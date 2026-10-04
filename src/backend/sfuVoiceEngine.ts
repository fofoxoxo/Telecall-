import crypto from 'crypto';

export type NetworkTier = '2g-ultra-low' | '3g-low' | '4g-standard' | '5g-wifi-hd';

export interface OpusCodecProfile {
  tier: NetworkTier;
  mimeType: 'audio/opus';
  clockRate: 48000;
  channels: 2;
  targetBitrateBps: number; // 6,000 bps (6 kbps) to 48,000 bps (48 kbps)
  minBitrateBps: number;
  maxBitrateBps: number;
  ptimeMs: 20 | 40 | 60; // Packetization interval (60ms reduces IP/UDP header overhead by 66% on 2G)
  useInbandFec: 1; // Forward Error Correction
  useDtx: 1; // Discontinuous Transmission (~0 kbps during silence)
  plcEnabled: boolean; // Packet Loss Concealment
  jitterBufferMinDelayMs: number;
  jitterBufferMaxPackets: number;
}

export const OPUS_NETWORK_PROFILES: Record<NetworkTier, OpusCodecProfile> = {
  '2g-ultra-low': {
    tier: '2g-ultra-low',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    targetBitrateBps: 6000, // 6 kbps ultra-low network
    minBitrateBps: 6000,
    maxBitrateBps: 8000, // 6-8 kbps ceiling
    ptimeMs: 60, // 60ms frame size for minimal packet overhead on 2G/Edge
    useInbandFec: 1,
    useDtx: 1,
    plcEnabled: true,
    jitterBufferMinDelayMs: 60,
    jitterBufferMaxPackets: 120,
  },
  '3g-low': {
    tier: '3g-low',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    targetBitrateBps: 12000, // 12 kbps
    minBitrateBps: 8000,
    maxBitrateBps: 16000,
    ptimeMs: 40,
    useInbandFec: 1,
    useDtx: 1,
    plcEnabled: true,
    jitterBufferMinDelayMs: 40,
    jitterBufferMaxPackets: 80,
  },
  '4g-standard': {
    tier: '4g-standard',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    targetBitrateBps: 24000, // 24 kbps
    minBitrateBps: 12000,
    maxBitrateBps: 32000,
    ptimeMs: 20,
    useInbandFec: 1,
    useDtx: 1,
    plcEnabled: true,
    jitterBufferMinDelayMs: 20,
    jitterBufferMaxPackets: 50,
  },
  '5g-wifi-hd': {
    tier: '5g-wifi-hd',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    targetBitrateBps: 48000, // 48 kbps Fullband HD Audio
    minBitrateBps: 24000,
    maxBitrateBps: 48000,
    ptimeMs: 20,
    useInbandFec: 1,
    useDtx: 1,
    plcEnabled: true,
    jitterBufferMinDelayMs: 15,
    jitterBufferMaxPackets: 40,
  },
};

export interface SfuTransportInfo {
  transportId: string;
  peerId: string;
  direction: 'send' | 'recv';
  iceParameters: {
    usernameFragment: string;
    password: string;
    iceLite: boolean;
  };
  iceCandidates: Array<{
    foundation: string;
    ip: string;
    port: number;
    priority: number;
    protocol: 'udp' | 'tcp';
    type: 'host';
  }>;
  dtlsParameters: {
    role: 'auto' | 'client' | 'server';
    fingerprints: Array<{ algorithm: string; value: string }>;
  };
  connected: boolean;
}

export interface SfuProducerInfo {
  producerId: string;
  peerId: string;
  transportId: string;
  kind: 'audio';
  rtpParameters: Record<string, unknown>;
  paused: boolean;
  currentBitrateBps: number;
  createdAt: number;
}

export interface SfuConsumerInfo {
  consumerId: string;
  producerId: string;
  peerId: string;
  transportId: string;
  kind: 'audio';
  rtpParameters: Record<string, unknown>;
  paused: boolean;
}

export interface SfuPeerSession {
  peerId: string;
  displayName: string;
  roomId: string;
  role: 'host' | 'speaker' | 'listener';
  muted: boolean;
  networkTier: NetworkTier;
  rttMs: number;
  packetLossPercent: number;
  jitterMs: number;
  activeProfile: OpusCodecProfile;
  joinedAt: number;
}

