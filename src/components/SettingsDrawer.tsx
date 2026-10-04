import React, { useState } from 'react';
import {
  ArrowLeft,
  Palette,
  Server,
  RefreshCw,
  Database,
  Bell,
  Radio,
  Trash2,
  Check,
  ShieldCheck,
  Wifi
} from 'lucide-react';
import {
  apiFetch,
  getApiBaseUrl,
  setApiBaseUrl
} from '../services/mtprotoClient';

export type AppThemeId = 'telegram-dark' | 'midnight-oled' | 'emerald-night' | 'light-clean';

export interface ThemePalette {
  id: AppThemeId;
  label: string;
  bgMain: string;
  bgCard: string;
  border: string;
  accentBg: string;
  accentText: string;
  textPrimary: string;
  textSecondary: string;
}

export const THEME_PALETTES: Record<AppThemeId, ThemePalette> = {
  'telegram-dark': {
    id: 'telegram-dark',
    label: 'Telegram Night (Default)',
    bgMain: 'bg-[#0b141a]',
    bgCard: 'bg-[#111b21]',
    border: 'border-slate-800',
    accentBg: 'bg-sky-500',
    accentText: 'text-sky-400',
    textPrimary: 'text-slate-100',
    textSecondary: 'text-slate-400'
  },
  'midnight-oled': {
    id: 'midnight-oled',
    label: 'AMOLED Pure Black',
    bgMain: 'bg-black',
    bgCard: 'bg-zinc-950',
    border: 'border-zinc-800',
    accentBg: 'bg-indigo-500',
    accentText: 'text-indigo-400',
    textPrimary: 'text-zinc-100',
    textSecondary: 'text-zinc-400'
  },
  'emerald-night': {
    id: 'emerald-night',
    label: 'Emerald Matrix',
    bgMain: 'bg-[#071712]',
    bgCard: 'bg-[#0d241c]',
    border: 'border-emerald-900/70',
    accentBg: 'bg-emerald-500',
    accentText: 'text-emerald-400',
    textPrimary: 'text-emerald-50',
    textSecondary: 'text-emerald-300/70'
  },
  'light-clean': {
    id: 'light-clean',
    label: 'Daylight Clean',
    bgMain: 'bg-slate-100',
    bgCard: 'bg-white',
    border: 'border-slate-200',
    accentBg: 'bg-sky-600',
    accentText: 'text-sky-600',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-500'
  }
};

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTheme: AppThemeId;
  onSelectTheme: (theme: AppThemeId) => void;
  userId: string;
  userName: string;
  onClearLocalData: () => void;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  onClose,
  activeTheme,
  onSelectTheme,
  userId,
  userName,
  onClearLocalData
}) => {
  const [backendUrlInput, setBackendUrlInput] = useState<string>(() => getApiBaseUrl());
  const [savedUrlNotice, setSavedUrlNotice] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<string>('');
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [preferredBitrateTier, setPreferredBitrateTier] = useState<
    '2g-ultra-low' | '3g-low' | '4g-standard' | '5g-wifi-hd'
  >('3g-low');

  if (!isOpen) return null;

  const palette = THEME_PALETTES[activeTheme];

  const handleSaveBackendUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setApiBaseUrl(backendUrlInput);
    setSavedUrlNotice(true);
    setTimeout(() => setSavedUrlNotice(false), 2000);
  };

  const runBackendUtility = async (
    label: string,
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: Record<string, unknown>
  ) => {
    setRunningAction(label);
    setDiagnosticResult('');
    try {
      const res = await apiFetch(endpoint, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      setDiagnosticResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setDiagnosticResult(
        `Error reaching ${endpoint}: ${(err as Error).message}. Check Backend Server URL above.`
      );
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end">
      <div
        className={`w-full max-w-lg h-full ${palette.bgMain} ${palette.textPrimary} border-l ${palette.border} flex flex-col overflow-hidden`}
      >
        {/* Top Settings Header */}
        <div
          className={`h-14 px-4 ${palette.bgCard} border-b ${palette.border} flex items-center justify-between shrink-0`}
        >
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 text-xs font-semibold hover:opacity-80"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to TeleCall</span>
          </button>
          <span className="text-sm font-bold">Global Settings & System Utilities</span>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* 1. Theme Engine */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-3`}>
            <div className="flex items-center gap-2">
              <Palette className={`w-4 h-4 ${palette.accentText}`} />
              <h3 className="text-sm font-bold">Theme Engine</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(THEME_PALETTES) as AppThemeId[]).map((tKey) => {
                const item = THEME_PALETTES[tKey];
                const isSelected = activeTheme === tKey;
                return (
                  <button
                    key={tKey}
                    onClick={() => onSelectTheme(tKey)}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between ${
                      isSelected
                        ? 'border-sky-500 bg-sky-500/15 text-sky-400'
                        : `${palette.border} opacity-80 hover:opacity-100`
                    }`}
                  >
                    <span>{item.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Opus Audio Bitrate & Low-Network Mode (Step 5 SFU Control) */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-3`}>
            <div className="flex items-center gap-2">
              <Wifi className={`w-4 h-4 ${palette.accentText}`} />
              <h3 className="text-sm font-bold">Opus Voice Codec & Network Mode (SFU)</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: '2g-ultra-low', label: '2G Saver (6–8 kbps)' },
                  { id: '3g-low', label: '3G Low (12 kbps)' },
                  { id: '4g-standard', label: '4G Standard (24 kbps)' },
                  { id: '5g-wifi-hd', label: '5G/Wi-Fi HD (48 kbps)' }
                ] as const
              ).map((tier) => (
                <button
                  key={tier.id}
                  onClick={() => {
                    setPreferredBitrateTier(tier.id);
                    runBackendUtility('Adapting SFU Bitrate', '/api/sfu/adapt-bitrate', 'POST', {
                      roomId: 'room-upsc-101',
                      peerId: userId,
                      rttMs: tier.id === '2g-ultra-low' ? 380 : 40,
                      packetLossPercent: tier.id === '2g-ultra-low' ? 9 : 0,
                      jitterMs: 12,
                      forcedTier: tier.id
                    });
                  }}
                  className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-medium ${
                    preferredBitrateTier === tier.id
                      ? 'border-sky-500 bg-sky-500/15 text-sky-400 font-semibold'
                      : palette.border
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </section>

          {/* 3. APK Remote Backend Server Configuration */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-3`}>
            <div className="flex items-center gap-2">
              <Server className={`w-4 h-4 ${palette.accentText}`} />
              <h3 className="text-sm font-bold">Backend Server URL (For APK Testing)</h3>
            </div>
            <p className={`text-xs ${palette.textSecondary}`}>
              Leave blank when using same-origin web preview, or set your Cloud Run / Express server
              URL so the Android APK connects directly to your live backend.
            </p>
            <form onSubmit={handleSaveBackendUrl} className="flex gap-2">
              <input
                type="text"
                placeholder="https://ais-pre-xfn5k5hyj4aiqlwlaul5tn-771261258696.asia-southeast1.run.app"
                value={backendUrlInput}
                onChange={(e) => setBackendUrlInput(e.target.value)}
                className={`flex-1 h-10 px-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs font-mono`}
              />
              <button
                type="submit"
                className="min-h-[40px] px-3.5 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold shrink-0"
              >
                {savedUrlNotice ? 'Saved!' : 'Save URL'}
              </button>
            </form>
          </section>

          {/* 4. Live Backend Feature Verification Utilities (Steps 1–6) */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-3`}>
            <div className="flex items-center gap-2">
              <Database className={`w-4 h-4 ${palette.accentText}`} />
              <h3 className="text-sm font-bold">System Utilities & Backend Verification</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() =>
                  runBackendUtility('Multi-DC Status', '/api/dc-media/dc-status', 'GET')
                }
                className={`min-h-[40px] px-3 py-2 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-2 hover:border-sky-500/60`}
              >
                <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Check Multi-DC Router (Step 2)</span>
              </button>

              <button
                onClick={() =>
                  runBackendUtility('PTS Diff Sync', '/api/local-sync/pts-sync', 'POST', {
                    accountId: 'primary'
                  })
                }
                className={`min-h-[40px] px-3 py-2 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-2 hover:border-sky-500/60`}
              >
                <RefreshCw className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Run PTS Diff Sync (Step 3)</span>
              </button>

              <button
                onClick={() =>
                  runBackendUtility('Flush Offline Queue', '/api/local-sync/queue/flush', 'POST')
                }
                className={`min-h-[40px] px-3 py-2 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-2 hover:border-sky-500/60`}
              >
                <Database className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Flush Offline Queue (Step 3)</span>
              </button>

              <button
                onClick={() =>
                  runBackendUtility('Topic Hierarchy Tree', '/api/community-topics/tree', 'GET')
                }
                className={`min-h-[40px] px-3 py-2 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-2 hover:border-sky-500/60`}
              >
                <Radio className="w-4 h-4 text-purple-400 shrink-0" />
                <span>Inspect Topic Tree (Step 4)</span>
              </button>

              <button
                onClick={() =>
                  runBackendUtility('SFU Codec Profiles', '/api/sfu/profiles', 'GET')
                }
                className={`min-h-[40px] px-3 py-2 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-2 hover:border-sky-500/60`}
              >
                <Wifi className="w-4 h-4 text-sky-400 shrink-0" />
                <span>SFU Opus Profiles (Step 5)</span>
              </button>

              <button
                onClick={() =>
                  runBackendUtility(
                    'FCM Background Call Push',
                    '/api/notifications/call-wakeup',
                    'POST',
                    {
                      targetUserId: userId,
                      callerId: 'tg-tester',
                      callerName: userName,
                      callerPhone: '+91 98201 44512'
                    }
                  )
                }
                className={`min-h-[40px] px-3 py-2 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-2 hover:border-sky-500/60`}
              >
                <Bell className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Test FCM Call Wakeup (Step 6)</span>
              </button>
            </div>

            {runningAction && (
              <div className="text-xs text-sky-400 animate-pulse">
                Running: {runningAction}...
              </div>
            )}

            {diagnosticResult && (
              <pre
                className={`p-3 rounded-xl ${palette.bgMain} border ${palette.border} text-[11px] font-mono overflow-x-auto max-h-56`}
              >
                {diagnosticResult}
              </pre>
            )}
          </section>

          {/* 5. Local Cache & Storage Reset */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-2.5`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">Clear Local App Cache</h3>
                <p className={`text-xs ${palette.textSecondary}`}>
                  Reset cached rooms and offline state on this device.
                </p>
              </div>
              <button
                onClick={onClearLocalData}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset Cache</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
