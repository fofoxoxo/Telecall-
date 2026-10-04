import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Router, Request, Response } from 'express';
import { fcmPushService, IncomingCallPushPayload } from './fcmPushService';
import { localSqliteDb } from './localDatabase';

/**
 * Step 6.3: Socket.io Real-Time Gateway (`/socket.io`)
 * Streams foreground real-time updates (typing indicators, new messages,
 * topic room activity, read receipts, and incoming call ringing) when the client is active,
 * and falls back to High-Priority FCM Push (`fcmPushService`) when a callee is in background/offline.
 */
export class RealtimeSocketGateway {
  private io: SocketIOServer | null = null;
  private activeUserSockets = new Map<string, Set<string>>(); // userId -> Set<socket.id>

  public attachToServer(httpServer: http.Server): SocketIOServer {
    if (this.io) return this.io;

    this.io = new SocketIOServer(httpServer, {
      path: '/socket.io',
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      pingInterval: 15000,
      pingTimeout: 10000,
    });

    this.io.on('connection', (socket: Socket) => {
      let currentUserId = String(socket.handshake.auth?.userId || socket.handshake.query?.userId || '');

      if (currentUserId) {
        this.registerUserSocket(currentUserId, socket.id);
        socket.join(`user:${currentUserId}`);
      }

      // 1. Register User Session & Optional FCM Token on Connect
      socket.on('session:register', async (data: {
        userId: string;
        sessionId: string;
        fcmToken?: string;
        devicePlatform?: 'android' | 'web' | 'ios';
      }) => {
        if (data?.userId) {
          currentUserId = String(data.userId);
          this.registerUserSocket(currentUserId, socket.id);
          socket.join(`user:${currentUserId}`);
        }
        if (data?.fcmToken && data?.sessionId && data?.userId) {
          await fcmPushService.saveOrUpdateToken({
            sessionId: String(data.sessionId),
            userId: String(data.userId),
            fcmToken: String(data.fcmToken),
            devicePlatform: data.devicePlatform || 'android',
            appVersion: '1.0.0',
            updatedAt: Date.now(),
          });
        }
        socket.emit('session:registered', { ok: true, userId: currentUserId });
      });

      // 2. Join Topic Room or Dialog Channel for Real-Time Activity
      socket.on('topic:subscribe', (data: { dialogId?: string; topicPath?: string }) => {
        if (data?.dialogId) socket.join(`dialog:${data.dialogId}`);
        if (data?.topicPath) socket.join(`topic:${data.topicPath}`);
      });

      // 3. Typing Indicator Broadcast (`typing:start` / `typing:stop`)
      socket.on('typing:update', (data: {
        dialogId: string;
        userId: string;
        userName: string;
        isTyping: boolean;
      }) => {
        if (!data?.dialogId) return;
        socket.to(`dialog:${data.dialogId}`).emit('typing:updated', {
          dialogId: data.dialogId,
          userId: data.userId || currentUserId,
          userName: data.userName || 'TeleCall User',
          isTyping: Boolean(data.isTyping),
          timestamp: Date.now(),
        });
      });

      // 4. Real-Time New Message Broadcast + SQLite Persistence
      socket.on('message:send', async (data: {
        messageId?: string;
        dialogId: string;
        senderId: string;
        senderName: string;
        topicPath?: string;
        text: string;
        mediaFileId?: string;
      }) => {
        if (!data?.dialogId || !data?.text) return;
        const msgRecord = {
          messageId: data.messageId || `msg-${Date.now()}`,
          dialogId: String(data.dialogId),
          senderId: String(data.senderId || currentUserId || 'tg-user'),
          senderName: String(data.senderName || 'TeleCall User'),
          topicPath: String(data.topicPath || '/general/chat'),
          text: String(data.text),
          mediaFileId: data.mediaFileId ? String(data.mediaFileId) : null,
          pts: Date.now() % 1000000,
          createdAt: Date.now(),
        };

        await localSqliteDb.insertMessage(msgRecord);
        this.io?.to(`dialog:${data.dialogId}`).emit('message:new', msgRecord);
      });

      // 5. Read Receipts (`message:read`)
      socket.on('message:read', (data: {
        dialogId: string;
        messageId: string;
        readerId: string;
      }) => {
        if (!data?.dialogId) return;
        socket.to(`dialog:${data.dialogId}`).emit('message:readReceipt', {
          dialogId: data.dialogId,
          messageId: data.messageId,
          readerId: data.readerId || currentUserId,
          readAt: Date.now(),
        });
      });

      // 6. Topic Room Live Activity Broadcast (speaker change, hand raise, listener count)
      socket.on('room:activity', (data: {
        roomId: string;
        topicPath?: string;
        activityType: string;
        summary: string;
      }) => {
        if (data?.roomId) {
          this.io?.to(`dialog:${data.roomId}`).emit('room:activityUpdated', {
            ...data,
            timestamp: Date.now(),
          });
        }
        if (data?.topicPath) {
          this.io?.to(`topic:${data.topicPath}`).emit('topic:roomActivity', {
            ...data,
            timestamp: Date.now(),
          });
        }
      });

      // 7. Initiate Voice Call -> Ring Foreground Socket OR Trigger High-Priority Background FCM Push
      socket.on('call:ringPeer', async (data: IncomingCallPushPayload & { targetUserId: string }) => {
        const targetId = String(data.targetUserId || '');
        const isForegroundOnline = this.isUserOnlineInForeground(targetId);

        if (isForegroundOnline) {
          this.io?.to(`user:${targetId}`).emit('call:incoming', data);
        }

        // Always also dispatch High-Priority FCM Data-Only Wakeup Push for Android background/killed state
        const pushResult = await fcmPushService.sendIncomingCallPush(targetId, data);
        socket.emit('call:ringStatus', {
          targetUserId: targetId,
          foregroundSocketDelivered: isForegroundOnline,
          fcmPushResult: pushResult,
        });
      });

      socket.on('disconnect', () => {
        if (currentUserId) {
          this.unregisterUserSocket(currentUserId, socket.id);
        }
      });
    });

    return this.io;
  }

