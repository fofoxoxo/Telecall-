import React, { useState } from 'react';
import {
  ArrowLeft,
  Palette,
  Trash2,
  Check,
  Wifi,
  Volume2,
  Bell
} from 'lucide-react';

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
    label: 'Classic Dark',
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
    label: 'Pure Black',
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
    label: 'Forest Green',
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
    label: 'Daylight White',
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
  onClearLocalData
}) => {
  const [callDataSaver, setCallDataSaver] = useState<'auto' | 'low-data' | 'high-quality'>('auto');
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [callAlerts, setCallAlerts] = useState(true);

  if (!isOpen) return null;

  const palette = THEME_PALETTES[activeTheme];

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
            <span>Back</span>
          </button>
          <span className="text-sm font-bold">Settings</span>
          <div className="w-10" />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 1. App Appearance */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-3`}>
            <div className="flex items-center gap-2">
              <Palette className={`w-4 h-4 ${palette.accentText}`} />
              <h3 className="text-sm font-bold">Appearance</h3>
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

          {/* 2. Call Quality & Mobile Data */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-3`}>
            <div className="flex items-center gap-2">
              <Wifi className={`w-4 h-4 ${palette.accentText}`} />
              <h3 className="text-sm font-bold">Call Quality & Data Usage</h3>
            </div>
            <p className={`text-xs ${palette.textSecondary}`}>
              Automatically adjusts call quality on slow mobile networks so your voice never drops.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'auto', label: 'Automatic' },
                  { id: 'low-data', label: 'Data Saver' },
                  { id: 'high-quality', label: 'Clear HD' }
                ] as const
              ).map((tier) => (
                <button
                  key={tier.id}
                  onClick={() => setCallDataSaver(tier.id)}
                  className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-medium ${
                    callDataSaver === tier.id
                      ? 'border-sky-500 bg-sky-500/15 text-sky-400 font-semibold'
                      : palette.border
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </section>

          {/* 3. Audio & Notifications */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-3`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Volume2 className={`w-4 h-4 ${palette.accentText}`} />
                <div>
                  <div className="text-xs font-semibold">Clear Voice & Echo Reduction</div>
                  <div className={`text-[11px] ${palette.textSecondary}`}>
                    Reduces background noise during calls
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={noiseSuppression}
                onChange={(e) => setNoiseSuppression(e.target.checked)}
                className="w-4 h-4 accent-sky-500"
              />
            </div>

            <div className={`pt-3 border-t ${palette.border} flex items-center justify-between`}>
              <div className="flex items-center gap-2.5">
                <Bell className={`w-4 h-4 ${palette.accentText}`} />
                <div>
                  <div className="text-xs font-semibold">Incoming Call Ringtone & Vibration</div>
                  <div className={`text-[11px] ${palette.textSecondary}`}>
                    Alert when someone calls your number
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={callAlerts}
                onChange={(e) => setCallAlerts(e.target.checked)}
                className="w-4 h-4 accent-sky-500"
              />
            </div>
          </section>

          {/* 4. Clear Call History */}
          <section className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-2.5`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">Clear Call History</h3>
                <p className={`text-xs ${palette.textSecondary}`}>
                  Remove saved call history from this phone.
                </p>
              </div>
              <button
                onClick={onClearLocalData}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
