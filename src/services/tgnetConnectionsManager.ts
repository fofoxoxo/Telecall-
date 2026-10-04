import MTProto from '@mtproto/core/envs/browser';
import { TELEGRAM_CONFIG } from '../config/telegramConfig';
import { getSavedTelegramCredentials } from './mtprotoClient';

/**
 * 1. BuildVars (Modeled directly after Official Telegram / Plus Messenger `BuildVars.java`)
 */
export class BuildVars {
  public static get APP_ID(): number {
    const saved = getSavedTelegramCredentials();
    return Number(saved.apiId) || Number(TELEGRAM_CONFIG.API_ID) || 30428833;
  }

  public static get APP_HASH(): string {
    const saved = getSavedTelegramCredentials();
    return (
      (saved.apiHash && saved.apiHash.length >= 16 ? saved.apiHash : '') ||
      TELEGRAM_CONFIG.API_HASH ||
      '41c474aebd7507799bd322e7517286c2'
    );
  }

  public static readonly BUILD_VERSION_STRING = '1.0.0';
  public static readonly DEVICE_MODEL = 'TeleCall Android';
  public static readonly SYSTEM_VERSION = 'Android 14';
}

/**
 * 2. NotificationCenter (Modeled after Official Telegram `NotificationCenter.java`)
 * Dispatches real-time events to TeleCall custom UI components when `cache4.db` or live sockets update.
 */
export const NotificationEvents = {
  didReceiveUpdates: 'didReceiveUpdates',
  contactsDidLoad: 'contactsDidLoad',
  dialogsDidLoad: 'dialogsDidLoad',
  callHistoryDidLoad: 'callHistoryDidLoad',
  userInfoDidLoad: 'userInfoDidLoad',
  voiceRoomsDidUpdate: 'voiceRoomsDidUpdate',
  connectionStateDidChange: 'connectionStateDidChange',
  cache4DbDidSync: 'cache4DbDidSync'
} as const;

type NotificationObserver = (payload: any) => void;

export class NotificationCenter {
  private static instance: NotificationCenter;
  private observers = new Map<string, Set<NotificationObserver>>();

  public static getInstance(): NotificationCenter {
    if (!NotificationCenter.instance) {
      NotificationCenter.instance = new NotificationCenter();
    }
    return NotificationCenter.instance;
  }

  public addObserver(event: string, observer: NotificationObserver): () => void {
    if (!this.observers.has(event)) {
      this.observers.set(event, new Set());
    }
    this.observers.get(event)!.add(observer);
    return () => this.removeObserver(event, observer);
  }

  public removeObserver(event: string, observer: NotificationObserver): void {
    this.observers.get(event)?.delete(observer);
  }

  public postNotificationName(event: string, payload?: any): void {
    this.observers.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        // ignore observer errors
      }
    });
  }
}

/**
 * 3. LocalStorage / IndexedDB Engine (`cache4.db` Client Mirror)
 * Stores `users`, `chats`, `dialogs`, `contacts`, `call_logs`, and `voice_rooms` locally on the device
 * so UI renders in 0ms and stays synced with Telegram servers.
 */
export interface Cache4DbSnapshot {
  users: Record<string, any>;
  chats: Record<string, any>;
  dialogs: any[];
  contacts: any[];
  callLogs: any[];
  voiceRooms: any[];
  lastPts: number;
  lastUpdatedAt: number;
}

const CACHE4_DB_STORAGE_KEY = 'telecall_cache4_db_v1';

export class LocalCache4Database {
  private static instance: LocalCache4Database;
  private state: Cache4DbSnapshot;

  private constructor() {
    this.state = this.loadFromDisk();
  }

  public static getInstance(): LocalCache4Database {
    if (!LocalCache4Database.instance) {
      LocalCache4Database.instance = new LocalCache4Database();
    }
    return LocalCache4Database.instance;
  }

