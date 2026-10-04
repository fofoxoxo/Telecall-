import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';

interface PendingAuthFlow {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  apiId: number;
  apiHash: string;
  createdAt: number;
}

/**
 * Real Telegram MTProto Authentication & Session Bridge (GramJS)
 * Connects directly to official Telegram Production Data Centers (DC1–DC5)
 * to dispatch real OTP codes (`auth.SendCode`), Resend via SMS/Call (`auth.ResendCode`),
 * Verify OTP (`auth.SignIn`), New User Sign Up (`auth.SignUp`),
 * and 2FA Cloud Password SRP Verification (`account.GetPassword` + `auth.CheckPassword`).
 */
export class RealTelegramAuthBridge {
  private pendingFlows = new Map<string, PendingAuthFlow>();
  private authenticatedClients = new Map<string, TelegramClient>();

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/[^\d+]/g, '');
    return digits.startsWith('+') ? digits : `+${digits}`;
  }

  private resolveCredentials(customApiId?: number | string, customApiHash?: string) {
    const rawId =
      Number(customApiId) ||
      Number(process.env.TELEGRAM_API_ID) ||
      Number(process.env.VITE_TELEGRAM_API_ID) ||
      0;
    const rawHash =
      (customApiHash && customApiHash !== 'telecall-secret-hash' ? customApiHash : '') ||
      process.env.TELEGRAM_API_HASH ||
      process.env.VITE_TELEGRAM_API_HASH ||
      '';

    return {
      apiId: rawId,
      apiHash: rawHash.trim(),
    };
  }

  /**
   * Step 1: Connect to real Telegram Production DC and trigger `auth.SendCode` or `auth.ResendCode`
   */
  public async sendRealCode(params: {
    phone: string;
    apiId?: number | string;
    apiHash?: string;
    forceResend?: boolean;
  }): Promise<{
    ok: boolean;
    phoneCodeHash?: string;
    deliveryType?: string;
    nextType?: string;
    isRealTelegramDc?: boolean;
    error?: string;
  }> {
    const cleanPhone = this.normalizePhone(params.phone);
    const { apiId, apiHash } = this.resolveCredentials(params.apiId, params.apiHash);

    if (!apiId || !apiHash || apiHash.length < 16) {
      return {
        ok: false,
        error:
          'Telegram API_ID and API_HASH are missing on the server. Add TELEGRAM_API_ID and TELEGRAM_API_HASH in Settings or Environment Secrets.',
      };
    }

    try {
      let existing = this.pendingFlows.get(cleanPhone);

      // If user clicked "Resend via SMS / Call" and we already have an active phoneCodeHash
      if (params.forceResend && existing && existing.phoneCodeHash) {
        await existing.client.connect();
        const resendResult = await existing.client.invoke(
          new Api.auth.ResendCode({
            phoneNumber: cleanPhone,
            phoneCodeHash: existing.phoneCodeHash,
          })
        );
        const newHash = (resendResult as any).phoneCodeHash || existing.phoneCodeHash;
        existing.phoneCodeHash = newHash;
        const typeName = (resendResult as any).type?.className || 'auth.SentCodeTypeSms';
        return {
          ok: true,
          phoneCodeHash: newHash,
          deliveryType: typeName,
          isRealTelegramDc: true,
        };
      }

      // Create a fresh GramJS TelegramClient connected to real Telegram production servers
      const stringSession = new StringSession('');
      const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 3,
        deviceModel: 'TeleCall Android',
        systemVersion: 'Android 14',
        appVersion: '1.0.0',
        useWSS: true,
      });

      await client.connect();

      const sendResult = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: cleanPhone,
          apiId,
          apiHash,
          settings: new Api.CodeSettings({
            allowFlashcall: true,
            currentNumber: true,
            allowAppHash: true,
          }),
        })
      );

      const phoneCodeHash = String((sendResult as any).phoneCodeHash || '');
      const typeClass = (sendResult as any).type?.className || 'auth.SentCodeTypeApp';
      const nextTypeClass = (sendResult as any).nextType?.className || 'auth.CodeTypeSms';

      this.pendingFlows.set(cleanPhone, {
        client,
        phone: cleanPhone,
        phoneCodeHash,
        apiId,
        apiHash,
        createdAt: Date.now(),
      });

      return {
        ok: true,
        phoneCodeHash,
        deliveryType: typeClass,
        nextType: nextTypeClass,
        isRealTelegramDc: true,
      };
    } catch (err: any) {
      const msg = err?.errorMessage || err?.message || 'Failed to send code from Telegram DC';
      return {
        ok: false,
        error: `Telegram DC Error: ${msg}`,
      };
    }
  }

  /**
   * Step 2: Verify OTP Code (`auth.SignIn`), handle `SESSION_PASSWORD_NEEDED` (2FA SRP),
   * or handle `PHONE_NUMBER_UNOCCUPIED` (`auth.SignUp`)
   */
  public async verifyRealCode(params: {
    phone: string;
    code: string;
    phoneCodeHash: string;
    firstName?: string;
    lastName?: string;
    twoFactorPassword?: string;
  }): Promise<{
    ok: boolean;
    requires2FA?: boolean;
    passwordHint?: string;
    stringSession?: string;
    user?: {
      id: string;
      name: string;
      phone: string;
      username: string;
      bio: string;
      twoFactorEnabled: boolean;
    };
    error?: string;
  }> {
    const cleanPhone = this.normalizePhone(params.phone);
    const flow = this.pendingFlows.get(cleanPhone);

    if (!flow) {
      return {
        ok: false,
        error: 'Session expired or not found. Please tap "Send Code" again.',
      };
    }

    const { client } = flow;
    await client.connect();

    try {
      // If user is submitting their 2FA Cloud Password after SESSION_PASSWORD_NEEDED
      if (params.twoFactorPassword) {
        const passwordInfo = await client.invoke(new Api.account.GetPassword());
        const srpPassword = await computeCheck(passwordInfo, params.twoFactorPassword);
        const authResult = await client.invoke(
          new Api.auth.CheckPassword({
            password: srpPassword,
          })
        );
        return this.finalizeSession(cleanPhone, client, authResult, true);
      }

      // Standard OTP Verification (`auth.SignIn`)
      const signInResult = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: cleanPhone,
          phoneCodeHash: params.phoneCodeHash || flow.phoneCodeHash,
          phoneCode: params.code.trim(),
        })
      );

      // Check if Telegram indicates this phone number is a brand-new user (`auth.AuthorizationSignUpRequired`)
      if (
        (signInResult as any).className === 'auth.AuthorizationSignUpRequired'
      ) {
        const signUpResult = await client.invoke(
          new Api.auth.SignUp({
            phoneNumber: cleanPhone,
            phoneCodeHash: params.phoneCodeHash || flow.phoneCodeHash,
            firstName: params.firstName?.trim() || 'TeleCall User',
            lastName: params.lastName?.trim() || '',
          })
        );
        return this.finalizeSession(cleanPhone, client, signUpResult, false);
      }

      return this.finalizeSession(cleanPhone, client, signInResult, false);
    } catch (err: any) {
      const codeName = String(err?.errorMessage || err?.message || '');

      // 1. Account has Two-Step Verification (2FA Cloud Password) enabled
      if (codeName.includes('SESSION_PASSWORD_NEEDED')) {
        try {
          const pwd = await client.invoke(new Api.account.GetPassword());
          return {
            ok: false,
            requires2FA: true,
            passwordHint: pwd.hint || 'Telegram Cloud Password',
            error: 'SESSION_PASSWORD_NEEDED',
          };
        } catch {
          return {
            ok: false,
            requires2FA: true,
            passwordHint: 'Telegram Cloud Password',
            error: 'SESSION_PASSWORD_NEEDED',
          };
        }
      }

      // 2. Brand-new phone number not registered on Telegram yet -> Sign Up (`auth.SignUp`)
      if (codeName.includes('PHONE_NUMBER_UNOCCUPIED')) {
        try {
          const signUpResult = await client.invoke(
            new Api.auth.SignUp({
              phoneNumber: cleanPhone,
              phoneCodeHash: params.phoneCodeHash || flow.phoneCodeHash,
              firstName: params.firstName?.trim() || 'TeleCall User',
              lastName: params.lastName?.trim() || '',
            })
          );
          return this.finalizeSession(cleanPhone, client, signUpResult, false);
        } catch (signUpErr: any) {
          return {
            ok: false,
            error: `Telegram SignUp Error: ${signUpErr?.errorMessage || signUpErr?.message}`,
          };
        }
      }

      return {
        ok: false,
        error: `Telegram Verification Error: ${codeName}`,
      };
    }
  }

  private finalizeSession(
    cleanPhone: string,
    client: TelegramClient,
    authResult: any,
    twoFactorUsed: boolean
  ) {
    const tgUser = authResult?.user || {};
    const firstName = tgUser.firstName || 'Telegram';
    const lastName = tgUser.lastName || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'TeleCall User';
    const username = tgUser.username ? `@${tgUser.username}` : `@user_${ String(tgUser.id || 'tg')}`;
    const userId = `tg-${String(tgUser.id || Date.now())}`;
    const savedSessionString = String((client.session as any).save() || '');

    this.authenticatedClients.set(userId, client);
    this.pendingFlows.delete(cleanPhone);

    return {
      ok: true,
      stringSession: savedSessionString,
      user: {
        id: userId,
        name: fullName,
        phone: cleanPhone,
        username,
        bio: 'Synced with Official Telegram Account (MTProto)',
        twoFactorEnabled: twoFactorUsed,
      },
    };
  }

  /**
   * Fetch real synced Telegram Contacts from the user's authenticated TelegramClient
   */
  public async fetchRealContacts(userId: string) {
    const client = this.authenticatedClients.get(userId);
    if (!client) return null;

    try {
      await client.connect();
      const result = await client.invoke(
        new Api.contacts.GetContacts({
          hash: BigInt(0) as any,
        })
      );
      const users = (result as any).users || [];
      return users.map((u: any) => ({
        id: `tg-${String(u.id)}`,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Telegram Contact',
        phone: u.phone ? `+${u.phone}` : 'Telegram User',
        username: u.username ? `@${u.username}` : '@telegram',
        online: u.status?.className === 'UserStatusOnline',
        lastSeen: u.status?.className === 'UserStatusOnline' ? 'Online' : 'Telegram Synced',
      }));
    } catch {
      return null;
    }
  }
}

export const realTelegramAuthBridge = new RealTelegramAuthBridge();
