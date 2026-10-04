import { Router, Request, Response } from 'express';
import { localSqliteDb } from './localDatabase';
import { ptsDiffSyncService } from './ptsSyncService';
import { offlineQueueManager } from './offlineQueue';

/**
 * Step 3.4: Fast Local Reader & Offline Sync Express APIs (`/api/local-sync/*`)
 * Reads chat feeds, searches hierarchical topic paths (`/category/topic/subtopic`),
 * loads dialog history directly from SQLite for 0ms local rendering, and manages
 * PTS diff synchronization + offline action queue flushing.
 */
export function createLocalSyncRouter(): Router {
  const router = Router();

  // 1. Fast Local Feed Reader: Get cached dialogs, topic paths, user profiles & PTS state in 1 call
  router.get('/feed', async (req: Request, res: Response) => {
    try {
      const topicPrefix = req.query.topicPath ? String(req.query.topicPath) : undefined;
      const [dialogs, topics, profiles, ptsState, pendingQueue] = await Promise.all([
        localSqliteDb.getDialogs(topicPrefix, 50),
        localSqliteDb.searchTopicPaths(''),
        localSqliteDb.getUserProfiles(),
        localSqliteDb.getPtsState('primary'),
        localSqliteDb.getPendingOfflineQueue(),
      ]);

      res.json({
        ok: true,
        ptsState,
        dialogs,
        topics,
        profiles,
        pendingOfflineActionsCount: pendingQueue.length,
        pendingQueue,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 2. Fast Topic Path Search (`/category/topic/subtopic`)
  router.get('/topics/search', async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '');
      const topics = await localSqliteDb.searchTopicPaths(q);
      res.json({ ok: true, count: topics.length, topics });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 3. Upsert a Custom Hierarchical Topic Path (`/category/topic/subtopic`)
  router.post('/topics', async (req: Request, res: Response) => {
    try {
      const { topicPath, rules, subscriberCount } = req.body;
      const normalized = String(topicPath || '/general/voice/talk').startsWith('/')
        ? String(topicPath)
        : `/${String(topicPath)}`;
      const parts = normalized.split('/').filter(Boolean);

      const record = {
        topicPath: normalized,
        category: parts[0] || 'general',
        topic: parts[1] || 'voice',
        subtopic: parts[2] || 'general',
        activeRoomsCount: 1,
        subscriberCount: Number(subscriberCount || 1),
        rulesJson: JSON.stringify(Array.isArray(rules) ? rules : []),
        updatedAt: Date.now(),
      };

      await localSqliteDb.upsertTopicPath(record);
      res.json({ ok: true, topic: record });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 4. Fast Local Dialog Message History Reader
  router.get('/history/:dialogId', async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const messages = await localSqliteDb.getMessagesByDialog(req.params.dialogId, limit);
      res.json({ ok: true, dialogId: req.params.dialogId, messages });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 5. Trigger Telegram PTS & Diff Sync (`updates.getDifference`)
  router.post('/pts-sync', async (req: Request, res: Response) => {
    try {
      const accountId = String(req.body?.accountId || 'primary');
      const report = await ptsDiffSyncService.syncMissingUpdates(accountId);
      res.json({ ok: true, report });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 6. Enqueue User Action (Offline Queue or Immediate Execution)
  router.post('/queue/enqueue', async (req: Request, res: Response) => {
    try {
      const { actionType, payload, offlineMode } = req.body;
      const result = await offlineQueueManager.enqueueAction(
        actionType || 'SEND_MESSAGE',
        payload || {},
        Boolean(offlineMode)
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 7. Flush Pending Offline Queue on Reconnect
  router.post('/queue/flush', async (_req: Request, res: Response) => {
    try {
      offlineQueueManager.setConnectivityState(true);
      const flushReport = await offlineQueueManager.flushPendingQueue();
      const ptsReport = await ptsDiffSyncService.syncMissingUpdates('primary');
      res.json({ ok: true, flushReport, ptsReport });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  return router;
}
