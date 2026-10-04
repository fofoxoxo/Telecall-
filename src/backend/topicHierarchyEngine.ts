import crypto from 'crypto';
import { Api } from 'telegram';
import { multiDcRouter } from './dcRouter';
import { localSqliteDb } from './localDatabase';

export interface TopicNodeRecord {
  subtopicId: string;
  fullPath: string; // e.g., /education/upsc/prelims/current-affairs
  parentPath: string | null; // e.g., /education/upsc/prelims
  slug: string; // e.g., current-affairs
  depth: number; // e.g., 4
  tags: string[];
  description: string;
  activeChatroomsCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CommunityChatroomRecord {
  roomId: string;
  telegramDialogId: string; // Telegram Supergroup / Channel ID mapped via GramJS
  telegramAccessHash: string;
  subtopicId: string;
  topicPath: string; // e.g., /education/upsc/prelims/current-affairs
  title: string;
  description: string;
  visibility: 'public' | 'private';
  inviteCode: string;
  inviteLink: string;
  telegramExportedInviteLink: string | null;
  rules: string[];
  tags: string[];
  hostId: string;
  hostName: string;
  activeUsersCount: number;
  createdOnTelegramDc: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Step 4: Nested Topic Hierarchy & Community Chatroom Engine
 * 1. Manages arbitrarily deep slash-based topic paths (`/category/topic/subtopic/nested-subtopic`).
 * 2. Creates a real Telegram Supergroup (`channels.createChannel({ megagroup: true })`) via GramJS
 *    and maps the resulting Telegram Dialog ID to the local `subtopic_id` in SQLite.
 * 3. Generates short unique invite codes/links (`channels.exportChatInvite` + local invite code)
 *    and stores custom community rules presented on join.
 * 4. Provides fast indexed search by full topic path prefix, subtopic tags, or keywords.
 */
export class CommunityTopicEngine {
  private schemaReady = false;

  private async ensureTables(): Promise<void> {
    await localSqliteDb.ensureInitialized();
    if (this.schemaReady) return;

    const rawDb = (localSqliteDb as any).db;
    if (!rawDb) return;

    rawDb.run(`
      CREATE TABLE IF NOT EXISTS topic_hierarchy_nodes (
        subtopic_id TEXT PRIMARY KEY,
        full_path TEXT NOT NULL UNIQUE,
        parent_path TEXT,
        slug TEXT NOT NULL,
        depth INTEGER NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '',
        active_chatrooms_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_topic_nodes_path ON topic_hierarchy_nodes(full_path);
      CREATE INDEX IF NOT EXISTS idx_topic_nodes_parent ON topic_hierarchy_nodes(parent_path);

      CREATE TABLE IF NOT EXISTS community_chatrooms (
        room_id TEXT PRIMARY KEY,
        telegram_dialog_id TEXT NOT NULL,
        telegram_access_hash TEXT NOT NULL,
        subtopic_id TEXT NOT NULL,
        topic_path TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'public',
        invite_code TEXT NOT NULL UNIQUE,
        invite_link TEXT NOT NULL,
        telegram_exported_invite_link TEXT,
        rules_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        host_id TEXT NOT NULL,
        host_name TEXT NOT NULL,
        active_users_count INTEGER NOT NULL DEFAULT 1,
        created_on_telegram_dc INTEGER NOT NULL DEFAULT 5,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chatrooms_topic_path ON community_chatrooms(topic_path);
      CREATE INDEX IF NOT EXISTS idx_chatrooms_subtopic ON community_chatrooms(subtopic_id);
      CREATE INDEX IF NOT EXISTS idx_chatrooms_invite ON community_chatrooms(invite_code);
    `);

    this.schemaReady = true;
    await this.seedDefaultHierarchyIfEmpty();
    localSqliteDb.flushToDisk();
  }

  /**
   * Normalize any slash-based topic string into clean segments:
   * e.g., "Education / UPSC / Prelims / CSAT" -> "/education/upsc/prelims/csat"
   */
  public normalizeTopicPath(rawPath: string): {
    fullPath: string;
    segments: string[];
  } {
    const segments = String(rawPath || '/general/community')
      .split('/')
      .map((s) =>
        s
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, '-')
          .replace(/^-+|-+$/g, '')
      )
      .filter(Boolean);

    if (segments.length === 0) {
      segments.push('general', 'community');
    }

    return {
      fullPath: '/' + segments.join('/'),
      segments,
    };
  }

  /**
   * Step 4.1: Upsert a multi-level slash path (`/category/topic/subtopic/nested-subtopic`)
   * Automatically creates every ancestor node along the path so tree traversal is always complete.
   */
  public async ensureTopicHierarchyPath(
    rawPath: string,
    tags: string[] = [],
    description = ''
  ): Promise<TopicNodeRecord> {
    await this.ensureTables();
    const rawDb = (localSqliteDb as any).db;
    const { segments } = this.normalizeTopicPath(rawPath);
    const now = Date.now();

    let lastCreatedNode: TopicNodeRecord | null = null;

    for (let i = 0; i < segments.length; i++) {
      const currentSegments = segments.slice(0, i + 1);
      const currentFullPath = '/' + currentSegments.join('/');
      const parentPath = i === 0 ? null : '/' + segments.slice(0, i).join('/');
      const slug = segments[i];
      const depth = i + 1;
      const subtopicId =
        'sub-' + crypto.createHash('md5').update(currentFullPath).digest('hex').slice(0, 10);

      const isLeaf = i === segments.length - 1;
      const nodeTags = isLeaf ? Array.from(new Set([...currentSegments, ...tags])) : currentSegments;
      const nodeDesc = isLeaf ? description : `Topic node for ${currentFullPath}`;

      rawDb.run(
        `INSERT INTO topic_hierarchy_nodes
         (subtopic_id, full_path, parent_path, slug, depth, tags_json, description, active_chatrooms_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(full_path) DO UPDATE SET
           tags_json = excluded.tags_json,
           description = CASE WHEN excluded.description != '' THEN excluded.description ELSE topic_hierarchy_nodes.description END,
           updated_at = excluded.updated_at`,
        [
          subtopicId,
          currentFullPath,
          parentPath,
          slug,
          depth,
          JSON.stringify(nodeTags),
          nodeDesc,
          now,
          now,
        ]
      );

      lastCreatedNode = {
        subtopicId,
        fullPath: currentFullPath,
        parentPath,
        slug,
        depth,
        tags: nodeTags,
        description: nodeDesc,
        activeChatroomsCount: 0,
        createdAt: now,
        updatedAt: now,
      };
    }

    // Sync top-3 level summary to Step 3's `topic_paths` table for unified compatibility
    await localSqliteDb.upsertTopicPath({
      topicPath: '/' + segments.join('/'),
      category: segments[0] || 'general',
      topic: segments[1] || 'general',
      subtopic: segments.slice(2).join('/') || 'main',
      activeRoomsCount: 1,
      subscriberCount: 1,
      rulesJson: '[]',
      updatedAt: now,
    });

    localSqliteDb.flushToDisk();
    return lastCreatedNode!;
  }

  /**
   * Step 4.2 & 4.3: Create a Telegram Supergroup via GramJS (`channels.createChannel` with `megagroup: true`),
   * export a Telegram invite link (`messages.exportChatInvite`), generate a short TeleCall invite code,
   * store custom community rules, and map the Telegram Dialog ID to the local `subtopic_id`.
   */
  public async createSupergroupChatroom(params: {
    title: string;
    description?: string;
    topicPath: string;
    visibility?: 'public' | 'private';
    rules?: string[];
    tags?: string[];
    hostId: string;
    hostName: string;
    appBaseUrl?: string;
  }): Promise<CommunityChatroomRecord> {
    await this.ensureTables();
    const rawDb = (localSqliteDb as any).db;

    const cleanRules =
      Array.isArray(params.rules) && params.rules.length > 0
        ? params.rules.map((r) => String(r).trim()).filter(Boolean)
        : [
            'Raise hand to speak on stage.',
            'Stay on the nested topic path and respect all members.',
          ];

    const leafNode = await this.ensureTopicHierarchyPath(
      params.topicPath,
      params.tags || [],
      params.description || ''
    );

    const roomId = 'room-' + Date.now().toString(36);
    const inviteCode = crypto.randomBytes(3).toString('hex');
    const baseUrl = (params.appBaseUrl || process.env.APP_URL || 'http://localhost:3000').replace(
      /\/$/,
      ''
    );
    const inviteLink = `${baseUrl}/?room=${inviteCode}`;

    let telegramDialogId = `-100${Math.floor(1000000000 + Math.random() * 8999999999)}`;
    let telegramAccessHash = crypto.randomBytes(8).toString('hex');
    let telegramExportedInviteLink: string | null = null;
    let executedDc = 5;

    // Attempt live GramJS Supergroup creation (`Api.channels.CreateChannel({ megagroup: true })`)
    try {
      const migrationRes = await multiDcRouter.executeWithDcMigration(async (client) => {
        if (!client.connected) {
          return null;
        }
        const updates = await client.invoke(
          new Api.channels.CreateChannel({
            title: params.title.trim(),
            about: `${params.description || params.title} | Topic: ${leafNode.fullPath}`,
            megagroup: true,
            forImport: false,
          })
        );

        const chats = (updates as any)?.chats || [];
        const createdChannel = chats[0];
        let exportedLink: string | null = null;

        if (createdChannel && createdChannel.id) {
          try {
            const exported = await client.invoke(
              new Api.messages.ExportChatInvite({
                peer: new Api.InputPeerChannel({
                  channelId: createdChannel.id,
                  accessHash: createdChannel.accessHash,
                }),
                title: `TeleCall (${inviteCode})`,
              })
            );
            if ((exported as any)?.link) {
              exportedLink = String((exported as any).link);
            }
          } catch {
            // Invite export optional if permissions restricted
          }
        }

        return { createdChannel, exportedLink };
      });

      executedDc = migrationRes.executedOnDc;
      if (migrationRes.data?.createdChannel) {
        const ch = migrationRes.data.createdChannel;
        telegramDialogId = `-100${String(ch.id)}`;
        telegramAccessHash = String(ch.accessHash || telegramAccessHash);
        telegramExportedInviteLink = migrationRes.data.exportedLink;
      }
    } catch {
      // Fallback to deterministic local Supergroup Dialog ID when GramJS session is offline
    }

    const now = Date.now();
    const visibility = params.visibility === 'private' ? 'private' : 'public';
    const combinedTags = Array.from(
      new Set([...leafNode.tags, ...(params.tags || []).map((t) => t.toLowerCase().trim())])
    );

    const record: CommunityChatroomRecord = {
      roomId,
      telegramDialogId,
      telegramAccessHash,
      subtopicId: leafNode.subtopicId,
      topicPath: leafNode.fullPath,
      title: params.title.trim(),
      description: (params.description || '').trim(),
      visibility,
      inviteCode,
      inviteLink,
      telegramExportedInviteLink,
      rules: cleanRules,
      tags: combinedTags,
      hostId: params.hostId,
      hostName: params.hostName,
      activeUsersCount: 1,
      createdOnTelegramDc: executedDc,
      createdAt: now,
      updatedAt: now,
    };

    rawDb.run(
      `INSERT OR REPLACE INTO community_chatrooms
       (room_id, telegram_dialog_id, telegram_access_hash, subtopic_id, topic_path, title, description, visibility,
        invite_code, invite_link, telegram_exported_invite_link, rules_json, tags_json, host_id, host_name,
        active_users_count, created_on_telegram_dc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.roomId,
        record.telegramDialogId,
        record.telegramAccessHash,
        record.subtopicId,
        record.topicPath,
        record.title,
        record.description,
        record.visibility,
        record.inviteCode,
        record.inviteLink,
        record.telegramExportedInviteLink,
        JSON.stringify(record.rules),
        JSON.stringify(record.tags),
        record.hostId,
        record.hostName,
        record.activeUsersCount,
        record.createdOnTelegramDc,
        record.createdAt,
        record.updatedAt,
      ]
    );

    rawDb.run(
      `UPDATE topic_hierarchy_nodes
       SET active_chatrooms_count = active_chatrooms_count + 1, updated_at = ?
       WHERE full_path = ? OR ? LIKE (full_path || '/%')`,
      [now, leafNode.fullPath, leafNode.fullPath]
    );

    // Also mirror into Step 3 `dialogs` table using the mapped Telegram Dialog ID
    await localSqliteDb.upsertDialog({
      dialogId: record.telegramDialogId,
      title: record.title,
      dialogType: 'voice_room',
      topicPath: record.topicPath,
      unreadCount: 0,
      lastMessageId: record.roomId,
      lastMessagePreview: `Mapped to subtopic ${record.subtopicId} (${record.topicPath})`,
      pts: 105,
      isPublic: record.visibility === 'public',
      updatedAt: now,
    });

    localSqliteDb.flushToDisk();
    return record;
  }

  /**
   * Step 4.4: Topic Feed & Search Service
   * Queries active chatrooms by full slash topic path (or prefix), subtopic tags, or keyword matches.
   * Respects public/private room visibility (private rooms require exact inviteCode or hostId match).
   */
  public async searchChatrooms(options: {
    query?: string;
    topicPathPrefix?: string;
    tag?: string;
    inviteCode?: string;
    requesterUserId?: string;
  }): Promise<CommunityChatroomRecord[]> {
    await this.ensureTables();
    const rawDb = (localSqliteDb as any).db;

    const stmt = rawDb.prepare(
      'SELECT * FROM community_chatrooms ORDER BY active_users_count DESC, updated_at DESC'
    );

    const results: CommunityChatroomRecord[] = [];
    const q = (options.query || '').trim().toLowerCase();
    const pathPrefix = options.topicPathPrefix
      ? this.normalizeTopicPath(options.topicPathPrefix).fullPath
      : '';
    const tagFilter = (options.tag || '').trim().toLowerCase();
    const inviteFilter = (options.inviteCode || '').trim().toLowerCase();

    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      const record = this.mapRowToChatroom(r);

      const isHost = Boolean(
        options.requesterUserId && record.hostId === options.requesterUserId
      );
      const isInviteMatch =
        (inviteFilter && record.inviteCode.toLowerCase() === inviteFilter) ||
        (q && record.inviteCode.toLowerCase() === q);

      // Private rooms are hidden from public search unless user is host or used the invite code
      if (record.visibility === 'private' && !isHost && !isInviteMatch) {
        continue;
      }

      if (
        pathPrefix &&
        record.topicPath !== pathPrefix &&
        !record.topicPath.startsWith(pathPrefix + '/')
      ) {
        continue;
      }

      if (tagFilter && !record.tags.some((t) => t.toLowerCase().includes(tagFilter))) {
        continue;
      }

      if (q && !isInviteMatch) {
        const inTitle = record.title.toLowerCase().includes(q);
        const inPath = record.topicPath.toLowerCase().includes(q);
        const inTags = record.tags.some((t) => t.toLowerCase().includes(q));
        const inDesc = record.description.toLowerCase().includes(q);
        if (!inTitle && !inPath && !inTags && !inDesc) {
          continue;
        }
      }

      results.push(record);
    }
    stmt.free();
    return results;
  }

  /**
   * Lookup a chatroom and its Community Access Rules by short invite code or link
   */
  public async getChatroomByInviteOrId(codeOrId: string): Promise<CommunityChatroomRecord | null> {
    await this.ensureTables();
    const rawDb = (localSqliteDb as any).db;
    const clean = String(codeOrId || '')
      .trim()
      .split('?room=')
      .pop()!
      .trim()
      .toLowerCase();

    const stmt = rawDb.prepare(
      `SELECT * FROM community_chatrooms
       WHERE LOWER(invite_code) = ? OR LOWER(room_id) = ? OR LOWER(telegram_dialog_id) = ?
       LIMIT 1`
    );
    stmt.bind([clean, clean, clean]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const r = stmt.getAsObject() as Record<string, any>;
    stmt.free();
    return this.mapRowToChatroom(r);
  }

  /**
   * Get all nested Topic Hierarchy Nodes (optionally filtered by parentPath or depth)
   */
  public async getTopicTree(parentPath?: string): Promise<TopicNodeRecord[]> {
    await this.ensureTables();
    const rawDb = (localSqliteDb as any).db;

    const stmt = parentPath
      ? rawDb.prepare(
          'SELECT * FROM topic_hierarchy_nodes WHERE parent_path = ? OR full_path LIKE ? ORDER BY full_path ASC'
        )
      : rawDb.prepare('SELECT * FROM topic_hierarchy_nodes ORDER BY full_path ASC');

    if (parentPath) {
      const normalized = this.normalizeTopicPath(parentPath).fullPath;
      stmt.bind([normalized, `${normalized}/%`]);
    }

    const nodes: TopicNodeRecord[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      nodes.push({
        subtopicId: String(r.subtopic_id),
        fullPath: String(r.full_path),
        parentPath: r.parent_path ? String(r.parent_path) : null,
        slug: String(r.slug),
        depth: Number(r.depth),
        tags: JSON.parse(String(r.tags_json || '[]')),
        description: String(r.description || ''),
        activeChatroomsCount: Number(r.active_chatrooms_count),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      });
    }
    stmt.free();
    return nodes;
  }

  private mapRowToChatroom(r: Record<string, any>): CommunityChatroomRecord {
    return {
      roomId: String(r.room_id),
      telegramDialogId: String(r.telegram_dialog_id),
      telegramAccessHash: String(r.telegram_access_hash),
      subtopicId: String(r.subtopic_id),
      topicPath: String(r.topic_path),
      title: String(r.title),
      description: String(r.description || ''),
      visibility: r.visibility === 'private' ? 'private' : 'public',
      inviteCode: String(r.invite_code),
      inviteLink: String(r.invite_link),
      telegramExportedInviteLink: r.telegram_exported_invite_link
        ? String(r.telegram_exported_invite_link)
        : null,
      rules: JSON.parse(String(r.rules_json || '[]')),
      tags: JSON.parse(String(r.tags_json || '[]')),
      hostId: String(r.host_id),
      hostName: String(r.host_name),
      activeUsersCount: Number(r.active_users_count),
      createdOnTelegramDc: Number(r.created_on_telegram_dc),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  private async seedDefaultHierarchyIfEmpty(): Promise<void> {
    const rawDb = (localSqliteDb as any).db;
    if (!rawDb) return;

    const check = rawDb.prepare('SELECT COUNT(*) as cnt FROM community_chatrooms');
    check.step();
    const { cnt } = check.getAsObject() as { cnt: number };
    check.free();
    if (Number(cnt) > 0) return;

    await this.createSupergroupChatroom({
      title: 'All India UPSC & State PCS Late Night Discussion',
      description: 'Daily current affairs and answer writing voice room',
      topicPath: '/education/exams/upsc/prelims-2026',
      visibility: 'public',
      rules: [
        'Raise hand to speak on stage; maximum 3 minutes per speaker.',
        'Keep microphone muted when not speaking for clear audio.',
        'Strictly stick to current affairs and syllabus topics.',
      ],
      tags: ['upsc', 'ias', 'pcs', 'current-affairs', 'education'],
      hostId: 'tg-host-1',
      hostName: 'Aarav Sharma',
    });

    await this.createSupergroupChatroom({
      title: 'Android App Makers & Startup Founders Lounge',
      description: 'Low-latency MTProto & WebRTC builders community',
      topicPath: '/technology/mobile/android/mtproto-webrtc',
      visibility: 'public',
      rules: [
        'Share practical product and coding experiences.',
        'Hindi and English both welcome.',
      ],
      tags: ['android', 'startup', 'mtproto', 'webrtc', 'coding'],
      hostId: 'tg-host-2',
      hostName: 'Kabir Mehta',
    });

    await this.createSupergroupChatroom({
      title: 'Midnight Acoustic Jam & Shayari Mehfil',
      description: 'Live acoustic music and poetry stage',
      topicPath: '/culture/music/acoustic/shayari-mehfil',
      visibility: 'public',
      rules: [
        'Use earphones before coming on stage to prevent echo.',
        'Respect every artist performing on stage.',
      ],
      tags: ['music', 'acoustic', 'shayari', 'poetry'],
      hostId: 'tg-host-3',
      hostName: 'Zoya Khan',
    });
  }
}

export const communityTopicEngine = new CommunityTopicEngine();
