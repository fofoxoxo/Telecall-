/**
 * Telegram API Credentials Configuration
 * --------------------------------------
 * GitHub par sync karne ke baad aap seedha is file (`src/config/telegramConfig.ts`)
 * me apna TELEGRAM_API_ID aur TELEGRAM_API_HASH daal sakte hain, ya fir GitHub Secrets me rakh sakte hain.
 */

export const TELEGRAM_CONFIG = {
  // Replace with your integer api_id from https://my.telegram.org
  API_ID: Number(import.meta.env.VITE_TELEGRAM_API_ID) || 28419022,

  // Replace with your 32-character api_hash from https://my.telegram.org
  API_HASH: String(import.meta.env.VITE_TELEGRAM_API_HASH || '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c'),

  // Default Telegram Production Data Center (DC4 / DC2 WebSocket & TCP Transport Bridge)
  DEFAULT_DC_ID: 4,
  APP_VERSION: '1.0.0',
  DEVICE_MODEL: 'Android TeleCall Client',
  SYSTEM_VERSION: 'Android 14',
  LANG_CODE: 'en',
};