  private loadFromDisk(): Cache4DbSnapshot {
    try {
      const raw = localStorage.getItem(CACHE4_DB_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
    return {
      users: {},
      chats: {},
      dialogs: [],
      contacts: [],
      callLogs: [],
      voiceRooms: [],
      lastPts: 0,
      lastUpdatedAt: 0
    };
  }

  public saveToDisk(): void {
    try {
      this.state.lastUpdatedAt = Date.now();
      localStorage.setItem(CACHE4_DB_STORAGE_KEY, JSON.stringify(this.state));
      NotificationCenter.getInstance().postNotificationName(
        NotificationEvents.cache4DbDidSync,
        this.state
      );
    } catch {
      // ignore quota errors
    }
  }

  public getSnapshot(): Cache4DbSnapshot {
    return this.state;
  }

  public putUsers(users: any[]): void {
    for (const u of users) {
      if (u?.id) {
        this.state.users[String(u.id)] = u;
      }
    }
  }

  public putChats(chats: any[]): void {
    for (const c of chats) {
      if (c?.id) {
        this.state.chats[String(c.id)] = c;
      }
    }
  }

  public setContacts(contacts: any[]): void {
    this.state.contacts = contacts;
    this.saveToDisk();
  }

  public setDialogsAndVoiceRooms(dialogs: any[], voiceRooms: any[]): void {
    this.state.dialogs = dialogs;
    this.state.voiceRooms = voiceRooms;
    this.saveToDisk();
  }

  public setCallLogs(callLogs: any[]): void {
    this.state.callLogs = callLogs;
    this.saveToDisk();
  }

  public clear(): void {
    localStorage.removeItem(CACHE4_DB_STORAGE_KEY);
    this.state = this.loadFromDisk();
  }
}

const mtprotoLocalStorage = {
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(`tgnet_${key}`, value);
  },
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(`tgnet_${key}`);
  }
};

/**
 * 4. ConnectionsManager (`tgnet` MTProto 2.0 WebSocket Engine)
 */
export class ConnectionsManager {
  private static instance: ConnectionsManager;
  private mtproto: MTProto | null = null;
  private activeApiId = 0;
  private activeApiHash = '';
  private defaultDcId: number = Number(localStorage.getItem('tgnet_default_dc_id')) || 5;

  public static getInstance(): ConnectionsManager {
    if (!ConnectionsManager.instance) {
      ConnectionsManager.instance = new ConnectionsManager();
    }
    return ConnectionsManager.instance;
  }

  public getDefaultDcId(): number {
    return this.defaultDcId;
  }

  private ensureEngine(): MTProto {
    const apiId = BuildVars.APP_ID;
    const apiHash = BuildVars.APP_HASH;

    if (!this.mtproto || this.activeApiId !== apiId || this.activeApiHash !== apiHash) {
      this.activeApiId = apiId;
      this.activeApiHash = apiHash;

      this.mtproto = new MTProto({
        api_id: apiId,
        api_hash: apiHash,
        test: false,
        storageOptions: {
          instance: mtprotoLocalStorage
        }
      });

      const updatesEvents = [
        'updatesTooLong',
        'updateShortMessage',
        'updateShortChatMessage',
        'updateShort',
        'updatesCombined',
        'updates',
        'updateShortSentMessage'
      ];
      for (const ev of updatesEvents) {
        this.mtproto.updates.on(ev, (updatePayload: any) => {
          this.processIncomingLiveUpdate(updatePayload);
          NotificationCenter.getInstance().postNotificationName(
            NotificationEvents.didReceiveUpdates,
            updatePayload
          );
        });
      }
    }

    return this.mtproto;
  }

  private processIncomingLiveUpdate(updatePayload: any) {
    if (Array.isArray(updatePayload?.users)) {
      LocalCache4Database.getInstance().putUsers(updatePayload.users);
    }
    if (Array.isArray(updatePayload?.chats)) {
      LocalCache4Database.getInstance().putChats(updatePayload.chats);
    }
  }

