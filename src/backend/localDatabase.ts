import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';

export interface LocalDialogRecord {
  dialogId: string;
  title: string;
  dialogType: 'user' | 'group' | 'channel' | 'voice_room';
  topicPath: string; // Hierarchical path e.g. /education/upsc/prelims
  unreadCount: number;
  lastMessageId: string;
  lastMessagePreview: string;
  pts: number;
  isPublic: boolean;
  updatedAt: number;
}

export interface LocalMessageRecord {
  messageId: string;
  dialogId: string;
  senderId: string;
  senderName: string;
  topicPath: string;
  text: string;
  mediaFileId: string | null;
  pts: number;
  createdAt: number;
}

export interface LocalUserProfileRecord {
  userId: string;
  phone: string;
  username: string;
  displayName: string;
  bio: string;
  avatarFileId: string | null;
  onlineStatus: 'online' | 'offline' | 'in_call' | 'in_voice_room';
  lastSeenAt: number;
  updatedAt: number;
}

export interface LocalTopicPathRecord {
  topicPath: string; // e.g., /technology/android/mtproto
  category: string;
  topic: string;
  subtopic: string;
  activeRoomsCount: number;
  subscriberCount: number;
  rulesJson: string;
  updatedAt: number;
}

export interface PtsSyncStateRecord {
  accountId: string;
  pts: number;
  qts: number;
  date: number;
  seq: number;
  unreadPtsDiffCount: number;
  lastSyncedAt: number;
}

export interface OfflineQueueItem {
  queueId: string;
  actionType: 'SEND_MESSAGE' | 'JOIN_VOICE_ROOM' | 'UPDATE_SETTINGS' | 'CREATE_VOICE_ROOM';
  payloadJson: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

const DB_DIR = path.join(process.cwd(), '.cache', 'telecall_db');
const DB_FILE_PATH = path.join(DB_DIR, 'telechats_offline.sqlite');

/**
 * Step 3.1: SQLite Local Schema Engine
 * Caches dialogs, messages, user profiles, hierarchical topic paths (/category/topic/subtopic),
 * Telegram PTS/QTS/Seq state, and the Offline Action Queue on disk.
 */
export class LocalSqliteDatabase {
  private db: Database | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
  }

