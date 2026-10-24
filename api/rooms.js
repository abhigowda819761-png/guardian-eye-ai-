// api/rooms.js - Vercel Serverless Function for GuardianEye AI Room & PeerJS Registry
// Fully compatible with Vercel Serverless Node.js runtime and Next.js API routes

const rooms = global.__guardianeye_rooms || (global.__guardianeye_rooms = new Map());

export default async function handler(req, res) {
  // Enable permissive CORS for frontend Vite client and external devices
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method, query } = req;
  const body = req.body || {};
  const action = query.action || body.action;
  const code = (query.code || body.code || '').trim().toUpperCase();

  try {
    // 1. Create Room (Host)
    if (action === 'create' || action === 'create_meeting' || (method === 'POST' && !action && body.hostPeerId)) {
      const roomCode = code || (
        Math.random().toString(36).substring(2, 5).toUpperCase() + '-' +
        Math.random().toString(36).substring(2, 5).toUpperCase()
      );

      const room = {
        code: roomCode,
        topic: body.topic || 'Strategy Sync',
        hostPeerId: body.hostPeerId,
        hostName: body.hostName || 'Host',
        peers: body.hostPeerId ? [
          {
            id: body.hostPeerId,
            name: body.hostName || 'Host',
            role: 'host'
          }
        ] : [],
        maxMembers: 5,
        webrtcConfig: {
          iceTransportPolicy: 'all',
          iceCandidatePoolSize: 10,
          maxBitrateKbps: 500,
          codecs: ['H264', 'VP8'],
          audioPriority: 'high'
        },
        createdAt: Date.now()
      };

      rooms.set(roomCode, room);
      return res.status(200).json({ status: 'success', room });
    }

    // 2. Get Room Status & Active Peer List
    if (method === 'GET' || action === 'get') {
      if (!code || !rooms.has(code)) {
        return res.status(404).json({ error: 'Room not found. Please check meeting code.' });
      }
      const room = rooms.get(code);
      return res.status(200).json({
        status: 'success',
        code: room.code,
        topic: room.topic,
        hostPeerId: room.hostPeerId,
        hostName: room.hostName,
        peers: room.peers,
        webrtcConfig: room.webrtcConfig,
        participantCount: room.peers.length
      });
    }

    // 3. Register Participant Knock / Join
    if (action === 'join') {
      if (!code || !rooms.has(code)) {
        return res.status(404).json({ error: 'Room not found. Please check meeting code.' });
      }
      const room = rooms.get(code);

      // Max capacity enforcement: Up to 5 members total
      if (room.peers.length >= 5) {
        return res.status(403).json({ error: 'Room is at full capacity (Maximum 5 members allowed).' });
      }

      const { peerId, name } = body;
      if (!peerId) {
        return res.status(400).json({ error: 'peerId is required to join' });
      }

      const existingIndex = room.peers.findIndex(p => p.id === peerId);
      if (existingIndex === -1) {
        room.peers.push({
          id: peerId,
          name: name || 'Guest',
          role: 'participant'
        });
      }

      return res.status(200).json({
        status: 'success',
        room: {
          code: room.code,
          topic: room.topic,
          hostPeerId: room.hostPeerId,
          hostName: room.hostName,
          peers: room.peers
        }
      });
    }

    // 4. Leave / Unregister Peer
    if (action === 'leave') {
      if (rooms.has(code)) {
        const room = rooms.get(code);
        room.peers = room.peers.filter(p => p.id !== body.peerId);
        if (room.peers.length === 0) {
          rooms.delete(code);
        }
      }
      return res.status(200).json({ status: 'success' });
    }

    return res.status(400).json({ error: 'Invalid action or request format' });
  } catch (err) {
    console.error('[api/rooms] Error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