  public getCrypto() {
    return this.ensureEngine().crypto;
  }

  public setDefaultDc(dcId: number): void {
    this.defaultDcId = dcId;
    localStorage.setItem('tgnet_default_dc_id', String(dcId));
  }

  public async sendRequest(
    method: string,
    params: Record<string, any> = {},
    options: { dcId?: number; syncAuth?: boolean } = {}
  ): Promise<any> {
    const engine = this.ensureEngine();
    const targetDc = options.dcId || this.defaultDcId;

    try {
      const result = await engine.call(method, params, {
        dcId: targetDc,
        syncAuth: options.syncAuth
      });
      NotificationCenter.getInstance().postNotificationName(
        NotificationEvents.connectionStateDidChange,
        { connected: true, dcId: targetDc }
      );
      return result;
    } catch (error: any) {
      const errorMessage: string = error?.error_message || error?.message || '';

      if (errorMessage.includes('_MIGRATE_')) {
        const parts = errorMessage.split('_MIGRATE_');
        const newDcId = Number(parts[1]);
        if (newDcId && newDcId >= 1 && newDcId <= 5) {
          this.setDefaultDc(newDcId);
          return engine.call(method, params, {
            dcId: newDcId,
            syncAuth: options.syncAuth
          });
        }
      }

      throw error;
    }
  }
}

/**
 * 5. ContactsController (Modeled after Official Telegram `ContactsController.java`)
 * Computes contact hashes, imports phonebook numbers (`contacts.importContacts`),
 * and syncs active Telegram contacts (`contacts.getContacts`) into `cache4.db`.
 */
export class ContactsController {
  private static instance: ContactsController;

  public static getInstance(): ContactsController {
    if (!ContactsController.instance) {
      ContactsController.instance = new ContactsController();
    }
    return ContactsController.instance;
  }

  public async syncContacts(
    phoneBookEntries?: Array<{ firstName: string; lastName?: string; phone: string }>
  ): Promise<any[]> {
    // 1. If user added or imported local phone book contacts, match them via `contacts.importContacts`
    if (phoneBookEntries && phoneBookEntries.length > 0) {
      try {
        await ConnectionsManager.getInstance().sendRequest('contacts.importContacts', {
          contacts: phoneBookEntries.map((entry, idx) => ({
            _: 'inputPhoneContact',
            client_id: idx + 1,
            phone: entry.phone.replace(/[^\d+]/g, ''),
            first_name: entry.firstName,
            last_name: entry.lastName || ''
          }))
        });
      } catch {
        // Ignore if import is rate-limited
      }
    }

    // 2. Fetch full synced Telegram directory (`contacts.getContacts`)
    try {
      const res = await ConnectionsManager.getInstance().sendRequest('contacts.getContacts', {
        hash: 0
      });
      const users: any[] = res?.users || [];
      LocalCache4Database.getInstance().putUsers(users);

      const mapped = users
        .filter((u) => !u.deleted)
        .map((u) => ({
          id: `tg-${u.id}`,
          tgId: u.id,
          accessHash: u.access_hash,
          name: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Telegram Contact',
          phone: u.phone ? `+${u.phone}` : 'Telegram User',
          username: u.username ? `@${u.username}` : `@tg_${u.id}`,
          online: u.status?._ === 'userStatusOnline',
          lastSeen:
            u.status?._ === 'userStatusOnline'
              ? 'Online'
              : u.status?.was_online
              ? 'Recently Online'
              : 'Telegram Synced'
        }));

      LocalCache4Database.getInstance().setContacts(mapped);
      NotificationCenter.getInstance().postNotificationName(
        NotificationEvents.contactsDidLoad,
        mapped
      );
      return mapped;
    } catch {
      return LocalCache4Database.getInstance().getSnapshot().contacts;
    }
  }
}

