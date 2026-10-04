import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import crypto from 'crypto';

export interface VoiceParticipant {
  id: string;
  name: string;
  phone: string;
  role: 'host' | 'speaker' | 'listener';
  isMuted: boolean;
  handRaised: boolean;
  isSpeaking: boolean;
  joinedAt: string;
}

export interface VoiceRoom {
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

export interface SyncedContact {
  id: string;
  name: string;
  phone: string;
  username: string;
  online: boolean;
  lastSeen: string;
}

export interface CallLogEntry {
  id: string;
  contactName: string;
  phone: string;
  direction: 'outgoing' | 'incoming';
  durationSeconds: number;
  timestamp: string;
}

const voiceRooms = new Map<string, VoiceRoom>([
  [
    'room-upsc-101',
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
      createdAt: new Date(Date.now() - 45 * 60000).toISOString(),
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
          joinedAt: new Date(Date.now() - 45 * 60000).toISOString(),
        },
        {
          id: 'tg-spk-2',
          name: 'Priya Verma',
          phone: '+91 98114 22089',
          role: 'speaker',
          isMuted: false,
          handRaised: false,
          isSpeaking: false,
          joinedAt: new Date(Date.now() - 32 * 60000).toISOString(),
        },
        {
          id: 'tg-lst-4',
          name: 'Vikramaditya Singh',
          phone: '+91 99102 66771',
          role: 'listener',
          isMuted: true,
          handRaised: true,
          isSpeaking: false,
          joinedAt: new Date(Date.now() - 12 * 60000).toISOString(),
        },
      ],
    },
  ],
  [
    'room-tech-talk',
    {
      id: 'room-tech-talk',
      title: 'Android App Makers & Startup Founders Lounge',
      topic: 'Technology & Startups',
      visibility: 'public',
      inviteCode: 'tech2026',
      rules: [
        'Share practical product and coding experiences.',
        'Hindi and English both welcome.',
        'No spam links.'
      ],
      hostId: 'tg-host-2',
      hostName: 'Kabir Mehta',
      createdAt: new Date(Date.now() - 90 * 60000).toISOString(),
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
          joinedAt: new Date(Date.now() - 90 * 60000).toISOString(),
        },
        {
          id: 'tg-spk-6',
          name: 'Ananya Desai',
          phone: '+91 98230 99055',
          role: 'speaker',
          isMuted: false,
          handRaised: false,
          isSpeaking: false,
          joinedAt: new Date(Date.now() - 60 * 60000).toISOString(),
        },
      ],
    },
  ],
  [
    'room-music-jam',
    {
      id: 'room-music-jam',
      title: 'Midnight Acoustic Jam & Shayari Mehfil',
      topic: 'Music & Poetry',
      visibility: 'public',
      inviteCode: 'mehfil99',
      rules: [
        'Use earphones before coming on stage to prevent echo.',
        'Respect every artist performing on stage.'
      ],
      hostId: 'tg-host-3',
      hostName: 'Zoya Khan',
      createdAt: new Date(Date.now() - 25 * 60000).toISOString(),
      maxCapacity: 2000,
      lowBandwidthMode: false,
      listenerCount: 876,
      participants: [
        {
          id: 'tg-host-3',
          name: 'Zoya Khan',
          phone: '+91 98991 30264',
          role: 'host',
          isMuted: false,
          handRaised: false,
          isSpeaking: true,
          joinedAt: new Date(Date.now() - 25 * 60000).toISOString(),
        },
      ],
    },
  ],
]);