export interface SfuRoomRouter {
  routerId: string;
  roomId: string;
  workerPid: number;
  createdAt: number;
  rtpCapabilities: Record<string, unknown>;
  peers: Map<string, SfuPeerSession>;
  transports: Map<string, SfuTransportInfo>;
  producers: Map<string, SfuProducerInfo>;
  consumers: Map<string, SfuConsumerInfo>;
}

/**
 * Step 5.1, 5.2 & 5.4: Mediasoup-Compatible SFU Server Engine
 * Manages multi-party Voice Room SFU Routers, WebRtcTransports, Audio Producers/Consumers,
 * Opus RTP capabilities, Jitter Buffer / PLC parameters, and Dynamic Bitrate Adaptation
 * (scaling smoothly from 6–8 kbps on 2G up to 48 kbps HD on 5G/Wi-Fi).
 */
export class MediasoupSfuEngine {
  private routers = new Map<string, SfuRoomRouter>();
  private workerPoolPids = [4101, 4102, 4103, 4104];
  private workerRoundRobin = 0;

  /**
   * Build standard Mediasoup Router RTP Capabilities tuned for low-latency Opus Voice
   * with In-Band FEC (`useinbandfec=1`), DTX (`usedtx=1`), and Transport-Wide CC (`transport-cc`).
   */
  public buildRouterRtpCapabilities(tier: NetworkTier = '3g-low'): Record<string, unknown> {
    const profile = OPUS_NETWORK_PROFILES[tier];
    return {
      codecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          preferredPayloadType: 111,
          clockRate: 48000,
          channels: 2,
          parameters: {
            minptime: 10,
            ptime: profile.ptimeMs,
            maxptime: 60,
            useinbandfec: profile.useInbandFec,
            usedtx: profile.useDtx,
            maxaveragebitrate: profile.targetBitrateBps,
            cbr: 0,
            stereo: 0,
          },
          rtcpFeedback: [{ type: 'transport-cc' }, { type: 'nack' }],
        },
      ],
      headerExtensions: [
        {
          kind: 'audio',
          uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level',
          preferredId: 1,
          preferredEncrypt: false,
          direction: 'sendrecv',
        },
        {
          kind: 'audio',
          uri: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
          preferredId: 5,
          preferredEncrypt: false,
          direction: 'sendrecv',
        },
      ],
      fecAndPlcConfig: {
        packetLossConcealment: profile.plcEnabled,
        inbandFec: true,
        dtxSilenceSuppression: true,
        jitterBufferMinDelayMs: profile.jitterBufferMinDelayMs,
        jitterBufferMaxPackets: profile.jitterBufferMaxPackets,
      },
    };
  }

  /**
   * Get or create an SFU Router for a Voice Room or 1-on-1 Call Session
   */
  public getOrCreateRouter(roomId: string): SfuRoomRouter {
    const existing = this.routers.get(roomId);
    if (existing) return existing;

    const workerPid = this.workerPoolPids[this.workerRoundRobin % this.workerPoolPids.length];
    this.workerRoundRobin += 1;

    const router: SfuRoomRouter = {
      routerId: 'sfu-router-' + crypto.randomBytes(5).toString('hex'),
      roomId,
      workerPid,
      createdAt: Date.now(),
      rtpCapabilities: this.buildRouterRtpCapabilities('3g-low'),
      peers: new Map(),
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };

    this.routers.set(roomId, router);
    return router;
  }

  /**
   * Register or update a peer inside an SFU Room Router
   */
  public joinPeer(params: {
    roomId: string;
    peerId: string;
    displayName: string;
    role?: 'host' | 'speaker' | 'listener';
    initialTier?: NetworkTier;
  }): SfuPeerSession {
    const router = this.getOrCreateRouter(params.roomId);
    const tier = params.initialTier || '3g-low';
    const session: SfuPeerSession = {
      peerId: params.peerId,
      displayName: params.displayName,
      roomId: params.roomId,
      role: params.role || 'listener',
      muted: params.role === 'listener',
      networkTier: tier,
      rttMs: 42,
      packetLossPercent: 0,
      jitterMs: 8,
      activeProfile: OPUS_NETWORK_PROFILES[tier],
      joinedAt: Date.now(),
    };

    router.peers.set(params.peerId, session);
    return session;
  }

  /**
   * Create a Mediasoup WebRtcTransport (`send` or `recv`) with ICE Lite + DTLS fingerprints
   */
  public createWebRtcTransport(
    roomId: string,
    peerId: string,
    direction: 'send' | 'recv'
  ): SfuTransportInfo {
    const router = this.getOrCreateRouter(roomId);
    const transportId = `tr-${direction}-${crypto.randomBytes(6).toString('hex')}`;

    const rawFingerprint = crypto.randomBytes(32).toString('hex').toUpperCase();
    const formattedFingerprint = rawFingerprint.match(/.{1,2}/g)!.join(':');

    const transport: SfuTransportInfo = {
      transportId,
      peerId,
      direction,
      iceParameters: {
        usernameFragment: crypto.randomBytes(4).toString('hex'),
        password: crypto.randomBytes(12).toString('hex'),
        iceLite: true,
      },
      iceCandidates: [
        {
          foundation: 'udpcandidate',
          ip: '0.0.0.0',
          port: 40000 + (Math.floor(Math.random() * 9000) % 9000),
          priority: 1076302079,
          protocol: 'udp',
          type: 'host',
        },
      ],
      dtlsParameters: {
        role: 'auto',
        fingerprints: [
          {
            algorithm: 'sha-256',
            value: formattedFingerprint,
          },
        ],
      },
      connected: false,
    };

    router.transports.set(transportId, transport);
    return transport;
  }

  public connectWebRtcTransport(roomId: string, transportId: string): boolean {
    const router = this.routers.get(roomId);
    const transport = router?.transports.get(transportId);
    if (!transport) return false;
    transport.connected = true;
    return true;
  }

  /**
   * Create an Audio Producer on the SFU Router (for a Stage Speaker or 1-on-1 Caller)
   */
  public createAudioProducer(params: {
    roomId: string;
    peerId: string;
    transportId: string;
    rtpParameters?: Record<string, unknown>;
  }): SfuProducerInfo {
    const router = this.getOrCreateRouter(params.roomId);
    const peer = router.peers.get(params.peerId);
    const profile = peer?.activeProfile || OPUS_NETWORK_PROFILES['3g-low'];

    const producerId = 'prod-audio-' + crypto.randomBytes(6).toString('hex');
    const producer: SfuProducerInfo = {
      producerId,
      peerId: params.peerId,
      transportId: params.transportId,
      kind: 'audio',
      rtpParameters: params.rtpParameters || {
        codecs: [
          {
            mimeType: 'audio/opus',
            payloadType: 111,
            clockRate: 48000,
            channels: 2,
            parameters: {
              useinbandfec: 1,
              usedtx: 1,
              ptime: profile.ptimeMs,
              maxaveragebitrate: profile.targetBitrateBps,
            },
          },
        ],
      },
      paused: false,
      currentBitrateBps: profile.targetBitrateBps,
      createdAt: Date.now(),
    };

    router.producers.set(producerId, producer);
    return producer;
  }

  /**
   * Create an Audio Consumer on the SFU Router so a Listener can receive a Speaker's Opus stream
   */
  public createAudioConsumer(params: {
    roomId: string;
    consumerPeerId: string;
    producerId: string;
    transportId: string;
  }): SfuConsumerInfo | null {
    const router = this.routers.get(params.roomId);
    const producer = router?.producers.get(params.producerId);
    if (!router || !producer) return null;

    const consumerId = 'cons-audio-' + crypto.randomBytes(6).toString('hex');
    const consumer: SfuConsumerInfo = {
      consumerId,
      producerId: params.producerId,
      peerId: params.consumerPeerId,
      transportId: params.transportId,
      kind: 'audio',
      rtpParameters: producer.rtpParameters,
      paused: false,
    };

    router.consumers.set(consumerId, consumer);
    return consumer;
  }

  /**
   * Step 5.2 & 5.4: Dynamic Bitrate Adaptation & Network Telemetry Controller
   * Evaluates live RTT (ms), Packet Loss (%), and Jitter (ms) and scales Opus bitrate:
   * - High loss (>8%) or RTT > 350ms -> 2G Ultra-Low Mode (6-8 kbps, 60ms ptime, aggressive PLC/FEC)
   * - Moderate loss (3-8%) or RTT > 180ms -> 3G Low Mode (12 kbps, 40ms ptime)
   * - Normal 4G (loss < 3%, RTT < 180ms) -> 4G Standard Mode (24 kbps, 20ms ptime)
   * - Excellent 5G/Wi-Fi (loss < 0.5%, RTT < 55ms) -> 5G/Wi-Fi HD Mode (48 kbps, 20ms ptime)
   */
  public adaptBitrateForNetwork(params: {
    roomId: string;
    peerId: string;
    rttMs: number;
    packetLossPercent: number;
    jitterMs: number;
    forcedTier?: NetworkTier;
  }): {
    previousTier: NetworkTier;
    newTier: NetworkTier;
    profile: OpusCodecProfile;
    sdpFmtpLine: string;
  } {
    const router = this.getOrCreateRouter(params.roomId);
    let peer = router.peers.get(params.peerId);
    if (!peer) {
      peer = this.joinPeer({
        roomId: params.roomId,
        peerId: params.peerId,
        displayName: 'TeleCall Peer',
      });
    }

    const previousTier = peer.networkTier;
    let newTier: NetworkTier = params.forcedTier || '4g-standard';

    if (!params.forcedTier) {
      if (params.packetLossPercent >= 8 || params.rttMs >= 350 || params.jitterMs >= 60) {
        newTier = '2g-ultra-low';
      } else if (params.packetLossPercent >= 3 || params.rttMs >= 180 || params.jitterMs >= 30) {
        newTier = '3g-low';
      } else if (params.packetLossPercent < 0.5 && params.rttMs < 55 && params.jitterMs < 12) {
        newTier = '5g-wifi-hd';
      } else {
        newTier = '4g-standard';
      }
    }

    const profile = OPUS_NETWORK_PROFILES[newTier];
    peer.networkTier = newTier;
    peer.rttMs = params.rttMs;
    peer.packetLossPercent = params.packetLossPercent;
    peer.jitterMs = params.jitterMs;
    peer.activeProfile = profile;

    // Update any active audio producers owned by this peer
    for (const prod of router.producers.values()) {
      if (prod.peerId === params.peerId) {
        prod.currentBitrateBps = profile.targetBitrateBps;
      }
    }

    const sdpFmtpLine = `a=fmtp:111 minptime=10;ptime=${profile.ptimeMs};maxptime=60;useinbandfec=${profile.useInbandFec};usedtx=${profile.useDtx};maxaveragebitrate=${profile.targetBitrateBps}`;

    return {
      previousTier,
      newTier,
      profile,
      sdpFmtpLine,
    };
  }

  public removePeer(roomId: string, peerId: string): void {
    const router = this.routers.get(roomId);
    if (!router) return;
    router.peers.delete(peerId);

    for (const [id, tr] of router.transports.entries()) {
      if (tr.peerId === peerId) router.transports.delete(id);
    }
    for (const [id, prod] of router.producers.entries()) {
      if (prod.peerId === peerId) router.producers.delete(id);
    }
    for (const [id, cons] of router.consumers.entries()) {
      if (cons.peerId === peerId) router.consumers.delete(id);
    }
  }

  public getRoomSfuSnapshot(roomId: string) {
    const router = this.getOrCreateRouter(roomId);
    return {
      routerId: router.routerId,
      roomId: router.roomId,
      workerPid: router.workerPid,
      rtpCapabilities: router.rtpCapabilities,
      peersCount: router.peers.size,
      peers: Array.from(router.peers.values()),
      producers: Array.from(router.producers.values()),
      consumersCount: router.consumers.size,
    };
  }
}

export const mediasoupSfuEngine = new MediasoupSfuEngine();
