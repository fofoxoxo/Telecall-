import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';

export interface CachedMediaRecord {
  fileId: string;
  dcId: number;
  mimeType: string;
  fileName: string;
  fileSize: number;
  localFilePath: string;
  thumbnailBase64: string | null;
  accessHash: string;
  updatedAt: number;
}

const CACHE_DIR = path.join(process.cwd(), '.cache', 'telecall_media');
const SQLITE_DB_PATH = path.join(CACHE_DIR, 'media_metadata.sqlite');

/**
 * Local SQLite + File System Cache Layer
 * Persists downloaded media metadata, DC ownership, and thumbnails in a SQLite database
 * (`media_metadata.sqlite`) alongside chunked binary files on disk for offline access.
 */
export class LocalMediaCache {
  private db: Database | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  public async ensureInitialized(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const SQL = await initSqlJs();
      if (fs.existsSync(SQLITE_DB_PATH)) {
        const fileBuffer = fs.readFileSync(SQLITE_DB_PATH);
        this.db = new SQL.Database(fileBuffer);
      } else {
        this.db = new SQL.Database();
      }

      this.db.run(`
        CREATE TABLE IF NOT EXISTS media_cache (
          file_id TEXT PRIMARY KEY,
          dc_id INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          local_file_path TEXT NOT NULL,
          thumbnail_base64 TEXT,
          access_hash TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_media_dc ON media_cache(dc_id);
      `);
      this.persistDbToDisk();
    })();

    return this.initPromise;
  }

  private persistDbToDisk(): void {
    if (!this.db) return;
    const binaryArray = this.db.export();
    fs.writeFileSync(SQLITE_DB_PATH, Buffer.from(binaryArray));
  }

  public async upsertMediaRecord(record: CachedMediaRecord): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO media_cache
       (file_id, dc_id, mime_type, file_name, file_size, local_file_path, thumbnail_base64, access_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.fileId,
        record.dcId,
        record.mimeType,
        record.fileName,
        record.fileSize,
        record.localFilePath,
        record.thumbnailBase64,
        record.accessHash,
        record.updatedAt,
      ]
    );
    this.persistDbToDisk();
  }

  public async getMediaRecord(fileId: string): Promise<CachedMediaRecord | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    const stmt = this.db.prepare('SELECT * FROM media_cache WHERE file_id = ? LIMIT 1');
    stmt.bind([fileId]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const row = stmt.getAsObject() as Record<string, any>;
    stmt.free();

    return {
      fileId: String(row.file_id),
      dcId: Number(row.dc_id),
      mimeType: String(row.mime_type),
      fileName: String(row.file_name),
      fileIdSize: Number(row.file_size),
      fileSize: Number(row.file_size),
      localFilePath: String(row.local_file_path),
      thumbnailBase64: row.thumbnail_base64 ? String(row.thumbnail_base64) : null,
      accessHash: String(row.access_hash || ''),
      updatedAt: Number(row.updated_at),
    } as CachedMediaRecord;
  }

  public async listCachedMedia(limit = 50): Promise<CachedMediaRecord[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const stmt = this.db.prepare('SELECT * FROM media_cache ORDER BY updated_at DESC LIMIT ?');
    stmt.bind([limit]);
    const results: CachedMediaRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      results.push({
        fileId: String(row.file_id),
        dcId: Number(row.dc_id),
        mimeType: String(row.mime_type),
        fileName: String(row.file_name),
        fileSize: Number(row.file_size),
        localFilePath: String(row.local_file_path),
        thumbnailBase64: row.thumbnail_base64 ? String(row.thumbnail_base64) : null,
        accessHash: String(row.access_hash || ''),
        updatedAt: Number(row.updated_at),
      });
    }
    stmt.free();
    return results;
  }

  public getLocalFilePath(fileId: string, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(CACHE_DIR, `${fileId}_${safeName}`);
  }
}

export const localMediaCache = new LocalMediaCache();