const defaultContacts: SyncedContact[] = [
  {
    id: 'contact-1',
    name: 'Aarav Sharma',
    phone: '+91 98201 44512',
    username: '@aarav_tg',
    online: true,
    lastSeen: 'Online',
  },
  {
    id: 'contact-2',
    name: 'Priya Verma',
    phone: '+91 98114 22089',
    username: '@priya_v',
    online: true,
    lastSeen: 'Online',
  },
  {
    id: 'contact-3',
    name: 'Kabir Mehta',
    phone: '+91 98765 11201',
    username: '@kabir_m',
    online: true,
    lastSeen: 'In Voice Room',
  },
  {
    id: 'contact-4',
    name: 'Rohan Nair',
    phone: '+91 97400 88344',
    username: '@rohannair',
    online: false,
    lastSeen: 'Last seen 14m ago',
  },
  {
    id: 'contact-5',
    name: 'Zoya Khan',
    phone: '+91 98991 30264',
    username: '@zoya_acoustic',
    online: true,
    lastSeen: 'Online',
  },
];

const callLogs: CallLogEntry[] = [
  {
    id: 'log-1',
    contactName: 'Aarav Sharma',
    phone: '+91 98201 44512',
    direction: 'outgoing',
    durationSeconds: 342,
    timestamp: 'Today, 9:40 PM',
  },
  {
    id: 'log-2',
    contactName: 'Zoya Khan',
    phone: '+91 98991 30264',
    direction: 'incoming',
    durationSeconds: 128,
    timestamp: 'Today, 7:15 PM',
  },
  {
    id: 'log-3',
    contactName: 'Priya Verma',
    phone: '+91 98114 22089',
    direction: 'outgoing',
    durationSeconds: 510,
    timestamp: 'Yesterday',
  },
];

const EMOJI_POOL = [
  '🔐', '🚀', '🦁', '🎸', '⚡', '💎', '🦅', '🌊',
  '🔥', '🪐', '🏔️', '🧭', '👑', '🐳', '🍀', '🎯',
  '🛡️', '🦊', '🌙', '☀️', '🍎', '🎲', '🚁', '⚓'
];

