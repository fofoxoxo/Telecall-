import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  PhoneOutgoing,
  PhoneIncoming,
  Mic,
  MicOff,
  Users,
  User,
  Search,
  Plus,
  Hand,
  Volume2,
  VolumeX,
  RefreshCw,
  Check,
  Copy,
  Radio,
  Lock,
  ArrowLeft,
  UserPlus,
  Share2,
  Delete,
  Globe,
  Link2,
  BookOpen,
  ShieldCheck,
  Mail,
  MessageSquare,
  PhoneCall,
  LogOut,
  Edit3,
  Menu,
  Clock,
  AtSign,
  Layers
} from 'lucide-react';
import {
  mtprotoEngine,
  MTProtoSessionData,
  AuthDeliveryMethod,
  apiFetch
} from './services/mtprotoClient';
import {
  SettingsDrawer,
  AppThemeId,
  THEME_PALETTES
} from './components/SettingsDrawer';

interface VoiceParticipant {
  id: string;
  name: string;
  phone: string;
  role: 'host' | 'speaker' | 'listener';
  isMuted: boolean;
  handRaised: boolean;
  isSpeaking: boolean;
  joinedAt: string;
}

interface VoiceRoom {
  id: string;
  title: string;
  topic: string;
  visibility: 'public' | 'private';
  inviteCode: string;
  rules: string[];
  hostId: string;
  hostName: string;
  createdAt: string;
  maxCapacity: number;
  lowBandwidthMode: boolean;
  participants: VoiceParticipant[];
  listenerCount: number;
}

interface SyncedContact {
  id: string;
  name: string;
  phone: string;
  username: string;
  online: boolean;
  lastSeen: string;
}

interface CallLogEntry {
  id: string;
  contactName: string;
  phone: string;
  username?: string;
  direction: 'outgoing' | 'incoming';
  durationSeconds: number;
  timestamp: string;
  codecUsed?: string;
  dhEmojis?: string[];
}

interface ActiveCallState {
  contactName: string;
  phone: string;
  sessionId: string;
  emojis: string[];
  isMuted: boolean;
  isSpeakerOn: boolean;
  lowNetworkMode: boolean;
}

// 6 Categories for the 3-Column Category Tag Grid on Voice Rooms Tab
const CATEGORY_GRID_TAGS = [
  'All',
  'Education & Exams',
  'Technology & Startups',
  'Music & Poetry',
  'Business & Finance',
  'Language Practice'
];

const DIAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '#'];
const RECENT_ROOMS_STORAGE_KEY = 'telecall_recent_joined_room_ids';
const THEME_STORAGE_KEY = 'telecall_active_theme';

