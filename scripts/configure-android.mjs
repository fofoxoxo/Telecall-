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

  // 2. Patch AndroidManifest.xml with Audio, Camera, Contacts & Push Notification permissions
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
        '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
      ].join('\n');
      manifest = manifest.replace('</manifest>', `${perms}\n</manifest>`);
      fs.writeFileSync(manifestPath, manifest, 'utf8');
      console.log('✅ Injected permissions into AndroidManifest.xml');
    }
  }

  // 3. Write MainActivity.java with WebRTC Audio/Camera grant, AudioManager.MODE_IN_COMMUNICATION & System Bar colors
  const mainActPath = 'android/app/src/main/java/com/telecall/dev/MainActivity.java';
  if (fs.existsSync(path.dirname(mainActPath))) {
    const javaSource = `package com.telecall.dev;

import android.Manifest;
import android.content.Context;
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