  public async ensureInitialized(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const SQL = await initSqlJs();
      if (fs.existsSync(DB_FILE_PATH)) {
        const buffer = fs.readFileSync(DB_FILE_PATH);
        this.db = new SQL.Database(buffer);
      } else {
        this.db = new SQL.Database();
      }

      this.createTablesAndIndexes();
      this.seedInitialDataIfEmpty();
      this.flushToDisk();
    })();

    return this.initPromise;
  }

  private createTablesAndIndexes(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS dialogs (
        dialog_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        dialog_type TEXT NOT NULL,
        topic_path TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_message_id TEXT NOT NULL DEFAULT '',
        last_message_preview TEXT NOT NULL DEFAULT '',
        pts INTEGER NOT NULL DEFAULT 1,
        is_public INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_dialogs_topic ON dialogs(topic_path);
      CREATE INDEX IF NOT EXISTS idx_dialogs_updated ON dialogs(updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        dialog_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        topic_path TEXT NOT NULL,
        text TEXT NOT NULL,
        media_file_id TEXT,
        pts INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_dialog ON messages(dialog_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_path);

      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        avatar_file_id TEXT,
        online_status TEXT NOT NULL DEFAULT 'online',
        last_seen_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topic_paths (
        topic_path TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        topic TEXT NOT NULL,
        subtopic TEXT NOT NULL,
        active_rooms_count INTEGER NOT NULL DEFAULT 0,
        subscriber_count INTEGER NOT NULL DEFAULT 0,
        rules_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_topic_category ON topic_paths(category, topic);

      CREATE TABLE IF NOT EXISTS pts_sync_state (
        account_id TEXT PRIMARY KEY,
        pts INTEGER NOT NULL DEFAULT 1,
        qts INTEGER NOT NULL DEFAULT 0,
        date INTEGER NOT NULL DEFAULT 0,
        seq INTEGER NOT NULL DEFAULT 0,
        unread_pts_diff_count INTEGER NOT NULL DEFAULT 0,
        last_synced_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS offline_queue (
        queue_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_queue_status ON offline_queue(status, created_at ASC);
    `);
  }

  private seedInitialDataIfEmpty(): void {
    if (!this.db) return;
    const check = this.db.prepare('SELECT COUNT(*) as cnt FROM topic_paths');
    check.step();
    const row = check.getAsObject() as { cnt: number };
    check.free();

    if (Number(row.cnt) > 0) return;

    const now = Date.now();

    // Seed Hierarchical TeleChats Topic Paths (/category/topic/subtopic)
    const defaultTopics: LocalTopicPathRecord[] = [
      {
        topicPath: '/education/upsc/current-affairs',
        category: 'education',
        topic: 'upsc',
        subtopic: 'current-affairs',
        activeRoomsCount: 4,
        subscriberCount: 1284,
        rulesJson: JSON.stringify([
          'Raise hand to speak on stage.',
          'Keep microphone muted when not speaking.',
        ]),
        updatedAt: now,
      },
      {
        topicPath: '/technology/android/mtproto-calling',
        category: 'technology',
        topic: 'android',
        subtopic: 'mtproto-calling',
        activeRoomsCount: 3,
        subscriberCount: 1042,
        rulesJson: JSON.stringify([
          'Share practical product and low-latency audio engineering tips.',
          'Hindi and English both welcome.',
        ]),
        updatedAt: now,
      },
      {
        topicPath: '/music/acoustic/midnight-mehfil',
        category: 'music',
        topic: 'acoustic',
        subtopic: 'midnight-mehfil',
        activeRoomsCount: 2,
        subscriberCount: 876,
        rulesJson: JSON.stringify(['Use earphones before coming on stage to prevent echo.']),
        updatedAt: now,
      },
    ];

    for (const t of defaultTopics) {
      this.db.run(
        `INSERT OR IGNORE INTO topic_paths
         (topic_path, category, topic, subtopic, active_rooms_count, subscriber_count, rules_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.topicPath,
          t.category,
          t.topic,
          t.subtopic,
          t.activeRoomsCount,
          t.subscriberCount,
          t.rulesJson,
          t.updatedAt,
        ]
      );
    }

    // Seed Default Dialogs
    this.db.run(
      `INSERT OR IGNORE INTO dialogs
       (dialog_id, title, dialog_type, topic_path, unread_count, last_message_id, last_message_preview, pts, is_public, updated_at)
       VALUES
       ('room-upsc-101', 'All India UPSC & State PCS Late Night Discussion', 'voice_room', '/education/upsc/current-affairs', 0, 'msg-101', 'Aarav joined the stage speaker panel.', 101, 1, ?),
       ('room-tech-talk', 'Android App Makers & Startup Founders Lounge', 'voice_room', '/technology/android/mtproto-calling', 0, 'msg-102', 'Low-latency 8kbps Opus mode enabled.', 102, 1, ?)`,
      [now, now]
    );

    // Seed Default PTS State
    this.db.run(
      `INSERT OR IGNORE INTO pts_sync_state
       (account_id, pts, qts, date, seq, unread_pts_diff_count, last_synced_at)
       VALUES ('primary', 102, 0, ?, 1, 0, ?)`,
      [Math.floor(now / 1000), now]
    );
  }

  public flushToDisk(): void {
    if (!this.db) return;
    const binary = this.db.export();
    fs.writeFileSync(DB_FILE_PATH, Buffer.from(binary));
  }

  // --- DIALOGS & MESSAGES CRUD ---

  public async upsertDialog(dialog: LocalDialogRecord): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO dialogs
       (dialog_id, title, dialog_type, topic_path, unread_count, last_message_id, last_message_preview, pts, is_public, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dialog.dialogId,
        dialog.title,
        dialog.dialogType,
        dialog.topicPath,
        dialog.unreadCount,
        dialog.lastMessageId,
        dialog.lastMessagePreview,
        dialog.pts,
        dialog.isPublic ? 1 : 0,
        dialog.updatedAt,
      ]
    );
    this.flushToDisk();
  }

  public async getDialogs(topicFilter?: string, limit = 50): Promise<LocalDialogRecord[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const query = topicFilter
      ? 'SELECT * FROM dialogs WHERE topic_path LIKE ? ORDER BY updated_at DESC LIMIT ?'
      : 'SELECT * FROM dialogs ORDER BY updated_at DESC LIMIT ?';

    const stmt = this.db.prepare(query);
    stmt.bind(topicFilter ? [`${topicFilter}%`, limit] : [limit]);

    const list: LocalDialogRecord[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      list.push({
        dialogId: String(r.dialog_id),
        title: String(r.title),
        dialogType: r.dialog_type as LocalDialogRecord['dialogType'],
        topicPath: String(r.topic_path),
        unreadCount: Number(r.unread_count),
        lastMessageId: String(r.last_message_id),
        lastMessagePreview: String(r.last_message_preview),
        pts: Number(r.pts),
        isPublic: Number(r.is_public) === 1,
        updatedAt: Number(r.updated_at),
      });
    }
    stmt.free();
    return list;
  }

  public async insertMessage(msg: LocalMessageRecord): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO messages
       (message_id, dialog_id, sender_id, sender_name, topic_path, text, media_file_id, pts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.messageId,
        msg.dialogId,
        msg.senderId,
        msg.senderName,
        msg.topicPath,
        msg.text,
        msg.mediaFileId,
        msg.pts,
        msg.createdAt,
      ]
    );

    this.db.run(
      `UPDATE dialogs
       SET last_message_id = ?, last_message_preview = ?, pts = MAX(pts, ?), updated_at = ?
       WHERE dialog_id = ?`,
      [msg.messageId, msg.text.slice(0, 120), msg.pts, msg.createdAt, msg.dialogId]
    );

    this.flushToDisk();
  }

  public async getMessagesByDialog(dialogId: string, limit = 100): Promise<LocalMessageRecord[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const stmt = this.db.prepare(
      'SELECT * FROM messages WHERE dialog_id = ? ORDER BY created_at ASC LIMIT ?'
    );
    stmt.bind([dialogId, limit]);

    const list: LocalMessageRecord[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      list.push({
        messageId: String(r.message_id),
        dialogId: String(r.dialog_id),
        senderId: String(r.sender_id),
        senderName: String(r.sender_name),
        topicPath: String(r.topic_path),
        text: String(r.text),
        mediaFileId: r.media_file_id ? String(r.media_file_id) : null,
        pts: Number(r.pts),
        createdAt: Number(r.created_at),
      });
    }
    stmt.free();
    return list;
  }

  // --- HIERARCHICAL TOPIC PATHS (/category/topic/subtopic) ---

  public async upsertTopicPath(record: LocalTopicPathRecord): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO topic_paths
       (topic_path, category, topic, subtopic, active_rooms_count, subscriber_count, rules_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.topicPath,
        record.category,
        record.topic,
        record.subtopic,
        record.activeRoomsCount,
        record.subscriberCount,
        record.rulesJson,
        record.updatedAt,
      ]
    );
    this.flushToDisk();
  }

  public async searchTopicPaths(query = ''): Promise<LocalTopicPathRecord[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const clean = query.trim().toLowerCase();
    const stmt = clean
      ? this.db.prepare(
          `SELECT * FROM topic_paths
           WHERE LOWER(topic_path) LIKE ? OR LOWER(category) LIKE ? OR LOWER(topic) LIKE ? OR LOWER(subtopic) LIKE ?
           ORDER BY subscriber_count DESC`
        )
      : this.db.prepare('SELECT * FROM topic_paths ORDER BY subscriber_count DESC');

    if (clean) {
      const pat = `%${clean}%`;
      stmt.bind([pat, pat, pat, pat]);
    }

    const list: LocalTopicPathRecord[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      list.push({
        topicPath: String(r.topic_path),
        category: String(r.category),
        topic: String(r.topic),
        subtopic: String(r.subtopic),
        activeRoomsCount: Number(r.active_rooms_count),
        subscriberCount: Number(r.subscriber_count),
        rulesJson: String(r.rules_json),
        updatedAt: Number(r.updated_at),
      });
    }
    stmt.free();
    return list;
  }

  // --- USER PROFILES ---

  public async upsertUserProfile(profile: LocalUserProfileRecord): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO user_profiles
       (user_id, phone, username, display_name, bio, avatar_file_id, online_status, last_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.userId,
        profile.phone,
        profile.username,
        profile.displayName,
        profile.bio,
        profile.avatarFileId,
        profile.onlineStatus,
        profile.lastSeenAt,
        profile.updatedAt,
      ]
    );
    this.flushToDisk();
  }

  public async getUserProfiles(): Promise<LocalUserProfileRecord[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const stmt = this.db.prepare('SELECT * FROM user_profiles ORDER BY updated_at DESC');
    const list: LocalUserProfileRecord[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      list.push({
        userId: String(r.user_id),
        phone: String(r.phone),
        username: String(r.username),
        displayName: String(r.display_name),
        bio: String(r.bio),
        avatarFileId: r.avatar_file_id ? String(r.avatar_file_id) : null,
        onlineStatus: r.online_status as LocalUserProfileRecord['onlineStatus'],
        lastSeenAt: Number(r.last_seen_at),
        updatedAt: Number(r.updated_at),
      });
    }
    stmt.free();
    return list;
  }

  // --- PTS SYNC STATE ---

  public async getPtsState(accountId = 'primary'): Promise<PtsSyncStateRecord> {
    await this.ensureInitialized();
    const fallback: PtsSyncStateRecord = {
      accountId,
      pts: 100,
      qts: 0,
      date: Math.floor(Date.now() / 1000),
      seq: 1,
      unreadPtsDiffCount: 0,
      lastSyncedAt: Date.now(),
    };
    if (!this.db) return fallback;

    const stmt = this.db.prepare('SELECT * FROM pts_sync_state WHERE account_id = ? LIMIT 1');
    stmt.bind([accountId]);
    if (!stmt.step()) {
      stmt.free();
      return fallback;
    }
    const r = stmt.getAsObject() as Record<string, any>;
    stmt.free();

    return {
      accountId: String(r.account_id),
      pts: Number(r.pts),
      qts: Number(r.qts),
      date: Number(r.date),
      seq: Number(r.seq),
      unreadPtsDiffCount: Number(r.unread_pts_diff_count),
      lastSyncedAt: Number(r.last_synced_at),
    };
  }

  public async savePtsState(state: PtsSyncStateRecord): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO pts_sync_state
       (account_id, pts, qts, date, seq, unread_pts_diff_count, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        state.accountId,
        state.pts,
        state.qts,
        state.date,
        state.seq,
        state.unreadPtsDiffCount,
        state.lastSyncedAt,
      ]
    );
    this.flushToDisk();
  }

  // --- OFFLINE ACTION QUEUE ---

  public async enqueueOfflineAction(
    queueId: string,
    actionType: OfflineQueueItem['actionType'],
    payload: Record<string, unknown>
  ): Promise<OfflineQueueItem> {
    await this.ensureInitialized();
    const now = Date.now();
    const item: OfflineQueueItem = {
      queueId,
      actionType,
      payloadJson: JSON.stringify(payload),
      status: 'pending',
      retryCount: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.db) {
      this.db.run(
        `INSERT OR REPLACE INTO offline_queue
         (queue_id, action_type, payload_json, status, retry_count, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.queueId,
          item.actionType,
          item.payloadJson,
          item.status,
          item.retryCount,
          item.lastError,
          item.createdAt,
          item.updatedAt,
        ]
      );
      this.flushToDisk();
    }
    return item;
  }

  public async getPendingOfflineQueue(): Promise<OfflineQueueItem[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const stmt = this.db.prepare(
      "SELECT * FROM offline_queue WHERE status IN ('pending', 'failed') AND retry_count < 5 ORDER BY created_at ASC"
    );
    const list: OfflineQueueItem[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      list.push({
        queueId: String(r.queue_id),
        actionType: r.action_type as OfflineQueueItem['actionType'],
        payloadJson: String(r.payload_json),
        status: r.status as OfflineQueueItem['status'],
        retryCount: Number(r.retry_count),
        lastError: r.last_error ? String(r.last_error) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      });
    }
    stmt.free();
    return list;
  }

  public async updateQueueItemStatus(
    queueId: string,
    status: OfflineQueueItem['status'],
    lastError: string | null = null
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `UPDATE offline_queue
       SET status = ?, retry_count = CASE WHEN ? = 'failed' THEN retry_count + 1 ELSE retry_count END, last_error = ?, updated_at = ?
       WHERE queue_id = ?`,
      [status, status, lastError, Date.now(), queueId]
    );
    this.flushToDisk();
  }
}

export const localSqliteDb = new LocalSqliteDatabase();