function computeDhEmojiFingerprint(callerId: string, calleeId: string, secretSalt: string): string[] {
  const sortedPair = [callerId, calleeId].sort().join(':') + ':' + secretSalt;
  const hash = crypto.createHash('sha256').update(sortedPair).digest();
  return [
    EMOJI_POOL[hash[0] % EMOJI_POOL.length],
    EMOJI_POOL[hash[4] % EMOJI_POOL.length],
    EMOJI_POOL[hash[8] % EMOJI_POOL.length],
    EMOJI_POOL[hash[12] % EMOJI_POOL.length],
  ];
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const clients = new Set<WebSocket>();

  function broadcast(event: string, payload: unknown) {
    const message = JSON.stringify({ event, payload });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.send(
      JSON.stringify({
        event: 'init',
        payload: {
          rooms: Array.from(voiceRooms.values()),
          contacts: defaultContacts,
          callLogs,
        },
      })
    );

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ event: 'pong', payload: { ts: data.payload?.ts, serverTs: Date.now() } }));
        } else if (data.type === 'mtproto:init_connection') {
          ws.send(
            JSON.stringify({
              event: 'mtproto:session_ack',
              payload: { dcId: data.payload?.dcId || 4, serverTime: Date.now() },
            })
          );
        } else if (data.type === 'webrtc:signal') {
          broadcast('webrtc:signal', data.payload);
        }
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  // 1. Telegram Auth Step 1: Send OTP Code (`auth.sendCode`)
  app.post('/api/auth/send-code', (req, res) => {
    const { phone, apiId, apiHash } = req.body;
    const effectiveApiId = apiId || process.env.TELEGRAM_API_ID || '28419022';
    const effectiveApiHash = apiHash || process.env.TELEGRAM_API_HASH || '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

    if (!phone || String(phone).trim().length < 7) {
      res.status(400).json({ error: 'Valid phone number is required.' });
      return;
    }

    const phoneCodeHash = crypto
      .createHmac('sha256', String(effectiveApiHash))
      .update(String(phone) + ':' + String(effectiveApiId))
      .digest('hex')
      .slice(0, 18);

    res.json({
      ok: true,
      phoneCodeHash,
    });
  });

  // 2. Telegram Auth Step 2: Verify Code & Sign In (`auth.signIn`)
  app.post('/api/auth/verify-code', (req, res) => {
    const { phone, code, phoneCodeHash, name } = req.body;
    if (!phone || !code || !phoneCodeHash) {
      res.status(400).json({ error: 'Phone number and verification code are required.' });
      return;
    }

    const userId = 'tg-user-' + crypto.createHash('md5').update(String(phone)).digest('hex').slice(0, 8);
    const authKeyHex = crypto.createHash('sha256').update(userId + ':' + phoneCodeHash).digest('hex');

    res.json({
      ok: true,
      authKeyHex,
      serverSalt: crypto.randomBytes(8).toString('hex'),
      user: {
        id: userId,
        name: name?.trim() || 'TeleCall User',
        phone: String(phone),
        username: '@' + (name?.trim()?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'telecall_user'),
      },
    });
  });

  // 3. Contacts Sync (`contacts.importContacts`)
  app.post('/api/contacts/sync', (req, res) => {
    const { customContacts } = req.body;
    if (Array.isArray(customContacts)) {
      for (const c of customContacts) {
        if (c.name && c.phone && !defaultContacts.some((d) => d.phone === c.phone)) {
          defaultContacts.unshift({
            id: 'contact-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            name: String(c.name).trim(),
            phone: String(c.phone).trim(),
            username: '@' + String(c.name).trim().toLowerCase().replace(/[^a-z0-9]/g, '_'),
            online: true,
            lastSeen: 'Online',
          });
        }
      }
    }
    broadcast('contacts:updated', defaultContacts);
    res.json({ ok: true, contacts: defaultContacts });
  });

  // 4. E2EE 1-on-1 Call Handshake & Call Log recording
  app.post('/api/call/handshake', (req, res) => {
    const { callerId, calleeId, contactName, phone } = req.body;
    const sessionId = 'call-' + Date.now().toString(36);
    const emojis = computeDhEmojiFingerprint(
      String(callerId || 'local'),
      String(calleeId || 'remote'),
      sessionId
    );

    if (contactName && phone) {
      const newLog: CallLogEntry = {
        id: 'log-' + Date.now(),
        contactName: String(contactName),
        phone: String(phone),
        direction: 'outgoing',
        durationSeconds: 0,
        timestamp: 'Just now',
      };
      callLogs.unshift(newLog);
      broadcast('calllogs:updated', callLogs);
    }

    res.json({
      ok: true,
      sessionId,
      emojis,
    });
  });

  // 5. Get / Search Voice Rooms (Public rooms + Private room by invite code)
  app.get('/api/rooms', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const invite = String(req.query.invite || '').trim().toLowerCase();
    const userId = String(req.query.userId || '');

    let list = Array.from(voiceRooms.values()).filter(
      (r) =>
        r.visibility === 'public' ||
        r.hostId === userId ||
        (invite && r.inviteCode.toLowerCase() === invite)
    );

    if (q) {
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.topic.toLowerCase().includes(q) ||
          r.inviteCode.toLowerCase() === q
      );
    }

    res.json({ ok: true, rooms: list });
  });

  // 6. Lookup Private or Public Room by Invite Code / Link
  app.post('/api/rooms/join-by-code', (req, res) => {
    const { code, userId, name, phone } = req.body;
    const cleanCode = String(code || '')
      .trim()
      .split('?room=')
      .pop()
      ?.trim()
      .toLowerCase();

    const found = Array.from(voiceRooms.values()).find(
      (r) => r.inviteCode.toLowerCase() === cleanCode || r.id.toLowerCase() === cleanCode
    );

    if (!found) {
      res.status(404).json({ error: 'Invalid or expired room invite link/code.' });
      return;
    }

    const existing = found.participants.find((p) => p.id === userId);
    if (!existing) {
      found.participants.push({
        id: String(userId),
        name: String(name || 'Listener'),
        phone: String(phone || ''),
        role: found.hostId === userId ? 'host' : 'listener',
        isMuted: found.hostId !== userId,
        handRaised: false,
        isSpeaking: false,
        joinedAt: new Date().toISOString(),
      });
      found.listenerCount += 1;
      broadcast('room:updated', found);
    }

    res.json({ ok: true, room: found });
  });

  // 7. Create a New Voice Room (Public or Private with Invite Link)
  app.post('/api/rooms', (req, res) => {
    const { title, topic, visibility, rules, hostId, hostName, hostPhone } = req.body;
    if (!title || !topic) {
      res.status(400).json({ error: 'Room title and topic are required.' });
      return;
    }

    const roomId = 'room-' + Date.now().toString(36);
    const inviteCode = crypto.randomBytes(3).toString('hex');
    const parsedRules: string[] =
      Array.isArray(rules) && rules.length > 0
        ? rules.map((r: string) => String(r).trim()).filter(Boolean)
        : [
            'Raise hand to speak on stage.',
            'Stay on topic and respect all participants.',
          ];

    const newRoom: VoiceRoom = {
      id: roomId,
      title: String(title).trim(),
      topic: String(topic).trim(),
      visibility: visibility === 'private' ? 'private' : 'public',
      inviteCode,
      rules: parsedRules,
      hostId: String(hostId || 'tg-local-host'),
      hostName: String(hostName || 'Host'),
      createdAt: new Date().toISOString(),
      maxCapacity: 5000,
      lowBandwidthMode: true,
      listenerCount: 1,
      participants: [
        {
          id: String(hostId || 'tg-local-host'),
          name: String(hostName || 'Host'),
          phone: String(hostPhone || ''),
          role: 'host',
          isMuted: false,
          handRaised: false,
          isSpeaking: true,
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    voiceRooms.set(roomId, newRoom);
    broadcast('room:created', newRoom);
    res.json({ ok: true, room: newRoom });
  });

  // 8. Join a Voice Room
  app.post('/api/rooms/:id/join', (req, res) => {
    const room = voiceRooms.get(req.params.id);
    if (!room) {
      res.status(404).json({ error: 'Voice room not found.' });
      return;
    }

    const { userId, name, phone } = req.body;
    const existing = room.participants.find((p) => p.id === userId);
    if (!existing) {
      room.participants.push({
        id: String(userId),
        name: String(name || 'Listener'),
        phone: String(phone || ''),
        role: room.hostId === userId ? 'host' : 'listener',
        isMuted: room.hostId !== userId,
        handRaised: false,
        isSpeaking: false,
        joinedAt: new Date().toISOString(),
      });
      room.listenerCount += 1;
      broadcast('room:updated', room);
    }

    res.json({ ok: true, room });
  });

  // 9. Update Participant State in Voice Room
  app.post('/api/rooms/:id/action', (req, res) => {
    const room = voiceRooms.get(req.params.id);
    if (!room) {
      res.status(404).json({ error: 'Voice room not found.' });
      return;
    }

    const { userId, action, targetUserId, newRules, newTopic } = req.body;
    const participant = room.participants.find((p) => p.id === (targetUserId || userId));

    if (action === 'toggle-mute' && participant) {
      participant.isMuted = !participant.isMuted;
      participant.isSpeaking = !participant.isMuted;
    } else if (action === 'toggle-hand' && participant) {
      participant.handRaised = !participant.handRaised;
    } else if (action === 'promote-speaker' && participant) {
      participant.role = 'speaker';
      participant.handRaised = false;
      participant.isMuted = false;
    } else if (action === 'move-to-listener' && participant) {
      participant.role = 'listener';
      participant.isMuted = true;
      participant.isSpeaking = false;
    } else if (action === 'update-rules' && Array.isArray(newRules)) {
      room.rules = newRules.map((r: string) => String(r).trim()).filter(Boolean);
      if (newTopic) {
        room.topic = String(newTopic).trim();
      }
    } else if (action === 'leave' && participant) {
      room.participants = room.participants.filter((p) => p.id !== userId);
      room.listenerCount = Math.max(1, room.listenerCount - 1);
    }

    broadcast('room:updated', room);
    res.json({ ok: true, room });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TeleCall server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