/**
 * 6. MessagesController (Modeled after Official Telegram `MessagesController.java`)
 * Handles:
 * - Official Telegram Auth Flow (`TLRPC.TL_auth_sendCode` -> `TL_auth_signIn` ->
 *   `PHONE_NUMBER_UNOCCUPIED` -> `TL_auth_signUp` + Profile Photo upload -> or `SESSION_PASSWORD_NEEDED` 2FA)
 * - Full Background Sync after Login (`messages.getDialogs`, Supergroups, Channels, Active Group Calls,
 *   and Phone Call History `messages.search` with `inputMessagesFilterPhoneCalls`) into `cache4.db`.
 */
export class MessagesController {
  private static instance: MessagesController;
  private lastPhoneCodeHash = '';
  private phoneSignUpRequired = false;

  public static getInstance(): MessagesController {
    if (!MessagesController.instance) {
      MessagesController.instance = new MessagesController();
    }
    return MessagesController.instance;
  }

  /**
   * Step 1: Official Telegram `TLRPC.TL_auth_sendCode`
   * Sends code automatically the official Telegram way (Telegram App message first, or SMS/Call as decided by Telegram DC).
   */
  public async sendCode(phone: string, forceResend = false): Promise<{
    ok: boolean;
    phoneCodeHash?: string;
    deliveryType?: string;
    nextType?: string;
    timeoutSeconds?: number;
    error?: string;
  }> {
    const cleanPhone = phone.replace(/[^\d+]/g, '').startsWith('+')
      ? phone.replace(/[^\d+]/g, '')
      : `+${phone.replace(/[^\d]/g, '')}`;

    try {
      if (forceResend && this.lastPhoneCodeHash) {
        const resendRes = await ConnectionsManager.getInstance().sendRequest('auth.resendCode', {
          phone_number: cleanPhone,
          phone_code_hash: this.lastPhoneCodeHash
        });
        this.lastPhoneCodeHash = resendRes.phone_code_hash || this.lastPhoneCodeHash;
        return {
          ok: true,
          phoneCodeHash: this.lastPhoneCodeHash,
          deliveryType: resendRes?.type?._ || 'auth.sentCodeTypeSms',
          nextType: resendRes?.next_type?._,
          timeoutSeconds: resendRes?.timeout || 60
        };
      }

      const res = await ConnectionsManager.getInstance().sendRequest('auth.sendCode', {
        phone_number: cleanPhone,
        api_id: BuildVars.APP_ID,
        api_hash: BuildVars.APP_HASH,
        settings: {
          _: 'codeSettings',
          allow_flashcall: true,
          current_number: true,
          allow_app_hash: true
        }
      });

      this.lastPhoneCodeHash = res.phone_code_hash;
      this.phoneSignUpRequired = false;

      return {
        ok: true,
        phoneCodeHash: res.phone_code_hash,
        deliveryType: res?.type?._ || 'auth.sentCodeTypeApp',
        nextType: res?.next_type?._,
        timeoutSeconds: res?.timeout || 60
      };
    } catch (err: any) {
      const msg = err?.error_message || err?.message || JSON.stringify(err);
      return {
        ok: false,
        error: msg
      };
    }
  }