export default function App() {
  // Theme Engine State
  const [activeTheme, setActiveTheme] = useState<AppThemeId>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as AppThemeId | null;
    return saved && THEME_PALETTES[saved] ? saved : 'telegram-dark';
  });
  const palette = THEME_PALETTES[activeTheme];

  const handleSelectTheme = (theme: AppThemeId) => {
    setActiveTheme(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  };

  // Hamburger Settings Drawer State
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);

  // Initialize MTProto Session from StringSession storage
  const [session, setSession] = useState<MTProtoSessionData | null>(() =>
    mtprotoEngine.getSavedSession()
  );

  // Telegram Auth Flow States (Primary Telegram Account via MTProto + Custom TeleChats Profile Layer)
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'existing_user' | 'new_user'>('existing_user');
  const [authStep, setAuthStep] = useState<'phone' | 'otp' | '2fa'>('phone');
  const [deliveryMethod, setDeliveryMethod] = useState<AuthDeliveryMethod>('telegram_app');
  const [phoneInput, setPhoneInput] = useState('+91 ');
  const [emailInput, setEmailInput] = useState('');
  const [firstNameInput, setFirstNameInput] = useState('');
  const [lastNameInput, setLastNameInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [twoFactorEnabledToggle, setTwoFactorEnabledToggle] = useState(false);
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Custom TeleChats Profile Layer Edit States (on top of synced primary Telegram profile)
  const [isEditingTelechatsLayer, setIsEditingTelechatsLayer] = useState(false);
  const [editTelechatsName, setEditTelechatsName] = useState('');
  const [editTelechatsHandle, setEditTelechatsHandle] = useState('');
  const [editTelechatsStatus, setEditTelechatsStatus] = useState('');
  const [editTelechatsCategory, setEditTelechatsCategory] = useState('Education & Exams');

  const currentUser: MTProtoSessionData = session || {
    dcId: 5,
    authKeyHex: 'default',
    serverSalt: 'default',
    userId: 'tg-user-local',
    phone: '+91 98200 11223',
    name: 'Aarav Verma',
    username: '@aarav_tg',
    bio: 'Synced from Primary Telegram Account (MTProto DC5)',
    twoFactorEnabled: true,
    telechatsDisplayName: 'Aarav Verma (Host)',
    telechatsHandle: '@aarav.telechats',
    telechatsStatus: 'Hosting Daily UPSC & Tech Voice Rooms',
    telechatsCategoryTag: 'Education & Exams',
    createdAt: Date.now()
  };

  // Main Navigation: 3 Primary Bottom Tabs ('calls' | 'rooms' | 'profile')
  const [activeBottomTab, setActiveBottomTab] = useState<'calls' | 'rooms' | 'profile'>('calls');

  // Calls Tab Floating Sub-Views: Call Logs | Thumb-Zone Dialer | Contacts
  const [callsSubTab, setCallsSubTab] = useState<'logs' | 'dialer' | 'contacts'>('logs');
  const [dialedInput, setDialedInput] = useState('+91 ');
  const [selectedCallerHistoryPhone, setSelectedCallerHistoryPhone] = useState<string | null>(null);

  // Recently Joined Room IDs
  const [recentRoomIds, setRecentRoomIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(RECENT_ROOMS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : ['room-upsc-101'];
    } catch {
      return ['room-upsc-101'];
    }
  });

  // Rooms State
  const [rooms, setRooms] = useState<VoiceRoom[]>(() => {
    const saved = localStorage.getItem('telecall_rooms_cache');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
    return [
      {
        id: 'room-upsc-101',
        title: 'All India UPSC & State PCS Late Night Discussion',
        topic: 'Education & Exams',
        visibility: 'public',
        inviteCode: 'upsc101',
        rules: [
          'Raise hand to speak on stage; maximum 3 minutes per speaker.',
          'Keep microphone muted when not speaking for clear audio.',
          'Strictly stick to current affairs and syllabus topics.'
        ],
        hostId: 'tg-host-1',
        hostName: 'Aarav Sharma',
        createdAt: new Date().toISOString(),
        maxCapacity: 2500,
        lowBandwidthMode: true,
        listenerCount: 1284,
        participants: [
          {
            id: 'tg-host-1',
            name: 'Aarav Sharma',
            phone: '+91 98201 44512',
            role: 'host',
            isMuted: false,
            handRaised: false,
            isSpeaking: true,
            joinedAt: new Date().toISOString()
          },
          {
            id: 'tg-spk-2',
            name: 'Priya Verma',
            phone: '+91 98114 22089',
            role: 'speaker',
            isMuted: false,
            handRaised: false,
            isSpeaking: false,
            joinedAt: new Date().toISOString()
          }
        ]
      },
      {
        id: 'room-tech-talk',
        title: 'Android App Makers & Startup Founders Lounge',
        topic: 'Technology & Startups',
        visibility: 'public',
        inviteCode: 'tech2026',
        rules: [
          'Share practical product and coding experiences.',
          'Hindi and English both welcome.'
        ],
        hostId: 'tg-host-2',
        hostName: 'Kabir Mehta',
        createdAt: new Date().toISOString(),
        maxCapacity: 5000,
        lowBandwidthMode: true,
        listenerCount: 1042,
        participants: [
          {
            id: 'tg-host-2',
            name: 'Kabir Mehta',
            phone: '+91 98765 11201',
            role: 'host',
            isMuted: false,
            handRaised: false,
            isSpeaking: true,
            joinedAt: new Date().toISOString()
          }
        ]
      }
    ];
  });

  const [contacts, setContacts] = useState<SyncedContact[]>([
    {
      id: 'contact-1',
      name: 'Aarav Sharma',
      phone: '+91 98201 44512',
      username: '@aarav_tg',
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
      lastSeen: 'In Voice Room'
    }
  ]);

  const [callLogs, setCallLogs] = useState<CallLogEntry[]>([
    {
      id: 'log-1',
      contactName: 'Aarav Sharma',
      phone: '+91 98201 44512',
      username: '@aarav_tg',
      direction: 'outgoing',
      durationSeconds: 342,
      timestamp: 'Today, 9:40 PM',
      codecUsed: 'Opus 12 kbps (Low-Latency SFU)',
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
      codecUsed: 'Opus 8 kbps (2G Ultra-Saver)',
      dhEmojis: ['⚡', '💎', '🌍', '🔥']
    },
    {
      id: 'log-3',
      contactName: 'Aarav Sharma',
      phone: '+91 98201 44512',
      username: '@aarav_tg',
      direction: 'incoming',
      durationSeconds: 195,
      timestamp: 'Yesterday, 8:10 PM',
      codecUsed: 'Opus 24 kbps (4G Standard)',
      dhEmojis: ['🔐', '🚀', '🦁', '🎸']
    }
  ]);

  // Voice Rooms Search & 3-Column Category Tag Filter
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('All');

  // Modals & Active Room / Call States
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [showJoinByLinkModal, setShowJoinByLinkModal] = useState(false);
  const [inviteLinkInput, setInviteLinkInput] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [roomPreviewRules, setRoomPreviewRules] = useState<VoiceRoom | null>(null);
  const [showEditRulesModal, setShowEditRulesModal] = useState(false);

  // Create Room Form
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomTopic, setNewRoomTopic] = useState('Education & Exams');
  const [newRoomVisibility, setNewRoomVisibility] = useState<'public' | 'private'>('public');
  const [newRoomRulesText, setNewRoomRulesText] = useState(
    'Raise hand to speak on stage.\nKeep microphone muted when not speaking.\nStay on the selected topic.'
  );

  // Contacts Sync / Add Contact
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('+91 ');
  const [syncingContacts, setSyncingContacts] = useState(false);

  // Active 1-on-1 Call
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);

  const recordRecentRoom = (roomId: string) => {
    setRecentRoomIds((prev) => {
      const next = [roomId, ...prev.filter((id) => id !== roomId)].slice(0, 8);
      localStorage.setItem(RECENT_ROOMS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    mtprotoEngine.initPersistentConnection();

    const unsubEvents = mtprotoEngine.onServerEvent((event, payload) => {
      if (event === 'init') {
        if (Array.isArray(payload.rooms) && payload.rooms.length > 0) {
          setRooms(payload.rooms);
        }
        if (Array.isArray(payload.contacts)) setContacts(payload.contacts);
        if (Array.isArray(payload.callLogs)) setCallLogs(payload.callLogs);
      } else if (event === 'room:created') {
        setRooms((prev) => {
          if (prev.some((r) => r.id === payload.id)) return prev;
          return [payload, ...prev];
        });
      } else if (event === 'room:updated') {
        setRooms((prev) => prev.map((r) => (r.id === payload.id ? payload : r)));
      } else if (event === 'contacts:updated') {
        setContacts(payload || []);
      } else if (event === 'calllogs:updated') {
        setCallLogs(payload || []);
      }
    });

    const params = new URLSearchParams(window.location.search);
    const roomInviteParam = params.get('room');
    if (roomInviteParam) {
      setActiveBottomTab('rooms');
      apiFetch('/api/rooms/join-by-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: roomInviteParam,
          userId: currentUser.userId,
          name: currentUser.telechatsDisplayName || currentUser.name,
          phone: currentUser.phone
        })
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.room) {
            setRooms((prev) =>
              prev.some((item) => item.id === data.room.id)
                ? prev.map((item) => (item.id === data.room.id ? data.room : item))
                : [data.room, ...prev]
            );
            recordRecentRoom(data.room.id);
            setJoinedRoomId(data.room.id);
          }
        })
        .catch(() => {});
    }

    return () => {
      unsubEvents();
    };
  }, [currentUser.userId, currentUser.name, currentUser.phone, currentUser.telechatsDisplayName]);

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

  const playTone = (freq = 480, duration = 0.1) => {
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

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const startCall = async (contactName: string, phone: string, calleeId = 'remote') => {
    if (!phone.trim() && !contactName.trim()) return;
    playTone(540, 0.14);
    try {
      const res = await apiFetch('/api/call/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerId: currentUser.userId,
          callerName: currentUser.telechatsDisplayName || currentUser.name,
          calleeId,
          contactName,
          phone
        })
      });
      const data = await res.json();
      setActiveCall({
        contactName,
        phone,
        sessionId: data.sessionId || 'call-1',
        emojis: data.emojis || ['🔐', '🚀', '🦁', '🎸'],
        isMuted: false,
        isSpeakerOn: true,
        lowNetworkMode: true
      });
    } catch {
      const newLog: CallLogEntry = {
        id: 'log-' + Date.now(),
        contactName,
        phone,
        direction: 'outgoing',
        durationSeconds: 0,
        timestamp: 'Just now',
        codecUsed: 'Opus 12 kbps (SFU)',
        dhEmojis: ['🔐', '🚀', '🦁', '🎸']
      };
      setCallLogs((prev) => [newLog, ...prev]);
      setActiveCall({
        contactName,
        phone,
        sessionId: 'call-local',
        emojis: ['🔐', '🚀', '🦁', '🎸'],
        isMuted: false,
        isSpeakerOn: true,
        lowNetworkMode: true
      });
    }
  };

  // --- TELEGRAM MTPROTO LOGIN & CUSTOM TELECHATS PROFILE HANDLERS ---

  const openAuthModal = (mode: 'existing_user' | 'new_user' = 'existing_user') => {
    setAuthMode(mode);
    setAuthStep('phone');
    setDeliveryMethod(mode === 'existing_user' ? 'telegram_app' : 'sms');
    setAuthError('');
    setShowAuthModal(true);
  };

  const handleSendOtp = async (e: React.FormEvent, customMethod?: AuthDeliveryMethod) => {
    e.preventDefault();
    setAuthError('');
    const chosenMethod = customMethod || deliveryMethod;

    if (chosenMethod === 'email' && !emailInput.trim()) {
      setAuthError('Please enter your email address to receive the Telegram Email OTP.');
      return;
    }

    setAuthLoading(true);
    const res = await mtprotoEngine.sendAuthCode(phoneInput, {
      deliveryMethod: chosenMethod,
      email: emailInput,
      isNewUser: authMode === 'new_user'
    });
    setAuthLoading(false);

    if (res.ok && res.phoneCodeHash) {
      setPhoneCodeHash(res.phoneCodeHash);
      setDeliveryMethod(chosenMethod);
      setOtpInput('');
      setAuthStep('otp');
    } else {
      setAuthError(res.error || 'Could not send Telegram verification code.');
    }
  };

  const handleVerifyOtpOr2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (authStep === 'otp' && authMode === 'existing_user' && twoFactorEnabledToggle) {
      setAuthStep('2fa');
      return;
    }

    setAuthLoading(true);
    const res = await mtprotoEngine.verifyAuthCode({
      phone: phoneInput,
      code: otpInput,
      phoneCodeHash,
      name:
        authMode === 'new_user'
          ? firstNameInput || 'TeleCall User'
          : firstNameInput || currentUser.name,
      lastName: lastNameInput,
      email: emailInput || undefined,
      twoFactorPassword: twoFactorPassword || undefined,
      require2FA: twoFactorEnabledToggle
    });
    setAuthLoading(false);

    if (res.requires2FA) {
      setAuthStep('2fa');
      return;
    }

    if (res.ok && res.sessionData) {
      const enriched: MTProtoSessionData = {
        ...res.sessionData,
        telechatsDisplayName:
          res.sessionData.telechatsDisplayName || `${res.sessionData.name} (TeleChats)`,
        telechatsHandle:
          res.sessionData.telechatsHandle ||
          `${res.sessionData.username.replace(/_tg$/, '')}.telechats`,
        telechatsStatus:
          res.sessionData.telechatsStatus || 'Active on TeleChats Voice Rooms',
        telechatsCategoryTag:
          res.sessionData.telechatsCategoryTag || 'Education & Exams'
      };
      mtprotoEngine.updateSavedProfile(enriched);
      setSession(enriched);
      setShowAuthModal(false);
      setAuthStep('phone');
      setTwoFactorPassword('');
    } else {
      setAuthError(res.error || 'Verification failed.');
    }
  };

  const handleSaveTelechatsLayer = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedHandle = editTelechatsHandle.trim().startsWith('@')
      ? editTelechatsHandle.trim()
      : `@${editTelechatsHandle.trim().replace(/^@/, '')}`;

    const updates: Partial<MTProtoSessionData> = {
      telechatsDisplayName: editTelechatsName.trim() || currentUser.name,
      telechatsHandle: cleanedHandle || '@user.telechats',
      telechatsStatus: editTelechatsStatus.trim() || 'Active on TeleChats',
      telechatsCategoryTag: editTelechatsCategory
    };

    const updated = mtprotoEngine.updateSavedProfile(updates);
    if (updated) {
      setSession(updated);
    } else {
      setSession({ ...currentUser, ...updates });
    }
    setIsEditingTelechatsLayer(false);
  };

  const handleSyncContacts = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSyncingContacts(true);
    const customContacts =
      newContactName.trim() && newContactPhone.trim()
        ? [{ name: newContactName.trim(), phone: newContactPhone.trim() }]
        : [];
    try {
      const res = await apiFetch('/api/contacts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customContacts })
      });
      const data = await res.json();
      if (data.contacts) setContacts(data.contacts);
      setNewContactName('');
      setNewContactPhone('+91 ');
      setShowAddContact(false);
    } finally {
      setTimeout(() => setSyncingContacts(false), 350);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomTitle.trim()) return;
    const rules = newRoomRulesText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);

    const hostDisplayName = currentUser.telechatsDisplayName || currentUser.name;

    try {
      const res = await apiFetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newRoomTitle,
          topic: newRoomTopic,
          visibility: newRoomVisibility,
          rules,
          hostId: currentUser.userId,
          hostName: hostDisplayName,
          hostPhone: currentUser.phone
        })
      });
      if (!res.ok) throw new Error('Static WebView fallback');
      const data = await res.json();
      if (data.ok && data.room) {
        setRooms((prev) => {
          const next = [data.room, ...prev.filter((r) => r.id !== data.room.id)];
          localStorage.setItem('telecall_rooms_cache', JSON.stringify(next));
          return next;
        });
        recordRecentRoom(data.room.id);
        setShowCreateRoomModal(false);
        setNewRoomTitle('');
        setJoinedRoomId(data.room.id);
        playTone(620, 0.14);
      }
    } catch {
      const fallbackRoom: VoiceRoom = {
        id: 'room-' + Date.now().toString(36),
        title: newRoomTitle.trim(),
        topic: newRoomTopic,
        visibility: newRoomVisibility,
        inviteCode: Math.random().toString(36).slice(2, 8),
        rules,
        hostId: currentUser.userId,
        hostName: hostDisplayName,
        createdAt: new Date().toISOString(),
        maxCapacity: 5000,
        lowBandwidthMode: true,
        listenerCount: 1,
        participants: [
          {
            id: currentUser.userId,
            name: hostDisplayName,
            phone: currentUser.phone,
            role: 'host',
            isMuted: false,
            handRaised: false,
            isSpeaking: true,
            joinedAt: new Date().toISOString()
          }
        ]
      };
      setRooms((prev) => {
        const next = [fallbackRoom, ...prev];
        localStorage.setItem('telecall_rooms_cache', JSON.stringify(next));
        return next;
      });
      recordRecentRoom(fallbackRoom.id);
      setShowCreateRoomModal(false);
      setNewRoomTitle('');
      setJoinedRoomId(fallbackRoom.id);
      playTone(620, 0.14);
    }
  };

  const handleJoinRoom = async (room: VoiceRoom) => {
    playTone(580, 0.12);
    recordRecentRoom(room.id);
    const displayName = currentUser.telechatsDisplayName || currentUser.name;

    try {
      const res = await apiFetch(`/api/rooms/${room.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.userId,
          name: displayName,
          phone: currentUser.phone
        })
      });
      if (!res.ok) throw new Error('Static fallback');
      const data = await res.json();
      if (data.ok && data.room) {
        setRoomPreviewRules(null);
        setJoinedRoomId(data.room.id);
        return;
      }
    } catch {
      // Static WebView fallback
    }
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== room.id) return r;
        const exists = r.participants.some((p) => p.id === currentUser.userId);
        if (exists) return r;
        return {
          ...r,
          listenerCount: r.listenerCount + 1,
          participants: [
            ...r.participants,
            {
              id: currentUser.userId,
              name: displayName,
              phone: currentUser.phone,
              role: r.hostId === currentUser.userId ? 'host' : 'listener',
              isMuted: r.hostId !== currentUser.userId,
              handRaised: false,
              isSpeaking: false,
              joinedAt: new Date().toISOString()
            }
          ]
        };
      })
    );
    setRoomPreviewRules(null);
    setJoinedRoomId(room.id);
  };

  const handleJoinByInviteLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    try {
      const res = await apiFetch('/api/rooms/join-by-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: inviteLinkInput,
          userId: currentUser.userId,
          name: currentUser.telechatsDisplayName || currentUser.name,
          phone: currentUser.phone
        })
      });
      const data = await res.json();
      if (data.ok && data.room) {
        setRooms((prev) =>
          prev.some((r) => r.id === data.room.id)
            ? prev.map((r) => (r.id === data.room.id ? data.room : r))
            : [data.room, ...prev]
        );
        recordRecentRoom(data.room.id);
        setShowJoinByLinkModal(false);
        setInviteLinkInput('');
        setJoinedRoomId(data.room.id);
      } else {
        setInviteError(data.error || 'Group not found. Check the invite code or link.');
      }
    } catch {
      const cleanCode = inviteLinkInput.trim().split('?room=').pop()?.trim().toLowerCase() || '';
      const found = rooms.find(
        (r) => r.inviteCode.toLowerCase() === cleanCode || r.id.toLowerCase() === cleanCode
      );
      if (found) {
        recordRecentRoom(found.id);
        setShowJoinByLinkModal(false);
        setInviteLinkInput('');
        setJoinedRoomId(found.id);
      } else {
        setInviteError('Group not found. Check the invite code or link.');
      }
    }
  };

  const handleRoomAction = async (
    roomId: string,
    action: string,
    targetUserId?: string,
    extra?: Record<string, unknown>
  ) => {
    const targetId = targetUserId || currentUser.userId;
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== roomId) return r;
        const updatedParticipants = r.participants.map((p) => {
          if (p.id !== targetId) return p;
          if (action === 'toggle-mute')
            return { ...p, isMuted: !p.isMuted, isSpeaking: p.isMuted };
          if (action === 'toggle-hand') return { ...p, handRaised: !p.handRaised };
          if (action === 'promote-speaker')
            return { ...p, role: 'speaker' as const, handRaised: false, isMuted: false };
          if (action === 'move-to-listener')
            return { ...p, role: 'listener' as const, isMuted: true, isSpeaking: false };
          return p;
        });
        return {
          ...r,
          topic: (extra?.newTopic as string) || r.topic,
          rules: Array.isArray(extra?.newRules)
            ? (extra.newRules as string[]).filter(Boolean)
            : r.rules,
          participants:
            action === 'leave'
              ? updatedParticipants.filter((p) => p.id !== currentUser.userId)
              : updatedParticipants
        };
      })
    );
    try {
      await apiFetch(`/api/rooms/${roomId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.userId,
          action,
          targetUserId,
          ...extra
        })
      });
    } catch {
      // Handled optimistically
    }
    if (action === 'leave') {
      playTone(320, 0.14);
      setJoinedRoomId(null);
    }
  };

  const recentlyJoinedRooms = recentRoomIds
    .map((id) => rooms.find((r) => r.id === id))
    .filter((r): r is VoiceRoom => Boolean(r));

  const visibleRooms = rooms.filter((r) => {
    const q = roomSearchQuery.trim().toLowerCase();
    const isCreator = r.hostId === currentUser.userId;
    const isRecent = recentRoomIds.includes(r.id);
    const matchesExactInvite =
      q.length > 0 &&
      (r.inviteCode.toLowerCase() === q || q.endsWith(`room=${r.inviteCode.toLowerCase()}`));

    if (r.visibility === 'private' && !isCreator && !isRecent && !matchesExactInvite) {
      return false;
    }

    const matchesTopic =
      selectedTopic === 'All' || r.topic.toLowerCase() === selectedTopic.toLowerCase();
    const matchesQuery =
      !q ||
      r.title.toLowerCase().includes(q) ||
      r.topic.toLowerCase().includes(q) ||
      matchesExactInvite;

    return matchesTopic && matchesQuery;
  });

  // Match contacts by @username or phone number inside the Thumb-Zone Dialer
  const dialerMatches = contacts.filter((c) => {
    const q = dialedInput.trim().toLowerCase();
    if (!q || q === '+91') return false;
    return (
      c.username.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.phone.replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))
    );
  });

  // Detailed Caller History for the clicked Call Log tile
  const selectedCallerLogs = selectedCallerHistoryPhone
    ? callLogs.filter((l) => l.phone === selectedCallerHistoryPhone)
    : [];

  const activeJoinedRoom = rooms.find((r) => r.id === joinedRoomId) || null;

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`min-h-screen ${palette.bgMain} ${palette.textPrimary} flex flex-col max-w-2xl mx-auto border-x ${palette.border}`}
    >
      {/* COMMON STICKY HEADER: App Name ("TeleCall") + Hamburger Settings Menu */}
      <header
        className={`sticky top-0 z-30 h-14 px-4 ${palette.bgCard} border-b ${palette.border} flex items-center justify-between`}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg font-bold tracking-tight">TeleCall</span>
          <span className={`text-[11px] font-medium ${palette.accentText}`}>
            {activeBottomTab === 'calls'
              ? '· Calls'
              : activeBottomTab === 'rooms'
              ? '· Voice Rooms'
              : '· Profile'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              session ? setActiveBottomTab('profile') : openAuthModal('existing_user')
            }
            className={`min-h-[38px] px-3 py-1.5 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-1.5`}
          >
            <User className={`w-3.5 h-3.5 ${palette.accentText}`} />
            <span className="max-w-[110px] truncate">
              {session ? currentUser.telechatsDisplayName || session.name : 'Telegram Login'}
            </span>
          </button>

          <button
            onClick={() => setShowSettingsDrawer(true)}
            aria-label="Open Settings Menu"
            className={`min-h-[38px] min-w-[38px] rounded-xl border ${palette.border} flex items-center justify-center hover:border-sky-500/60`}
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* MAIN SCROLLABLE VIEWPORT */}
      <main className="flex-1 px-4 py-4 pb-36">
        {/* ACTIVE VOICE ROOM FULL SCREEN STAGE */}
        {activeJoinedRoom ? (
          <div className={`${palette.bgCard} border ${palette.border} rounded-2xl p-4 sm:p-5 space-y-5`}>
            <div className={`flex items-start justify-between gap-3 pb-4 border-b ${palette.border}`}>
              <div className="min-w-0">
                <button
                  onClick={() => setJoinedRoomId(null)}
                  className={`inline-flex items-center gap-1.5 text-xs ${palette.textSecondary} hover:opacity-100 mb-1.5`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Voice Rooms</span>
                </button>
                <h1 className="text-lg font-bold leading-snug">{activeJoinedRoom.title}</h1>
                <div className={`flex flex-wrap items-center gap-2 text-xs ${palette.textSecondary} mt-1 tabular-nums`}>
                  <span className={`${palette.accentText} font-medium`}>{activeJoinedRoom.topic}</span>
                  <span>·</span>
                  <span>
                    {activeJoinedRoom.visibility === 'private' ? 'Private Group' : 'Public Group'}
                  </span>
                  <span>·</span>
                  <span>{activeJoinedRoom.listenerCount.toLocaleString()} active</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setRoomPreviewRules(activeJoinedRoom)}
                  className={`min-h-[40px] px-3 py-1.5 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-1.5 whitespace-nowrap`}
                >
                  <BookOpen className={`w-3.5 h-3.5 ${palette.accentText}`} />
                  <span>Rules</span>
                </button>

                <button
                  onClick={() =>
                    copyToClipboard(
                      'room-link',
                      `${window.location.origin}/?room=${activeJoinedRoom.inviteCode}`
                    )
                  }
                  className={`min-h-[40px] px-3 py-1.5 rounded-xl border ${palette.border} text-xs font-medium ${palette.accentText} flex items-center gap-1.5 whitespace-nowrap`}
                >
                  {copiedId === 'room-link' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Share</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => handleRoomAction(activeJoinedRoom.id, 'leave')}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold whitespace-nowrap"
                >
                  Leave
                </button>
              </div>
            </div>

            {/* Speakers Stage */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className={`text-xs font-semibold ${palette.textSecondary}`}>
                  Speakers ({activeJoinedRoom.participants.filter((p) => p.role !== 'listener').length})
                </h2>
                {activeJoinedRoom.hostId === currentUser.userId && (
                  <button
                    onClick={() => {
                      setNewRoomTopic(activeJoinedRoom.topic);
                      setNewRoomRulesText(activeJoinedRoom.rules.join('\n'));
                      setShowEditRulesModal(true);
                    }}
                    className={`text-xs ${palette.accentText} hover:underline`}
                  >
                    Edit Topic & Rules
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {activeJoinedRoom.participants
                  .filter((p) => p.role === 'host' || p.role === 'speaker')
                  .map((p) => (
                    <div
                      key={p.id}
                      className={`p-3 rounded-xl ${palette.bgMain} border ${
                        !p.isMuted ? 'border-emerald-500/60' : palette.border
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="w-9 h-9 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-xs">
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        {p.isMuted ? (
                          <MicOff className="w-4 h-4 text-rose-400" />
                        ) : (
                          <Mic className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>
                      <div className="text-xs font-semibold truncate">{p.name}</div>
                      <div className={`text-[11px] ${palette.textSecondary}`}>
                        {p.role === 'host' ? 'Host' : 'Speaker'}
                      </div>
                      {activeJoinedRoom.hostId === currentUser.userId &&
                        p.id !== currentUser.userId && (
                          <button
                            onClick={() =>
                              handleRoomAction(activeJoinedRoom.id, 'move-to-listener', p.id)
                            }
                            className={`mt-2 w-full py-1 rounded-lg border ${palette.border} text-[10px]`}
                          >
                            Move to Listeners
                          </button>
                        )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Listeners */}
            <div>
              <h2 className={`text-xs font-semibold ${palette.textSecondary} mb-2.5 tabular-nums`}>
                Listeners ({activeJoinedRoom.listenerCount.toLocaleString()} active)
              </h2>
              <div className="space-y-2">
                {activeJoinedRoom.participants
                  .filter((p) => p.role === 'listener')
                  .map((p) => (
                    <div
                      key={p.id}
                      className={`p-2.5 rounded-xl ${palette.bgMain} border ${palette.border} flex items-center justify-between gap-2`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center font-semibold text-xs shrink-0">
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{p.name}</div>
                          <div className={`text-[11px] ${palette.textSecondary}`}>
                            {p.handRaised ? '✋ Raised hand to speak' : 'Listening'}
                          </div>
                        </div>
                      </div>

                      {p.handRaised && (
                        <button
                          onClick={() =>
                            handleRoomAction(activeJoinedRoom.id, 'promote-speaker', p.id)
                          }
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-sky-500/20 text-sky-400 text-xs font-medium shrink-0"
                        >
                          Allow to Speak
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Bottom Controls inside Voice Room */}
            <div className={`pt-3 border-t ${palette.border} flex items-center justify-between gap-3`}>
              <button
                onClick={() => handleRoomAction(activeJoinedRoom.id, 'toggle-mute')}
                className={`flex-1 min-h-[44px] py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 ${
                  activeJoinedRoom.participants.find((p) => p.id === currentUser.userId)?.isMuted
                    ? `border ${palette.border}`
                    : 'bg-emerald-500 text-slate-950'
                }`}
              >
                {activeJoinedRoom.participants.find((p) => p.id === currentUser.userId)?.isMuted ? (
                  <>
                    <MicOff className="w-4 h-4" />
                    <span>Unmute</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    <span>Mic On</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleRoomAction(activeJoinedRoom.id, 'toggle-hand')}
                className={`flex-1 min-h-[44px] py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 ${
                  activeJoinedRoom.participants.find((p) => p.id === currentUser.userId)?.handRaised
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : `border ${palette.border}`
                }`}
              >
                <Hand className="w-4 h-4" />
                <span>
                  {activeJoinedRoom.participants.find((p) => p.id === currentUser.userId)
                    ?.handRaised
                    ? 'Lower Hand'
                    : 'Raise Hand'}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* =================================================================== */}
            {/* PRIMARY TAB 1: CALLS (Call Logs | Thumb-Zone Dialer | Contacts)     */}
            {/* =================================================================== */}
            {activeBottomTab === 'calls' && (
              <div className="space-y-4">
                {/* Sub-Screen 1: Call Logs (Click any tile for Detailed Info & Caller History) */}
                {callsSubTab === 'logs' && (
                  <div className="space-y-3">
                    <div className={`${palette.bgCard} border ${palette.border} rounded-2xl divide-y divide-slate-800/60`}>
                      {callLogs.map((log) => {
                        const isExpanded = selectedCallerHistoryPhone === log.phone;
                        return (
                          <div key={log.id} className="p-3.5 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              {/* Clicking the caller tile opens Detailed Info & Caller History */}
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedCallerHistoryPhone(isExpanded ? null : log.phone)
                                }
                                className="flex items-center gap-3 min-w-0 flex-1 text-left"
                              >
                                <div className="w-10 h-10 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center font-bold text-xs shrink-0">
                                  {log.contactName.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold truncate">
                                      {log.contactName}
                                    </span>
                                    {log.username && (
                                      <span className={`text-[11px] ${palette.accentText} truncate`}>
                                        {log.username}
                                      </span>
                                    )}
                                  </div>
                                  <div className={`flex items-center gap-1.5 text-xs ${palette.textSecondary} mt-0.5 tabular-nums`}>
                                    {log.direction === 'outgoing' ? (
                                      <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <PhoneIncoming className="w-3.5 h-3.5 text-sky-400" />
                                    )}
                                    <span>{log.timestamp}</span>
                                    {log.durationSeconds > 0 && (
                                      <>
                                        <span>·</span>
                                        <span>{formatDuration(log.durationSeconds)}</span>
                                      </>
                                    )}
                                    <span>·</span>
                                    <span className="underline">Details</span>
                                  </div>
                                </div>
                              </button>

                              <button
                                onClick={() => startCall(log.contactName, log.phone, log.id)}
                                className="min-h-[44px] min-w-[44px] rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 flex items-center justify-center shrink-0"
                              >
                                <Phone className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Expanded Detailed Caller Info & History */}
                            {isExpanded && (
                              <div className={`p-3.5 rounded-xl ${palette.bgMain} border ${palette.border} space-y-2.5 text-xs`}>
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold">
                                    Caller History & E2EE Details ({log.phone})
                                  </span>
                                  <span className="text-[11px] text-emerald-400">
                                    {log.codecUsed || 'Opus Low-Latency SFU'}
                                  </span>
                                </div>

                                {log.dhEmojis && (
                                  <div className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg ${palette.bgCard} border ${palette.border}`}>
                                    <span className={palette.textSecondary}>
                                      Last Call DH Fingerprint
                                    </span>
                                    <span className="tracking-widest text-sm">
                                      {log.dhEmojis.join(' ')}
                                    </span>
                                  </div>
                                )}

                                <div className="space-y-1.5 pt-1">
                                  <div className={`text-[11px] font-medium ${palette.textSecondary}`}>
                                    All Calls with {log.contactName} ({selectedCallerLogs.length})
                                  </div>
                                  {selectedCallerLogs.map((h) => (
                                    <div
                                      key={h.id}
                                      className="flex items-center justify-between text-[11px] py-1 border-b border-slate-800/40 last:border-none tabular-nums"
                                    >
                                      <span className="flex items-center gap-1.5">
                                        <Clock className="w-3 h-3 text-sky-400" />
                                        <span>
                                          {h.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} ·{' '}
                                          {h.timestamp}
                                        </span>
                                      </span>
                                      <span>{formatDuration(h.durationSeconds)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sub-Screen 2: Thumb-Zone Dialer (Username Search + Phone Keypad Call Execution) */}
                {callsSubTab === 'dialer' && (
                  <div className="max-w-sm mx-auto flex flex-col justify-end min-h-[64vh] space-y-3">
                    {/* Live Username / Contact Matches in Dialer */}
                    {dialerMatches.length > 0 && (
                      <div className={`${palette.bgCard} border ${palette.border} rounded-2xl p-2.5 space-y-1.5`}>
                        <div className={`text-[11px] px-1 font-medium ${palette.textSecondary}`}>
                          Matching Telegram Contacts / Usernames
                        </div>
                        {dialerMatches.map((m) => (
                          <div
                            key={m.id}
                            className={`p-2 rounded-xl ${palette.bgMain} flex items-center justify-between gap-2`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-semibold truncate">{m.name}</div>
                              <div className={`text-[11px] ${palette.accentText} truncate`}>
                                {m.username} · {m.phone}
                              </div>
                            </div>
                            <button
                              onClick={() => startCall(m.name, m.phone, m.id)}
                              className="min-h-[36px] px-3 py-1 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs shrink-0"
                            >
                              Call
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Thumb-Zone Keypad Card */}
                    <div className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-3.5`}>
                      <div className={`flex items-center justify-between ${palette.bgMain} border ${palette.border} rounded-xl px-3.5 h-12`}>
                        <AtSign className={`w-4 h-4 ${palette.accentText} mr-2 shrink-0`} />
                        <input
                          type="text"
                          placeholder="Enter @username or +91 phone..."
                          value={dialedInput}
                          onChange={(e) => setDialedInput(e.target.value)}
                          className="w-full bg-transparent text-base font-mono font-semibold focus:outline-none tabular-nums"
                        />
                        <button
                          onClick={() => setDialedInput((prev) => prev.slice(0, -1))}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center opacity-70 hover:opacity-100"
                        >
                          <Delete className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {DIAL_KEYS.map((digit) => (
                          <button
                            key={digit}
                            onClick={() => {
                              playTone(600, 0.05);
                              setDialedInput((prev) => prev + digit);
                            }}
                            className={`h-12 rounded-2xl ${palette.bgMain} border ${palette.border} text-lg font-semibold active:scale-95 transition-transform tabular-nums`}
                          >
                            {digit}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => {
                          const match = dialerMatches[0];
                          if (match) {
                            startCall(match.name, match.phone, match.id);
                          } else {
                            startCall(dialedInput, dialedInput, dialedInput);
                          }
                        }}
                        className="w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2"
                      >
                        <Phone className="w-5 h-5" />
                        <span>Call via Telegram MTProto</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-Screen 3: Contacts (Synced Phone & Telegram Directory) */}
                {callsSubTab === 'contacts' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleSyncContacts()}
                        className={`min-h-[40px] px-3.5 py-2 rounded-xl ${palette.bgCard} border ${palette.border} text-xs font-medium flex items-center gap-1.5`}
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            syncingContacts ? 'animate-spin text-sky-400' : ''
                          }`}
                        />
                        <span>
                          {syncingContacts ? 'Syncing...' : 'Sync Phone & Telegram Directory'}
                        </span>
                      </button>

                      <button
                        onClick={() => setShowAddContact((v) => !v)}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-sky-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Add Contact</span>
                      </button>
                    </div>

                    {showAddContact && (
                      <form
                        onSubmit={handleSyncContacts}
                        className={`p-3.5 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-2.5`}
                      >
                        <input
                          type="text"
                          required
                          placeholder="Contact Name"
                          value={newContactName}
                          onChange={(e) => setNewContactName(e.target.value)}
                          className={`w-full h-10 px-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs`}
                        />
                        <input
                          type="tel"
                          required
                          placeholder="+91 98765 43210"
                          value={newContactPhone}
                          onChange={(e) => setNewContactPhone(e.target.value)}
                          className={`w-full h-10 px-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs font-mono`}
                        />
                        <button
                          type="submit"
                          className="w-full h-10 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs"
                        >
                          Save & Sync Contact
                        </button>
                      </form>
                    )}

                    <div className={`${palette.bgCard} border ${palette.border} rounded-2xl divide-y divide-slate-800/60`}>
                      {contacts.map((contact) => (
                        <div
                          key={contact.id}
                          className="p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center font-bold text-xs shrink-0">
                              {contact.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold truncate">
                                  {contact.name}
                                </span>
                                <span className={`text-[11px] ${palette.accentText}`}>
                                  {contact.username}
                                </span>
                              </div>
                              <div className={`text-xs ${palette.textSecondary} mt-0.5 tabular-nums truncate`}>
                                {contact.phone} ·{' '}
                                <span
                                  className={
                                    contact.online ? 'text-emerald-400' : palette.textSecondary
                                  }
                                >
                                  {contact.lastSeen}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={() => startCall(contact.name, contact.phone, contact.id)}
                            className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shrink-0"
                          >
                            <Phone className="w-4 h-4" />
                            <span>Call</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* =================================================================== */}
            {/* PRIMARY TAB 2: VOICE ROOMS (Search + Private Code Join + 3-Col Grid */}
            {/* + Recent Rooms + Live Topic Rooms List + Floating Action Button)    */}
            {/* =================================================================== */}
            {activeBottomTab === 'rooms' && (
              <div className="space-y-4">
                {/* Search Bar + Private Code Join Button */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className={`w-4 h-4 ${palette.textSecondary} absolute left-3.5 top-1/2 -translate-y-1/2`} />
                    <input
                      type="text"
                      value={roomSearchQuery}
                      onChange={(e) => setRoomSearchQuery(e.target.value)}
                      placeholder="Search live topic rooms or paths..."
                      className={`w-full h-11 pl-9 pr-3 ${palette.bgCard} border ${palette.border} rounded-xl text-xs focus:outline-none focus:border-sky-500`}
                    />
                  </div>

                  <button
                    onClick={() => setShowJoinByLinkModal(true)}
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl ${palette.bgCard} border ${palette.border} text-xs font-semibold flex items-center gap-1.5 shrink-0 whitespace-nowrap`}
                  >
                    <Link2 className={`w-4 h-4 ${palette.accentText}`} />
                    <span>Private Code Join</span>
                  </button>
                </div>

                {/* Recently Joined Rooms Strip */}
                {recentlyJoinedRooms.length > 0 && (
                  <div className={`p-3 rounded-2xl ${palette.bgCard} border ${palette.border}`}>
                    <div className={`text-[11px] font-semibold ${palette.textSecondary} mb-2`}>
                      Recently Joined Rooms
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar">
                      {recentlyJoinedRooms.map((recentRoom) => (
                        <button
                          key={recentRoom.id}
                          onClick={() => handleJoinRoom(recentRoom)}
                          className={`min-h-[36px] px-3 py-1.5 rounded-xl ${palette.bgMain} border ${palette.border} flex items-center gap-2 shrink-0 text-left`}
                        >
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-xs font-semibold truncate max-w-[155px]">
                            {recentRoom.title}
                          </span>
                          <span className={`text-[11px] ${palette.accentText} tabular-nums shrink-0`}>
                            {recentRoom.listenerCount}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3-Column Category Filtering Tag Grid */}
                <div>
                  <div className={`text-xs font-semibold ${palette.textSecondary} mb-2`}>
                    Browse by Category (3-Column Tag Grid)
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {CATEGORY_GRID_TAGS.map((topic) => (
                      <button
                        key={topic}
                        onClick={() => setSelectedTopic(topic)}
                        className={`min-h-[40px] px-2.5 py-2 rounded-xl text-xs font-medium text-center truncate transition-colors ${
                          selectedTopic === topic
                            ? 'bg-sky-500 text-slate-950 font-semibold'
                            : `${palette.bgCard} border ${palette.border}`
                        }`}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Topic Rooms List */}
                <div className="space-y-3">
                  {visibleRooms.map((room) => (
                    <div
                      key={room.id}
                      className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} flex items-center justify-between gap-3`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={`flex items-center gap-2 text-xs ${palette.textSecondary} mb-1 tabular-nums`}>
                          <span className={`${palette.accentText} font-medium truncate`}>
                            {room.topic}
                          </span>
                          <span>·</span>
                          <span className="shrink-0">
                            {room.listenerCount.toLocaleString()} active
                          </span>
                          {room.visibility === 'private' && (
                            <>
                              <span>·</span>
                              <span className="text-amber-400 shrink-0">Private</span>
                            </>
                          )}
                        </div>
                        <h2 className="text-base font-bold leading-snug truncate">{room.title}</h2>
                        <div className={`text-xs ${palette.textSecondary} mt-0.5 truncate`}>
                          Host: <span className="font-medium">{room.hostName}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {room.visibility === 'private' && (
                          <button
                            onClick={() =>
                              copyToClipboard(
                                room.id,
                                `${window.location.origin}/?room=${room.inviteCode}`
                              )
                            }
                            className={`min-h-[42px] px-3 py-2 rounded-xl border ${palette.border} text-xs font-medium ${palette.accentText} flex items-center gap-1`}
                          >
                            {copiedId === room.id ? (
                              <Check className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        )}

                        <button
                          onClick={() => handleJoinRoom(room)}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Radio className="w-3.5 h-3.5" />
                          <span>Join</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Floating Action Button (FAB) to Create Voice Room */}
                <button
                  onClick={() => setShowCreateRoomModal(true)}
                  aria-label="Create Voice Room"
                  className="fixed bottom-20 right-5 z-30 h-14 px-5 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-xl flex items-center gap-2 active:scale-95 transition-transform"
                >
                  <Plus className="w-5 h-5" />
                  <span>Create Room</span>
                </button>
              </div>
            )}

            {/* =================================================================== */}
            {/* PRIMARY TAB 3: PROFILE (Synced Primary Telegram Account +           */}
            {/* Custom TeleChats Profile Layer)                                     */}
            {/* =================================================================== */}
            {activeBottomTab === 'profile' && (
              <div className="space-y-4">
                {/* 1. Primary Telegram Account Card (Synced via MTProto) */}
                <div className={`p-5 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-4`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${palette.accentText} flex items-center gap-1.5`}>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Primary Telegram Account (MTProto Synced)</span>
                    </span>
                    {session && (
                      <button
                        onClick={() => {
                          mtprotoEngine.logout();
                          setSession(null);
                        }}
                        className="min-h-[34px] px-3 py-1 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center gap-1"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Logout</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-15 h-15 rounded-full bg-sky-500/20 border border-sky-400/40 text-sky-400 flex items-center justify-center font-bold text-xl shrink-0">
                      {currentUser.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold truncate">{currentUser.name}</h2>
                      <p className={`text-xs ${palette.accentText} font-medium truncate`}>
                        {currentUser.username}
                      </p>
                      <p className={`text-xs ${palette.textSecondary} font-mono mt-0.5`}>
                        {currentUser.phone} · DC{currentUser.dcId}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => openAuthModal('existing_user')}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl bg-sky-500 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5"
                    >
                      <User className="w-4 h-4" />
                      <span>Login Existing Telegram User</span>
                    </button>
                    <button
                      onClick={() => openAuthModal('new_user')}
                      className={`min-h-[40px] px-3.5 py-2 rounded-xl border ${palette.border} font-semibold text-xs flex items-center justify-center gap-1.5`}
                    >
                      <UserPlus className={`w-4 h-4 ${palette.accentText}`} />
                      <span>New User Sign Up (Call/SMS/Email)</span>
                    </button>
                  </div>
                </div>

                {/* 2. Custom TeleChats Profile Layer Card */}
                <div className={`p-5 rounded-2xl ${palette.bgCard} border ${palette.border} space-y-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className={`w-4 h-4 ${palette.accentText}`} />
                      <h3 className="text-sm font-bold">Custom TeleChats Profile Layer</h3>
                    </div>

                    <button
                      onClick={() => {
                        setEditTelechatsName(
                          currentUser.telechatsDisplayName || currentUser.name
                        );
                        setEditTelechatsHandle(
                          currentUser.telechatsHandle || '@user.telechats'
                        );
                        setEditTelechatsStatus(
                          currentUser.telechatsStatus || 'Active on TeleChats Voice Rooms'
                        );
                        setEditTelechatsCategory(
                          currentUser.telechatsCategoryTag || 'Education & Exams'
                        );
                        setIsEditingTelechatsLayer((v) => !v);
                      }}
                      className={`min-h-[36px] px-3 py-1.5 rounded-xl border ${palette.border} text-xs font-medium flex items-center gap-1.5`}
                    >
                      <Edit3 className={`w-3.5 h-3.5 ${palette.accentText}`} />
                      <span>Customize Layer</span>
                    </button>
                  </div>

                  {isEditingTelechatsLayer ? (
                    <form
                      onSubmit={handleSaveTelechatsLayer}
                      className={`p-4 rounded-xl ${palette.bgMain} border ${palette.border} space-y-3`}
                    >
                      <div>
                        <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                          TeleChats Stage Display Name
                        </label>
                        <input
                          type="text"
                          required
                          value={editTelechatsName}
                          onChange={(e) => setEditTelechatsName(e.target.value)}
                          className={`w-full h-10 px-3 rounded-xl ${palette.bgCard} border ${palette.border} text-xs`}
                        />
                      </div>
                      <div>
                        <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                          Custom TeleChats Handle
                        </label>
                        <input
                          type="text"
                          required
                          value={editTelechatsHandle}
                          onChange={(e) => setEditTelechatsHandle(e.target.value)}
                          className={`w-full h-10 px-3 rounded-xl ${palette.bgCard} border ${palette.border} text-xs`}
                        />
                      </div>
                      <div>
                        <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                          Community Status / Headline
                        </label>
                        <input
                          type="text"
                          value={editTelechatsStatus}
                          onChange={(e) => setEditTelechatsStatus(e.target.value)}
                          className={`w-full h-10 px-3 rounded-xl ${palette.bgCard} border ${palette.border} text-xs`}
                        />
                      </div>
                      <div>
                        <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                          Primary Topic Specialization
                        </label>
                        <select
                          value={editTelechatsCategory}
                          onChange={(e) => setEditTelechatsCategory(e.target.value)}
                          className={`w-full h-10 px-3 rounded-xl ${palette.bgCard} border ${palette.border} text-xs`}
                        >
                          {CATEGORY_GRID_TAGS.filter((t) => t !== 'All').map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setIsEditingTelechatsLayer(false)}
                          className={`min-h-[38px] px-3.5 py-1.5 rounded-xl border ${palette.border} text-xs`}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="min-h-[38px] px-4 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-semibold text-xs"
                        >
                          Save TeleChats Layer
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="divide-y divide-slate-800/60 text-xs">
                      <div className="py-2.5 flex items-center justify-between gap-2">
                        <span className={palette.textSecondary}>Stage Display Name</span>
                        <span className="font-semibold">
                          {currentUser.telechatsDisplayName || currentUser.name}
                        </span>
                      </div>
                      <div className="py-2.5 flex items-center justify-between gap-2">
                        <span className={palette.textSecondary}>TeleChats Handle</span>
                        <span className={`${palette.accentText} font-medium`}>
                          {currentUser.telechatsHandle || '@aarav.telechats'}
                        </span>
                      </div>
                      <div className="py-2.5 flex items-center justify-between gap-2">
                        <span className={palette.textSecondary}>Voice Status</span>
                        <span className="text-right">
                          {currentUser.telechatsStatus || 'Active on TeleChats Voice Rooms'}
                        </span>
                      </div>
                      <div className="py-2.5 flex items-center justify-between gap-2">
                        <span className={palette.textSecondary}>Primary Topic Badge</span>
                        <span className="px-2.5 py-0.5 rounded-lg bg-sky-500/15 text-sky-400 font-medium">
                          {currentUser.telechatsCategoryTag || 'Education & Exams'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* FLOATING SUB-VIEW NAVIGATION ON CALLS PAGE (Call Logs | Dialer | Contacts) */}
      {activeBottomTab === 'calls' && !activeJoinedRoom && (
        <div className="fixed bottom-19 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
          <div
            className={`pointer-events-auto ${palette.bgCard} border ${palette.border} shadow-xl rounded-2xl p-1 flex items-center gap-1`}
          >
            <button
              onClick={() => setCallsSubTab('logs')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                callsSubTab === 'logs'
                  ? 'bg-sky-500 text-slate-950'
                  : `${palette.textSecondary} hover:opacity-100`
              }`}
            >
              Call Logs
            </button>
            <button
              onClick={() => setCallsSubTab('dialer')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                callsSubTab === 'dialer'
                  ? 'bg-sky-500 text-slate-950'
                  : `${palette.textSecondary} hover:opacity-100`
              }`}
            >
              Dialer
            </button>
            <button
              onClick={() => setCallsSubTab('contacts')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                callsSubTab === 'contacts'
                  ? 'bg-sky-500 text-slate-950'
                  : `${palette.textSecondary} hover:opacity-100`
              }`}
            >
              Contacts
            </button>
          </div>
        </div>
      )}

      {/* HAMBURGER SETTINGS PAGE / DRAWER (Theme Engine & System Utilities) */}
      <SettingsDrawer
        isOpen={showSettingsDrawer}
        onClose={() => setShowSettingsDrawer(false)}
        activeTheme={activeTheme}
        onSelectTheme={handleSelectTheme}
        userId={currentUser.userId}
        userName={currentUser.telechatsDisplayName || currentUser.name}
        onClearLocalData={() => {
          localStorage.removeItem('telecall_rooms_cache');
          localStorage.removeItem(RECENT_ROOMS_STORAGE_KEY);
          setRecentRoomIds([]);
          setShowSettingsDrawer(false);
        }}
      />

      {/* MODAL: Create Voice Room */}
      {showCreateRoomModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateRoom}
            className={`${palette.bgCard} border ${palette.border} rounded-2xl max-w-md w-full p-5 space-y-4`}
          >
            <h3 className="text-lg font-bold">Create Voice Room</h3>

            <div>
              <label className={`block text-xs font-medium ${palette.textSecondary} mb-1`}>
                Voice Room Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Daily Exam Strategy & Doubt Solving"
                value={newRoomTitle}
                onChange={(e) => setNewRoomTitle(e.target.value)}
                className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
              />
            </div>

            <div>
              <label className={`block text-xs font-medium ${palette.textSecondary} mb-1`}>
                Room Topic Category
              </label>
              <select
                value={newRoomTopic}
                onChange={(e) => setNewRoomTopic(e.target.value)}
                className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-sm`}
              >
                {CATEGORY_GRID_TAGS.filter((t) => t !== 'All').map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={`block text-xs font-medium ${palette.textSecondary} mb-1`}>
                Room Privacy
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewRoomVisibility('public')}
                  className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 ${
                    newRoomVisibility === 'public'
                      ? 'bg-sky-500/20 border-sky-500 text-sky-400'
                      : `${palette.bgMain} ${palette.border}`
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Public (Searchable)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNewRoomVisibility('private')}
                  className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 ${
                    newRoomVisibility === 'private'
                      ? 'bg-sky-500/20 border-sky-500 text-sky-400'
                      : `${palette.bgMain} ${palette.border}`
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Private (Invite Code)</span>
                </button>
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium ${palette.textSecondary} mb-1`}>
                Room Rules (One per line)
              </label>
              <textarea
                rows={3}
                value={newRoomRulesText}
                onChange={(e) => setNewRoomRulesText(e.target.value)}
                className={`w-full p-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs`}
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateRoomModal(false)}
                className={`min-h-[42px] px-4 py-2 rounded-xl border ${palette.border} text-xs`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold"
              >
                Create Room
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Join Group via Private Code / Invite Link */}
      {showJoinByLinkModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleJoinByInviteLink}
            className={`${palette.bgCard} border ${palette.border} rounded-2xl max-w-sm w-full p-5 space-y-4`}
          >
            <h3 className="text-base font-bold">Private Code Join</h3>
            <p className={`text-xs ${palette.textSecondary}`}>
              Enter the private invite code or link shared by the room host:
            </p>
            <input
              type="text"
              required
              placeholder="Paste code (e.g. upsc101 or tech2026)..."
              value={inviteLinkInput}
              onChange={(e) => setInviteLinkInput(e.target.value)}
              className={`w-full h-11 px-3.5 rounded-xl ${palette.bgMain} border ${palette.border} text-xs`}
            />
            {inviteError && <p className="text-xs text-rose-400">{inviteError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowJoinByLinkModal(false);
                  setInviteError('');
                }}
                className={`min-h-[40px] px-4 py-2 rounded-xl border ${palette.border} text-xs`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold"
              >
                Join Room
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Room Rules Popup */}
      {roomPreviewRules && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`${palette.bgCard} border ${palette.border} rounded-2xl max-w-sm w-full p-5 space-y-4`}>
            <div>
              <div className={`text-xs ${palette.accentText} font-medium`}>{roomPreviewRules.topic}</div>
              <h3 className="text-base font-bold mt-0.5">{roomPreviewRules.title}</h3>
            </div>
            <div className={`space-y-1.5 p-3.5 rounded-xl ${palette.bgMain} border ${palette.border}`}>
              {roomPreviewRules.rules.map((r, i) => (
                <div key={i} className="text-xs">
                  {i + 1}. {r}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRoomPreviewRules(null)}
                className={`min-h-[40px] px-4 py-2 rounded-xl border ${palette.border} text-xs`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Edit Room Rules */}
      {showEditRulesModal && activeJoinedRoom && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`${palette.bgCard} border ${palette.border} rounded-2xl max-w-sm w-full p-5 space-y-4`}>
            <h3 className="text-base font-bold">Edit Topic & Rules</h3>
            <input
              type="text"
              value={newRoomTopic}
              onChange={(e) => setNewRoomTopic(e.target.value)}
              className={`w-full h-10 px-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs`}
            />
            <textarea
              rows={4}
              value={newRoomRulesText}
              onChange={(e) => setNewRoomRulesText(e.target.value)}
              className={`w-full p-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs`}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowEditRulesModal(false)}
                className={`min-h-[40px] px-4 py-2 rounded-xl border ${palette.border} text-xs`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleRoomAction(activeJoinedRoom.id, 'update-rules', undefined, {
                    newTopic: newRoomTopic,
                    newRules: newRoomRulesText.split('\n')
                  });
                  setShowEditRulesModal(false);
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Telegram Login (OTP + 2FA) & New User Registration (SMS / Phone Call / Email OTP) */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={authStep === 'phone' ? handleSendOtp : handleVerifyOtpOr2FA}
            className={`${palette.bgCard} border ${palette.border} rounded-2xl max-w-md w-full p-5 space-y-4`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {authMode === 'existing_user'
                  ? 'Telegram Account Login'
                  : 'New Telegram User Sign Up'}
              </h3>
              <span className={`text-[11px] ${palette.accentText} font-medium`}>
                TeleCall MTProto
              </span>
            </div>

            <div className={`grid grid-cols-2 gap-1.5 p-1 rounded-xl ${palette.bgMain} border ${palette.border}`}>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('existing_user');
                  setAuthStep('phone');
                  setDeliveryMethod('telegram_app');
                  setAuthError('');
                }}
                className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  authMode === 'existing_user'
                    ? 'bg-sky-500 text-slate-950'
                    : palette.textSecondary
                }`}
              >
                Existing Telegram User
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('new_user');
                  setAuthStep('phone');
                  setDeliveryMethod('sms');
                  setAuthError('');
                }}
                className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  authMode === 'new_user'
                    ? 'bg-sky-500 text-slate-950'
                    : palette.textSecondary
                }`}
              >
                New User Sign Up
              </button>
            </div>

            {authStep === 'phone' && (
              <div className="space-y-3">
                {authMode === 'new_user' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                        First Name
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="First name"
                        value={firstNameInput}
                        onChange={(e) => setFirstNameInput(e.target.value)}
                        className={`w-full h-10 px-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs`}
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
                        className={`w-full h-10 px-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs`}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className={`block text-xs ${palette.textSecondary} mb-1`}>
                    Telegram Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className={`w-full h-10 px-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs font-mono`}
                  />
                </div>

                <div>
                  <label className={`block text-xs ${palette.textSecondary} mb-1.5`}>
                    Receive Verification Code Via
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {authMode === 'existing_user' && (
                      <button
                        type="button"
                        onClick={() => setDeliveryMethod('telegram_app')}
                        className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 ${
                          deliveryMethod === 'telegram_app'
                            ? 'bg-sky-500/20 border-sky-500 text-sky-400'
                            : `${palette.bgMain} ${palette.border}`
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Telegram App OTP</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setDeliveryMethod('sms')}
                      className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 ${
                        deliveryMethod === 'sms'
                          ? 'bg-sky-500/20 border-sky-500 text-sky-400'
                          : `${palette.bgMain} ${palette.border}`
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>SMS OTP</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeliveryMethod('phone_call')}
                      className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 ${
                        deliveryMethod === 'phone_call'
                          ? 'bg-sky-500/20 border-sky-500 text-sky-400'
                          : `${palette.bgMain} ${palette.border}`
                      }`}
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      <span>Phone Call OTP</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeliveryMethod('email')}
                      className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 ${
                        deliveryMethod === 'email'
                          ? 'bg-sky-500/20 border-sky-500 text-sky-400'
                          : `${palette.bgMain} ${palette.border}`
                      }`}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Email OTP</span>
                    </button>
                  </div>
                </div>

                {deliveryMethod === 'email' && (
                  <div>
                    <label className="block text-xs text-sky-400 mb-1">
                      Email Address for Telegram OTP
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className={`w-full h-10 px-3 rounded-xl ${palette.bgMain} border border-sky-500/60 text-xs`}
                    />
                  </div>
                )}

                {authMode === 'existing_user' && (
                  <label className={`flex items-center justify-between p-2.5 rounded-xl ${palette.bgMain} border ${palette.border} cursor-pointer`}>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-sky-400" />
                      <span className="text-xs">
                        My account has 2-Step Verification (2FA Password)
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={twoFactorEnabledToggle}
                      onChange={(e) => setTwoFactorEnabledToggle(e.target.checked)}
                      className="accent-sky-500 w-4 h-4"
                    />
                  </label>
                )}
              </div>
            )}

            {authStep === 'otp' && (
              <div className="space-y-3">
                <div className={`p-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs`}>
                  {deliveryMethod === 'telegram_app' &&
                    `Code sent to your Telegram app on ${phoneInput}.`}
                  {deliveryMethod === 'sms' && `SMS OTP sent to ${phoneInput}.`}
                  {deliveryMethod === 'phone_call' &&
                    `Calling ${phoneInput} with your 5-digit Telegram voice code...`}
                  {deliveryMethod === 'email' &&
                    `Email OTP sent to ${emailInput || 'your email'}.`}
                </div>

                <div>
                  <label className="block text-xs text-sky-400 mb-1">
                    Enter 5-Digit Verification Code
                  </label>
                  <input
                    type="text"
                    required
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    className={`w-full h-11 px-3 rounded-xl ${palette.bgMain} border border-sky-500 text-sm font-mono tracking-widest`}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={(e) => handleSendOtp(e, 'sms')}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    Get Code via SMS
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={(e) => handleSendOtp(e, 'phone_call')}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    Request Phone Call
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => {
                      setDeliveryMethod('email');
                      setAuthStep('phone');
                    }}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    Get Code via Email
                  </button>
                </div>
              </div>
            )}

            {authStep === '2fa' && (
              <div className="space-y-3">
                <div className={`p-3 rounded-xl ${palette.bgMain} border ${palette.border} text-xs flex items-center gap-2`}>
                  <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>
                    Two-Step Verification is enabled on this Telegram account. Enter your Cloud
                    Password to finish signing in.
                  </span>
                </div>

                <div>
                  <label className="block text-xs text-sky-400 mb-1">
                    Telegram 2FA Cloud Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Enter your 2FA password..."
                    value={twoFactorPassword}
                    onChange={(e) => setTwoFactorPassword(e.target.value)}
                    className={`w-full h-11 px-3 rounded-xl ${palette.bgMain} border border-sky-500 text-xs`}
                  />
                </div>
              </div>
            )}

            {authError && <p className="text-xs text-rose-400">{authError}</p>}

            <div className="flex justify-between items-center gap-2 pt-1">
              {authStep !== 'phone' ? (
                <button
                  type="button"
                  onClick={() => setAuthStep('phone')}
                  className={`min-h-[40px] px-3 py-2 rounded-xl border ${palette.border} text-xs`}
                >
                  Back
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAuthModal(false)}
                  className={`min-h-[40px] px-4 py-2 rounded-xl border ${palette.border} text-xs`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={authLoading}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold"
                >
                  {authLoading
                    ? 'Please wait...'
                    : authStep === 'phone'
                    ? 'Send Code'
                    : authStep === '2fa'
                    ? 'Verify 2FA & Login'
                    : twoFactorEnabledToggle && authMode === 'existing_user'
                    ? 'Next (2FA)'
                    : 'Verify & Login'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* FULL-SCREEN OVERLAY: 1-ON-1 E2EE VOICE CALL */}
      {activeCall && (
        <div className={`fixed inset-0 z-50 ${palette.bgMain} flex flex-col justify-between p-6`}>
          <div className={`max-w-sm w-full mx-auto flex items-center justify-between text-xs ${palette.textSecondary}`}>
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Lock className="w-3.5 h-3.5" />
              <span>End-to-End Encrypted</span>
            </div>
            <span className="tabular-nums">{formatDuration(callSeconds)}</span>
          </div>

          <div className="max-w-sm w-full mx-auto text-center space-y-5 my-auto">
            <div className="w-24 h-24 rounded-full bg-sky-500/20 border-2 border-sky-400/50 text-sky-400 flex items-center justify-center font-bold text-3xl mx-auto">
              {activeCall.contactName.slice(0, 2).toUpperCase()}
            </div>

            <div>
              <h2 className="text-2xl font-bold">{activeCall.contactName}</h2>
              <p className={`text-xs ${palette.textSecondary} mt-1`}>{activeCall.phone}</p>
            </div>

            <div className={`p-4 rounded-2xl ${palette.bgCard} border ${palette.border} max-w-xs mx-auto`}>
              <div className="text-2xl tracking-widest space-x-3 mb-1">
                {activeCall.emojis.map((em, i) => (
                  <span key={i}>{em}</span>
                ))}
              </div>
              <p className={`text-[11px] ${palette.textSecondary}`}>
                Matching emojis confirm End-to-End Encryption.
              </p>
            </div>
          </div>

          <div className="max-w-sm w-full mx-auto grid grid-cols-3 gap-4 pb-4">
            <button
              onClick={() =>
                setActiveCall((prev) => (prev ? { ...prev, isMuted: !prev.isMuted } : null))
              }
              className={`h-14 rounded-2xl flex flex-col items-center justify-center gap-1 text-xs font-medium ${
                activeCall.isMuted
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : `${palette.bgCard} border ${palette.border}`
              }`}
            >
              {activeCall.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              <span>{activeCall.isMuted ? 'Muted' : 'Mute'}</span>
            </button>

            <button
              onClick={() =>
                setActiveCall((prev) =>
                  prev ? { ...prev, isSpeakerOn: !prev.isSpeakerOn } : null
                )
              }
              className={`h-14 rounded-2xl flex flex-col items-center justify-center gap-1 text-xs font-medium ${
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
              onClick={() => {
                playTone(300, 0.16);
                setActiveCall(null);
              }}
              className="h-14 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white flex flex-col items-center justify-center gap-1 text-xs font-semibold"
            >
              <PhoneOff className="w-5 h-5" />
              <span>End</span>
            </button>
          </div>
        </div>
      )}

      {/* 3 PRIMARY BOTTOM TABS: Calls | Voice Rooms | Profile */}
      <nav
        className={`fixed bottom-0 left-0 right-0 z-40 h-16 max-w-2xl mx-auto ${palette.bgCard} border-t ${palette.border} grid grid-cols-3 items-center`}
      >
        <button
          onClick={() => setActiveBottomTab('calls')}
          className={`h-full flex flex-col items-center justify-center transition-colors ${
            activeBottomTab === 'calls' ? palette.accentText : palette.textSecondary
          }`}
        >
          <Phone className="w-5 h-5" />
          <span className="text-xs font-semibold mt-1">Calls</span>
        </button>

        <button
          onClick={() => setActiveBottomTab('rooms')}
          className={`h-full flex flex-col items-center justify-center transition-colors ${
            activeBottomTab === 'rooms' ? palette.accentText : palette.textSecondary
          }`}
        >
          <Users className="w-5 h-5" />
          <span className="text-xs font-semibold mt-1">Voice Rooms</span>
        </button>

        <button
          onClick={() => setActiveBottomTab('profile')}
          className={`h-full flex flex-col items-center justify-center transition-colors ${
            activeBottomTab === 'profile' ? palette.accentText : palette.textSecondary
          }`}
        >
          <User className="w-5 h-5" />
          <span className="text-xs font-semibold mt-1">Profile</span>
        </button>
      </nav>
    </div>
  );
}