  private registerUserSocket(userId: string, socketId: string): void {
    const set = this.activeUserSockets.get(userId) || new Set<string>();
    set.add(socketId);
    this.activeUserSockets.set(userId, set);
  }

  private unregisterUserSocket(userId: string, socketId: string): void {
    const set = this.activeUserSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
      this.activeUserSockets.delete(userId);
    }
  }

  public isUserOnlineInForeground(userId: string): boolean {
    const set = this.activeUserSockets.get(userId);
    return Boolean(set && set.size > 0);
  }

  public emitToRoom(roomId: string, event: string, payload: unknown): void {
    this.io?.to(`dialog:${roomId}`).emit(event, payload);
  }
}

export const realtimeSocketGateway = new RealtimeSocketGateway();

/**
 * Step 6.4 & 6.5 Express Router (`/api/notifications/*`)
 * Exposes FCM Token CRUD endpoints (save, update, remove) and High-Priority Background Call Wakeup Push.
 */
export function createFcmNotificationsRouter(): Router {
  const router = Router();

  // 1. Check Firebase Admin SDK & Socket.io Gateway Status
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      ...fcmPushService.getStatus(),
    });
  });

  // 2. Save or Update FCM Device Token for a User Session ID
  router.post('/tokens', async (req: Request, res: Response) => {
    try {
      const { sessionId, userId, fcmToken, devicePlatform, appVersion } = req.body;
      if (!sessionId || !userId || !fcmToken) {
        res.status(400).json({
          ok: false,
          error: 'sessionId, userId, and fcmToken are required.',
        });
        return;
      }

      const saved = await fcmPushService.saveOrUpdateToken({
        sessionId: String(sessionId),
        userId: String(userId),
        fcmToken: String(fcmToken),
        devicePlatform: devicePlatform || 'android',
        appVersion: String(appVersion || '1.0.0'),
        updatedAt: Date.now(),
      });

      res.json({ ok: true, tokenRecord: saved });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 3. Remove FCM Device Token (on Logout or Unregister)
  router.delete('/tokens/:sessionIdOrToken', async (req: Request, res: Response) => {
    try {
      await fcmPushService.removeToken(req.params.sessionIdOrToken);
      res.json({ ok: true, removed: req.params.sessionIdOrToken });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 4. Trigger High-Priority Data-Only Background Incoming Call Push
  router.post('/call-wakeup', async (req: Request, res: Response) => {
    try {
      const {
        targetUserId,
        callSessionId,
        callerId,
        callerName,
        callerPhone,
        roomId,
        isGroupVoiceRoom,
        dhEmojiFingerprint,
      } = req.body;

      if (!targetUserId || !callerName) {
        res.status(400).json({
          ok: false,
          error: 'targetUserId and callerName are required to dispatch wakeup call push.',
        });
        return;
      }

      const result = await fcmPushService.sendIncomingCallPush(String(targetUserId), {
        callSessionId: String(callSessionId || `call-${Date.now()}`),
        callerId: String(callerId || 'tg-caller'),
        callerName: String(callerName),
        callerPhone: String(callerPhone || ''),
        roomId: roomId ? String(roomId) : undefined,
        isGroupVoiceRoom: Boolean(isGroupVoiceRoom),
        dhEmojiFingerprint: Array.isArray(dhEmojiFingerprint)
          ? dhEmojiFingerprint
          : ['🔐', '🚀', '🦁', '🎸'],
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  return router;
}
