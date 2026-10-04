import type { CapacitorConfig } from '@capacitor/cli';

const isDevBuild = process.env.BUILD_ENV === 'dev';
const liveServerUrl = process.env.WEBVIEW_SERVER_URL;

const config: CapacitorConfig = {
  appId: isDevBuild ? 'org.telecall.messenger.dev' : 'org.telecall.messenger',
  appName: isDevBuild ? 'TeleCall Dev' : 'TeleCall',
  webDir: 'dist',
  server: liveServerUrl
    ? {
        url: liveServerUrl,
        cleartext: true,
        allowNavigation: ['*'],
      }
    : {
        androidScheme: 'https',
        cleartext: true,
      },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
