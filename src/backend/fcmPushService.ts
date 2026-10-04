import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { localSqliteDb } from './localDatabase';

export interface FcmDeviceTokenRecord {
  sessionId: string;
  userId: string;
  fcmToken: string;
  devicePlatform: 'android' | 'web' | 'ios';
  appVersion: string;
  updatedAt: number;
}

export interface IncomingCallPushPayload {
  callSessionId: string;
  callerId: string;
  callerName: string;
  callerPhone: string;
  roomId?: string;
  isGroupVoiceRoom?: boolean;
  dhEmojiFingerprint?: string[];
  codecProfile?: string;
}

/**
 * Step 6.1, 6.2, 6.4 & 6.5: Firebase Admin SDK & FCM Push Notification Engine
 * - Loads credentials strictly from `process.env.FIREBASE_SERVICE_ACCOUNT_JSON` or
 *   `process.env.FIREBASE_SERVICE_ACCOUNT_PATH` (zero hardcoded keys).
 * - Manages FCM Device Tokens mapped to `session_id` and `user_id` in SQLite.
 * - Constructs Android High-Priority Data-Only Background Call Payloads (`priority: 'high'`,
 *   `ttl: 0`) to wake up killed/backgrounded Android apps for incoming calls.
 */
export class FcmPushService {
  private firebaseInitialized = false;
  private initError: string | null = null;
  private tableCreated = false;

  constructor() {
    // Lazy-initialized on first FCM request so server startup never blocks
  }

  /**
   * Step 6.1 & 6.2: Securely initialize Firebase Admin SDK from environment variables
   */
  public initializeFirebaseAdmin(): boolean {
    if (this.firebaseInitialized || getApps().length > 0) {
      this.firebaseInitialized = true;
      return true;
    }

    try {
      const rawJsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
      const filePathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();

      let serviceAccount: ServiceAccount | null = null;

      if (rawJsonEnv) {
        // Support both raw JSON string and Base64-encoded JSON string in GitHub Secrets
        const jsonString = rawJsonEnv.startsWith('{')
          ? rawJsonEnv
          : Buffer.from(rawJsonEnv, 'base64').toString('utf8');
        serviceAccount = JSON.parse(jsonString);
      } else if (filePathEnv) {
        const resolvedPath = path.isAbsolute(filePathEnv)
          ? filePathEnv
          : path.join(process.cwd(), filePathEnv);
        if (fs.existsSync(resolvedPath)) {
          serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        }
      }

      if (!serviceAccount) {
        this.initError =
          'FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH not set yet.';
        return false;
      }

      initializeApp({
        credential: cert(serviceAccount),
      });

      this.firebaseInitialized = true;
      this.initError = null;
      return true;
    } catch (err) {
      this.initError = (err as Error).message;
      return false;
    }
  }

  /**
   * Step 6.4: Ensure SQLite table `fcm_device_tokens` exists
   */
  private async ensureTokenTable(): Promise<void> {
    await localSqliteDb.ensureInitialized();
    if (this.tableCreated) return;

    const rawDb = (localSqliteDb as any).db;
    if (!rawDb) return;

    rawDb.run(`
      CREATE TABLE IF NOT EXISTS fcm_device_tokens (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        fcm_token TEXT NOT NULL,
        device_platform TEXT NOT NULL DEFAULT 'android',
        app_version TEXT NOT NULL DEFAULT '1.0.0',
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_fcm_user_id ON fcm_device_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_fcm_token ON fcm_device_tokens(fcm_token);
    `);

    this.tableCreated = true;
    localSqliteDb.flushToDisk();
  }

