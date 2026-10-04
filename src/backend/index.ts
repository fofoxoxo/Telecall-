import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { multiDcRouter } from './dcRouter';
import { streamingMediaHandler } from './mediaHandler';
import { localMediaCache } from './localCache';

export { multiDcRouter, MultiDcRouter } from './dcRouter';
export { streamingMediaHandler, StreamingMediaHandler } from './mediaHandler';
export { localMediaCache, LocalMediaCache } from './localCache';
export type { CachedMediaRecord } from './localCache';

/**
 * Step 2.4: Clean Modular Express Bridge Router (`/api/dc-media/*`)
 * Exposes Multi-DC status, FILE_MIGRATE / USER_MIGRATE simulation & execution,
 * non-blocking chunked media upload/download streaming, and SQLite thumbnail/metadata cache.
 */
export function createDcMediaBridgeRouter(): Router {
  const router = Router();

  // 1. Get Multi-DC Router & SQLite Cache Status
  router.get('/status', async (_req: Request, res: Response) => {
    const cachedItems = await localMediaCache.listCachedMedia(20);
    res.json({
      ok: true,
      dcRouter: multiDcRouter.getStatusSummary(),
      cachedMediaCount: cachedItems.length,
      cachedMedia: cachedItems,
    });
  });

  // 2. Test / Trigger Multi-DC Migration (`FILE_MIGRATE_X` or `USER_MIGRATE_X`)
  router.post('/migrate-test', async (req: Request, res: Response) => {
    const { simulateError, preferredDc } = req.body;
    try {
      let attempt = 0;
      const result = await multiDcRouter.executeWithDcMigration(async (_client, dcId) => {
        attempt += 1;
        if (attempt === 1 && simulateError) {
          throw new Error(String(simulateError)); // e.g., "FILE_MIGRATE_4" or "USER_MIGRATE_2"
        }
        return { message: `Successfully resolved on DC${dcId}`, attempt };
      }, Number(preferredDc) || undefined);

      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 3. Non-Blocking Streaming Media Upload (Saves chunks + SQLite thumbnail & metadata)
  router.post('/upload', async (req: Request, res: Response) => {
    try {
      const { fileName, mimeType, base64Data, dcId, thumbnailBase64 } = req.body;
      const rawBuffer = Buffer.from(String(base64Data || 'VGVsZUNhbGwgTWVkaWEgU3RyZWFt'), 'base64');
      const inputStream = Readable.from(rawBuffer);

      const uploadResult = await streamingMediaHandler.streamUploadMedia(inputStream, {
        fileName: String(fileName || `media_${Date.now()}.bin`),
        mimeType: String(mimeType || 'application/octet-stream'),
        fileSize: rawBuffer.length,
        dcId: Number(dcId) || undefined,
        thumbnailBase64: thumbnailBase64 ? String(thumbnailBase64) : undefined,
      });

      res.json({ ok: true, ...uploadResult });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 4. Non-Blocking Streaming Media Download (Serves from SQLite/Disk Cache or Remote DC)
  router.get('/download/:fileId', async (req: Request, res: Response) => {
    try {
      const { fileId } = req.params;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;

      const { stream, record, cacheHit, executedOnDc } =
        await streamingMediaHandler.createDownloadStream({
          fileId,
          offset,
          limit,
        });

      res.setHeader('Content-Type', record.mimeType);
      res.setHeader('X-TeleCall-DC', String(executedOnDc));
      res.setHeader('X-TeleCall-Cache-Hit', String(cacheHit));
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(record.fileName)}"`
      );

      stream.pipe(res);
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 5. Retrieve Offline Thumbnail & Metadata from Local SQLite Cache
  router.get('/metadata/:fileId', async (req: Request, res: Response) => {
    const record = await localMediaCache.getMediaRecord(req.params.fileId);
    if (!record) {
      res.status(404).json({ ok: false, error: 'Media metadata not found in local SQLite cache.' });
      return;
    }
    res.json({ ok: true, record });
  });

  return router;
}
