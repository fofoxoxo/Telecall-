import React, { useEffect, useRef, useState } from 'react';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneOff,
  PhoneCall,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  User,
  Users,
  Lock,
  ArrowLeft,
  Delete,
  Edit3,
  Settings,
  Video,
  VideoOff,
  Pause,
  UserPlus,
  RefreshCw,
  LogOut,
  Check,
  MessageSquare
} from 'lucide-react';
import {
  apiFetch,
  mtprotoEngine,
  MTProtoSessionData
} from './services/mtprotoClient';
import { tdlibClientEngine } from './services/tdlibClient';
import {
  NotificationCenter,
  NotificationEvents
} from './services/tgnetConnectionsManager';
import { peerCallWebRtcEngine } from './services/peerCallWebRtc';
import {
  SettingsDrawer,
  AppThemeId,
  THEME_PALETTES
} from './components/SettingsDrawer';

interface SyncedContact {
  id: string;
  name: string;
  phone: string;
  username: string;
  online: boolean;
  lastSeen: string;
  tgId?: any;
  accessHash?: any;
}

interface CallLogEntry {
  id: string;
  contactName: string;
  phone: string;
  username?: string;
  direction: 'outgoing' | 'incoming';
  durationSeconds: number;
  timestamp: string;
  dhEmojis?: string[];
}

interface ActiveCallState {
  contactName: string;
  phone: string;
  sessionId: string;
  emojis: string[];
  status: 'ringing' | 'connected' | 'on-hold';
  isMuted: boolean;
  isSpeakerOn: boolean;
  isOnHold: boolean;
  isVideoEnabled: boolean;
  addedParticipants: string[];
}

interface IncomingCallOffer {
  sessionId: string;
  callerName: string;
  callerPhone: string;
  emojis: string[];
  sdpOffer?: RTCSessionDescriptionInit;
  tgCallPeer?: { id: any; access_hash: any };
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const DIAL_KEYS = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '+', sub: '' },
  { digit: '0', sub: '' },
  { digit: '#', sub: '' }
];

const THEME_STORAGE_KEY = 'telecall_active_theme';

const THEME_HEX_COLORS: Record<AppThemeId, { barHex: string; bgHex: string; isLight: boolean }> = {
  'telegram-dark': { barHex: '#111b21', bgHex: '#0b141a', isLight: false },
  'midnight-oled': { barHex: '#09090b', bgHex: '#000000', isLight: false },
  'emerald-night': { barHex: '#0d241c', bgHex: '#071712', isLight: false },
  'light-clean': { barHex: '#ffffff', bgHex: '#f1f5f9', isLight: true }
};

