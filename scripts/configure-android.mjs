/**
 * Clean Node.js Android APK Pre-Build Configurator
 * ================================================
 * Generates:
 * 1. `capacitor.config.json`
 * 2. Copies `google-services.json` / `googleservices.json` into `android/app/google-services.json`
 * 3. Injects Android Runtime Permissions (`RECORD_AUDIO`, `CAMERA`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH`, `READ_CONTACTS`, `POST_NOTIFICATIONS`) into `AndroidManifest.xml`
 * 4. Writes `MainActivity.java` with `WebChromeClient.onPermissionRequest`, `AudioManager.MODE_IN_COMMUNICATION`, and OS Status/Navigation Bar colors (`#111b21` / `#0b141a`).
 */

import fs from 'fs';
import path from 'path';

const mode = process.argv[2] || 'pre-cap';

if (mode === 'pre-cap') {
  const capConfig = {
    appId: 'com.telecall.dev',
    appName: 'TeleCall',
    webDir: 'dist',
    server: {
      cleartext: true,
      androidScheme: 'https',
      allowNavigation: ['*']
    },
    android: {
      allowMixedContent: true,
      captureInput: true,
      webContentsDebuggingEnabled: true,
      backgroundColor: '#ffffff'
    },
    plugins: {
      StatusBar: {
        overlaysWebView: false,
        style: 'LIGHT',
        backgroundColor: '#ffffff'
      }
    }
  };

  fs.writeFileSync('capacitor.config.json', JSON.stringify(capConfig, null, 2), 'utf8');
  console.log('✅ Generated capacitor.config.json');
} else if (mode === 'post-cap') {
  // 1. Copy google-services.json if present
  const gsPaths = ['google-services.json', 'googleservices.json'];
  for (const gs of gsPaths) {
    if (fs.existsSync(gs) && fs.existsSync('android/app')) {
      fs.copyFileSync(gs, path.join('android/app', 'google-services.json'));
      console.log(`✅ Copied ${gs} to android/app/google-services.json`);
      break;
    }
  }

  // 2. Patch AndroidManifest.xml with Audio, Camera, Contacts, ForegroundService & VoIPService registration
  const manifestPath = 'android/app/src/main/AndroidManifest.xml';
  if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    if (!manifest.includes('android.permission.RECORD_AUDIO')) {
      const perms = [
        '    <uses-permission android:name="android.permission.RECORD_AUDIO" />',
        '    <uses-permission android:name="android.permission.CAMERA" />',
        '    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
        '    <uses-permission android:name="android.permission.BLUETOOTH" />',
        '    <uses-permission android:name="android.permission.READ_CONTACTS" />',
        '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
        '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
        '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
        '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />',
        '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL" />',
        '    <uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />'
      ].join('\n');
      manifest = manifest.replace('</manifest>', `${perms}\n</manifest>`);
    }
    if (!manifest.includes('com.telecall.dev.VoIPService')) {
      const serviceTag = [
        '        <service',
        '            android:name="com.telecall.dev.VoIPService"',
        '            android:enabled="true"',
        '            android:exported="false"',
        '            android:foregroundServiceType="microphone|phoneCall" />'
      ].join('\n');
      manifest = manifest.replace('</application>', `${serviceTag}\n    </application>`);
    }
    fs.writeFileSync(manifestPath, manifest, 'utf8');
    console.log('✅ Patched AndroidManifest.xml with VoIPService and Call Permissions');
  }

  // 3. Write VoIPService.java & MainActivity.java
  const javaDir = 'android/app/src/main/java/com/telecall/dev';
  if (fs.existsSync(javaDir)) {
    const voipServiceSource = `package com.telecall.dev;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class VoIPService extends Service {
    private static final String CHANNEL_ID = "telecall_voip_channel";
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private AudioFocusRequest focusRequest;

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TeleCall::VoipWakeLock");
                wakeLock.acquire(60 * 60 * 1000L);
            }
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "TeleCall::VoipWifiLock");
                wifiLock.acquire();
            }
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(attrs)
                        .build();
                    am.requestAudioFocus(focusRequest);
                }
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Active Voice Call",
                    NotificationManager.IMPORTANCE_LOW
                );
                NotificationManager nm = getSystemService(NotificationManager.class);
                if (nm != null) nm.createNotificationChannel(channel);
                Notification notification = new Notification.Builder(this, CHANNEL_ID)
                    .setContentTitle("TeleCall Active Call")
                    .setContentText("End-to-End Encrypted Voice Call in progress")
                    .setSmallIcon(android.R.drawable.sym_action_call)
                    .setOngoing(true)
                    .build();
                startForeground(2002, notification);
            }
        } catch (Exception ignored) {}
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                    am.abandonAudioFocusRequest(focusRequest);
                }
                am.setMode(AudioManager.MODE_NORMAL);
                am.setSpeakerphoneOn(false);
            }
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
`;
    fs.writeFileSync(path.join(javaDir, 'VoIPService.java'), voipServiceSource, 'utf8');
    console.log('✅ Wrote VoIPService.java');
  }

  const mainActPath = 'android/app/src/main/java/com/telecall/dev/MainActivity.java';
  if (fs.existsSync(path.dirname(mainActPath))) {
    const javaSource = `package com.telecall.dev;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            Window window = getWindow();
            if (window != null) {
                window.setStatusBarColor(Color.parseColor("#ffffff"));
                window.setNavigationBarColor(Color.parseColor("#ffffff"));
            }
        } catch (Exception ignored) {}

        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
                this.bridge.getWebView().addJavascriptInterface(new AndroidAudioBridge(this), "AndroidAudioBridge");
                this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(() -> {
                            try {
                                request.grant(request.getResources());
                            } catch (Exception ignored) {}
                        });
                    }
                });
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onBackPressed() {
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().evaluateJavascript(
                    "(function(){ if(window.__telecallHandleHardwareBack && window.__telecallHandleHardwareBack()) { return 'handled'; } return 'root'; })()",
                    value -> {
                        if (value == null || !value.contains("handled")) {
                            if (this.bridge.getWebView().canGoBack()) {
                                this.bridge.getWebView().goBack();
                            } else {
                                moveTaskToBack(true);
                            }
                        }
                    }
                );
                return;
            }
        } catch (Exception ignored) {}
        super.onBackPressed();
    }

    private void requestAppRuntimePermissions() {
        try {
            String[] perms = new String[] {
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA,
                Manifest.permission.READ_CONTACTS,
                Manifest.permission.MODIFY_AUDIO_SETTINGS
            };
            List<String> needed = new ArrayList<>();
            for (String p : perms) {
                if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(p);
                }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                if (ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    needed.add("android.permission.POST_NOTIFICATIONS");
                }
            }
            if (!needed.isEmpty()) {
                ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), 1001);
            }
        } catch (Exception ignored) {}
    }

    public class AndroidAudioBridge {
        private final Context ctx;
        AndroidAudioBridge(Context c) { this.ctx = c; }

        @JavascriptInterface
        public String getDeviceModel() {
            String man = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
            String mod = Build.MODEL != null ? Build.MODEL : "Android Phone";
            if (mod.toLowerCase().startsWith(man.toLowerCase())) {
                return mod;
            }
            return (man + " " + mod).trim();
        }

        @JavascriptInterface
        public String getAndroidVersion() {
            return "Android " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")";
        }

        @JavascriptInterface
        public void startVoipService(String endpointsJson) {
            try {
                Intent serviceIntent = new Intent(ctx, VoIPService.class);
                serviceIntent.putExtra("endpoints", endpointsJson);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(serviceIntent);
                } else {
                    ctx.startService(serviceIntent);
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void stopVoipService() {
            try {
                Intent serviceIntent = new Intent(ctx, VoIPService.class);
                ctx.stopService(serviceIntent);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void requestDevicePermissions() {
            runOnUiThread(() -> requestAppRuntimePermissions());
        }

        @JavascriptInterface
        public void setCommunicationMode(boolean active) {
            try {
                AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.setMode(active ? AudioManager.MODE_IN_COMMUNICATION : AudioManager.MODE_NORMAL);
                    am.setSpeakerphoneOn(active);
                }
                if (active) {
                    startVoipService("[]");
                } else {
                    stopVoipService();
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void setSpeakerphoneOn(boolean on) {
            try {
                AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.setSpeakerphoneOn(on);
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void setSystemBarsColor(final String statusBarHex, final String navBarHex, final boolean isLight) {
            runOnUiThread(() -> {
                try {
                    Window w = getWindow();
                    if (w != null) {
                        w.setStatusBarColor(Color.parseColor(statusBarHex));
                        w.setNavigationBarColor(Color.parseColor(navBarHex));
                    }
                } catch (Exception ignored) {}
            });
        }
    }
}
`;
    fs.writeFileSync(mainActPath, javaSource, 'utf8');
    console.log('✅ Wrote MainActivity.java');
  }
} else if (mode === 'copy-apk') {
  const apkDir = 'android/app/build/outputs/apk/debug';
  const outDir = 'artifacts/apk';
  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(apkDir)) {
    const files = fs.readdirSync(apkDir).filter((f) => f.endsWith('.apk'));
    if (files.length > 0) {
      fs.copyFileSync(path.join(apkDir, files[0]), path.join(outDir, 'telecall-dev-debug.apk'));
      console.log(`✅ Copied ${files[0]} to artifacts/apk/telecall-dev-debug.apk`);
    }
  }
}
