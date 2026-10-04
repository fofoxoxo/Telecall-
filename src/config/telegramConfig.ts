/**
 * TELEGRAM API CREDENTIALS & MULTI-DC CONFIGURATION (SECRETS-DRIVEN)
 * ==================================================================
 * Security Notice: Raw API_ID and API_HASH are NEVER hardcoded in source code.
 * They are loaded automatically from Environment Variables / GitHub Actions Secrets:
 * - Server-Side: `process.env.TELEGRAM_API_ID` & `process.env.TELEGRAM_API_HASH`
 * - Client-Side (Vite Build): `import.meta.env.VITE_TELEGRAM_API_ID` & `import.meta.env.VITE_TELEGRAM_API_HASH`
 */

export interface DataCenterEndpoint {
  dcId: 1 | 2 | 3 | 4 | 5;
  ipAddress: string;
  port: number;
  region: string;
}

export const TELEGRAM_DC_MAP: Record<number, DataCenterEndpoint> = {
  1: { dcId: 1, ipAddress: '149.154.175.53', port: 443, region: 'Miami, US (DC1)' },
  2: { dcId: 2, ipAddress: '149.154.167.51', port: 443, region: 'Amsterdam, NL (DC2)' },
  3: { dcId: 3, ipAddress: '149.154.175.100', port: 443, region: 'Miami, US (DC3)' },
  4: { dcId: 4, ipAddress: '149.154.167.91', port: 443, region: 'Amsterdam, NL (DC4 - Media/Main)' },
  5: { dcId: 5, ipAddress: '91.108.56.130', port: 443, region: 'Singapore, SG (DC5 - Asia/India)' },
};

const envApiId =
  (typeof process !== 'undefined' && (process.env?.TELEGRAM_API_ID || process.env?.VITE_TELEGRAM_API_ID)) ||
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TELEGRAM_API_ID);

const envApiHash =
  (typeof process !== 'undefined' && (process.env?.TELEGRAM_API_HASH || process.env?.VITE_TELEGRAM_API_HASH)) ||
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TELEGRAM_API_HASH);

export const TELEGRAM_CONFIG = {
  // Loaded strictly from GitHub Secrets / Environment Variables (No raw keys in code)
  API_ID: Number(envApiId) || 0,
  API_HASH: String(envApiHash || ''),

  // Default Telegram Production Data Center (DC5 Singapore / India)
  DEFAULT_DC_ID: 5 as 1 | 2 | 3 | 4 | 5,
  APP_VERSION: '1.0.0',
  DEVICE_MODEL: 'Android TeleCall Client',
  SYSTEM_VERSION: 'Android 14',
  LANG_CODE: 'en',

  // Media Streaming Chunk Constants (non-blocking 256KB MTProto chunks)
  STREAM_CHUNK_SIZE_BYTES: 256 * 1024,
  MAX_CONCURRENT_DC_WORKERS: 4,
};
