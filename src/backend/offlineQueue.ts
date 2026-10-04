import crypto from 'crypto';
import {
  localSqliteDb,
  OfflineQueueItem,
  LocalMessageRecord,
  LocalDialogRecord,
  LocalTopicPathRecord,
} from './localDatabase';
import { ptsDiffSyncService } from './ptsSyncService';

type ActionExecutor = (payload: Record<string, any>) => Promise<void>;

/**
 * Step 3.3: Offline Queue Manager
 * Records user actions (sending messages, joining voice rooms, creating rooms, updating settings)
 * into SQLite while offline or on flaky 2G connections, and sequentially flushes them
 * as soon as connectivity is available.
 */
export class OfflineQueueManager {
  private isFlushing = false;
  private isOnline = true;
  private customExecutors = new Map<OfflineQueueItem['actionType'], ActionExecutor>();

  constructor() {
    this.registerDefaultExecutors();
  }

  private registerDefaultExecutors(): void {
    // 1. SEND_MESSAGE Executor
    this.customExecutors.set('SEND_MESSAGE', async (payload) => {
      const ptsState = await ptsDiffSyncService.advanceLocalPts(1);
      const msg: LocalMessageRecord = {
        messageId: String(payload.messageId || `msg-${Date.now()}`),
        dialogId: String(payload.dialogId || 'general'),
        senderId: String(payload.senderId || 'tg-local-user'),
        senderName: String(payload.senderName || 'TeleCall User'),
        topicPath: String(payload.topicPath || '/general/chat/main'),
        text: String(payload.text || ''),
        mediaFileId: payload.mediaFileId ? String(payload.mediaFileId) : null,
        pts: ptsState.pts,
        createdAt: Number(payload.createdAt || Date.now()),
      };
      await localSqliteDb.insertMessage(msg);
    });

    // 2. JOIN_VOICE_ROOM Executor
    this.customExecutors.set('JOIN_VOICE_ROOM', async (payload) => {
      const ptsState = await ptsDiffSyncService.advanceLocalPts(1);
      const dialog: LocalDialogRecord = {
        dialogId: String(payload.roomId || `room-${Date.now()}`),
        title: String(payload.title || 'Voice Room'),
        dialogType: 'voice_room',
        topicPath: String(payload.topicPath || '/general/voice/room'),
        unreadCount: 0,
        lastMessageId: `join-${Date.now()}`,
        lastMessagePreview: `${payload.userName || 'User'} joined the voice room.`,
        pts: ptsState.pts,
        isPublic: payload.visibility !== 'private',
        updatedAt: Date.now(),
      };
      await localSqliteDb.upsertDialog(dialog);
    });

    // 3. CREATE_VOICE_ROOM Executor
    this.customExecutors.set('CREATE_VOICE_ROOM', async (payload) => {
      const ptsState = await ptsDiffSyncService.advanceLocalPts(1);
      const topicPath = String(payload.topicPath || '/general/voice/custom');
      const parts = topicPath.split('/').filter(Boolean);

      const topicRecord: LocalTopicPathRecord = {
        topicPath,
        category: parts[0] || 'general',
        topic: parts[1] || 'voice',
        subtopic: parts[2] || 'custom',
        activeRoomsCount: 1,
        subscriberCount: 1,
        rulesJson: JSON.stringify(payload.rules || []),
        updatedAt: Date.now(),
      };
      await localSqliteDb.upsertTopicPath(topicRecord);

      const dialog: LocalDialogRecord = {
        dialogId: String(payload.roomId || `room-${Date.now()}`),
        title: String(payload.title || 'New Voice Room'),
        dialogType: 'voice_room',
        topicPath,
        unreadCount: 0,
        lastMessageId: `create-${Date.now()}`,
        lastMessagePreview: `Voice room created by ${payload.hostName || 'Host'}`,
        pts: ptsState.pts,
        isPublic: payload.visibility !== 'private',
        updatedAt: Date.now(),
      };
      await localSqliteDb.upsertDialog(dialog);
    });

    // 4. UPDATE_SETTINGS Executor
    this.customExecutors.set('UPDATE_SETTINGS', async (payload) => {
      await ptsDiffSyncService.advanceLocalPts(1);
      if (payload.userId) {
        await localSqliteDb.upsertUserProfile({
          userId: String(payload.userId),
          phone: String(payload.phone || ''),
          username: String(payload.username || ''),
          displayName: String(payload.displayName || 'TeleCall User'),
          bio: String(payload.bio || ''),
          avatarFileId: payload.avatarFileId ? String(payload.avatarFileId) : null,
          onlineStatus: 'online',
          lastSeenAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });
  }

  public setConnectivityState(online: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = online;
    if (online && wasOffline) {
      this.flushPendingQueue().catch(() => {});
    }
  }

  /**
   * Enqueue an action and immediately flush if online (or hold in SQLite if offline)
   */
  public async enqueueAction(
    actionType: OfflineQueueItem['actionType'],
    payload: Record<string, unknown>,
    forceOfflineQueue = false
  ): Promise<{ item: OfflineQueueItem; executedImmediately: boolean }> {
    const queueId = `q-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const item = await localSqliteDb.enqueueOfflineAction(queueId, actionType, payload);

    if (this.isOnline && !forceOfflineQueue) {
      await this.flushPendingQueue();
      return { item, executedImmediately: true };
    }

    return { item, executedImmediately: false };
  }

  /**
   * Sequentially execute all pending offline actions in FIFO order (`created_at ASC`)
   */
  public async flushPendingQueue(): Promise<{
    processedCount: number;
    completedIds: string[];
    failedIds: string[];
  }> {
    if (this.isFlushing) {
      return { processedCount: 0, completedIds: [], failedIds: [] };
    }

    this.isFlushing = true;
    const completedIds: string[] = [];
    const failedIds: string[] = [];

    try {
      const pendingItems = await localSqliteDb.getPendingOfflineQueue();

      for (const item of pendingItems) {
        await localSqliteDb.updateQueueItemStatus(item.queueId, 'processing');
        try {
          const payload = JSON.parse(item.payloadJson);
          const executor = this.customExecutors.get(item.actionType);
          if (executor) {
            await executor(payload);
          }
          await localSqliteDb.updateQueueItemStatus(item.queueId, 'completed', null);
          completedIds.push(item.queueId);
        } catch (err) {
          await localSqliteDb.updateQueueItemStatus(
            item.queueId,
            'failed',
            (err as Error).message
          );
          failedIds.push(item.queueId);
        }
      }
    } finally {
      this.isFlushing = false;
    }

    return {
      processedCount: completedIds.length + failedIds.length,
      completedIds,
      failedIds,
    };
  }
}

export const offlineQueueManager = new OfflineQueueManager();
