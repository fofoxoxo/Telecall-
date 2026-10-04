import { TELEGRAM_CONFIG } from '../config/telegramConfig';
import { tdlibClientEngine } from './tdlibClient';

export type AuthDeliveryMethod = 'telegram_app' | 'sms' | 'phone_call' | 'email';

export interface MTProtoSessionData {
  dcId: number;
  authKeyHex: string;
  serverSalt: string;
  userId: string;
  phone: string;
  name: string;
  username: string;
  bio?: string;
  email?: string;
  twoFactorEnabled?: boolean;
  // Custom TeleChats Profile Layer on top of primary Telegram account
  telechatsDisplayName?: string;
  telechatsHandle?: string;
  telechatsStatus?: string;
  telechatsCategoryTag?: string;
  avatarDataUrl?: string;
  createdAt: number;
}

const STRING_SESSION_STORAGE_KEY = 'telecall_mtproto_string_session';
const BACKEND_URL_STORAGE_KEY = 'telecall_backend_server_url';
const CUSTOM_TG_API_ID_KEY = 'telecall_custom_tg_api_id';
const CUSTOM_TG_API_HASH_KEY = 'telecall_custom_tg_api_hash';

export function getSavedTelegramCredentials(): { apiId: number; apiHash: string } {
  const savedId = typeof window !== 'undefined' ? localStorage.getItem(CUSTOM_TG_API_ID_KEY) : null;
  const savedHash = typeof window !== 'undefined' ? localStorage.getItem(CUSTOM_TG_API_HASH_KEY) : null;
  return {
    apiId: Number(savedId) || TELEGRAM_CONFIG.API_ID || 0,
    apiHash: (savedHash && savedHash.trim()) || TELEGRAM_CONFIG.API_HASH || '',
  };
}

export function saveTelegramCredentials(apiId: string, apiHash: string): void {
  if (typeof window === 'undefined') return;
  if (apiId.trim()) localStorage.setItem(CUSTOM_TG_API_ID_KEY, apiId.trim());
  if (apiHash.trim()) localStorage.setItem(CUSTOM_TG_API_HASH_KEY, apiHash.trim());
}

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const saved = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
  if (saved && saved.trim()) {
    return saved.trim().replace(/\/$/, '');
  }
  // If running inside Capacitor Android APK from local file/https scheme or github.io, default to the live backend URL
  const host = window.location.hostname;
  if (host === 'localhost' && window.location.port !== '3000') {
    return 'https://ais-pre-xfn5k5hyj4aiqlwlaul5tn-771261258696.asia-southeast1.run.app';
  }
  if (host.endsWith('github.io')) {
    return 'https://ais-pre-xfn5k5hyj4aiqlwlaul5tn-771261258696.asia-southeast1.run.app';
  }
  return '';
}

export function setApiBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/$/, '');
  if (!clean) {
    localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
  } else {
    localStorage.setItem(BACKEND_URL_STORAGE_KEY, clean);
  }
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl();
  const fullUrl = path.startsWith('http') ? path : `${base}${path}`;
  return fetch(fullUrl, init);
}

/**
 * StringSession implementation modeled after GramJS / Telethon StringSession.
 * Encodes DC ID, Auth Key, Server Salt, and User identity into a compact Base64 string
 * stored persistently in localStorage.
 */
export class StringSession {
  private rawString: string;

  constructor(sessionString = '') {
    this.rawString = sessionString || localStorage.getItem(STRING_SESSION_STORAGE_KEY) || '';
  }

  public save(data: MTProtoSessionData): string {
    const versionPrefix = '1';
    const jsonPayload = JSON.stringify(data);
    const encoded = versionPrefix + btoa(encodeURIComponent(jsonPayload));
    this.rawString = encoded;
    localStorage.setItem(STRING_SESSION_STORAGE_KEY, encoded);
    return encoded;
  }

  public load(): MTProtoSessionData | null {
    if (!this.rawString || this.rawString.length < 2) return null;
    try {
      const payload = decodeURIComponent(atob(this.rawString.slice(1)));
      return JSON.parse(payload) as MTProtoSessionData;
    } catch {
      return null;
    }
  }

  public getSessionString(): string {
    return this.rawString;
  }

  public clear(): void {
    this.rawString = '';
    localStorage.removeItem(STRING_SESSION_STORAGE_KEY);
  }
}

type ConnectionListener = (connected: boolean) => void;
type EventListener = (event: string, payload: any) => void;

/**
 * Client-Side MTProto Engine & Session Initializer
 * Handles persistent TCP/WebSocket transport tunneling, keep-alive ping/pong,
 * StringSession persistence, and Telegram user login flow (`auth.sendCode`, `auth.signIn`).
 */
export class ClientMTProtoEngine {
  private session: StringSession;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;
  private connectionListeners = new Set<ConnectionListener>();
  private eventListeners = new Set<EventListener>();
  private seqNo = 0;

  constructor() {
    this.session = new StringSession();
  }