  /**
   * Save or update an FCM Device Token associated with a user Session ID
   */
  public async saveOrUpdateToken(record: FcmDeviceTokenRecord): Promise<FcmDeviceTokenRecord> {
    await this.ensureTokenTable();
    const rawDb = (localSqliteDb as any).db;
    const now = Date.now();

    const normalized: FcmDeviceTokenRecord = {
      sessionId: record.sessionId,
      userId: record.userId,
      fcmToken: record.fcmToken,
      devicePlatform: record.devicePlatform || 'android',
      appVersion: record.appVersion || '1.0.0',
      updatedAt: now,
    };

    if (rawDb) {
      rawDb.run(
        `INSERT OR REPLACE INTO fcm_device_tokens
         (session_id, user_id, fcm_token, device_platform, app_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          normalized.sessionId,
          normalized.userId,
          normalized.fcmToken,
          normalized.devicePlatform,
          normalized.appVersion,
          normalized.updatedAt,
        ]
      );
      localSqliteDb.flushToDisk();
    }

    return normalized;
  }

  /**
   * Remove an FCM Device Token by Session ID or Token string (e.g., on logout or token invalidation)
   */
  public async removeToken(sessionIdOrToken: string): Promise<boolean> {
    await this.ensureTokenTable();
    const rawDb = (localSqliteDb as any).db;
    if (!rawDb) return false;

    rawDb.run(
      'DELETE FROM fcm_device_tokens WHERE session_id = ? OR fcm_token = ?',
      [sessionIdOrToken, sessionIdOrToken]
    );
    localSqliteDb.flushToDisk();
    return true;
  }

  /**
   * Get all registered FCM device tokens for a specific target `userId`
   */
  public async getTokensForUser(userId: string): Promise<FcmDeviceTokenRecord[]> {
    await this.ensureTokenTable();
    const rawDb = (localSqliteDb as any).db;
    if (!rawDb) return [];

    const stmt = rawDb.prepare(
      'SELECT * FROM fcm_device_tokens WHERE user_id = ? ORDER BY updated_at DESC'
    );
    stmt.bind([userId]);

    const tokens: FcmDeviceTokenRecord[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      tokens.push({
        sessionId: String(r.session_id),
        userId: String(r.user_id),
        fcmToken: String(r.fcm_token),
        devicePlatform: (r.device_platform || 'android') as FcmDeviceTokenRecord['devicePlatform'],
        appVersion: String(r.app_version || '1.0.0'),
        updatedAt: Number(r.updated_at),
      });
    }
    stmt.free();
    return tokens;
  }

  /**
   * Step 6.5: Construct High-Priority Background Call Data-Only FCM Payload
   * Uses `data`-only keys (no `notification` block) with `android.priority = 'high'` and `ttl = 0`
   * so Android's `FirebaseMessagingService.onMessageReceived` wakes up immediately even when
   * the app is swiped away/killed or the device is in Doze mode, triggering the full-screen incoming call UI.
   */
  public buildHighPriorityCallMessage(
    fcmTokens: string[],
    callInfo: IncomingCallPushPayload
  ): MulticastMessage {
    return {
      tokens: fcmTokens,
      data: {
        type: 'TELECALL_INCOMING_VOICE_CALL',
        wakeupAction: ' LAUNCH_FULLSCREEN_CALL_OVERLAY',
        callSessionId: String(callInfo.callSessionId),
        callerId: String(callInfo.callerId),
        callerName: String(callInfo.callerName),
        callerPhone: String(callInfo.callerPhone),
        roomId: String(callInfo.roomId || ''),
        isGroupVoiceRoom: String(Boolean(callInfo.isGroupVoiceRoom)),
        dhEmojiFingerprint: JSON.stringify(callInfo.dhEmojiFingerprint || ['🔐', '🚀', '🦁', '🎸']),
        codecProfile: String(callInfo.codecProfile || 'Opus 8kbps Low-Latency'),
        timestamp: String(Date.now()),
      },
      android: {
        priority: 'high',
        ttl: 0, // Deliver immediately or drop if unreachable; real-time voice ringing cannot be delayed
        directBootOk: true,
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'voip',
        },
        payload: {
          aps: {
            contentAvailable: true,
          },
        },
      },
    };
  }

  /**
   * Dispatch High-Priority Incoming Call Push Notification to a target user's registered devices
   */
  public async sendIncomingCallPush(
    targetUserId: string,
    callInfo: IncomingCallPushPayload
  ): Promise<{
    sent: boolean;
    firebaseReady: boolean;
    targetTokensCount: number;
    successCount: number;
    failureCount: number;
    constructedPayload: Record<string, unknown>;
  }> {
    this.initializeFirebaseAdmin();
    const records = await this.getTokensForUser(targetUserId);
    const tokenStrings = records.map((r) => r.fcmToken);

    const multicastPayload = this.buildHighPriorityCallMessage(
      tokenStrings.length > 0 ? tokenStrings : ['placeholder-device-token'],
      callInfo
    );

    if (!this.firebaseInitialized || tokenStrings.length === 0) {
      return {
        sent: false,
        firebaseReady: this.firebaseInitialized,
        targetTokensCount: tokenStrings.length,
        successCount: 0,
        failureCount: 0,
        constructedPayload: multicastPayload as unknown as Record<string, unknown>,
      };
    }

    const response = await getMessaging().sendEachForMulticast(multicastPayload);

    // Clean up any stale/unregistered tokens automatically
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
        this.removeToken(tokenStrings[idx]).catch(() => {});
      }
    });

    return {
      sent: true,
      firebaseReady: true,
      targetTokensCount: tokenStrings.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      constructedPayload: multicastPayload as unknown as Record<string, unknown>,
    };
  }

  public getStatus() {
    this.initializeFirebaseAdmin();
    return {
      firebaseInitialized: this.firebaseInitialized,
      hasServiceAccountJsonEnv: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
      hasServiceAccountPathEnv: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PATH),
      statusMessage: this.firebaseInitialized
        ? 'Firebase Admin SDK active and ready for high-priority FCM push.'
        : this.initError,
    };
  }
}

export const fcmPushService = new FcmPushService();