export default function App() {
  // Theme State
  const [activeTheme, setActiveTheme] = useState<AppThemeId>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as AppThemeId | null;
    return saved && THEME_PALETTES[saved] ? saved : 'telegram-dark';
  });
  const palette = THEME_PALETTES[activeTheme];

  const handleSelectTheme = (theme: AppThemeId) => {
    setActiveTheme(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  };

  // Sync OS Status Bar, Navigation Bar & HTML background color with active theme so no top/bottom gaps appear
  useEffect(() => {
    const colors = THEME_HEX_COLORS[activeTheme] || THEME_HEX_COLORS['telegram-dark'];
    document.documentElement.style.backgroundColor = colors.bgHex;
    document.body.style.backgroundColor = colors.bgHex;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', colors.barHex);
    }

    const win = window as any;
    if (win.Capacitor?.Plugins?.StatusBar) {
      const StatusBar = win.Capacitor.Plugins.StatusBar;
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      StatusBar.setBackgroundColor({ color: colors.barHex }).catch(() => {});
      StatusBar.setStyle({ style: colors.isLight ? 'LIGHT' : 'DARK' }).catch(() => {});
    }
    if (win.AndroidAudioBridge?.setSystemBarsColor) {
      try {
        win.AndroidAudioBridge.setSystemBarsColor(colors.barHex, colors.bgHex, colors.isLight);
      } catch {
        // ignore
      }
    }
  }, [activeTheme]);

  // Settings Page State
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);

  // User Session (Telegram Authentication)
  const [session, setSession] = useState<MTProtoSessionData | null>(() =>
    mtprotoEngine.getSavedSession()
  );

  // Telegram Authentication Flow States (Step 1: Phone -> Step 2: Code -> Step 3a: Password / Step 3b: SignUp)
  const [authStep, setAuthStep] = useState<'phone' | 'otp' | '2fa' | 'signup'>('phone');
  const [phoneInput, setPhoneInput] = useState('+91 ');
  const [firstNameInput, setFirstNameInput] = useState('');
  const [lastNameInput, setLastNameInput] = useState('');
  const [signupAvatarDataUrl, setSignupAvatarDataUrl] = useState<string>('');
  const [otpInput, setOtpInput] = useState('');
  const [sentDeliveryType, setSentDeliveryType] = useState<string>('app');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Main Screen Navigation ('logs' | 'dialer' | 'contacts' | 'profile')
  const [activePage, setActivePage] = useState<'logs' | 'dialer' | 'contacts' | 'profile'>('logs');

  // Selected Contact Profile & Call History Detail View
  const [selectedContact, setSelectedContact] = useState<SyncedContact | null>(null);

  // Profile Edit State (Name, Username, Phone Number)
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [profileSavedNotice, setProfileSavedNotice] = useState(false);

  // Thumb-Zone Dialer State
  const [dialedInput, setDialedInput] = useState('+91 ');

  // Contacts & Call History State
  const [contacts, setContacts] = useState<SyncedContact[]>([
    {
      id: 'contact-1',
      name: 'Aarav Sharma',
      phone: '+91 98201 44512',
      username: '@aarav_s',
      online: true,
      lastSeen: 'Online'
    },
    {
      id: 'contact-2',
      name: 'Priya Verma',
      phone: '+91 98114 22089',
      username: '@priya_v',
      online: true,
      lastSeen: 'Online'
    },
    {
      id: 'contact-3',
      name: 'Kabir Mehta',
      phone: '+91 98765 11201',
      username: '@kabir_m',
      online: true,
      lastSeen: 'Online'
    },
    {
      id: 'contact-4',
      name: 'Zoya Khan',
      phone: '+91 98991 30264',
      username: '@zoya_k',
      online: false,
      lastSeen: 'Recently'
    }
  ]);

  const [callLogs, setCallLogs] = useState<CallLogEntry[]>([
    {
      id: 'log-1',
      contactName: 'Aarav Sharma',
      phone: '+91 98201 44512',
      username: '@aarav_s',
      direction: 'outgoing',
      durationSeconds: 342,
      timestamp: 'Today, 9:40 PM',
      dhEmojis: ['🔐', '🚀', '🦁', '🎸']
    },
    {
      id: 'log-2',
      contactName: 'Priya Verma',
      phone: '+91 98114 22089',
      username: '@priya_v',
      direction: 'incoming',
      durationSeconds: 128,
      timestamp: 'Today, 7:15 PM',
      dhEmojis: ['⚡', '💎', '🌍', '🔥']
    },
    {
      id: 'log-3',
      contactName: 'Kabir Mehta',
      phone: '+91 98765 11201',
      username: '@kabir_m',
      direction: 'outgoing',
      durationSeconds: 195,
      timestamp: 'Yesterday, 8:10 PM',
      dhEmojis: ['🔐', '🚀', '🦁', '🎸']
    }
  ]);

  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('+91 ');
  const [syncingContacts, setSyncingContacts] = useState(false);

  // Active Call & Incoming Call Ringing States
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallOffer | null>(null);
  const [showAddCallPicker, setShowAddCallPicker] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const currentUser: MTProtoSessionData = session || {
    dcId: 5,
    authKeyHex: 'default',
    serverSalt: 'default',
    userId: 'user-local',
    phone: '+91 98200 11223',
    name: 'Aarav Verma',
    username: '@aarav',
    bio: 'Available for calls',
    twoFactorEnabled: false,
    createdAt: Date.now()
  };

  const playTone = (freq = 480, duration = 0.12) => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // ignore
    }
  };

  // Pre-warm authentication engine & initialize real-time call listeners
  useEffect(() => {
    mtprotoEngine.initPersistentConnection();
    tdlibClientEngine.ensureReadyForAuth().catch(() => {});

    // Load cached contacts & call history immediately
    const cached = tdlibClientEngine.getCachedSnapshot();
    if (Array.isArray(cached.contacts) && cached.contacts.length > 0) {
      setContacts(cached.contacts);
    }
    if (Array.isArray(cached.callLogs) && cached.callLogs.length > 0) {
      setCallLogs((prev) => {
        const merged = [...cached.callLogs, ...prev];
        return merged.filter(
          (v, idx, arr) => arr.findIndex((item) => item.id === v.id) === idx
        );
      });
    }

    if (session) {
      tdlibClientEngine.syncAllTelegramData().catch(() => {});

      // Register push notifications on Android if available
      const win = window as any;
      if (win.Capacitor?.Plugins?.PushNotifications) {
        const PushNotifications = win.Capacitor.Plugins.PushNotifications;
        PushNotifications.requestPermissions()
          .then((perm: any) => {
            if (perm.receive === 'granted') PushNotifications.register();
          })
          .catch(() => {});
        PushNotifications.addListener('registration', (tokenObj: { value: string }) => {
          if (tokenObj?.value) {
            tdlibClientEngine.registerFcmToken(tokenObj.value).catch(() => {});
            apiFetch('/api/notifications/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: session.userId,
                fcmToken: tokenObj.value,
                platform: 'android'
              })
            }).catch(() => {});
          }
        });
      }
    }

    const unsubContacts = NotificationCenter.getInstance().addObserver(
      NotificationEvents.contactsDidLoad,
      (loadedContacts) => {
        if (Array.isArray(loadedContacts) && loadedContacts.length > 0) {
          setContacts(loadedContacts);
        }
      }
    );

    const unsubCallHistory = NotificationCenter.getInstance().addObserver(
      NotificationEvents.callHistoryDidLoad,
      (syncedCalls) => {
        if (Array.isArray(syncedCalls) && syncedCalls.length > 0) {
          setCallLogs((prev) => {
            const merged = [...syncedCalls, ...prev];
            return merged.filter(
              (v, idx, arr) => arr.findIndex((item) => item.id === v.id) === idx
            );
          });
        }
      }
    );

    // Listen for incoming Telegram calls (`phoneCallRequested`)
    const unsubTgIncoming = NotificationCenter.getInstance().addObserver(
      NotificationEvents.didReceiveIncomingCall,
      (pc) => {
        playTone(620, 0.35);
        setIncomingCall({
          sessionId: String(pc?.id || Date.now()),
          callerName: 'Incoming Call',
          callerPhone: 'Telegram Voice Call',
          emojis: ['🔐', '✈️', '🛡️', '⚡'],
          tgCallPeer: pc?.id && pc?.access_hash ? { id: pc.id, access_hash: pc.access_hash } : undefined
        });
      }
    );

    // Listen for 1-on-1 WebRTC Peer Calls & Audio/Video Streams
    const unsubWebRtc = peerCallWebRtcEngine.initSignalingListener(
      () => ({ phone: currentUser.phone, userId: currentUser.userId }),
      (offer) => {
        playTone(620, 0.35);
        setIncomingCall(offer);
      },
      {
        onRemoteStream: (stream) => {
          if (remoteVideoRef.current && stream.getVideoTracks().length > 0) {
            remoteVideoRef.current.srcObject = stream;
          }
        },
        onCallConnected: () => {
          setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
        },
        onCallEnded: () => {
          setActiveCall(null);
          setIncomingCall(null);
        },
        onRemoteHoldChanged: (isHeld) => {
          setActiveCall((prev) =>
            prev ? { ...prev, status: isHeld ? 'on-hold' : 'connected' } : null
          );
        }
      }
    );

    return () => {
      unsubContacts();
      unsubCallHistory();
      unsubTgIncoming();
      unsubWebRtc();
    };
  }, [session, currentUser.phone, currentUser.userId]);

  // Call duration timer (runs when call is connected or ringing)
  useEffect(() => {
    if (!activeCall) {
      setCallSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setCallSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeCall]);

  // --- AUTHENTICATION HANDLERS ---

  const handleSendOtp = async (e: React.FormEvent, forceResend = false) => {
    e.preventDefault();
    setAuthError('');
    if (phoneInput.replace(/[^\d]/g, '').length < 8) {
      setAuthError('Please enter a valid phone number.');
      return;
    }

    // Switch to OTP input screen immediately so the user never waits when OTP arrives fast on their phone!
    setOtpInput('');
    setAuthStep('otp');
    setAuthLoading(true);

    const res = await mtprotoEngine.sendAuthCode(phoneInput, { forceResend });
    setAuthLoading(false);

    if (res.ok && res.phoneCodeHash) {
      setPhoneCodeHash(res.phoneCodeHash);
      setSentDeliveryType(res.deliveryType || 'app');
    } else {
      setAuthStep('phone');
      setAuthError(res.error || 'Could not send verification code. Please check your number.');
    }
  };

  const finalizeLoggedInSession = async (sessionData: MTProtoSessionData) => {
    mtprotoEngine.updateSavedProfile(sessionData);
    setSession(sessionData);
    setAuthStep('phone');
    setTwoFactorPassword('');
    setActivePage('logs');

    // Immediately trigger OS Device Permission Pop-ups (Microphone, Camera & Contacts) right after authentication
    peerCallWebRtcEngine.requestAllDevicePermissionsOnLogin().catch(() => {});
    tdlibClientEngine.syncAllTelegramData().catch(() => {});
  };

  const handleVerifyOtpOr2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    const res = await mtprotoEngine.verifyAuthCode({
      phone: phoneInput,
      code: otpInput,
      phoneCodeHash,
      name: firstNameInput || 'User',
      lastName: lastNameInput,
      twoFactorPassword: twoFactorPassword || undefined
    });
    setAuthLoading(false);

    if (res.requires2FA) {
      setPasswordHint(res.passwordHint || '');
      setAuthStep('2fa');
      return;
    }

    if (res.requiresSignUp) {
      setAuthStep('signup');
      return;
    }

    if (res.ok && res.sessionData) {
      finalizeLoggedInSession(res.sessionData);
    } else {
      setAuthError(res.error || 'Invalid code. Please try again.');
    }
  };

  const handleCompleteSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!firstNameInput.trim()) {
      setAuthError('Please enter your first name.');
      return;
    }

    setAuthLoading(true);
    const res = await mtprotoEngine.completeSignUp({
      phone: phoneInput,
      phoneCodeHash,
      firstName: firstNameInput.trim(),
      lastName: lastNameInput.trim(),
      avatarDataUrl: signupAvatarDataUrl || undefined
    });
    setAuthLoading(false);

    if (res.ok && res.sessionData) {
      finalizeLoggedInSession(res.sessionData);
    } else {
      setAuthError(res.error || 'Could not create account.');
    }
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSignupAvatarDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // --- CALLING HANDLERS (OUTGOING, INCOMING ACCEPT/DECLINE, MUTE, SPEAKER, HOLD, VIDEO, ADD CALL) ---

  const startCall = async (
    contactName: string,
    phone: string,
    username?: string,
    tgId?: any,
    accessHash?: any
  ) => {
    if (!phone.trim() && !contactName.trim()) return;
    playTone(540, 0.14);

    const sessionId = 'call-' + Date.now();
    const initialEmojis = ['🔐', '✈️', '🛡️', '⚡'];

    setActiveCall({
      contactName: contactName || phone,
      phone,
      sessionId,
      emojis: initialEmojis,
      status: 'ringing',
      isMuted: false,
      isSpeakerOn: true,
      isOnHold: false,
      isVideoEnabled: false,
      addedParticipants: []
    });

    // 1. Start real WebRTC E2EE Audio stream with Automatic Low-Network Bitrate Adaptation
    peerCallWebRtcEngine
      .startOutgoingCall({
        sessionId,
        callerId: currentUser.userId,
        callerName: currentUser.name,
        callerPhone: currentUser.phone,
        targetPhone: phone.trim(),
        emojis: initialEmojis,
        withVideo: false
      })
      .catch(() => {});

    // 2. Also ring the target user on Telegram (`phone.requestCall`)
    const realCallRes = await tdlibClientEngine.startRealCall({
      phone: phone.trim(),
      username,
      tgId,
      accessHash
    });

    const finalEmojis = realCallRes.dhEmojis || initialEmojis;
    setActiveCall((prev) =>
      prev
        ? {
            ...prev,
            emojis: finalEmojis,
            status: 'connected'
          }
        : null
    );

    const newLog: CallLogEntry = {
      id: 'log-' + Date.now(),
      contactName: contactName || phone,
      phone,
      username,
      direction: 'outgoing',
      durationSeconds: 0,
      timestamp: 'Just now',
      dhEmojis: finalEmojis
    };
    setCallLogs((prev) => [newLog, ...prev]);

    // 3. Notify push service for background wakeup
    apiFetch('/api/call/handshake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerId: currentUser.userId,
        callerName: currentUser.name,
        callerPhone: currentUser.phone,
        calleeId: tgId || phone,
        contactName,
        phone
      })
    }).catch(() => {});
  };

  const handleAcceptIncomingCall = async () => {
    if (!incomingCall) return;
    const offer = incomingCall;
    setIncomingCall(null);
    playTone(680, 0.14);

    setActiveCall({
      contactName: offer.callerName,
      phone: offer.callerPhone,
      sessionId: offer.sessionId,
      emojis: offer.emojis,
      status: 'connected',
      isMuted: false,
      isSpeakerOn: true,
      isOnHold: false,
      isVideoEnabled: false,
      addedParticipants: []
    });

    if (offer.tgCallPeer) {
      await tdlibClientEngine.acceptRealCall(offer.tgCallPeer);
    }

    await peerCallWebRtcEngine.answerIncomingCall({
      sessionId: offer.sessionId,
      myUserId: currentUser.userId,
      sdpOffer: offer.sdpOffer,
      withVideo: false
    });

    const newLog: CallLogEntry = {
      id: 'log-' + Date.now(),
      contactName: offer.callerName,
      phone: offer.callerPhone,
      direction: 'incoming',
      durationSeconds: 0,
      timestamp: 'Just now',
      dhEmojis: offer.emojis
    };
    setCallLogs((prev) => [newLog, ...prev]);
  };

  const handleDeclineIncomingCall = () => {
    if (!incomingCall) return;
    playTone(300, 0.15);
    tdlibClientEngine.discardRealCall(0).catch(() => {});
    peerCallWebRtcEngine.endCall(currentUser.userId);
    setIncomingCall(null);
  };

  const handleToggleMute = () => {
    if (!activeCall) return;
    const nextMuted = !activeCall.isMuted;
    peerCallWebRtcEngine.setMuted(nextMuted);
    setActiveCall({ ...activeCall, isMuted: nextMuted });
  };

  const handleToggleSpeaker = () => {
    if (!activeCall) return;
    const nextSpeaker = !activeCall.isSpeakerOn;
    peerCallWebRtcEngine.setSpeakerphone(nextSpeaker);
    setActiveCall({ ...activeCall, isSpeakerOn: nextSpeaker });
  };

  const handleToggleHold = () => {
    if (!activeCall) return;
    const nextHold = !activeCall.isOnHold;
    peerCallWebRtcEngine.setHold(nextHold, currentUser.userId);
    setActiveCall({
      ...activeCall,
      isOnHold: nextHold,
      status: nextHold ? 'on-hold' : 'connected'
    });
  };

  const handleToggleVideoCall = async () => {
    if (!activeCall) return;
    const nextVideo = !activeCall.isVideoEnabled;
    const stream = await peerCallWebRtcEngine.setVideoEnabled(nextVideo);
    if (nextVideo && stream && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    setActiveCall({ ...activeCall, isVideoEnabled: nextVideo });
  };

  const handleAddParticipantToCall = (contact: SyncedContact) => {
    if (!activeCall) return;
    if (!activeCall.addedParticipants.includes(contact.name)) {
      setActiveCall({
        ...activeCall,
        addedParticipants: [...activeCall.addedParticipants, contact.name]
      });
      tdlibClientEngine
        .startRealCall({
          phone: contact.phone,
          username: contact.username,
          tgId: contact.tgId,
          accessHash: contact.accessHash
        })
        .catch(() => {});
    }
    setShowAddCallPicker(false);
  };

  const handleEndCall = () => {
    playTone(300, 0.16);
    tdlibClientEngine.discardRealCall(callSeconds).catch(() => {});
    peerCallWebRtcEngine.endCall(currentUser.userId);
    setCallLogs((prev) =>
      prev.map((item, idx) =>
        idx === 0 && item.durationSeconds === 0
          ? { ...item, durationSeconds: callSeconds }
          : item
      )
    );
    setShowAddCallPicker(false);
    setActiveCall(null);
  };

  // --- CONTACTS & PROFILE HANDLERS ---

  const handleSyncContacts = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSyncingContacts(true);
    const customEntries =
      newContactName.trim() && newContactPhone.trim()
        ? [
            {
              firstName: newContactName.trim().split(' ')[0] || newContactName.trim(),
              lastName: newContactName.trim().split(' ').slice(1).join(' '),
              phone: newContactPhone.trim()
            }
          ]
        : undefined;

    try {
      const synced = await tdlibClientEngine.getTdlibContacts(customEntries);
      if (synced && synced.length > 0) {
        setContacts(synced);
      } else if (customEntries && customEntries[0]) {
        setContacts((prev) => [
          {
            id: 'contact-' + Date.now(),
            name: newContactName.trim(),
            phone: newContactPhone.trim(),
            username: '@' + newContactName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'),
            online: true,
            lastSeen: 'Online'
          },
          ...prev
        ]);
      }
      setNewContactName('');
      setNewContactPhone('+91 ');
      setShowAddContactModal(false);
    } finally {
      setSyncingContacts(false);
    }
  };

  const openEditProfile = () => {
    setEditName(currentUser.name);
    setEditUsername(currentUser.username.replace(/^@/, ''));
    setEditPhone(currentUser.phone);
    setIsEditingProfile(true);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = editUsername.trim().startsWith('@')
      ? editUsername.trim()
      : `@${editUsername.trim() || 'user'}`;
    const updated: MTProtoSessionData = {
      ...currentUser,
      name: editName.trim() || currentUser.name,
      username: cleanUsername,
      phone: editPhone.trim() || currentUser.phone
    };
    mtprotoEngine.updateSavedProfile(updated);
    setSession(updated);
    setIsEditingProfile(false);
    setProfileSavedNotice(true);
    setTimeout(() => setProfileSavedNotice(false), 2000);
  };

  const handleLogout = () => {
    mtprotoEngine.logout();
    setSession(null);
    setAuthStep('phone');
  };

  // ============================================================================
  // 1. FULL-SCREEN TELEGRAM AUTHENTICATION ON APP OPEN (IF NOT LOGGED IN)
  // ============================================================================
  if (!session) {
    return (
      <div
        className={`min-h-screen ${palette.bgMain} ${palette.textPrimary} flex flex-col items-center justify-center p-5 select-none`}
      >
        <div
          className={`${palette.bgCard} border ${palette.border} rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-6`}
        >
          <form
            onSubmit={
              authStep === 'phone'
                ? (e) => handleSendOtp(e, false)
                : authStep === 'signup'
                ? handleCompleteSignUp
                : handleVerifyOtpOr2FA
            }
            className="space-y-5"
          >
            {/* Step 1: Enter Phone Number */}
            {authStep === 'phone' && (
              <div className="space-y-4 text-center">
                <div className="w-16 h-16 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center mx-auto">
                  <Phone className="w-7 h-7" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">TeleCall</h1>
                  <p className={`text-xs ${palette.textSecondary} mt-1`}>
                    Enter your phone number to start calling your contacts.
                  </p>
                </div>

                <div className="text-left">
                  <label className={`block text-xs ${palette.textSecondary} mb-1.5`}>
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    autoFocus
                    placeholder="+91 98765 43210"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className={`w-full h-12 px-4 rounded-xl ${palette.bgMain} border ${palette.border} text-base font-medium focus:outline-none focus:border-sky-500`}
                  />
                </div>
              </div>
            )}

            {/* Step 2: Enter 5-Digit Code */}
            {authStep === 'otp' && (
              <div className="space-y-4 text-center">
                <div className="w-16 h-16 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center mx-auto">
                  <MessageSquare className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">{phoneInput}</h2>
                  <p className={`text-xs ${palette.textSecondary} mt-1`}>
                    {sentDeliveryType.toLowerCase().includes('sms')
                      ? 'We sent an SMS with your verification code.'
                      : 'We sent a verification code to your Telegram app.'}
                  </p>
                </div>

                <div className="text-left">
                  <label className="block text-xs text-sky-400 mb-1.5">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    maxLength={6}
                    placeholder="• • • • •"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    className={`w-full h-12 px-4 rounded-xl ${palette.bgMain} border border-sky-500 text-center text-lg font-bold tracking-widest focus:outline-none`}
                  />
                </div>

                <button
                  type="button"
                  onClick={(e) => handleSendOtp(e, true)}
                  className="text-xs text-sky-400 hover:underline"
                >
                  Didn&apos;t receive the code? Resend
                </button>
              </div>
            )}

            {/* Step 3a: Password (If Two-Step Verification is enabled) */}
            {authStep === '2fa' && (
              <div className="space-y-4 text-center">
                <div className="w-16 h-16 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center mx-auto">
                  <Lock className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Enter Password</h2>
                  <p className={`text-xs ${palette.textSecondary} mt-1`}>
                    Your account is protected with a password.
                  </p>
                </div>

                <div className="text-left">
                  <label className="block text-xs text-sky-400 mb-1.5">
                    Password {passwordHint ? `(Hint: ${passwordHint})` : ''}
                  </label>
                  <input
                    type="password"
                    required
                    autoFocus
                    placeholder="Enter your password"
                    value={twoFactorPassword}
                    onChange={(e) => setTwoFactorPassword(e.target.value)}
                    className={`w-full h-12 px-4 rounded-xl ${palette.bgMain} border border-sky-500 text-sm focus:outline-none`}
                  />
                </div>
              </div>
            )}

            {/* Step 3b: New Account Registration */}
            {authStep === 'signup' && (
              <div className="space-y-4 text-center">
                <div className="flex flex-col items-center gap-2">
                  <label className="relative w-20 h-20 rounded-full bg-sky-500/15 border-2 border-dashed border-sky-400/60 flex items-center justify-center cursor-pointer overflow-hidden">
                    {signupAvatarDataUrl ? (
                      <img
                        src={signupAvatarDataUrl}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[11px] font-semibold text-sky-400 px-2">
                        Add Photo
                      </span>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarFileSelect}
                      className="hidden"
                    />
                  </label>
                  <div>
                    <h2 className="text-lg font-bold">Your Name</h2>
                    <p className={`text-xs ${palette.textSecondary} mt-0.5`}>
                      Enter your name and add a photo to finish signing up.
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5 text-left">
                  <div>
                    <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                      First Name
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder="First name"
                      value={firstNameInput}
                      onChange={(e) => setFirstNameInput(e.target.value)}
                      className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                      Last Name (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Last name"
                      value={lastNameInput}
                      onChange={(e) => setLastNameInput(e.target.value)}
                      className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
                    />
                  </div>
                </div>
              </div>
            )}

            {authError && (
              <p className="text-xs text-rose-400 text-center bg-rose-500/10 border border-rose-500/30 rounded-xl p-2.5">
                {authError}
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              {authStep !== 'phone' && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('phone');
                    setAuthError('');
                  }}
                  className={`min-h-[44px] px-4 py-2 rounded-xl border ${palette.border} text-xs font-semibold`}
                >
                  Back
                </button>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="flex-1 min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-sm font-bold"
              >
                {authLoading
                  ? 'Please wait...'
                  : authStep === 'phone'
                  ? 'Continue'
                  : authStep === 'otp'
                  ? 'Next'
                  : authStep === '2fa'
                  ? 'Continue'
                  : 'Start Calling'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Contact History helper for Selected Contact Profile view
  const selectedContactHistory = selectedContact
    ? callLogs.filter(
        (l) =>
          l.phone.replace(/[^\d]/g, '').slice(-10) ===
            selectedContact.phone.replace(/[^\d]/g, '').slice(-10) ||
          l.contactName.toLowerCase() === selectedContact.name.toLowerCase()
      )
    : [];

  // ============================================================================
  // 2. MAIN CALLING APP INTERFACE (CALL LOGS HOME + FLOATING BUTTONS)
  // ============================================================================
  return (
    <div
      className={`min-h-screen ${palette.bgMain} ${palette.textPrimary} flex flex-col justify-between pb-24 select-none`}
    >
      {/* TOP HEADER: Left = App Name ("TeleCall") | Right = Profile Button */}
      <header
        className={`sticky top-0 z-30 h-14 px-4 ${palette.bgCard}/95 backdrop-blur-md border-b ${palette.border} flex items-center justify-between`}
      >
        <div className="flex items-center gap-2.5">
          {activePage !== 'logs' || selectedContact ? (
            <button
              onClick={() => {
                if (selectedContact) {
                  setSelectedContact(null);
                } else {
                  setActivePage('logs');
                }
              }}
              className={`w-9 h-9 rounded-xl border ${palette.border} flex items-center justify-center hover:opacity-80`}
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-sky-500 flex items-center justify-center text-slate-950 font-bold">
              <Phone className="w-4 h-4" />
            </div>
          )}
          <span className="font-bold text-base tracking-tight">TeleCall</span>
        </div>

        {/* Top-Right Profile Button */}
        <button
          onClick={() => {
            setSelectedContact(null);
            setActivePage('profile');
          }}
          className={`min-h-[38px] px-3 py-1.5 rounded-xl border ${
            activePage === 'profile' ? 'border-sky-500 bg-sky-500/15 text-sky-400' : palette.border
          } text-xs font-semibold flex items-center gap-2`}
        >
          <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-[11px]">
            {currentUser.name.slice(0, 2).toUpperCase()}
          </div>
          <span className="max-w-[110px] truncate">{currentUser.name}</span>
        </button>
      </header>

      {/* MAIN BODY */}
      <main className="flex-1 max-w-xl w-full mx-auto px-4 pt-4">
        {/* ==================================================================== */}
        {/* PAGE 1: HOME — CALL LOGS                                             */}
        {/* ==================================================================== */}
        {activePage === 'logs' && !selectedContact && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-base font-bold">Recent Calls</h2>
              <span className={`text-xs ${palette.textSecondary}`}>
                {callLogs.length} {callLogs.length === 1 ? 'call' : 'calls'}
              </span>
            </div>

            {callLogs.length === 0 ? (
              <div
                className={`${palette.bgCard} border ${palette.border} rounded-2xl p-8 text-center space-y-3`}
              >
                <Phone className="w-8 h-8 text-sky-400 mx-auto" />
                <div className="text-sm font-semibold">No Recent Calls</div>
                <p className={`text-xs ${palette.textSecondary}`}>
                  Use the Dialer or Contacts button below to start a call.
                </p>
              </div>
            ) : (
              <div
                className={`${palette.bgCard} border ${palette.border} rounded-2xl divide-y divide-slate-800/60 overflow-hidden`}
              >
                {callLogs.map((log) => (
                  <div
                    key={log.id}
                    onClick={() => {
                      const matched = contacts.find(
                        (c) =>
                          c.phone.replace(/[^\d]/g, '').slice(-10) ===
                            log.phone.replace(/[^\d]/g, '').slice(-10) ||
                          c.name.toLowerCase() === log.contactName.toLowerCase()
                      );
                      setSelectedContact(
                        matched || {
                          id: log.id,
                          name: log.contactName,
                          phone: log.phone,
                          username: log.username || '',
                          online: true,
                          lastSeen: 'Recent'
                        }
                      );
                    }}
                    className="p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-800/25 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                          log.direction === 'incoming'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-sky-500/15 text-sky-400'
                        }`}
                      >
                        {log.direction === 'incoming' ? (
                          <PhoneIncoming className="w-4 h-4" />
                        ) : (
                          <PhoneOutgoing className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{log.contactName}</div>
                        <div className={`text-xs ${palette.textSecondary} flex items-center gap-1.5`}>
                          <span>{log.direction === 'incoming' ? 'Incoming' : 'Outgoing'}</span>
                          <span>·</span>
                          <span>{formatDuration(log.durationSeconds)}</span>
                          <span>·</span>
                          <span>{log.timestamp}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startCall(log.contactName, log.phone, log.username);
                      }}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shrink-0"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* PAGE 2: THUMB-ZONE DIALER (KEYPAD POSITIONED AT THE BOTTOM)          */}
        {/* ==================================================================== */}
        {activePage === 'dialer' && !selectedContact && (
          <div className="min-h-[calc(100vh-9.5rem)] flex flex-col justify-end pb-2">
            {/* Number Display right above the keypad */}
            <div
              className={`${palette.bgCard} border ${palette.border} rounded-3xl p-5 shadow-xl space-y-5`}
            >
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                <input
                  type="tel"
                  value={dialedInput}
                  onChange={(e) => setDialedInput(e.target.value)}
                  placeholder="Enter phone number"
                  className="w-full bg-transparent text-2xl font-bold tracking-wider text-center focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    playTone(360, 0.06);
                    setDialedInput((prev) => prev.slice(0, -1));
                  }}
                  className={`p-2 rounded-xl ${palette.textSecondary} hover:opacity-100`}
                  title="Backspace"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>

              {/* Keypad Grid in lower thumb zone */}
              <div className="grid grid-cols-3 gap-2.5">
                {DIAL_KEYS.map((item) => (
                  <button
                    key={item.digit}
                    type="button"
                    onClick={() => {
                      playTone(520, 0.05);
                      setDialedInput((prev) => prev + item.digit);
                    }}
                    className={`h-14 rounded-2xl ${palette.bgMain} border ${palette.border} active:scale-95 transition-transform flex flex-col items-center justify-center`}
                  >
                    <span className="text-lg font-bold leading-none">{item.digit}</span>
                    {item.sub && (
                      <span className={`text-[9px] ${palette.textSecondary} mt-0.5 tracking-widest`}>
                        {item.sub}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Call Action Button at the very bottom of the Dialer */}
              <button
                type="button"
                onClick={() => {
                  const matched = contacts.find(
                    (c) =>
                      c.phone.replace(/[^\d]/g, '').slice(-10) ===
                      dialedInput.replace(/[^\d]/g, '').slice(-10)
                  );
                  startCall(
                    matched ? matched.name : dialedInput.trim(),
                    dialedInput.trim(),
                    matched?.username,
                    matched?.tgId,
                    matched?.accessHash
                  );
                }}
                className="w-full h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base flex items-center justify-center gap-2 shadow-lg"
              >
                <Phone className="w-5 h-5" />
                <span>Call</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* PAGE 3: CONTACTS LIST                                                */}
        {/* ==================================================================== */}
        {activePage === 'contacts' && !selectedContact && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Contacts</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSyncContacts()}
                  className={`min-h-[36px] px-3 py-1.5 rounded-xl border ${palette.border} text-xs font-semibold flex items-center gap-1.5`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingContacts ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <button
                  onClick={() => setShowAddContactModal(true)}
                  className="min-h-[36px] px-3 py-1.5 rounded-xl bg-sky-500 text-slate-950 text-xs font-bold flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add Contact</span>
                </button>
              </div>
            </div>

            <div
              className={`${palette.bgCard} border ${palette.border} rounded-2xl divide-y divide-slate-800/60 overflow-hidden`}
            >
              {contacts.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedContact(c)}
                  className="p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-800/25 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <div className="w-11 h-11 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center font-bold text-sm">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      {c.online && (
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950 absolute bottom-0 right-0" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{c.name}</div>
                      <div className={`text-xs ${palette.textSecondary} truncate`}>{c.phone}</div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startCall(c.name, c.phone, c.username, c.tgId, c.accessHash);
                    }}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shrink-0"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* SELECTED CONTACT PROFILE & CALL HISTORY VIEW                         */}
        {/* ==================================================================== */}
        {selectedContact && (
          <div className="space-y-4">
            <div
              className={`${palette.bgCard} border ${palette.border} rounded-2xl p-5 text-center space-y-4`}
            >
              <div className="w-20 h-20 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center font-bold text-2xl mx-auto">
                {selectedContact.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold">{selectedContact.name}</h2>
                <p className={`text-xs ${palette.textSecondary} mt-0.5`}>{selectedContact.phone}</p>
                {selectedContact.username && (
                  <p className={`text-xs ${palette.accentText} mt-0.5`}>
                    {selectedContact.username}
                  </p>
                )}
              </div>

              <div className="flex justify-center gap-3 pt-1">
                <button
                  onClick={() =>
                    startCall(
                      selectedContact.name,
                      selectedContact.phone,
                      selectedContact.username,
                      selectedContact.tgId,
                      selectedContact.accessHash
                    )
                  }
                  className="min-h-[44px] px-6 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-2"
                >
                  <Phone className="w-4 h-4" />
                  <span>Voice Call</span>
                </button>
              </div>
            </div>

            <div className={`${palette.bgCard} border ${palette.border} rounded-2xl p-4 space-y-3`}>
              <h3 className="text-sm font-bold">Call History with {selectedContact.name}</h3>
              {selectedContactHistory.length === 0 ? (
                <p className={`text-xs ${palette.textSecondary} py-4 text-center`}>
                  No previous calls with this contact.
                </p>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {selectedContactHistory.map((item) => (
                    <div
                      key={item.id}
                      className="py-2.5 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        {item.direction === 'incoming' ? (
                          <PhoneIncoming className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <PhoneOutgoing className="w-3.5 h-3.5 text-sky-400" />
                        )}
                        <span className="font-medium">
                          {item.direction === 'incoming' ? 'Incoming Call' : 'Outgoing Call'}
                        </span>
                      </div>
                      <div className={palette.textSecondary}>
                        {formatDuration(item.durationSeconds)} · {item.timestamp}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* PAGE 4: USER PROFILE PAGE (VIEW/EDIT NAME, USERNAME, NUMBER + SETTINGS) */}
        {/* ==================================================================== */}
        {activePage === 'profile' && !selectedContact && (
          <div className="space-y-4">
            <div className={`${palette.bgCard} border ${palette.border} rounded-2xl p-5 space-y-5`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="w-16 h-16 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-xl">
                    {currentUser.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{currentUser.name}</h2>
                    <p className={`text-xs ${palette.accentText}`}>{currentUser.username}</p>
                    <p className={`text-xs ${palette.textSecondary} mt-0.5`}>{currentUser.phone}</p>
                  </div>
                </div>

                {!isEditingProfile && (
                  <button
                    onClick={openEditProfile}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-xl border ${palette.border} text-xs font-semibold flex items-center gap-1.5`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                )}
              </div>

              {profileSavedNotice && (
                <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>Profile updated!</span>
                </div>
              )}

              {isEditingProfile ? (
                <form onSubmit={handleSaveProfile} className="space-y-3 pt-2 border-t border-slate-800/60">
                  <div>
                    <label className={`block text-xs ${palette.textSecondary} mb-1`}>Name</label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs ${palette.textSecondary} mb-1`}>Username</label>
                    <input
                      type="text"
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                      className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingProfile(false)}
                      className={`min-h-[40px] px-4 py-2 rounded-xl border ${palette.border} text-xs font-semibold`}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="min-h-[40px] px-5 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-bold"
                    >
                      Save Changes
                    </button>
                  </div>
                </form>
              ) : (
                <div className="divide-y divide-slate-800/60 text-xs pt-2 border-t border-slate-800/60">
                  <div className="py-3 flex items-center justify-between">
                    <span className={palette.textSecondary}>Full Name</span>
                    <span className="font-semibold">{currentUser.name}</span>
                  </div>
                  <div className="py-3 flex items-center justify-between">
                    <span className={palette.textSecondary}>Username</span>
                    <span className="font-semibold">{currentUser.username}</span>
                  </div>
                  <div className="py-3 flex items-center justify-between">
                    <span className={palette.textSecondary}>Phone Number</span>
                    <span className="font-semibold">{currentUser.phone}</span>
                  </div>
                </div>
              )}

              {/* Settings & Log Out Buttons */}
              <div className="grid grid-cols-2 gap-2.5 pt-2">
                <button
                  onClick={() => setShowSettingsDrawer(true)}
                  className={`min-h-[44px] px-4 py-2.5 rounded-xl border ${palette.border} font-semibold text-xs flex items-center justify-center gap-2`}
                >
                  <Settings className={`w-4 h-4 ${palette.accentText}`} />
                  <span>Settings</span>
                </button>

                <button
                  onClick={handleLogout}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 font-semibold text-xs flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log Out</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ====================================================================== */}
      {/* TWO FLOATING ACTION BUTTONS ON HOME / CALLS VIEW: DIALER & CONTACTS    */}
      {/* ====================================================================== */}
      {activePage !== 'profile' && (
        <div className="fixed bottom-5 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
          <div
            className={`pointer-events-auto ${palette.bgCard} border ${palette.border} shadow-2xl rounded-full p-1.5 flex items-center gap-2`}
          >
            {activePage !== 'logs' && (
              <button
                onClick={() => {
                  setSelectedContact(null);
                  setActivePage('logs');
                }}
                className={`min-h-[44px] px-5 py-2 rounded-full text-xs font-bold flex items-center gap-2 transition-colors ${palette.textSecondary}`}
              >
                <Phone className="w-4 h-4" />
                <span>Call Logs</span>
              </button>
            )}

            <button
              onClick={() => {
                setSelectedContact(null);
                setActivePage('dialer');
              }}
              className={`min-h-[44px] px-5 py-2 rounded-full text-xs font-bold flex items-center gap-2 transition-colors ${
                activePage === 'dialer'
                  ? 'bg-sky-500 text-slate-950 shadow-md'
                  : `${palette.textPrimary} hover:bg-slate-800/40`
              }`}
            >
              <PhoneCall className="w-4 h-4" />
              <span>Dialer</span>
            </button>

            <button
              onClick={() => {
                setSelectedContact(null);
                setActivePage('contacts');
              }}
              className={`min-h-[44px] px-5 py-2 rounded-full text-xs font-bold flex items-center gap-2 transition-colors ${
                activePage === 'contacts'
                  ? 'bg-sky-500 text-slate-950 shadow-md'
                  : `${palette.textPrimary} hover:bg-slate-800/40`
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Contacts</span>
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL: ADD NEW CONTACT                                                 */}
      {/* ====================================================================== */}
      {showAddContactModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSyncContacts}
            className={`${palette.bgCard} border ${palette.border} rounded-2xl max-w-sm w-full p-5 space-y-4`}
          >
            <h3 className="text-base font-bold">New Contact</h3>
            <div>
              <label className={`block text-xs ${palette.textSecondary} mb-1`}>Name</label>
              <input
                type="text"
                required
                placeholder="Contact name"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
              />
            </div>
            <div>
              <label className={`block text-xs ${palette.textSecondary} mb-1`}>Phone Number</label>
              <input
                type="tel"
                required
                placeholder="+91 98765 43210"
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddContactModal(false)}
                className={`min-h-[40px] px-4 py-2 rounded-xl border ${palette.border} text-xs font-semibold`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-5 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-bold"
              >
                Save Contact
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ====================================================================== */}
      {/* INCOMING CALL FULL-SCREEN BANNER / OVERLAY                             */}
      {/* ====================================================================== */}
      {incomingCall && !activeCall && (
        <div className={`fixed inset-0 z-50 ${palette.bgMain} flex flex-col justify-between p-6`}>
          <div className="text-center pt-6">
            <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold">
              Incoming Call
            </span>
          </div>

          <div className="text-center space-y-4 my-auto">
            <div className="w-24 h-24 rounded-full bg-sky-500/20 border-2 border-sky-400/50 text-sky-400 flex items-center justify-center font-bold text-3xl mx-auto animate-pulse">
              {incomingCall.callerName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-2xl font-bold">{incomingCall.callerName}</h2>
              <p className={`text-sm ${palette.textSecondary} mt-1`}>{incomingCall.callerPhone}</p>
            </div>
          </div>

          <div className="max-w-xs w-full mx-auto grid grid-cols-2 gap-6 pb-8">
            <button
              onClick={handleDeclineIncomingCall}
              className="h-16 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg"
            >
              <PhoneOff className="w-5 h-5" />
              <span>Decline</span>
            </button>
            <button
              onClick={handleAcceptIncomingCall}
              className="h-16 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg"
            >
              <Phone className="w-5 h-5" />
              <span>Answer</span>
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* FULL-SCREEN ACTIVE CALL TAB (MUTE, SPEAKER, HOLD, VIDEO CALL, ADD CALL)*/}
      {/* ====================================================================== */}
      {activeCall && (
        <div className={`fixed inset-0 z-50 ${palette.bgMain} flex flex-col justify-between p-6`}>
          {/* Top E2EE Emoji Bar & Call Timer */}
          <div
            className={`max-w-sm w-full mx-auto flex items-center justify-between text-xs ${palette.textSecondary}`}
          >
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Lock className="w-3.5 h-3.5" />
              <span>Encrypted</span>
              <span className="ml-1 tracking-widest">{activeCall.emojis.join(' ')}</span>
            </div>
            <span className="tabular-nums font-semibold">
              {activeCall.status === 'on-hold'
                ? 'On Hold'
                : activeCall.status === 'ringing'
                ? 'Ringing...'
                : formatDuration(callSeconds)}
            </span>
          </div>

          {/* Caller Info or Video Stream */}
          <div className="max-w-sm w-full mx-auto text-center space-y-4 my-auto">
            {activeCall.isVideoEnabled ? (
              <div className="relative w-full h-64 rounded-3xl overflow-hidden bg-slate-900 border border-slate-800">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-24 h-32 rounded-2xl object-cover border-2 border-sky-400 absolute bottom-3 right-3 bg-black"
                />
              </div>
            ) : (
              <div className="w-24 h-24 rounded-full bg-sky-500/20 border-2 border-sky-400/50 text-sky-400 flex items-center justify-center font-bold text-3xl mx-auto">
                {activeCall.contactName.slice(0, 2).toUpperCase()}
              </div>
            )}

            <div>
              <h2 className="text-2xl font-bold">{activeCall.contactName}</h2>
              <p className={`text-xs ${palette.textSecondary} mt-1`}>{activeCall.phone}</p>
              {activeCall.addedParticipants.length > 0 && (
                <p className="text-xs text-sky-400 font-medium mt-1">
                  + {activeCall.addedParticipants.join(', ')}
                </p>
              )}
            </div>
          </div>

          {/* Add Call Contact Picker Modal inside Active Call */}
          {showAddCallPicker && (
            <div
              className={`max-w-sm w-full mx-auto ${palette.bgCard} border ${palette.border} rounded-2xl p-3 mb-3 max-h-44 overflow-y-auto space-y-1.5`}
            >
              <div className="flex items-center justify-between text-xs font-bold px-1">
                <span>Select Contact to Add</span>
                <button
                  onClick={() => setShowAddCallPicker(false)}
                  className={palette.textSecondary}
                >
                  Close
                </button>
              </div>
              {contacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleAddParticipantToCall(c)}
                  className="w-full p-2 rounded-xl hover:bg-slate-800/40 flex items-center justify-between text-xs"
                >
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-sky-400">Add</span>
                </button>
              ))}
            </div>
          )}

          {/* Call Controls: Mute, Speaker, Hold, Video Call, Add Call + End Call */}
          <div className="max-w-sm w-full mx-auto space-y-3 pb-2">
            <div className="grid grid-cols-5 gap-2">
              <button
                onClick={handleToggleMute}
                className={`h-16 rounded-2xl flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  activeCall.isMuted
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : `${palette.bgCard} border ${palette.border}`
                }`}
              >
                {activeCall.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                <span>Mute</span>
              </button>

              <button
                onClick={handleToggleSpeaker}
                className={`h-16 rounded-2xl flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  activeCall.isSpeakerOn
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : `${palette.bgCard} border ${palette.border}`
                }`}
              >
                {activeCall.isSpeakerOn ? (
                  <Volume2 className="w-5 h-5" />
                ) : (
                  <VolumeX className="w-5 h-5" />
                )}
                <span>Speaker</span>
              </button>

              <button
                onClick={handleToggleHold}
                className={`h-16 rounded-2xl flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  activeCall.isOnHold
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : `${palette.bgCard} border ${palette.border}`
                }`}
              >
                <Pause className="w-5 h-5" />
                <span>Hold</span>
              </button>

              <button
                onClick={handleToggleVideoCall}
                className={`h-16 rounded-2xl flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  activeCall.isVideoEnabled
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : `${palette.bgCard} border ${palette.border}`
                }`}
              >
                {activeCall.isVideoEnabled ? (
                  <Video className="w-5 h-5" />
                ) : (
                  <VideoOff className="w-5 h-5" />
                )}
                <span>Video Call</span>
              </button>

              <button
                onClick={() => setShowAddCallPicker((v) => !v)}
                className={`h-16 rounded-2xl flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  showAddCallPicker
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : `${palette.bgCard} border ${palette.border}`
                }`}
              >
                <UserPlus className="w-5 h-5" />
                <span>Add Call</span>
              </button>
            </div>

            <button
              onClick={handleEndCall}
              className="w-full h-14 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center gap-2 text-sm font-bold shadow-lg"
            >
              <PhoneOff className="w-5 h-5" />
              <span>End Call</span>
            </button>
          </div>
        </div>
      )}

      {/* SETTINGS PAGE DRAWER (OPENED FROM PROFILE PAGE) */}
      <SettingsDrawer
        isOpen={showSettingsDrawer}
        onClose={() => setShowSettingsDrawer(false)}
        activeTheme={activeTheme}
        onSelectTheme={handleSelectTheme}
        userId={currentUser.userId}
        userName={currentUser.name}
        onClearLocalData={() => {
          setCallLogs([]);
          setShowSettingsDrawer(false);
        }}
      />
    </div>
  );
}
