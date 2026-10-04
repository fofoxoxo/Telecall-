import { Router, Request, Response } from 'express';
import { WebSocket } from 'ws';
import {
  mediasoupSfuEngine,
  OPUS_NETWORK_PROFILES,
  NetworkTier,
} from './sfuVoiceEngine';

export interface SignalingEnvelope {
  type: string;
  roomId?: string;
  peerId?: string;
  targetPeerId?: string;
  payload?: Record<string, any>;
}

/**
 * Step 5.3: WebSocket Signaling Gateway & Express SFU Controller
 * Handles WebRTC SDP Offer/Answer negotiation, ICE Candidate trickle,
 * Mediasoup SFU transport/producer/consumer lifecycle, mute states, and
 * real-time network telemetry adaptation (6–8 kbps 2G up to 48 kbps HD).
 */
export function handleSfuSignalingMessage(
  ws: WebSocket,
  data: SignalingEnvelope,
  broadcastToAll: (event: string, payload: unknown) => void
): boolean {
  const { type, payload = {} } = data;
  if (!type || !type.startsWith('sfu:')) {
    return false;
  }

  const roomId = String(payload.roomId || data.roomId || 'default-room');
  const peerId = String(payload.peerId || data.peerId || 'tg-peer');

  switch (type) {
    // 1. Peer joins SFU Room & requests Router RTP Capabilities
    case 'sfu:joinRoom': {
      const peerSession = mediasoupSfuEngine.joinPeer({
        roomId,
        peerId,
        displayName: String(payload.displayName || 'TeleCall User'),
        role: payload.role || 'listener',
        initialTier: payload.networkTier || '3g-low',
      });
      const routerSnapshot = mediasoupSfuEngine.getRoomSfuSnapshot(roomId);

      ws.send(
        JSON.stringify({
          event: 'sfu:routerRtpCapabilities',
          payload: {
            roomId,
            routerId: routerSnapshot.routerId,
            rtpCapabilities: routerSnapshot.rtpCapabilities,
            peerSession,
            existingProducers: routerSnapshot.producers,
          },
        })
      );

      broadcastToAll('sfu:peerJoined', { roomId, peerSession });
      return true;
    }

    // 2. Create WebRTC Send or Receive Transport on SFU
    case 'sfu:createWebRtcTransport': {
      const direction = payload.direction === 'recv' ? 'recv' : 'send';
      const transport = mediasoupSfuEngine.createWebRtcTransport(roomId, peerId, direction);
      ws.send(
        JSON.stringify({
          event: 'sfu:webRtcTransportCreated',
          payload: { roomId, transport },
        })
      );
      return true;
    }

    // 3. Connect DTLS parameters for WebRtcTransport
    case 'sfu:connectWebRtcTransport': {
      const connected = mediasoupSfuEngine.connectWebRtcTransport(
        roomId,
        String(payload.transportId)
      );
      ws.send(
        JSON.stringify({
          event: 'sfu:webRtcTransportConnected',
          payload: { roomId, transportId: payload.transportId, connected },
        })
      );
      return true;
    }

    // 4. Start Producing Opus Audio Stream
    case 'sfu:produceAudio': {
      const producer = mediasoupSfuEngine.createAudioProducer({
        roomId,
        peerId,
        transportId: String(payload.transportId),
        rtpParameters: payload.rtpParameters,
      });

      ws.send(
        JSON.stringify({
          event: 'sfu:producedAudio',
          payload: { roomId, producer },
        })
      );

      // Notify all room participants that a new speaker audio producer is live
      broadcastToAll('sfu:newProducer', { roomId, peerId, producer });
      return true;
    }

    // 5. Consume a Speaker's Audio Producer
    case 'sfu:consumeAudio': {
      const consumer = mediasoupSfuEngine.createAudioConsumer({
        roomId,
        consumerPeerId: peerId,
        producerId: String(payload.producerId),
        transportId: String(payload.transportId),
      });

      ws.send(
        JSON.stringify({
          event: 'sfu:consumedAudio',
          payload: { roomId, consumer },
        })
      );
      return true;
    }

    // 6. Exchange SDP Offer / Answer & Trickle ICE Candidates
    case 'sfu:sdpOffer':
    case 'sfu:sdpAnswer':
    case 'sfu:iceCandidate': {
      broadcastToAll(type, {
        roomId,
        fromPeerId: peerId,
        targetPeerId: payload.targetPeerId || data.targetPeerId,
        sdp: payload.sdp,
        candidate: payload.candidate,
      });
      return true;
    }

    // 7. Report Network Status (RTT, Packet Loss, Jitter) -> Dynamic Opus Bitrate Scaling
    case 'sfu:networkTelemetry': {
      const adaptation = mediasoupSfuEngine.adaptBitrateForNetwork({
        roomId,
        peerId,
        rttMs: Number(payload.rttMs ?? 45),
        packetLossPercent: Number(payload.packetLossPercent ?? 0),
        jitterMs: Number(payload.jitterMs ?? 10),
        forcedTier: payload.forcedTier as NetworkTier | undefined,
      });

      ws.send(
        JSON.stringify({
          event: 'sfu:bitrateAdapted',
          payload: { roomId, peerId, ...adaptation },
        })
      );
      return true;
    }

    // 8. Leave SFU Room
    case 'sfu:leaveRoom': {
      mediasoupSfuEngine.removePeer(roomId, peerId);
      broadcastToAll('sfu:peerLeft', { roomId, peerId });
      return true;
    }

    default:
      return false;
  }
}

/**
 * Express HTTP Endpoints for SFU Inspection, Opus Profiles, & Bitrate Adaptation (`/api/sfu/*`)
 */
export function createSfuRouter(): Router {
  const router = Router();

  // 1. Get all Opus Codec Network Profiles (6-8 kbps 2G up to 48 kbps HD) & PLC/Jitter settings
  router.get('/profiles', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      profiles: OPUS_NETWORK_PROFILES,
    });
  });

  // 2. Get SFU Router RTP Capabilities & Active Peers/Producers for a Room
  router.get('/rooms/:roomId', (req: Request, res: Response) => {
    const snapshot = mediasoupSfuEngine.getRoomSfuSnapshot(req.params.roomId);
    res.json({
      ok: true,
      snapshot,
    });
  });

  // 3. Dynamically Adapt Opus Bitrate based on Network Conditions (2G/3G/4G/5G)
  router.post('/adapt-bitrate', (req: Request, res: Response) => {
    const { roomId, peerId, rttMs, packetLossPercent, jitterMs, forcedTier } = req.body;
    const result = mediasoupSfuEngine.adaptBitrateForNetwork({
      roomId: String(roomId || 'default-room'),
      peerId: String(peerId || 'tg-local-peer'),
      rttMs: Number(rttMs ?? 45),
      packetLossPercent: Number(packetLossPercent ?? 0),
      jitterMs: Number(jitterMs ?? 8),
      forcedTier: forcedTier as NetworkTier | undefined,
    });

    res.json({
      ok: true,
      ...result,
    });
  });

  return router;
}
