import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  PhoneOutgoing,
  PhoneIncoming,
  Mic,
  MicOff,
  Users,
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
  BookOpen
} from 'lucide-react';
import { mtprotoEngine, MTProtoSessionData } from './services/mtprotoClient';

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
  direction: 'outgoing' | 'incoming';
  durationSeconds: number;
  timestamp: string;
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

const TOPICS = [
  'All',
  'Education & Exams',
  'Technology & Startups',
  'Music & Poetry',
  'Business & Finance',
  'Language Practice'
];

const DIAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '#'];

export default function App() {
  // Initialize MTProto Session from StringSession storage
  const [session, setSession] = useState<MTProtoSessionData | null>(() =>
    mtprotoEngine.getSavedSession()
  );

  // Login Flow States
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authStep, setAuthStep] = useState<'phone' | 'otp'>('phone');
  const [phoneInput, setPhoneInput] = useState('+91 ');
  const [nameInput, setNameInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const currentUser = session || {
    dcId: 4,
    authKeyHex: 'default',
    serverSalt: 'default',
    userId: 'tg-user-local',
    phone: '+91 98200 11223',
    name: 'TeleCall User',
    username: '@telecall_user',
    createdAt: Date.now()
  };

  // Bottom Navigation (Strictly 2 tabs: 'calls' and 'rooms')
  const [activeBottomTab, setActiveBottomTab] = useState<'calls' | 'rooms'>('calls');

  // Floating Switcher above footer inside Calls tab: Call Logs, Contacts, Dialer
  const [callsSubTab, setCallsSubTab] = useState<'logs' | 'contacts' | 'dialer'>('logs');
  const [dialedNumber, setDialedNumber] = useState('+91 ');

  // Data States (Initialized with built-in defaults so deployed GitHub Pages WebView works immediately even without Node backend)
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
      direction: 'outgoing',
      durationSeconds: 342,
      timestamp: 'Today, 9:40 PM'
    },
    {
      id: 'log-2',
      contactName: 'Priya Verma',
      phone: '+91 98114 22089',
      direction: 'incoming',
      durationSeconds: 128,
      timestamp: 'Today, 7:15 PM'
    }
  ]);

  // Voice Rooms Header Search & Topic Filter
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

  useEffect(() => {
    mtprotoEngine.initPersistentConnection();

    const unsubEvents = mtprotoEngine.onServerEvent((event, payload) => {
      if (event === 'init') {
        setRooms(payload.rooms || []);
        setContacts(payload.contacts || []);
        setCallLogs(payload.callLogs || []);
      } else if (event === 'room:created') {
        setRooms((prev) => {
          if (prev.some((r) => r.id === payload.id)) return prev;
          return [payload, ...prev];
        });
      } else if (event === 'room:updated') {
        setRooms((prev) =>
          prev.map((r) => (r.id === payload.id ? payload : r))
        );
      } else if (event === 'contacts:updated') {
        setContacts(payload || []);
      } else if (event === 'calllogs:updated') {
        setCallLogs(payload || []);
      }
    });

    // Check if user opened a private room invite link (?room=inviteCode)
    const params = new URLSearchParams(window.location.search);
    const roomInviteParam = params.get('room');
    if (roomInviteParam) {
      setActiveBottomTab('rooms');
      fetch('/api/rooms/join-by-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: roomInviteParam,
          userId: currentUser.userId,
          name: currentUser.name,
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
            setJoinedRoomId(data.room.id);
          }
        })
        .catch(() => {});
    }

    return () => {
      unsubEvents();
    };
  }, [currentUser.userId, currentUser.name, currentUser.phone]);

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
    if (!phone.trim()) return;
    playTone(540, 0.14);
    try {
      const res = await fetch('/api/call/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerId: currentUser.userId,
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

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    const res = await mtprotoEngine.sendAuthCode(phoneInput);
    setAuthLoading(false);
    if (res.ok && res.phoneCodeHash) {
      setPhoneCodeHash(res.phoneCodeHash);
      setOtpInput('54921');
      setAuthStep('otp');
    } else {
      setAuthError(res.error || 'Could not send verification code.');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    const res = await mtprotoEngine.verifyAuthCode({
      phone: phoneInput,
      code: otpInput,
      phoneCodeHash,
      name: nameInput || 'TeleCall User'
    });
    setAuthLoading(false);
    if (res.ok && res.sessionData) {
      setSession(res.sessionData);
      setShowAuthModal(false);
      setAuthStep('phone');
    } else {
      setAuthError(res.error || 'Verification failed.');
    }
  };

  const handleSyncContacts = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSyncingContacts(true);
    const customContacts =
      newContactName.trim() && newContactPhone.trim()
        ? [{ name: newContactName.trim(), phone: newContactPhone.trim() }]
        : [];
    try {
      const res = await fetch('/api/contacts/sync', {
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

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newRoomTitle,
          topic: newRoomTopic,
          visibility: newRoomVisibility,
          rules,
          hostId: currentUser.userId,
          hostName: currentUser.name,
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
        hostName: currentUser.name,
        createdAt: new Date().toISOString(),
        maxCapacity: 5000,
        lowBandwidthMode: true,
        listenerCount: 1,
        participants: [
          {
            id: currentUser.userId,
            name: currentUser.name,
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
      setShowCreateRoomModal(false);
      setNewRoomTitle('');
      setJoinedRoomId(fallbackRoom.id);
      playTone(620, 0.14);
    }
  };

  const handleJoinRoom = async (room: VoiceRoom) => {
    playTone(580, 0.12);
    try {
      const res = await fetch(`/api/rooms/${room.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.userId,
          name: currentUser.name,
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
              name: currentUser.name,
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
    const res = await fetch('/api/rooms/join-by-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: inviteLinkInput,
        userId: currentUser.userId,
        name: currentUser.name,
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
      setShowJoinByLinkModal(false);
      setInviteLinkInput('');
      setJoinedRoomId(data.room.id);
    } else {
      setInviteError(data.error || 'Room not found. Check the invite link.');
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
          if (action === 'toggle-mute') return { ...p, isMuted: !p.isMuted, isSpeaking: p.isMuted };
          if (action === 'toggle-hand') return { ...p, handRaised: !p.handRaised };
          if (action === 'promote-speaker') return { ...p, role: 'speaker' as const, handRaised: false, isMuted: false };
          if (action === 'move-to-listener') return { ...p, role: 'listener' as const, isMuted: true, isSpeaking: false };
          return p;
        });
        return {
          ...r,
          topic: (extra?.newTopic as string) || r.topic,
          rules: Array.isArray(extra?.newRules) ? (extra.newRules as string[]).filter(Boolean) : r.rules,
          participants: action === 'leave' ? updatedParticipants.filter((p) => p.id !== currentUser.userId) : updatedParticipants
        };
      })
    );
    try {
      await fetch(`/api/rooms/${roomId}/action`, {
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
      // Handled optimistically for static GitHub Pages WebView
    }
    if (action === 'leave') {
      playTone(320, 0.14);
      setJoinedRoomId(null);
    }
  };

  const visibleRooms = rooms.filter((r) => {
    const q = roomSearchQuery.trim().toLowerCase();
    const isCreator = r.hostId === currentUser.userId;
    const matchesExactInvite =
      q.length > 0 &&
      (r.inviteCode.toLowerCase() === q || q.endsWith(`room=${r.inviteCode.toLowerCase()}`));

    if (r.visibility === 'private' && !isCreator && !matchesExactInvite) {
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

  const activeJoinedRoom = rooms.find((r) => r.id === joinedRoomId) || null;

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#0b141a] text-slate-100 flex flex-col max-w-2xl mx-auto border-x border-slate-800/60">
      {/* Top App Header */}
      {activeBottomTab === 'calls' ? (
        <header className="sticky top-0 z-30 h-14 px-4 bg-[#111b21]/95 backdrop-blur-md border-b border-slate-800 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight text-white">TeleCall</span>

          <button
            onClick={() => setShowAuthModal(true)}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap"
          >
            {session ? `${session.name}` : 'Telegram Sign In'}
          </button>
        </header>
      ) : (
        /* Voice Rooms Header with Topic Search + Create Voice Room right next to it */
        <header className="sticky top-0 z-30 px-4 py-2.5 bg-[#111b21]/95 backdrop-blur-md border-b border-slate-800 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={roomSearchQuery}
              onChange={(e) => setRoomSearchQuery(e.target.value)}
              placeholder="Search topics or voice rooms..."
              className="w-full h-10 pl-9 pr-3 bg-[#0b141a] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <button
            onClick={() => setShowJoinByLinkModal(true)}
            className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Link</span>
          </button>

          <button
            onClick={() => setShowCreateRoomModal(true)}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Create</span>
          </button>
        </header>
      )}

      {/* Main Scrollable Viewport */}
      <main className="flex-1 px-4 py-4 pb-36">
        {/* ACTIVE VOICE ROOM FULL SCREEN STAGE */}
        {activeJoinedRoom ? (
          <div className="bg-[#111b21] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-5">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="min-w-0">
                <button
                  onClick={() => setJoinedRoomId(null)}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Voice Rooms</span>
                </button>
                <h1 className="text-lg font-bold text-white leading-snug">
                  {activeJoinedRoom.title}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1 tabular-nums">
                  <span className="text-sky-400 font-medium">{activeJoinedRoom.topic}</span>
                  <span>·</span>
                  <span>
                    {activeJoinedRoom.visibility === 'private' ? 'Private Room' : 'Public Room'}
                  </span>
                  <span>·</span>
                  <span>{activeJoinedRoom.listenerCount.toLocaleString()} active</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setRoomPreviewRules(activeJoinedRoom)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                  <span>Rules</span>
                </button>

                <button
                  onClick={() =>
                    copyToClipboard(
                      'room-link',
                      `${window.location.origin}/?room=${activeJoinedRoom.inviteCode}`
                    )
                  }
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-sky-300 flex items-center gap-1.5 whitespace-nowrap"
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
                <h2 className="text-xs font-semibold text-slate-400">
                  Speakers ({activeJoinedRoom.participants.filter((p) => p.role !== 'listener').length})
                </h2>
                {activeJoinedRoom.hostId === currentUser.userId && (
                  <button
                    onClick={() => {
                      setNewRoomTopic(activeJoinedRoom.topic);
                      setNewRoomRulesText(activeJoinedRoom.rules.join('\n'));
                      setShowEditRulesModal(true);
                    }}
                    className="text-xs text-sky-400 hover:underline"
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
                      className={`p-3 rounded-xl bg-[#0b141a] border ${
                        !p.isMuted ? 'border-emerald-500/60' : 'border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="w-9 h-9 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center font-bold text-xs">
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        {p.isMuted ? (
                          <MicOff className="w-4 h-4 text-rose-400" />
                        ) : (
                          <Mic className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>
                      <div className="text-xs font-semibold text-white truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {p.role === 'host' ? 'Host' : 'Speaker'}
                      </div>
                      {activeJoinedRoom.hostId === currentUser.userId &&
                        p.id !== currentUser.userId && (
                          <button
                            onClick={() =>
                              handleRoomAction(activeJoinedRoom.id, 'move-to-listener', p.id)
                            }
                            className="mt-2 w-full py-1 rounded-lg bg-slate-800 text-[10px] text-slate-300"
                          >
                            Move to Listeners
                          </button>
                        )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Listeners (1000+ Audience) */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 mb-2.5 tabular-nums">
                Listeners ({activeJoinedRoom.listenerCount.toLocaleString()} active)
              </h2>
              <div className="space-y-2">
                {activeJoinedRoom.participants
                  .filter((p) => p.role === 'listener')
                  .map((p) => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-xl bg-[#0b141a] border border-slate-800/80 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-semibold text-xs shrink-0">
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-200 truncate">
                            {p.name}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {p.handRaised ? '✋ Raised hand to speak' : 'Listening'}
                          </div>
                        </div>
                      </div>

                      {p.handRaised && (
                        <button
                          onClick={() =>
                            handleRoomAction(activeJoinedRoom.id, 'promote-speaker', p.id)
                          }
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-sky-500/20 text-sky-300 text-xs font-medium shrink-0"
                        >
                          Allow to Speak
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Bottom Controls inside Voice Room */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
              <button
                onClick={() => handleRoomAction(activeJoinedRoom.id, 'toggle-mute')}
                className={`flex-1 min-h-[44px] py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 ${
                  activeJoinedRoom.participants.find((p) => p.id === currentUser.userId)?.isMuted
                    ? 'bg-slate-800 text-slate-200'
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
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-800 text-slate-200'
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
            {/* BOTTOM TAB 1: CALLS (Call Logs, Contacts, Dialer) */}
            {activeBottomTab === 'calls' && (
              <div className="space-y-4">
                {/* Sub-Tab A: Call Logs */}
                {callsSubTab === 'logs' && (
                  <div className="bg-[#111b21] border border-slate-800 rounded-2xl divide-y divide-slate-800/80">
                    {callLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3.5 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-slate-800 text-sky-300 flex items-center justify-center font-bold text-xs shrink-0">
                            {log.contactName.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">
                              {log.contactName}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 tabular-nums">
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
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => startCall(log.contactName, log.phone, log.id)}
                          className="min-h-[44px] min-w-[44px] rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 flex items-center justify-center shrink-0"
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sub-Tab B: Contacts (with Sync & Add) */}
                {callsSubTab === 'contacts' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleSyncContacts()}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#111b21] border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            syncingContacts ? 'animate-spin text-sky-400' : ''
                          }`}
                        />
                        <span>{syncingContacts ? 'Syncing...' : 'Sync Contacts'}</span>
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
                        className="p-3.5 rounded-2xl bg-[#111b21] border border-slate-800 space-y-2.5"
                      >
                        <input
                          type="text"
                          required
                          placeholder="Contact Name"
                          value={newContactName}
                          onChange={(e) => setNewContactName(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl bg-[#0b141a] border border-slate-800 text-xs text-white"
                        />
                        <input
                          type="tel"
                          required
                          placeholder="+91 98765 43210"
                          value={newContactPhone}
                          onChange={(e) => setNewContactPhone(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl bg-[#0b141a] border border-slate-800 text-xs text-white font-mono"
                        />
                        <button
                          type="submit"
                          className="w-full h-10 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs"
                        >
                          Save & Sync Contact
                        </button>
                      </form>
                    )}

                    <div className="bg-[#111b21] border border-slate-800 rounded-2xl divide-y divide-slate-800/80">
                      {contacts.map((contact) => (
                        <div
                          key={contact.id}
                          className="p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-sky-500/15 text-sky-300 flex items-center justify-center font-bold text-xs shrink-0">
                              {contact.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">
                                {contact.name}
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5 tabular-nums truncate">
                                {contact.phone} ·{' '}
                                <span
                                  className={
                                    contact.online ? 'text-emerald-400' : 'text-slate-500'
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

                {/* Sub-Tab C: Keypad Dialer */}
                {callsSubTab === 'dialer' && (
                  <div className="p-5 rounded-2xl bg-[#111b21] border border-slate-800 max-w-sm mx-auto space-y-4">
                    <div className="flex items-center justify-between bg-[#0b141a] border border-slate-800 rounded-xl px-4 h-13">
                      <input
                        type="tel"
                        value={dialedNumber}
                        onChange={(e) => setDialedNumber(e.target.value)}
                        className="w-full bg-transparent text-xl font-mono font-semibold text-white focus:outline-none tabular-nums"
                      />
                      <button
                        onClick={() => setDialedNumber((prev) => prev.slice(0, -1))}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white"
                      >
                        <Delete className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      {DIAL_KEYS.map((digit) => (
                        <button
                          key={digit}
                          onClick={() => {
                            playTone(600, 0.05);
                            setDialedNumber((prev) => prev + digit);
                          }}
                          className="h-13 rounded-2xl bg-[#0b141a] hover:bg-slate-800 border border-slate-800/80 text-lg font-semibold text-white active:scale-95 transition-transform tabular-nums"
                        >
                          {digit}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => startCall(dialedNumber, dialedNumber, dialedNumber)}
                      className="w-full h-13 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2"
                    >
                      <Phone className="w-5 h-5" />
                      <span>Call</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* BOTTOM TAB 2: VOICE ROOMS (Clean list showing Room Name, Topic & Active Users without inline rules bar) */}
            {activeBottomTab === 'rooms' && (
              <div className="space-y-4">
                {/* Horizontal Topic Filter Bar */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                  {TOPICS.map((topic) => (
                    <button
                      key={topic}
                      onClick={() => setSelectedTopic(topic)}
                      className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        selectedTopic === topic
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'bg-[#111b21] text-slate-300 border border-slate-800'
                      }`}
                    >
                      {topic}
                    </button>
                  ))}
                </div>

                {/* Voice Rooms List: Only Room Name, Topic, Active Users, and Join Action */}
                <div className="space-y-3">
                  {visibleRooms.map((room) => (
                    <div
                      key={room.id}
                      className="p-4 rounded-2xl bg-[#111b21] border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 tabular-nums">
                          <span className="text-sky-400 font-medium truncate">{room.topic}</span>
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
                        <h2 className="text-base font-bold text-white leading-snug truncate">
                          {room.title}
                        </h2>
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          Host: <span className="text-slate-300">{room.hostName}</span>
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
                            className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-800 text-xs font-medium text-sky-300 flex items-center gap-1"
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
              </div>
            )}
          </>
        )}
      </main>

      {/* FLOATING CALLS SUB-NAVIGATION BAR ABOVE FOOTER (Call Logs | Contacts | Dialer) */}
      {activeBottomTab === 'calls' && !activeJoinedRoom && (
        <div className="fixed bottom-19 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto bg-[#111b21]/95 backdrop-blur-md border border-slate-700/80 shadow-xl rounded-2xl p-1 flex items-center gap-1">
            <button
              onClick={() => setCallsSubTab('logs')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                callsSubTab === 'logs'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Call Logs
            </button>
            <button
              onClick={() => setCallsSubTab('contacts')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                callsSubTab === 'contacts'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Contacts
            </button>
            <button
              onClick={() => setCallsSubTab('dialer')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                callsSubTab === 'dialer'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Dialer
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Create Voice Room (Public or Private) */}
      {showCreateRoomModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateRoom}
            className="bg-[#111b21] border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4"
          >
            <h3 className="text-lg font-bold text-white">Create Voice Room</h3>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Voice Room Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Daily Exam Strategy & Doubt Solving"
                value={newRoomTitle}
                onChange={(e) => setNewRoomTitle(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#0b141a] border border-slate-800 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Room Topic
              </label>
              <select
                value={newRoomTopic}
                onChange={(e) => setNewRoomTopic(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#0b141a] border border-slate-800 text-sm text-white"
              >
                {TOPICS.filter((t) => t !== 'All').map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Room Privacy
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewRoomVisibility('public')}
                  className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 ${
                    newRoomVisibility === 'public'
                      ? 'bg-sky-500/20 border-sky-500 text-sky-300'
                      : 'bg-[#0b141a] border-slate-800 text-slate-400'
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
                      ? 'bg-sky-500/20 border-sky-500 text-sky-300'
                      : 'bg-[#0b141a] border-slate-800 text-slate-400'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Private (Invite Link)</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Room Rules (One per line)
              </label>
              <textarea
                rows={3}
                value={newRoomRulesText}
                onChange={(e) => setNewRoomRulesText(e.target.value)}
                className="w-full p-3 rounded-xl bg-[#0b141a] border border-slate-800 text-xs text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateRoomModal(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
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

      {/* MODAL: Join Private Room via Invite Link / Code */}
      {showJoinByLinkModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleJoinByInviteLink}
            className="bg-[#111b21] border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4"
          >
            <h3 className="text-base font-bold text-white">Join Private Voice Room</h3>
            <p className="text-xs text-slate-400">
              Paste the invite link or room code shared by the room creator:
            </p>
            <input
              type="text"
              required
              placeholder="Paste invite link or code..."
              value={inviteLinkInput}
              onChange={(e) => setInviteLinkInput(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-[#0b141a] border border-slate-800 text-xs text-white"
            />
            {inviteError && <p className="text-xs text-rose-400">{inviteError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowJoinByLinkModal(false);
                  setInviteError('');
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
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

      {/* MODAL: Room Rules Popup (Only when user clicks Rules inside room) */}
      {roomPreviewRules && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111b21] border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4">
            <div>
              <div className="text-xs text-sky-400 font-medium">{roomPreviewRules.topic}</div>
              <h3 className="text-base font-bold text-white mt-0.5">{roomPreviewRules.title}</h3>
            </div>
            <div className="space-y-1.5 p-3.5 rounded-xl bg-[#0b141a] border border-slate-800">
              {roomPreviewRules.rules.map((r, i) => (
                <div key={i} className="text-xs text-slate-300">
                  {i + 1}. {r}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRoomPreviewRules(null)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
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
          <div className="bg-[#111b21] border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-white">Edit Topic & Rules</h3>
            <input
              type="text"
              value={newRoomTopic}
              onChange={(e) => setNewRoomTopic(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#0b141a] border border-slate-800 text-xs text-white"
            />
            <textarea
              rows={4}
              value={newRoomRulesText}
              onChange={(e) => setNewRoomRulesText(e.target.value)}
              className="w-full p-3 rounded-xl bg-[#0b141a] border border-slate-800 text-xs text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowEditRulesModal(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
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

      {/* MODAL: Telegram Login / Registration (MTProto StringSession) */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={authStep === 'otp' ? handleVerifyOtp : handleSendOtp}
            className="bg-[#111b21] border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4"
          >
            <h3 className="text-base font-bold text-white">Telegram Login</h3>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Your Name</label>
              <input
                type="text"
                required
                placeholder="Enter your name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#0b141a] border border-slate-800 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Phone Number</label>
              <input
                type="tel"
                required
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#0b141a] border border-slate-800 text-xs text-white font-mono"
              />
            </div>

            {authStep === 'otp' && (
              <div>
                <label className="block text-xs text-sky-400 mb-1">Telegram Verification Code</label>
                <input
                  type="text"
                  required
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#0b141a] border border-sky-500 text-xs text-white font-mono tracking-widest"
                />
              </div>
            )}

            {authError && <p className="text-xs text-rose-400">{authError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={authLoading}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold"
              >
                {authLoading
                  ? 'Please wait...'
                  : authStep === 'otp'
                  ? 'Verify & Login'
                  : 'Send Code'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FULL-SCREEN OVERLAY: 1-ON-1 E2EE VOICE CALL */}
      {activeCall && (
        <div className="fixed inset-0 z-50 bg-[#0b141a] flex flex-col justify-between p-6">
          <div className="max-w-sm w-full mx-auto flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Lock className="w-3.5 h-3.5" />
              <span>End-to-End Encrypted</span>
            </div>
            <span className="tabular-nums">{formatDuration(callSeconds)}</span>
          </div>

          <div className="max-w-sm w-full mx-auto text-center space-y-5 my-auto">
            <div className="w-24 h-24 rounded-full bg-sky-500/20 border-2 border-sky-400/50 text-sky-300 flex items-center justify-center font-bold text-3xl mx-auto">
              {activeCall.contactName.slice(0, 2).toUpperCase()}
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white">{activeCall.contactName}</h2>
              <p className="text-xs text-slate-400 mt-1">{activeCall.phone}</p>
            </div>

            <div className="p-4 rounded-2xl bg-[#111b21] border border-slate-800 max-w-xs mx-auto">
              <div className="text-2xl tracking-widest space-x-3 mb-1">
                {activeCall.emojis.map((em, i) => (
                  <span key={i}>{em}</span>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">
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
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-[#111b21] text-slate-200 border border-slate-800'
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
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'bg-[#111b21] text-slate-200 border border-slate-800'
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

      {/* STRICTLY 2 BOTTOM NAVIGATION BARS: Calls & Voice Rooms */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 h-16 max-w-2xl mx-auto bg-[#111b21]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-2 items-center">
        <button
          onClick={() => setActiveBottomTab('calls')}
          className={`h-full flex flex-col items-center justify-center transition-colors ${
            activeBottomTab === 'calls' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Phone className="w-5 h-5" />
          <span className="text-xs font-semibold mt-1">Calls</span>
        </button>

        <button
          onClick={() => setActiveBottomTab('rooms')}
          className={`h-full flex flex-col items-center justify-center transition-colors ${
            activeBottomTab === 'rooms' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-5 h-5" />
          <span className="text-xs font-semibold mt-1">Voice Rooms</span>
        </button>
      </nav>
    </div>
  );
}