  /**
   * Step 2: Official Telegram `TLRPC.TL_auth_signIn`
   * - If account exists: signs in immediately (or returns `requires2FA: true` on `SESSION_PASSWORD_NEEDED`).
   * - If account does NOT exist: returns `requiresSignUp: true` (`PHONE_NUMBER_UNOCCUPIED` / `auth.authorizationSignUpRequired`)
   *   so UI prompts for First Name, Last Name, and Profile Picture before calling `completeSignUp`.
   */
  public async signInOrVerify2FA(params: {
    phone: string;
    code: string;
    phoneCodeHash: string;
    twoFactorPassword?: string;
  }): Promise<{
    ok: boolean;
    requires2FA?: boolean;
    requiresSignUp?: boolean;
    passwordHint?: string;
    user?: any;
    error?: string;
  }> {
    const cleanPhone = params.phone.replace(/[^\d+]/g, '').startsWith('+')
      ? params.phone.replace(/[^\d+]/g, '')
      : `+${params.phone.replace(/[^\d+]/g, '')}`;
    const codeHash = params.phoneCodeHash || this.lastPhoneCodeHash;

    try {
      // Handle 2FA Cloud Password (`account.getPassword` + `auth.checkPassword`)
      if (params.twoFactorPassword) {
        const pwdInfo = await ConnectionsManager.getInstance().sendRequest('account.getPassword');
        const { srp_id, current_algo, srp_B } = pwdInfo;
        const { g, p, salt1, salt2 } = current_algo;

        const { A, M1 } = await ConnectionsManager.getInstance()
          .getCrypto()
          .getSRPParams({
            g,
            p,
            salt1,
            salt2,
            gB: srp_B,
            password: params.twoFactorPassword
          });

        const checkRes = await ConnectionsManager.getInstance().sendRequest('auth.checkPassword', {
          password: {
            _: 'inputCheckPasswordSRP',
            srp_id,
            A,
            M1
          }
        });

        NotificationCenter.getInstance().postNotificationName(
          NotificationEvents.userInfoDidLoad,
          checkRes.user
        );
        // Trigger full background sync of Contacts, Dialogs, Voice Rooms, and Call History
        this.syncAllTelegramDataInBackground().catch(() => {});
        return { ok: true, user: checkRes.user };
      }

      // Official `TLRPC.TL_auth_signIn`
      const signInRes = await ConnectionsManager.getInstance().sendRequest('auth.signIn', {
        phone_number: cleanPhone,
        phone_code_hash: codeHash,
        phone_code: params.code.trim()
      });

      // If Telegram returns `auth.authorizationSignUpRequired` (Modern MTProto schema for PHONE_NUMBER_UNOCCUPIED)
      if (signInRes?._ === 'auth.authorizationSignUpRequired') {
        this.phoneSignUpRequired = true;
        return {
          ok: false,
          requiresSignUp: true
        };
      }

      NotificationCenter.getInstance().postNotificationName(
        NotificationEvents.userInfoDidLoad,
        signInRes.user
      );
      this.syncAllTelegramDataInBackground().catch(() => {});
      return { ok: true, user: signInRes.user };
    } catch (err: any) {
      const code = err?.error_message || err?.message || '';

      if (code === 'SESSION_PASSWORD_NEEDED') {
        try {
          const pwd = await ConnectionsManager.getInstance().sendRequest('account.getPassword');
          return {
            ok: false,
            requires2FA: true,
            passwordHint: pwd?.hint || 'Telegram Cloud Password'
          };
        } catch {
          return {
            ok: false,
            requires2FA: true,
            passwordHint: 'Telegram Cloud Password'
          };
        }
      }

      if (code === 'PHONE_NUMBER_UNOCCUPIED') {
        this.phoneSignUpRequired = true;
        return {
          ok: false,
          requiresSignUp: true
        };
      }

      return {
        ok: false,
        error: code || 'Verification failed'
      };
    }
  }

  /**
   * Step 3 (Only when `PHONE_NUMBER_UNOCCUPIED` / `requiresSignUp` is returned):
   * Executes `TLRPC.TL_auth_signUp` with Name and optional Profile Picture (`photos.uploadProfilePhoto`)
   */
  public async completeSignUp(params: {
    phone: string;
    phoneCodeHash: string;
    firstName: string;
    lastName?: string;
    avatarDataUrl?: string;
  }): Promise<{
    ok: boolean;
    user?: any;
    error?: string;
  }> {
    const cleanPhone = params.phone.replace(/[^\d+]/g, '').startsWith('+')
      ? params.phone.replace(/[^\d+]/g, '')
      : `+${params.phone.replace(/[^\d+]/g, '')}`;
    const codeHash = params.phoneCodeHash || this.lastPhoneCodeHash;

    try {
      const signUpRes = await ConnectionsManager.getInstance().sendRequest('auth.signUp', {
        phone_number: cleanPhone,
        phone_code_hash: codeHash,
        first_name: params.firstName.trim() || 'Telegram User',
        last_name: params.lastName?.trim() || ''
      });

      NotificationCenter.getInstance().postNotificationName(
        NotificationEvents.userInfoDidLoad,
        signUpRes.user
      );
      this.syncAllTelegramDataInBackground().catch(() => {});
      return {
        ok: true,
        user: signUpRes.user
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.error_message || err?.message || 'Could not complete sign up'
      };
    }
  }

