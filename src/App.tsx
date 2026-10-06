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
  Users,
  Lock,
  ArrowLeft,
  Delete,
  Edit3,
  Video,
  VideoOff,
  Pause,
  UserPlus,
  RefreshCw,
  LogOut,
  Check,
  MessageSquare,
  Star,
  Trash2,
  Moon,
  Sun,
  Camera,
  Send,
  X
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

interface SyncedContact {
  id: string;
  name: string;
  phone: string;
  username: string;
  avatarUrl?: string;
  isFavorite?: boolean;
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
  avatarUrl?: string;
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

const DARK_MODE_STORAGE_KEY = 'telecall_wikipedia_dark_mode';

export default function App() {
  // Wikipedia Monochrome Black & White Theme (Light Paper #ffffff vs Dark Ink #0a0a0a)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem(DARK_MODE_STORAGE_KEY) === 'true';
  });

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem(DARK_MODE_STORAGE_KEY, String(next));
      return next;
    });
  };

  // Wikipedia Style Palette Classes
  const bgMain = isDarkMode ? 'bg-[#0a0a0a]' : 'bg-white';
  const bgSurface = isDarkMode ? 'bg-[#141414]' : 'bg-[#f8f9fa]';
  const textPrimary = isDarkMode ? 'text-[#f8f9fa]' : 'text-[#111111]';
  const textSecondary = isDarkMode ? 'text-[#a0a0a0]' : 'text-[#54595d]';
  const borderHairline = isDarkMode ? 'border-[#2a2a2a]' : 'border-[#a2a9b1]';
  const btnPrimary = isDarkMode
    ? 'bg-white text-black hover:bg-neutral-200'
    : 'bg-black text-white hover:bg-neutral-800';
  const btnOutline = isDarkMode
    ? 'bg-[#141414] text-white border border-[#3a3a3a] hover:bg-[#1f1f1f]'
    : 'bg-white text-black border border-[#a2a9b1] hover:bg-[#f1f2f4]';

  // Sync OS Status Bar & Navigation Bar Colors with Wikipedia Black/White Mode
  useEffect(() => {
    const barHex = isDarkMode ? '#0a0a0a' : '#ffffff';
    document.documentElement.style.backgroundColor = barHex;
    document.body.style.backgroundColor = barHex;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', barHex);
    }

    const win = window as any;
    if (win.Capacitor?.Plugins?.StatusBar) {
      const StatusBar = win.Capacitor.Plugins.StatusBar;
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      StatusBar.setBackgroundColor({ color: barHex }).catch(() => {});
      StatusBar.setStyle({ style: isDarkMode ? 'DARK' : 'LIGHT' }).catch(() => {});
    }
    if (win.AndroidAudioBridge?.setSystemBarsColor) {
      try {
        win.AndroidAudioBridge.setSystemBarsColor(barHex, barHex, !isDarkMode);
      } catch {
        // ignore
      }
    }
  }, [isDarkMode]);

  // User Session (Telegram Authentication)
  const [session, setSession] = useState<MTProtoSessionData | null>(() =>
    mtprotoEngine.getSavedSession()
  );

  // Telegram Authentication Flow States
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

  // Long-Press Call Log / Contact Action Sheet & Sub-Modals
  const [contextLogItem, setContextLogItem] = useState<CallLogEntry | null>(null);
  const [contextSubView, setContextSubView] = useState<
    'menu' | 'profile' | 'history' | 'editName' | 'message'
  >('menu');
  const [renameContactInput, setRenameContactInput] = useState('');
  const [quickMessageInput, setQuickMessageInput] = useState('');
  const [quickMessageSentNotice, setQuickMessageSentNotice] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef<boolean>(false);

  // Selected Contact Profile & Call History Detail View (from Contacts list)
  const [selectedContact, setSelectedContact] = useState<SyncedContact | null>(null);

  // Profile Edit State (Name, Phone Number, Profile Picture)
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [profileSavedNotice, setProfileSavedNotice] = useState(false);

  // Thumb-Zone Bottom Dialer State
  const [dialedInput, setDialedInput] = useState('+91 ');

  // Contacts & Call History State
  const [contacts, setContacts] = useState<SyncedContact[]>([
    {
      id: 'contact-1',
      name: 'Aarav Sharma',
      phone: '+91 98201 44512',
      username: '@aarav_s',
      isFavorite: true,
      online: true,
      lastSeen: 'Online'
    },
    {
      id: 'contact-2',
      name: 'Priya Verma',
      phone: '+91 98114 22089',
      username: '@priya_v',
      isFavorite: false,
      online: true,
      lastSeen: 'Online'
    },
    {
      id: 'contact-3',
      name: 'Kabir Mehta',
      phone: '+91 98765 11201',
      username: '@kabir_m',
      isFavorite: false,
      online: true,
      lastSeen: 'Online'
    },
    {
      id: 'contact-4',
      name: 'Zoya Khan',
      phone: '+91 98991 30264',
      username: '@zoya_k',
      isFavorite: false,
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
  const pendingSendCodePromiseRef = useRef<Promise<string | null> | null>(null);

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

  // ============================================================================
  // ANDROID HARDWARE BACK BUTTON & BROWSER HISTORY STACK (`pushState` + `popstate`)
  // ============================================================================
  // Ensures pressing Android Hardware Back from Dialer, Contacts, Profile, or Modals
  // returns to the Call Logs Home Page instead of closing the APK!
  const navigateToPage = (nextPage: 'logs' | 'dialer' | 'contacts' | 'profile') => {
    if (nextPage !== activePage) {
      window.history.pushState({ page: nextPage }, '', `#${nextPage}`);
      setActivePage(nextPage);
    }
  };

  useEffect(() => {
    // Initialize root history entry
    if (!window.history.state) {
      window.history.replaceState({ page: 'logs' }, '', '#logs');
    }

    const handleBackNavigation = (): boolean => {
      if (showAddCallPicker) {
        setShowAddCallPicker(false);
        return true;
      }
      if (contextLogItem) {
        if (contextSubView !== 'menu') {
          setContextSubView('menu');
        } else {
          setContextLogItem(null);
        }
        return true;
      }
      if (showAddContactModal) {
        setShowAddContactModal(false);
        return true;
      }
      if (isEditingProfile) {
        setIsEditingProfile(false);
        return true;
      }
      if (selectedContact) {
        setSelectedContact(null);
        return true;
      }
      if (activePage !== 'logs') {
        setActivePage('logs');
        return true;
      }
      if (!session && authStep !== 'phone') {
        setAuthStep('phone');
        return true;
      }
      return false;
    };

    // Expose global handler for Android MainActivity.java `onBackPressed()`
    (window as any).__telecallHandleHardwareBack = handleBackNavigation;

    const onPopState = () => {
      const handled = handleBackNavigation();
      if (handled) {
        // Keep a buffer entry on history stack so next back press is also caught
        window.history.pushState({ page: 'logs' }, '', '#logs');
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [
    activePage,
    selectedContact,
    contextLogItem,
    contextSubView,
    showAddContactModal,
    showAddCallPicker,
    isEditingProfile,
    session,
    authStep
  ]);

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

    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    if (session) {
      syncTimer = setTimeout(() => {
        tdlibClientEngine.syncAllTelegramData().catch(() => {});
      }, 1500);

      const win = window as any;
      if (win.AndroidAudioBridge?.requestDevicePermissions) {
        setTimeout(() => {
          try {
            win.AndroidAudioBridge.requestDevicePermissions();
          } catch {
            // ignore
          }
        }, 800);
      }
    }

    // Also listen for `userInfoDidLoad` during OTP screen: if Telegram pushes "New login detected"
    // while user is on the OTP screen, automatically finalize login!
    const unsubAutoLogin = NotificationCenter.getInstance().addObserver(
      NotificationEvents.userInfoDidLoad,
      (u) => {
        if (!session && u && (u.id || u.verifiedLogin)) {
          const fullName =
            [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'Telegram User';
          const autoSession: MTProtoSessionData = {
            dcId: 5,
            authKeyHex: `tgnet-${u.id || Date.now()}`,
            serverSalt: 'auto',
            userId: `tg-${u.id || Date.now()}`,
            phone: u.phone ? `+${u.phone}` : phoneInput,
            name: fullName,
            username: u.username ? `@${u.username}` : `@user_${u.id || ''}`,
            createdAt: Date.now()
          };
          mtprotoEngine.updateSavedProfile(autoSession);
          setSession(autoSession);
          setAuthLoading(false);
          setActivePage('logs');
        }
      }
    );

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

    const unsubTgIncoming = NotificationCenter.getInstance().addObserver(
      NotificationEvents.didReceiveIncomingCall,
      (pc) => {
        playTone(620, 0.35);
        setIncomingCall({
          sessionId: String(pc?.id || Date.now()),
          callerName: 'Incoming Call',
          callerPhone: 'Voice Call',
          emojis: ['🔐', '✈️', '🛡️', '⚡'],
          tgCallPeer:
            pc?.id && pc?.access_hash ? { id: pc.id, access_hash: pc.access_hash } : undefined
        });
      }
    );

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
      if (syncTimer) clearTimeout(syncTimer);
      unsubAutoLogin();
      unsubContacts();
      unsubCallHistory();
      unsubTgIncoming();
      unsubWebRtc();
    };
  }, [session, currentUser.phone, currentUser.userId, phoneInput]);

  // Call duration timer
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

    setOtpInput('');
    setAuthStep('otp');

    const sendPromise = (async (): Promise<string | null> => {
      try {
        const res = await mtprotoEngine.sendAuthCode(phoneInput, { forceResend });
        if (res.ok && res.phoneCodeHash) {
          setPhoneCodeHash(res.phoneCodeHash);
          setSentDeliveryType(res.deliveryType || 'app');
          return res.phoneCodeHash;
        } else {
          setAuthStep('phone');
          setAuthError(res.error || 'Could not send verification code. Please check your number.');
          return null;
        }
      } catch {
        setAuthStep('phone');
        setAuthError('Network error while sending code. Please try again.');
        return null;
      }
    })();

    pendingSendCodePromiseRef.current = sendPromise;
  };

  const finalizeLoggedInSession = (sessionData: MTProtoSessionData) => {
    mtprotoEngine.updateSavedProfile(sessionData);
    setSession(sessionData);
    setAuthStep('phone');
    setTwoFactorPassword('');
    setActivePage('logs');
    peerCallWebRtcEngine.requestAllDevicePermissionsOnLogin().catch(() => {});
  };

  const handleVerifyOtpOr2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      let activeHash = phoneCodeHash;
      if (!activeHash && pendingSendCodePromiseRef.current) {
        activeHash = (await pendingSendCodePromiseRef.current) || '';
      }

      const res = await mtprotoEngine.verifyAuthCode({
        phone: phoneInput,
        code: otpInput,
        phoneCodeHash: activeHash,
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
    } catch {
      setAuthLoading(false);
      setAuthError('Verification timed out. Please tap Next again.');
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

  const handleAvatarFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'signup' | 'profile'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        if (target === 'signup') {
          setSignupAvatarDataUrl(reader.result);
        } else {
          setEditAvatarUrl(reader.result);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // --- CALLING HANDLERS ---

  const startCall = async (
    contactName: string,
    phone: string,
    username?: string,
    tgId?: any,
    accessHash?: any,
    withVideo = false
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
      isVideoEnabled: withVideo,
      addedParticipants: []
    });

    // 1. Start WebRTC E2EE Audio/Video + WebSocket PCM Audio Relay
    peerCallWebRtcEngine
      .startOutgoingCall({
        sessionId,
        callerId: currentUser.userId,
        callerName: currentUser.name,
        callerPhone: currentUser.phone,
        targetPhone: phone.trim(),
        emojis: initialEmojis,
        withVideo
      })
      .then((stream) => {
        if (withVideo && stream && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
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

  // --- LONG PRESS HANDLERS FOR CALL LOGS ---

  const startLongPress = (log: CallLogEntry) => {
    longPressTriggeredRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      playTone(420, 0.06);
      setRenameContactInput(log.contactName);
      setQuickMessageInput('');
      setContextSubView('menu');
      setContextLogItem(log);
      window.history.pushState({ modal: 'context' }, '', '#context');
    }, 450);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSaveRenamedContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contextLogItem || !renameContactInput.trim()) return;
    const newName = renameContactInput.trim();
    const targetPhone = contextLogItem.phone;

    setCallLogs((prev) =>
      prev.map((l) => (l.phone === targetPhone ? { ...l, contactName: newName } : l))
    );
    setContacts((prev) =>
      prev.map((c) => (c.phone === targetPhone ? { ...c, name: newName } : c))
    );
    setContextLogItem({ ...contextLogItem, contactName: newName });
    setContextSubView('menu');
  };

  const handleToggleFavoriteFromContext = () => {
    if (!contextLogItem) return;
    const targetPhone = contextLogItem.phone;
    setContacts((prev) => {
      const exists = prev.some((c) => c.phone === targetPhone);
      if (exists) {
        return prev.map((c) =>
          c.phone === targetPhone ? { ...c, isFavorite: !c.isFavorite } : c
        );
      }
      return [
        {
          id: 'fav-' + Date.now(),
          name: contextLogItem.contactName,
          phone: contextLogItem.phone,
          username: contextLogItem.username || '',
          isFavorite: true,
          online: true,
          lastSeen: 'Saved'
        },
        ...prev
      ];
    });
    setContextLogItem(null);
  };

  const handleDeleteContactAndLogs = () => {
    if (!contextLogItem) return;
    const targetPhone = contextLogItem.phone;
    setContacts((prev) => prev.filter((c) => c.phone !== targetPhone));
    setCallLogs((prev) => prev.filter((l) => l.phone !== targetPhone));
    setContextLogItem(null);
  };

  const handleSendQuickMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contextLogItem || !quickMessageInput.trim()) return;
    const matched = contacts.find((c) => c.phone === contextLogItem.phone);
    if (matched?.tgId) {
      await tdlibClientEngine
        .sendChatMessage(
          {
            peerType: 'user',
            peerId: matched.tgId,
            accessHash: matched.accessHash
          },
          quickMessageInput.trim()
        )
        .catch(() => {});
    }
    setQuickMessageSentNotice(true);
    setTimeout(() => {
      setQuickMessageSentNotice(false);
      setContextLogItem(null);
    }, 1000);
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
    setEditPhone(currentUser.phone);
    setEditAvatarUrl(currentUser.avatarDataUrl || '');
    setIsEditingProfile(true);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: MTProtoSessionData = {
      ...currentUser,
      name: editName.trim() || currentUser.name,
      phone: editPhone.trim() || currentUser.phone,
      avatarDataUrl: editAvatarUrl || currentUser.avatarDataUrl
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
  // 1. WIKIPEDIA BLACK & WHITE LOGIN SCREEN ON APP OPEN
  // ============================================================================
  if (!session) {
    return (
      <div
        className={`min-h-screen ${bgMain} ${textPrimary} flex flex-col items-center justify-center p-5 select-none`}
      >
        <div
          className={`${bgSurface} border ${borderHairline} max-w-sm w-full p-6 space-y-6`}
        >
          <div className={`border-b ${borderHairline} pb-3 flex items-center justify-between`}>
            <div>
              <h1 className="font-serif text-2xl font-bold tracking-tight">TeleCall</h1>
              <p className={`text-xs ${textSecondary} mt-0.5`}>
                Direct Voice & Video Calling
              </p>
            </div>
            <button
              type="button"
              onClick={toggleDarkMode}
              className={`p-2 border ${borderHairline} ${bgMain}`}
              title="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          <form
            onSubmit={
              authStep === 'phone'
                ? (e) => handleSendOtp(e, false)
                : authStep === 'signup'
                ? handleCompleteSignUp
                : handleVerifyOtpOr2FA
            }
            className="space-y-4"
          >
            {authStep === 'phone' && (
              <div className="space-y-3">
                <p className={`text-xs ${textSecondary}`}>
                  Enter your phone number to receive your login code.
                </p>
                <div>
                  <label className="block text-xs font-semibold mb-1">Phone Number</label>
                  <input
                    type="tel"
                    required
                    autoFocus
                    placeholder="+91 98765 43210"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className={`w-full h-11 px-3 ${bgMain} border ${borderHairline} text-base font-mono focus:outline-none`}
                  />
                </div>
              </div>
            )}

            {authStep === 'otp' && (
              <div className="space-y-3">
                <div className="text-sm font-serif font-bold">{phoneInput}</div>
                <p className={`text-xs ${textSecondary}`}>
                  {sentDeliveryType.toLowerCase().includes('sms')
                    ? 'Enter the code sent via SMS.'
                    : 'Enter the login code sent to your Telegram app.'}
                </p>
                <div>
                  <label className="block text-xs font-semibold mb-1">Login Code</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    maxLength={6}
                    placeholder="1 2 3 4 5"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    className={`w-full h-12 px-3 ${bgMain} border ${borderHairline} text-center text-lg font-mono font-bold tracking-widest focus:outline-none`}
                  />
                </div>
                <button
                  type="button"
                  onClick={(e) => handleSendOtp(e, true)}
                  className="text-xs underline"
                >
                  Resend code
                </button>
              </div>
            )}

            {authStep === '2fa' && (
              <div className="space-y-3">
                <div className="text-sm font-serif font-bold">Two-Step Password</div>
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Password {passwordHint ? `(${passwordHint})` : ''}
                  </label>
                  <input
                    type="password"
                    required
                    autoFocus
                    placeholder="Password"
                    value={twoFactorPassword}
                    onChange={(e) => setTwoFactorPassword(e.target.value)}
                    className={`w-full h-11 px-3 ${bgMain} border ${borderHairline} text-sm focus:outline-none`}
                  />
                </div>
              </div>
            )}

            {authStep === 'signup' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label
                    className={`w-16 h-16 border ${borderHairline} ${bgMain} flex items-center justify-center cursor-pointer overflow-hidden shrink-0`}
                  >
                    {signupAvatarDataUrl ? (
                      <img
                        src={signupAvatarDataUrl}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Camera className="w-5 h-5" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleAvatarFileSelect(e, 'signup')}
                      className="hidden"
                    />
                  </label>
                  <div>
                    <div className="text-sm font-serif font-bold">Complete Profile</div>
                    <p className={`text-xs ${textSecondary}`}>Enter your name to continue.</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    value={firstNameInput}
                    onChange={(e) => setFirstNameInput(e.target.value)}
                    className={`w-full h-10 px-3 ${bgMain} border ${borderHairline} text-sm`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Last Name</label>
                  <input
                    type="text"
                    value={lastNameInput}
                    onChange={(e) => setLastNameInput(e.target.value)}
                    className={`w-full h-10 px-3 ${bgMain} border ${borderHairline} text-sm`}
                  />
                </div>
              </div>
            )}

            {authError && (
              <div className={`p-2.5 border ${borderHairline} ${bgMain} text-xs font-medium`}>
                {authError}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              {authStep !== 'phone' && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('phone');
                    setAuthError('');
                  }}
                  className={`min-h-[42px] px-4 py-2 text-xs font-semibold ${btnOutline}`}
                >
                  Back
                </button>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className={`flex-1 min-h-[42px] px-5 py-2 text-xs font-bold uppercase tracking-wider ${btnPrimary}`}
              >
                {authLoading ? 'Signing in...' : 'Continue'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const selectedContactHistory = selectedContact
    ? callLogs.filter(
        (l) =>
          l.phone.replace(/[^\d]/g, '').slice(-10) ===
            selectedContact.phone.replace(/[^\d]/g, '').slice(-10) ||
          l.contactName.toLowerCase() === selectedContact.name.toLowerCase()
      )
    : [];

  const contextLogHistory = contextLogItem
    ? callLogs.filter(
        (l) =>
          l.phone.replace(/[^\d]/g, '').slice(-10) ===
            contextLogItem.phone.replace(/[^\d]/g, '').slice(-10) ||
          l.contactName.toLowerCase() === contextLogItem.contactName.toLowerCase()
      )
    : [];

  const isContextContactFavorite = contextLogItem
    ? Boolean(contacts.find((c) => c.phone === contextLogItem.phone)?.isFavorite)
    : false;

  // ============================================================================
  // 2. WIKIPEDIA BLACK & WHITE MAIN CALLING APP
  // ============================================================================
  return (
    <div
      className={`min-h-screen ${bgMain} ${textPrimary} flex flex-col justify-between pb-24 select-none`}
    >
      {/* HEADER: Left = App Name ("TeleCall") | Right = Profile Button */}
      <header
        className={`sticky top-0 z-30 h-14 px-4 ${bgMain} border-b ${borderHairline} flex items-center justify-between`}
      >
        <div className="flex items-center gap-2.5">
          {(activePage !== 'logs' || selectedContact) && (
            <button
              onClick={() => {
                if (selectedContact) {
                  setSelectedContact(null);
                } else {
                  navigateToPage('logs');
                }
              }}
              className={`w-8 h-8 border ${borderHairline} flex items-center justify-center`}
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <span className="font-serif font-bold text-xl tracking-tight">TeleCall</span>
        </div>

        {/* Top-Right Profile Button */}
        <button
          onClick={() => {
            setSelectedContact(null);
            navigateToPage('profile');
          }}
          className={`min-h-[36px] px-3 py-1 flex items-center gap-2 text-xs font-semibold ${
            activePage === 'profile' ? btnPrimary : btnOutline
          }`}
        >
          <div
            className={`w-6 h-6 border ${borderHairline} flex items-center justify-center overflow-hidden text-[10px] font-bold`}
          >
            {currentUser.avatarDataUrl ? (
              <img
                src={currentUser.avatarDataUrl}
                alt={currentUser.name}
                className="w-full h-full object-cover"
              />
            ) : (
              currentUser.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <span className="max-w-[100px] truncate">{currentUser.name}</span>
        </button>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 max-w-xl w-full mx-auto px-4 pt-4">
        {/* ==================================================================== */}
        {/* HOMEPAGE: CALL LOGS (LONG-PRESS FOR FULL CALLER MENU)                */}
        {/* ==================================================================== */}
        {activePage === 'logs' && !selectedContact && (
          <div className="space-y-3">
            <div className={`flex items-center justify-between border-b ${borderHairline} pb-2`}>
              <h2 className="font-serif text-lg font-bold">Call Logs</h2>
              <span className={`text-xs ${textSecondary}`}>
                Hold any call log for options
              </span>
            </div>

            {callLogs.length === 0 ? (
              <div className={`border ${borderHairline} ${bgSurface} p-8 text-center space-y-2`}>
                <div className="font-serif text-base font-bold">No Call History</div>
                <p className={`text-xs ${textSecondary}`}>
                  Use the Dialer or Contacts button below to place a call.
                </p>
              </div>
            ) : (
              <div className={`border ${borderHairline} divide-y ${
                isDarkMode ? 'divide-[#2a2a2a]' : 'divide-[#a2a9b1]'
              }`}>
                {callLogs.map((log) => {
                  const matchedContact = contacts.find((c) => c.phone === log.phone);
                  const pfpUrl = log.avatarUrl || matchedContact?.avatarUrl;
                  const isFav = matchedContact?.isFavorite;

                  return (
                    <div
                      key={log.id}
                      onMouseDown={() => startLongPress(log)}
                      onMouseUp={cancelLongPress}
                      onMouseLeave={cancelLongPress}
                      onTouchStart={() => startLongPress(log)}
                      onTouchEnd={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        cancelLongPress();
                        setRenameContactInput(log.contactName);
                        setContextSubView('menu');
                        setContextLogItem(log);
                      }}
                      onClick={() => {
                        if (longPressTriggeredRef.current) return;
                        setRenameContactInput(log.contactName);
                        setContextSubView('menu');
                        setContextLogItem(log);
                      }}
                      className={`p-3.5 ${bgMain} hover:${bgSurface} flex items-center justify-between gap-3 cursor-pointer transition-colors`}
                    >
                      {/* Left: Caller PFP, Name, Call Direction, Timestamp */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-11 h-11 border ${borderHairline} ${bgSurface} flex items-center justify-center font-serif font-bold text-sm shrink-0 overflow-hidden`}
                        >
                          {pfpUrl ? (
                            <img
                              src={pfpUrl}
                              alt={log.contactName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            log.contactName.slice(0, 2).toUpperCase()
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-serif font-bold text-sm truncate">
                              {log.contactName}
                            </span>
                            {isFav && <Star className="w-3.5 h-3.5 fill-current shrink-0" />}
                          </div>
                          <div className={`text-xs ${textSecondary} flex items-center gap-1.5 mt-0.5`}>
                            {log.direction === 'incoming' ? (
                              <PhoneIncoming className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <PhoneOutgoing className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>
                              {log.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
                            </span>
                            <span>·</span>
                            <span>{log.timestamp}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Call Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startCall(log.contactName, log.phone, log.username);
                        }}
                        className={`min-h-[38px] px-3.5 py-1.5 text-xs font-bold flex items-center gap-1.5 shrink-0 ${btnPrimary}`}
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Call</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* DIALER PAGE: POSITIONED AT THE VERY BOTTOM OF THE SCREEN             */}
        {/* ==================================================================== */}
        {activePage === 'dialer' && !selectedContact && (
          <div className="min-h-[calc(100vh-9.5rem)] flex flex-col justify-end pb-2">
            <div className={`border ${borderHairline} ${bgSurface} p-4 space-y-4`}>
              <div className={`flex items-center justify-between border-b ${borderHairline} pb-2.5`}>
                <input
                  type="tel"
                  value={dialedInput}
                  onChange={(e) => setDialedInput(e.target.value)}
                  placeholder="Enter phone number"
                  className="w-full bg-transparent text-2xl font-mono font-bold tracking-wider text-center focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    playTone(360, 0.06);
                    setDialedInput((prev) => prev.slice(0, -1));
                  }}
                  className="p-2"
                  title="Backspace"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>

              {/* Bottom Thumb-Zone Keypad */}
              <div className="grid grid-cols-3 gap-2">
                {DIAL_KEYS.map((item) => (
                  <button
                    key={item.digit}
                    type="button"
                    onClick={() => {
                      playTone(520, 0.05);
                      setDialedInput((prev) => prev + item.digit);
                    }}
                    className={`h-14 ${bgMain} border ${borderHairline} active:opacity-70 flex flex-col items-center justify-center`}
                  >
                    <span className="text-lg font-mono font-bold leading-none">{item.digit}</span>
                    {item.sub && (
                      <span className={`text-[9px] ${textSecondary} mt-0.5 tracking-widest`}>
                        {item.sub}
                      </span>
                    )}
                  </button>
                ))}
              </div>

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
                className={`w-full h-13 font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 ${btnPrimary}`}
              >
                <Phone className="w-4 h-4" />
                <span>Call Number</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* CONTACTS PAGE                                                        */}
        {/* ==================================================================== */}
        {activePage === 'contacts' && !selectedContact && (
          <div className="space-y-3">
            <div className={`flex items-center justify-between border-b ${borderHairline} pb-2`}>
              <h2 className="font-serif text-lg font-bold">Contacts</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSyncContacts()}
                  className={`min-h-[34px] px-3 py-1 text-xs font-semibold flex items-center gap-1.5 ${btnOutline}`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingContacts ? 'animate-spin' : ''}`} />
                  <span>Sync</span>
                </button>
                <button
                  onClick={() => setShowAddContactModal(true)}
                  className={`min-h-[34px] px-3 py-1 text-xs font-bold flex items-center gap-1.5 ${btnPrimary}`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </div>

            <div
              className={`border ${borderHairline} divide-y ${
                isDarkMode ? 'divide-[#2a2a2a]' : 'divide-[#a2a9b1]'
              }`}
            >
              {contacts.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedContact(c)}
                  className={`p-3.5 ${bgMain} hover:${bgSurface} flex items-center justify-between gap-3 cursor-pointer`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 border ${borderHairline} ${bgSurface} flex items-center justify-center font-serif font-bold text-sm shrink-0 overflow-hidden`}
                    >
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt={c.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        c.name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-serif font-bold text-sm truncate">{c.name}</span>
                        {c.isFavorite && <Star className="w-3.5 h-3.5 fill-current shrink-0" />}
                      </div>
                      <div className={`text-xs font-mono ${textSecondary} truncate`}>{c.phone}</div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startCall(c.name, c.phone, c.username, c.tgId, c.accessHash);
                    }}
                    className={`min-h-[36px] px-3.5 py-1.5 text-xs font-bold flex items-center gap-1.5 shrink-0 ${btnPrimary}`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SELECTED CONTACT DETAIL & HISTORY VIEW */}
        {selectedContact && (
          <div className="space-y-4">
            <div className={`border ${borderHairline} ${bgSurface} p-5 text-center space-y-3`}>
              <div
                className={`w-20 h-20 border ${borderHairline} ${bgMain} flex items-center justify-center font-serif font-bold text-2xl mx-auto overflow-hidden`}
              >
                {selectedContact.avatarUrl ? (
                  <img
                    src={selectedContact.avatarUrl}
                    alt={selectedContact.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  selectedContact.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div>
                <h2 className="font-serif text-xl font-bold">{selectedContact.name}</h2>
                <p className={`text-xs font-mono ${textSecondary} mt-0.5`}>
                  {selectedContact.phone}
                </p>
              </div>
              <div className="flex justify-center gap-2 pt-1">
                <button
                  onClick={() =>
                    startCall(
                      selectedContact.name,
                      selectedContact.phone,
                      selectedContact.username,
                      selectedContact.tgId,
                      selectedContact.accessHash,
                      false
                    )
                  }
                  className={`min-h-[40px] px-5 py-2 text-xs font-bold flex items-center gap-2 ${btnPrimary}`}
                >
                  <Phone className="w-4 h-4" />
                  <span>Voice Call</span>
                </button>
                <button
                  onClick={() =>
                    startCall(
                      selectedContact.name,
                      selectedContact.phone,
                      selectedContact.username,
                      selectedContact.tgId,
                      selectedContact.accessHash,
                      true
                    )
                  }
                  className={`min-h-[40px] px-5 py-2 text-xs font-bold flex items-center gap-2 ${btnOutline}`}
                >
                  <Video className="w-4 h-4" />
                  <span>Video Call</span>
                </button>
              </div>
            </div>

            <div className={`border ${borderHairline} ${bgMain} p-4 space-y-2`}>
              <h3 className={`font-serif text-sm font-bold border-b ${borderHairline} pb-1.5`}>
                Call History
              </h3>
              {selectedContactHistory.length === 0 ? (
                <p className={`text-xs ${textSecondary} py-3 text-center`}>
                  No calls recorded with this contact.
                </p>
              ) : (
                <div className={`divide-y ${isDarkMode ? 'divide-[#2a2a2a]' : 'divide-[#a2a9b1]'}`}>
                  {selectedContactHistory.map((item) => (
                    <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
                      <span className="font-medium">
                        {item.direction === 'incoming' ? 'Incoming Call' : 'Outgoing Call'}
                      </span>
                      <span className={`font-mono ${textSecondary}`}>
                        {formatDuration(item.durationSeconds)} · {item.timestamp}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* PROFILE TAB: VIEW & EDIT NAME, NUMBER, PROFILE PICTURE + DARK MODE   */}
        {/* ==================================================================== */}
        {activePage === 'profile' && !selectedContact && (
          <div className="space-y-4">
            <div className={`border ${borderHairline} ${bgSurface} p-5 space-y-5`}>
              <div className={`flex items-center justify-between border-b ${borderHairline} pb-4`}>
                <div className="flex items-center gap-4">
                  <div
                    className={`w-16 h-16 border ${borderHairline} ${bgMain} flex items-center justify-center font-serif font-bold text-xl overflow-hidden shrink-0`}
                  >
                    {currentUser.avatarDataUrl ? (
                      <img
                        src={currentUser.avatarDataUrl}
                        alt={currentUser.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      currentUser.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <h2 className="font-serif text-xl font-bold">{currentUser.name}</h2>
                    <p className={`text-xs font-mono ${textSecondary} mt-1`}>{currentUser.phone}</p>
                  </div>
                </div>

                {!isEditingProfile && (
                  <button
                    onClick={openEditProfile}
                    className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 ${btnOutline}`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                )}
              </div>

              {profileSavedNotice && (
                <div className={`p-2.5 border ${borderHairline} ${bgMain} text-xs flex items-center gap-2`}>
                  <Check className="w-4 h-4" />
                  <span>Profile saved.</span>
                </div>
              )}

              {isEditingProfile ? (
                <form onSubmit={handleSaveProfile} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Profile Picture</label>
                    <label
                      className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold cursor-pointer ${btnOutline}`}
                    >
                      <Camera className="w-4 h-4" />
                      <span>Choose Photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleAvatarFileSelect(e, 'profile')}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1">Name</label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={`w-full h-10 px-3 ${bgMain} border ${borderHairline} text-sm`}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1">Phone Number</label>
                    <input
                      type="tel"
                      required
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className={`w-full h-10 px-3 ${bgMain} border ${borderHairline} text-sm font-mono`}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingProfile(false)}
                      className={`min-h-[38px] px-4 py-1.5 text-xs font-semibold ${btnOutline}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={`min-h-[38px] px-5 py-1.5 text-xs font-bold ${btnPrimary}`}
                    >
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <div className={`divide-y ${isDarkMode ? 'divide-[#2a2a2a]' : 'divide-[#a2a9b1]'} text-xs`}>
                  <div className="py-3 flex items-center justify-between">
                    <span className={textSecondary}>Name</span>
                    <span className="font-semibold">{currentUser.name}</span>
                  </div>
                  <div className="py-3 flex items-center justify-between">
                    <span className={textSecondary}>Phone Number</span>
                    <span className="font-mono font-semibold">{currentUser.phone}</span>
                  </div>
                </div>
              )}

              {/* Dark Mode Toggle Button underneath Profile Details */}
              <div className={`pt-3 border-t ${borderHairline} space-y-2.5`}>
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className={`w-full min-h-[44px] px-4 py-2.5 text-xs font-bold flex items-center justify-between ${btnOutline}`}
                >
                  <span className="flex items-center gap-2">
                    {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    <span>Dark Mode</span>
                  </span>
                  <span className="font-mono uppercase">{isDarkMode ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className={`w-full min-h-[42px] px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 ${btnOutline}`}
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
      {/* FLOATING BOTTOM BUTTONS: CONTACTS & DIALER                             */}
      {/* ====================================================================== */}
      {activePage !== 'profile' && (
        <div className="fixed bottom-5 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
          <div
            className={`pointer-events-auto ${bgMain} border ${borderHairline} shadow-lg p-1 flex items-center gap-1`}
          >
            {activePage !== 'logs' && (
              <button
                onClick={() => {
                  setSelectedContact(null);
                  navigateToPage('logs');
                }}
                className={`min-h-[42px] px-4 py-2 text-xs font-bold flex items-center gap-2 ${btnOutline}`}
              >
                <Phone className="w-4 h-4" />
                <span>Call Logs</span>
              </button>
            )}

            <button
              onClick={() => {
                setSelectedContact(null);
                navigateToPage('contacts');
              }}
              className={`min-h-[42px] px-5 py-2 text-xs font-bold flex items-center gap-2 ${
                activePage === 'contacts' ? btnPrimary : btnOutline
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Contacts</span>
            </button>

            <button
              onClick={() => {
                setSelectedContact(null);
                navigateToPage('dialer');
              }}
              className={`min-h-[42px] px-5 py-2 text-xs font-bold flex items-center gap-2 ${
                activePage === 'dialer' ? btnPrimary : btnOutline
              }`}
            >
              <PhoneCall className="w-4 h-4" />
              <span>Dialer</span>
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* CALL LOG LONG-PRESS OPTIONS MODAL                                      */}
      {/* (Caller Profile, History, Name Editor, Call, Video Call, Message,      */}
      {/*  Add to Favorites, Delete Contact)                                     */}
      {/* ====================================================================== */}
      {contextLogItem && (
        <div
          onClick={() => setContextLogItem(null)}
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`${bgMain} border ${borderHairline} max-w-sm w-full p-5 space-y-4`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between border-b ${borderHairline} pb-3`}>
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 border ${borderHairline} ${bgSurface} flex items-center justify-center font-serif font-bold text-sm shrink-0`}
                >
                  {contextLogItem.contactName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-serif font-bold text-base truncate">
                    {contextLogItem.contactName}
                  </div>
                  <div className={`text-xs font-mono ${textSecondary} truncate`}>
                    {contextLogItem.phone}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setContextLogItem(null)}
                className={`p-1.5 border ${borderHairline}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* SUB-VIEW 1: MAIN OPTIONS MENU */}
            {contextSubView === 'menu' && (
              <div className="grid grid-cols-1 gap-1.5 text-xs font-semibold">
                <button
                  onClick={() => setContextSubView('profile')}
                  className={`w-full h-10 px-3 text-left flex items-center justify-between ${btnOutline}`}
                >
                  <span>Caller Profile</span>
                  <span>→</span>
                </button>

                <button
                  onClick={() => setContextSubView('history')}
                  className={`w-full h-10 px-3 text-left flex items-center justify-between ${btnOutline}`}
                >
                  <span>Call History ({contextLogHistory.length})</span>
                  <span>→</span>
                </button>

                <button
                  onClick={() => {
                    setRenameContactInput(contextLogItem.contactName);
                    setContextSubView('editName');
                  }}
                  className={`w-full h-10 px-3 text-left flex items-center justify-between ${btnOutline}`}
                >
                  <span>Edit Name</span>
                  <Edit3 className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => {
                    const item = contextLogItem;
                    setContextLogItem(null);
                    startCall(item.contactName, item.phone, item.username, undefined, undefined, false);
                  }}
                  className={`w-full h-10 px-3 text-left flex items-center justify-between ${btnPrimary}`}
                >
                  <span>Voice Call</span>
                  <Phone className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => {
                    const item = contextLogItem;
                    setContextLogItem(null);
                    startCall(item.contactName, item.phone, item.username, undefined, undefined, true);
                  }}
                  className={`w-full h-10 px-3 text-left flex items-center justify-between ${btnOutline}`}
                >
                  <span>Video Call</span>
                  <Video className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setContextSubView('message')}
                  className={`w-full h-10 px-3 text-left flex items-center justify-between ${btnOutline}`}
                >
                  <span>Message</span>
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleToggleFavoriteFromContext}
                  className={`w-full h-10 px-3 text-left flex items-center justify-between ${btnOutline}`}
                >
                  <span>
                    {isContextContactFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                  </span>
                  <Star className={`w-3.5 h-3.5 ${isContextContactFavorite ? 'fill-current' : ''}`} />
                </button>

                <button
                  onClick={handleDeleteContactAndLogs}
                  className={`w-full h-10 px-3 text-left flex items-center justify-between ${btnOutline}`}
                >
                  <span>Delete Contact</span>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* SUB-VIEW 2: CALLER PROFILE */}
            {contextSubView === 'profile' && (
              <div className="space-y-3 text-xs">
                <div className={`p-4 border ${borderHairline} ${bgSurface} text-center space-y-2`}>
                  <div
                    className={`w-16 h-16 border ${borderHairline} ${bgMain} flex items-center justify-center font-serif font-bold text-xl mx-auto`}
                  >
                    {contextLogItem.contactName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="font-serif text-base font-bold">{contextLogItem.contactName}</div>
                  <div className={`font-mono ${textSecondary}`}>{contextLogItem.phone}</div>
                </div>
                <button
                  onClick={() => setContextSubView('menu')}
                  className={`w-full h-10 font-semibold ${btnOutline}`}
                >
                  Back to Options
                </button>
              </div>
            )}

            {/* SUB-VIEW 3: CALLER HISTORY */}
            {contextSubView === 'history' && (
              <div className="space-y-3 text-xs">
                <div className={`max-h-48 overflow-y-auto divide-y ${
                  isDarkMode ? 'divide-[#2a2a2a]' : 'divide-[#a2a9b1]'
                }`}>
                  {contextLogHistory.map((h) => (
                    <div key={h.id} className="py-2 flex items-center justify-between">
                      <span>{h.direction === 'incoming' ? 'Incoming' : 'Outgoing'}</span>
                      <span className={`font-mono ${textSecondary}`}>
                        {formatDuration(h.durationSeconds)} · {h.timestamp}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setContextSubView('menu')}
                  className={`w-full h-10 font-semibold ${btnOutline}`}
                >
                  Back to Options
                </button>
              </div>
            )}

            {/* SUB-VIEW 4: NAME EDITOR */}
            {contextSubView === 'editName' && (
              <form onSubmit={handleSaveRenamedContact} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Edit Caller Name</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={renameContactInput}
                    onChange={(e) => setRenameContactInput(e.target.value)}
                    className={`w-full h-10 px-3 ${bgMain} border ${borderHairline} text-sm`}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setContextSubView('menu')}
                    className={`flex-1 h-10 font-semibold ${btnOutline}`}
                  >
                    Back
                  </button>
                  <button type="submit" className={`flex-1 h-10 font-bold ${btnPrimary}`}>
                    Save Name
                  </button>
                </div>
              </form>
            )}

            {/* SUB-VIEW 5: SEND MESSAGE */}
            {contextSubView === 'message' && (
              <form onSubmit={handleSendQuickMessage} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">
                    Message to {contextLogItem.contactName}
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="Write a message..."
                    value={quickMessageInput}
                    onChange={(e) => setQuickMessageInput(e.target.value)}
                    className={`w-full h-10 px-3 ${bgMain} border ${borderHairline} text-sm`}
                  />
                </div>
                {quickMessageSentNotice && (
                  <div className="font-semibold">Message sent!</div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setContextSubView('menu')}
                    className={`flex-1 h-10 font-semibold ${btnOutline}`}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 h-10 font-bold flex items-center justify-center gap-1.5 ${btnPrimary}`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL: ADD NEW CONTACT                                                 */}
      {/* ====================================================================== */}
      {showAddContactModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSyncContacts}
            className={`${bgMain} border ${borderHairline} max-w-sm w-full p-5 space-y-4`}
          >
            <h3 className="font-serif text-lg font-bold">New Contact</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">Name</label>
              <input
                type="text"
                required
                placeholder="Contact name"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                className={`w-full h-10 px-3 ${bgMain} border ${borderHairline} text-sm`}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Phone Number</label>
              <input
                type="tel"
                required
                placeholder="+91 98765 43210"
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                className={`w-full h-10 px-3 ${bgMain} border ${borderHairline} text-sm font-mono`}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddContactModal(false)}
                className={`min-h-[38px] px-4 py-1.5 text-xs font-semibold ${btnOutline}`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`min-h-[38px] px-5 py-1.5 text-xs font-bold ${btnPrimary}`}
              >
                Save Contact
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ====================================================================== */}
      {/* INCOMING CALL FULL-SCREEN OVERLAY                                      */}
      {/* ====================================================================== */}
      {incomingCall && !activeCall && (
        <div className={`fixed inset-0 z-50 ${bgMain} flex flex-col justify-between p-6`}>
          <div className="text-center pt-6">
            <span className={`px-3 py-1 border ${borderHairline} text-xs font-bold uppercase`}>
              Incoming Call
            </span>
          </div>

          <div className="text-center space-y-4 my-auto">
            <div
              className={`w-24 h-24 border-2 ${borderHairline} ${bgSurface} flex items-center justify-center font-serif font-bold text-3xl mx-auto`}
            >
              {incomingCall.callerName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="font-serif text-2xl font-bold">{incomingCall.callerName}</h2>
              <p className={`text-sm font-mono ${textSecondary} mt-1`}>{incomingCall.callerPhone}</p>
            </div>
          </div>

          <div className="max-w-xs w-full mx-auto grid grid-cols-2 gap-4 pb-8">
            <button
              onClick={handleDeclineIncomingCall}
              className={`h-14 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${btnOutline}`}
            >
              <PhoneOff className="w-4 h-4" />
              <span>Decline</span>
            </button>
            <button
              onClick={handleAcceptIncomingCall}
              className={`h-14 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${btnPrimary}`}
            >
              <Phone className="w-4 h-4" />
              <span>Answer</span>
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* ACTIVE CALL PAGE (MUTE, SPEAKER, HOLD, ADD CALL, VIDEO CALL)           */}
      {/* ====================================================================== */}
      {activeCall && (
        <div className={`fixed inset-0 z-50 ${bgMain} flex flex-col justify-between p-6`}>
          <div
            className={`max-w-sm w-full mx-auto flex items-center justify-between text-xs border-b ${borderHairline} pb-3`}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <Lock className="w-3.5 h-3.5" />
              <span>Encrypted</span>
              <span className="ml-1">{activeCall.emojis.join(' ')}</span>
            </div>
            <span className="font-mono font-bold">
              {activeCall.status === 'on-hold'
                ? 'On Hold'
                : activeCall.status === 'ringing'
                ? 'Ringing...'
                : formatDuration(callSeconds)}
            </span>
          </div>

          <div className="max-w-sm w-full mx-auto text-center space-y-4 my-auto">
            {activeCall.isVideoEnabled ? (
              <div className={`relative w-full h-64 overflow-hidden ${bgSurface} border ${borderHairline}`}>
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
                  className={`w-24 h-32 object-cover border ${borderHairline} absolute bottom-3 right-3 bg-black`}
                />
              </div>
            ) : (
              <div
                className={`w-24 h-24 border-2 ${borderHairline} ${bgSurface} flex items-center justify-center font-serif font-bold text-3xl mx-auto`}
              >
                {activeCall.contactName.slice(0, 2).toUpperCase()}
              </div>
            )}

            <div>
              <h2 className="font-serif text-2xl font-bold">{activeCall.contactName}</h2>
              <p className={`text-xs font-mono ${textSecondary} mt-1`}>{activeCall.phone}</p>
              {activeCall.addedParticipants.length > 0 && (
                <p className="text-xs font-semibold mt-1">
                  + {activeCall.addedParticipants.join(', ')}
                </p>
              )}
            </div>
          </div>

          {showAddCallPicker && (
            <div
              className={`max-w-sm w-full mx-auto ${bgSurface} border ${borderHairline} p-3 mb-3 max-h-44 overflow-y-auto space-y-1.5`}
            >
              <div className="flex items-center justify-between text-xs font-bold px-1">
                <span>Add Contact to Call</span>
                <button onClick={() => setShowAddCallPicker(false)} className="underline">
                  Close
                </button>
              </div>
              {contacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleAddParticipantToCall(c)}
                  className={`w-full p-2 border ${borderHairline} ${bgMain} flex items-center justify-between text-xs`}
                >
                  <span className="font-semibold">{c.name}</span>
                  <span className="underline">Add</span>
                </button>
              ))}
            </div>
          )}

          {/* Active Call Controls: Mute, Speaker, Hold, Add Call, Video Call + End Call */}
          <div className="max-w-sm w-full mx-auto space-y-3 pb-2">
            <div className="grid grid-cols-5 gap-1.5">
              <button
                onClick={handleToggleMute}
                className={`h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  activeCall.isMuted ? btnPrimary : btnOutline
                }`}
              >
                {activeCall.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                <span>Mute</span>
              </button>

              <button
                onClick={handleToggleSpeaker}
                className={`h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  activeCall.isSpeakerOn ? btnPrimary : btnOutline
                }`}
              >
                {activeCall.isSpeakerOn ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
                <span>Speaker</span>
              </button>

              <button
                onClick={handleToggleHold}
                className={`h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  activeCall.isOnHold ? btnPrimary : btnOutline
                }`}
              >
                <Pause className="w-4 h-4" />
                <span>Hold</span>
              </button>

              <button
                onClick={() => setShowAddCallPicker((v) => !v)}
                className={`h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  showAddCallPicker ? btnPrimary : btnOutline
                }`}
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Call</span>
              </button>

              <button
                onClick={handleToggleVideoCall}
                className={`h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  activeCall.isVideoEnabled ? btnPrimary : btnOutline
                }`}
              >
                {activeCall.isVideoEnabled ? (
                  <Video className="w-4 h-4" />
                ) : (
                  <VideoOff className="w-4 h-4" />
                )}
                <span>Video Call</span>
              </button>
            </div>

            <button
              onClick={handleEndCall}
              className={`w-full h-13 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${btnPrimary}`}
            >
              <PhoneOff className="w-4 h-4" />
              <span>End Call</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