  public initPersistentConnection(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const base = getApiBaseUrl();
    let wsUrl: string;
    if (base && base.startsWith('http')) {
      wsUrl = base.replace(/^http/, 'ws') + '/ws';
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws`;
    }

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      this.isConnected = true;
      this.notifyConnection(true);

      // Send initial MTProto transport handshake frame with StringSession
      const savedSession = this.session.load();
      this.sendTransportFrame('mtproto:init_connection', {
        apiId: TELEGRAM_CONFIG.API_ID,
        deviceModel: TELEGRAM_CONFIG.DEVICE_MODEL,
        systemVersion: TELEGRAM_CONFIG.SYSTEM_VERSION,
        appVersion: TELEGRAM_CONFIG.APP_VERSION,
        dcId: savedSession?.dcId || TELEGRAM_CONFIG.DEFAULT_DC_ID,
        stringSession: this.session.getSessionString(),
      });

      // Start persistent TCP-over-WS keep-alive (`mtproto.ping_delay_disconnect`)
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        this.sendTransportFrame('ping', { ts: Date.now() });
      }, 15000);
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event) {
          this.eventListeners.forEach((cb) => cb(msg.event, msg.payload));
        }
      } catch {
        // ignore invalid frames
      }
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      this.notifyConnection(false);
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.reconnectTimer = setTimeout(() => this.initPersistentConnection(), 2000);
    };
  }

  public sendTransportFrame(type: string, payload: Record<string, unknown> = {}): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.seqNo += 1;
      this.socket.send(
        JSON.stringify({
          type,
          seqNo: this.seqNo,
          msgId: `${Date.now()}-${this.seqNo}`,
          payload,
        })
      );
    }
  }

  public onConnectionChange(cb: ConnectionListener): () => void {
    this.connectionListeners.add(cb);
    cb(this.isConnected);
    return () => this.connectionListeners.delete(cb);
  }

  public onServerEvent(cb: EventListener): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  private notifyConnection(state: boolean): void {
    this.connectionListeners.forEach((cb) => cb(state));
  }

  public getSavedSession(): MTProtoSessionData | null {
    return this.session.load();
  }

  /**
   * Step 1 of Telegram Login / Registration: `auth.sendCode` / `auth.resendCode`
   * Supports delivery via: Telegram App ('telegram_app'), SMS ('sms'), Phone Call ('phone_call'), or Email ('email')
   */
  public async sendAuthCode(
    phone: string,
    options?: {
      deliveryMethod?: AuthDeliveryMethod;
      email?: string;
      isNewUser?: boolean;
      forceResend?: boolean;
    }
  ): Promise<{
    ok: boolean;
    phoneCodeHash?: string;
    deliveryType?: string;
    nextType?: string;
    timeoutSeconds?: number;
    deliveryMethod?: AuthDeliveryMethod;
    error?: string;
  }> {
    return tdlibClientEngine.sendCode(phone, options);
  }

  /**
   * Step 2 of Telegram Login: `TL_auth_signIn`, `SESSION_PASSWORD_NEEDED` (2FA), or `PHONE_NUMBER_UNOCCUPIED` (`requiresSignUp`)
   */
  public async verifyAuthCode(params: {
    phone: string;
    code: string;
    phoneCodeHash: string;
    name: string;
    lastName?: string;
    bio?: string;
    email?: string;
    twoFactorPassword?: string;
    require2FA?: boolean;
  }): Promise<{
    ok: boolean;
    requires2FA?: boolean;
    requiresSignUp?: boolean;
    passwordHint?: string;
    sessionData?: MTProtoSessionData;
    error?: string;
  }> {
    const result = await tdlibClientEngine.verifyCodeOrPassword(params);
    if (result.ok && result.sessionData) {
      this.session.save(result.sessionData);
    }
    return result;
  }

  /**
   * Step 3 (Only when `PHONE_NUMBER_UNOCCUPIED` is returned by Telegram):
   * Collects user's First Name, Last Name, and optional Profile Picture and calls `TL_auth_signUp`.
   */
  public async completeSignUp(params: {
    phone: string;
    phoneCodeHash: string;
    firstName: string;
    lastName?: string;
    avatarDataUrl?: string;
  }): Promise<{
    ok: boolean;
    sessionData?: MTProtoSessionData;
    error?: string;
  }> {
    const result = await tdlibClientEngine.completeNewUserSignUp(params);
    if (result.ok && result.sessionData) {
      this.session.save(result.sessionData);
    }
    return result;
  }

  public updateSavedProfile(updates: Partial<MTProtoSessionData>): MTProtoSessionData | null {
    const current = this.session.load();
    if (!current) return null;
    const updated: MTProtoSessionData = { ...current, ...updates };
    this.session.save(updated);
    return updated;
  }

  public logout(): void {
    this.session.clear();
  }

  public destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.socket) this.socket.close();
  }
}

export const mtprotoEngine = new ClientMTProtoEngine();