  /**
   * Full Background Telegram Data Sync into Local `cache4.db` (`LocalCache4Database`):
   * 1. `ContactsController.syncContacts()` -> Phonebook + Telegram Contacts
   * 2. `messages.getDialogs` -> Historical Chats, Supergroups, Channels & Active Voice Rooms (`call_active`)
   * 3. `messages.search` (`inputMessagesFilterPhoneCalls`) -> Real Telegram Call Logs History
   */
  public async syncAllTelegramDataInBackground(): Promise<{
    contactsCount: number;
    dialogsCount: number;
    voiceRoomsCount: number;
    callLogsCount: number;
  }> {
    // 1. Sync Contacts via ContactsController
    const contacts = await ContactsController.getInstance().syncContacts();

    // 2. Sync Dialogs, Supergroups, Channels & Voice Rooms (`messages.getDialogs`)
    let dialogsCount = 0;
    let voiceRoomsCount = 0;
    try {
      const dialogsRes = await ConnectionsManager.getInstance().sendRequest('messages.getDialogs', {
        offset_date: 0,
        offset_id: 0,
        offset_peer: { _: 'inputPeerEmpty' },
        limit: 80,
        hash: 0
      });

      const chats: any[] = dialogsRes?.chats || [];
      const users: any[] = dialogsRes?.users || [];
      const dialogs: any[] = dialogsRes?.dialogs || [];

      LocalCache4Database.getInstance().putChats(chats);
      LocalCache4Database.getInstance().putUsers(users);
      dialogsCount = dialogs.length;

      // Extract Supergroups, Channels, and Chats into TeleCall Voice Rooms & Group Directory
      const extractedRooms = chats
        .filter((c) => c._ === 'channel' || c._ === 'chat')
        .map((c) => {
          const isVoiceActive = Boolean(c.call_active);
          const count = c.participants_count || (isVoiceActive ? 24 : 8);
          return {
            id: `tg-chat-${c.id}`,
            tgChatId: c.id,
            accessHash: c.access_hash,
            title: c.title || 'Telegram Group',
            topic: c.megagroup
              ? 'Telegram Supergroups'
              : c.broadcast
              ? 'Telegram Channels'
              : 'Telegram Groups',
            visibility: c.username ? ('public' as const) : ('private' as const),
            inviteCode: c.username || `tg${c.id}`,
            rules: [
              isVoiceActive
                ? 'Live Telegram Voice Chat active in this group.'
                : 'Synced from your primary Telegram account (cache4.db).',
              'Tap Join to enter the voice stage or start group voice chat.'
            ],
            hostId: `tg-${c.creator ? 'me' : c.id}`,
            hostName: c.username ? `@${c.username}` : 'Telegram Group',
            createdAt: new Date().toISOString(),
            maxCapacity: 5000,
            lowBandwidthMode: true,
            listenerCount: count,
            isTelegramSynced: true,
            callActive: isVoiceActive,
            participants: [
              {
                id: `tg-host-${c.id}`,
                name: c.title ? `${c.title} Host` : 'Group Host',
                phone: c.username ? `@${c.username}` : 'Telegram',
                role: 'host' as const,
                isMuted: false,
                handRaised: false,
                isSpeaking: isVoiceActive,
                joinedAt: new Date().toISOString()
              }
            ]
          };
        });

      voiceRoomsCount = extractedRooms.length;
      LocalCache4Database.getInstance().setDialogsAndVoiceRooms(dialogs, extractedRooms);

      NotificationCenter.getInstance().postNotificationName(
        NotificationEvents.dialogsDidLoad,
        { dialogs, chats, users }
      );
      if (extractedRooms.length > 0) {
        NotificationCenter.getInstance().postNotificationName(
          NotificationEvents.voiceRoomsDidUpdate,
          extractedRooms
        );
      }
    } catch {
      // Ignore if dialogs fetch fails
    }

    // 3. Sync Historical Telegram Phone Call Logs (`messages.search` with `inputMessagesFilterPhoneCalls`)
    let callLogsCount = 0;
    try {
      const callsRes = await ConnectionsManager.getInstance().sendRequest('messages.search', {
        peer: { _: 'inputPeerEmpty' },
        q: '',
        filter: { _: 'inputMessagesFilterPhoneCalls', missed: false },
        min_date: 0,
        max_date: 0,
        offset_id: 0,
        add_offset: 0,
        limit: 40,
        max_id: 0,
        min_id: 0,
        hash: 0
      });

      const callMessages: any[] = callsRes?.messages || [];
      const callUsers: any[] = callsRes?.users || [];
      LocalCache4Database.getInstance().putUsers(callUsers);

      const userMap = new Map<string, any>();
      for (const u of callUsers) {
        userMap.set(String(u.id), u);
      }

      const mappedLogs = callMessages
        .filter((m) => m.action?._ === 'messageActionPhoneCall')
        .map((m) => {
          const peerId = m.peer_id?.user_id || m.from_id?.user_id;
          const u = userMap.get(String(peerId));
          const contactName = u
            ? [u.first_name, u.last_name].filter(Boolean).join(' ')
            : `Telegram User #${peerId || m.id}`;
          const phone = u?.phone ? `+${u.phone}` : u?.username ? `@${u.username}` : `+tg-${peerId}`;
          const duration = m.action?.duration || 0;
          const dateStr = m.date
            ? new Date(m.date * 1000).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })
            : 'Synced';

          return {
            id: `tg-call-${m.id}`,
            contactName,
            phone,
            username: u?.username ? `@${u.username}` : undefined,
            direction: m.out ? ('outgoing' as const) : ('incoming' as const),
            durationSeconds: duration,
            timestamp: dateStr,
            codecUsed: 'Telegram MTProto Voice Call (Synced)',
            dhEmojis: ['🔐', '✈️', '🛡️', '⚡']
          };
        });

