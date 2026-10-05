import {
  BuildVars,
  ConnectionsManager,
  ContactsController,
  LocalCache4Database,
  MessagesController,
  NotificationCenter,
  NotificationEvents
} from './tgnetConnectionsManager';
import { MTProtoSessionData, AuthDeliveryMethod } from './mtprotoClient';

/**
 * Unified Client Engine delegating to Official Telegram / Plus Messenger-style:
 * - `ConnectionsManager` (`tgnet` MTProto 2.0 WebSocket engine)
 * - `MessagesController` (`TL_auth_sendCode`, `TL_auth_signIn`, `PHONE_NUMBER_UNOCCUPIED` -> `TL_auth_signUp`, `messages.getDialogs`)
 * - `ContactsController` (`contacts.importContacts`, `contacts.getContacts`)
 * - `LocalCache4Database` (`cache4.db` local mirror)
 * - `NotificationCenter` (real-time UI observer hub)
 */
export class ClientTdlibEngine {
  public onUpdate(cb: (update: any) => void): () => void {
    return NotificationCenter.getInstance().addObserver(
      NotificationEvents.didReceiveUpdates,
      cb
    );
  }

  public async ensureReadyForAuth(): Promise<string> {
    ConnectionsManager.getInstance().warmUpConnection().catch(() => {});
    return 'authorizationStateWaitPhoneNumber';
  }

  public async sendCode(
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
    const res = await MessagesController.getInstance().sendCode(
      phone,
      Boolean(options?.forceResend)
    );
    return {
      ...res,
      deliveryMethod: options?.deliveryMethod || 'telegram_app'
    };
  }

  public async verifyCodeOrPassword(params: {
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
    const res = await MessagesController.getInstance().signInOrVerify2FA({
      phone: params.phone,
      code: params.code,
      phoneCodeHash: params.phoneCodeHash,
      twoFactorPassword: params.twoFactorPassword
    });

    if (res.requires2FA) {
      return {
        ok: false,
        requires2FA: true,
        passwordHint: res.passwordHint || 'Telegram Cloud Password'
      };
    }

    if (res.requiresSignUp) {
      return {
        ok: false,
        requiresSignUp: true
      };
    }

    if (!res.ok || !res.user) {
      return {
        ok: false,
        error: res.error || 'Verification failed.'
      };
    }

    return {
      ok: true,
      sessionData: this.mapTelegramUserToSession(res.user, params.phone, Boolean(params.twoFactorPassword))
    };
  }

  public async completeNewUserSignUp(params: {
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
    const res = await MessagesController.getInstance().completeSignUp(params);
    if (!res.ok || !res.user) {
      return {
        ok: false,
        error: res.error || 'Sign up failed.'
      };
    }
    const sessionData = this.mapTelegramUserToSession(res.user, params.phone, false);
    if (params.avatarDataUrl) {
      sessionData.avatarDataUrl = params.avatarDataUrl;
    }
    return {
      ok: true,
      sessionData
    };
  }

  private mapTelegramUserToSession(
    u: any,
    fallbackPhone: string,
    twoFactorEnabled: boolean
  ): MTProtoSessionData {
    const fullName =
      [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'Telegram User';
    const username = u.username ? `@${u.username}` : `@tg_${u.id || 'user'}`;

    return {
      dcId: ConnectionsManager.getInstance().getDefaultDcId(),
      authKeyHex: `tgnet-mtproto-${u.id || Date.now()}`,
      serverSalt: `buildvars-${BuildVars.APP_ID}`,
      userId: `tg-${u.id || Date.now()}`,
      phone: u.phone ? `+${u.phone}` : fallbackPhone,
      name: fullName,
      username,
      bio: 'Synced with Official Telegram Account (MTProto cache4.db)',
      twoFactorEnabled,
      createdAt: Date.now()
    };
  }

  public async syncAllTelegramData() {
    return MessagesController.getInstance().syncAllTelegramDataInBackground();
  }

  public getCachedSnapshot() {
    return LocalCache4Database.getInstance().getSnapshot();
  }

  public async getTdlibContacts(
    customEntries?: Array<{ firstName: string; lastName?: string; phone: string }>
  ): Promise<any[] | null> {
    return ContactsController.getInstance().syncContacts(customEntries);
  }

  public async createTdlibVoiceRoom(title: string, description: string): Promise<string | null> {
    return MessagesController.getInstance().createGroupVoiceRoom(title, description);
  }

  public async getChatDialogs() {
    return MessagesController.getInstance().getChatDialogsList();
  }

  public async getChatMessages(peer: {
    peerType: 'user' | 'chat' | 'channel';
    peerId: any;
    accessHash?: any;
  }) {
    return MessagesController.getInstance().getChatHistory(peer);
  }

  public async sendChatMessage(
    peer: { peerType: 'user' | 'chat' | 'channel'; peerId: any; accessHash?: any },
    text: string
  ) {
    return MessagesController.getInstance().sendTextMessage(peer, text);
  }

  public async startRealCall(target: {
    phone?: string;
    username?: string;
    tgId?: any;
    accessHash?: any;
  }) {
    return MessagesController.getInstance().startRealTelegramCall(target);
  }

  public async acceptRealCall(incomingCall?: { id: any; access_hash: any }) {
    return MessagesController.getInstance().acceptRealTelegramCall(incomingCall);
  }

  public async discardRealCall(durationSeconds: number) {
    return MessagesController.getInstance().discardRealTelegramCall(durationSeconds);
  }

  public async registerFcmToken(fcmToken: string) {
    return MessagesController.getInstance().registerFcmTokenWithTelegram(fcmToken);
  }
}

export const tdlibClientEngine = new ClientTdlibEngine();
