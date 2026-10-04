import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { TELEGRAM_CONFIG, TELEGRAM_DC_MAP, DataCenterEndpoint } from '../config/telegramConfig';

export interface MigrationResult<T> {
  data: T;
  executedOnDc: number;
  migrated: boolean;
  migrationType?: 'FILE_MIGRATE' | 'USER_MIGRATE' | 'PHONE_MIGRATE' | 'NETWORK_MIGRATE';
}

/**
 * Step 2.1: Multi-DC Migration & Routing Manager (DC1 to DC5)
 * Uses GramJS (`TelegramClient`) to maintain pooled connections across Telegram Data Centers
 * and automatically intercepts `FILE_MIGRATE_X`, `USER_MIGRATE_X`, `PHONE_MIGRATE_X`, and
 * `NETWORK_MIGRATE_X` errors—exporting/importing authorization across DCs transparently.
 */
export class MultiDcRouter {
  private dcClients = new Map<number, TelegramClient>();
  private dcStrings = new Map<number, string>();
  private activePrimaryDc: number = TELEGRAM_CONFIG.DEFAULT_DC_ID;

  constructor(initialSessionString = '') {
    if (initialSessionString) {
      this.dcStrings.set(this.activePrimaryDc, initialSessionString);
    }
  }

  /**
   * Parse Telegram RPC Error strings such as `FILE_MIGRATE_4`, `USER_MIGRATE_2`, `PHONE_MIGRATE_5`
   */
  public parseMigrateError(error: unknown): {
    type: 'FILE_MIGRATE' | 'USER_MIGRATE' | 'PHONE_MIGRATE' | 'NETWORK_MIGRATE';
    targetDc: number;
  } | null {
    const message =
      (error as any)?.errorMessage ||
      (error as any)?.message ||
      String(error || '');

    const match = message.match(/(FILE_MIGRATE|USER_MIGRATE|PHONE_MIGRATE|NETWORK_MIGRATE)_(\d+)/i);
    if (!match) return null;

    const type = match[1].toUpperCase() as
      | 'FILE_MIGRATE'
      | 'USER_MIGRATE'
      | 'PHONE_MIGRATE'
      | 'NETWORK_MIGRATE';
    const targetDc = Number(match[2]);

    if (targetDc >= 1 && targetDc <= 5) {
      return { type, targetDc };
    }
    return null;
  }

  /**
   * Get or create a GramJS TelegramClient bound to a specific Data Center (DC1 - DC5)
   */
  public async getClientForDc(dcId: number): Promise<TelegramClient> {
    const validDc = TELEGRAM_DC_MAP[dcId] ? dcId : TELEGRAM_CONFIG.DEFAULT_DC_ID;
    const existing = this.dcClients.get(validDc);
    if (existing) {
      return existing;
    }

    const dcEndpoint: DataCenterEndpoint = TELEGRAM_DC_MAP[validDc];
    const savedSession = this.dcStrings.get(validDc) || '';
    const stringSession = new StringSession(savedSession);

    // Pre-bind session to target DC IP & Port (DC1..DC5)
    stringSession.setDC(dcEndpoint.dcId, dcEndpoint.ipAddress, dcEndpoint.port);

    const client = new TelegramClient(
      stringSession,
      TELEGRAM_CONFIG.API_ID,
      TELEGRAM_CONFIG.API_HASH,
      {
        connectionRetries: 5,
        useWSS: false,
        deviceModel: TELEGRAM_CONFIG.DEVICE_MODEL,
        systemVersion: TELEGRAM_CONFIG.SYSTEM_VERSION,
        appVersion: TELEGRAM_CONFIG.APP_VERSION,
      }
    );

    this.dcClients.set(validDc, client);
    return client;
  }

  /**
   * Cross-DC Authorization Transfer (`auth.exportAuthorization` -> `auth.importAuthorization`)
   * Called automatically when `FILE_MIGRATE_X` or `USER_MIGRATE_X` occurs.
   */
  public async migrateAuthorization(sourceDc: number, targetDc: number): Promise<void> {
    if (sourceDc === targetDc) return;

    const sourceClient = await this.getClientForDc(sourceDc);
    const targetClient = await this.getClientForDc(targetDc);

    if (!sourceClient.connected) {
      await sourceClient.connect();
    }
    if (!targetClient.connected) {
      await targetClient.connect();
    }

    const exportedAuth = await sourceClient.invoke(
      new Api.auth.ExportAuthorization({ dcId: targetDc })
    );

    await targetClient.invoke(
      new Api.auth.ImportAuthorization({
        id: exportedAuth.id,
        bytes: exportedAuth.bytes,
      })
    );

    // Save updated StringSession for the target DC
    const newTargetSession = targetClient.session.save() as unknown as string;
    if (newTargetSession) {
      this.dcStrings.set(targetDc, newTargetSession);
    }
  }

  /**
   * Execute any MTProto RPC request or media operation with automatic Multi-DC Migration retry.
   * Handles both `FILE_MIGRATE_X` (media on another DC) and `USER_MIGRATE_X` (user account on another DC).
   */
  public async executeWithDcMigration<T>(
    operation: (client: TelegramClient, dcId: number) => Promise<T>,
    preferredDcId: number = this.activePrimaryDc
  ): Promise<MigrationResult<T>> {
    let currentDc = preferredDcId;

    try {
      const client = await this.getClientForDc(currentDc);
      const data = await operation(client, currentDc);
      return {
        data,
        executedOnDc: currentDc,
        migrated: false,
      };
    } catch (err) {
      const migration = this.parseMigrateError(err);
      if (!migration) {
        throw err;
      }

      const { type, targetDc } = migration;

      // If USER_MIGRATE or PHONE_MIGRATE, switch primary DC
      if (type === 'USER_MIGRATE' || type === 'PHONE_MIGRATE') {
        this.activePrimaryDc = targetDc;
      }

      try {
        // Attempt cross-DC auth transfer if already logged in on source DC
        await this.migrateAuthorization(currentDc, targetDc);
      } catch {
        // If unauthenticated or running in standalone bridge mode, continue directly on target DC
      }

      const migratedClient = await this.getClientForDc(targetDc);
      const data = await operation(migratedClient, targetDc);

      return {
        data,
        executedOnDc: targetDc,
        migrated: true,
        migrationType: type,
      };
    }
  }

  public getStatusSummary() {
    return {
      primaryDc: this.activePrimaryDc,
      primaryRegion: TELEGRAM_DC_MAP[this.activePrimaryDc]?.region,
      pooledDcs: Array.from(this.dcClients.keys()),
      availableDcs: Object.values(TELEGRAM_DC_MAP),
    };
  }
}

export const multiDcRouter = new MultiDcRouter();