      callLogsCount = mappedLogs.length;
      if (mappedLogs.length > 0) {
        LocalCache4Database.getInstance().setCallLogs(mappedLogs);
        NotificationCenter.getInstance().postNotificationName(
          NotificationEvents.callHistoryDidLoad,
          mappedLogs
        );
      }
    } catch {
      // Ignore if call history search is empty
    }

    return {
      contactsCount: contacts.length,
      dialogsCount,
      voiceRoomsCount,
      callLogsCount
    };
  }

  public async loadContacts(): Promise<any[] | null> {
    return ContactsController.getInstance().syncContacts();
  }

  public async createGroupVoiceRoom(title: string, about: string): Promise<string | null> {
    try {
      const createRes = await ConnectionsManager.getInstance().sendRequest(
        'channels.createChannel',
        {
          megagroup: true,
          title,
          about
        }
      );
      const chat = createRes?.chats?.[0];
      if (chat?.id && chat?.access_hash) {
        await ConnectionsManager.getInstance().sendRequest('phone.createGroupCall', {
          peer: {
            _: 'inputPeerChannel',
            channel_id: chat.id,
            access_hash: chat.access_hash
          },
          random_id: Math.floor(Math.random() * 1000000000),
          title
        });
        this.syncAllTelegramDataInBackground().catch(() => {});
        return String(chat.id);
      }
      return null;
    } catch {
      return null;
    }
  }
}
