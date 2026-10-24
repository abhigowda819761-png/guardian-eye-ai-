// backend/peer_server.js - Lightweight Node.js PeerServer & Room Registry
// Fully compatible with both local execution and Vercel Serverless Node.js runtime

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 9000;

// Root / status endpoint for live verification
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'GuardianEye AI Signaling & Room Registry',
    version: '1.0.0',
    platform: process.env.VERCEL ? 'vercel-serverless' : 'node-standalone',
    timestamp: Date.now()
  });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'GuardianEye PeerServer', timestamp: Date.now() });
});

// In-memory User Registry (retained across warm serverless function invocations)
const users = global.__guardianeye_users || (global.__guardianeye_users = new Map([
  ['abhi@gmail.com', { password: 'Abhi@123', displayName: 'Abhishek', role: 'host' }]
]));

// Auth: Login Endpoint
app.post('/api/auth/login', (req, res) => {
  const { email, password, role } = req.body || {};
  const rawEmail = (email || '').trim().toLowerCase();
  const cleanEmail = rawEmail.includes('@') ? rawEmail : `${rawEmail}@gmail.com`;
  const pwd = (password || '').trim();

  if (!pwd) {
    return res.status(400).json({ detail: 'Password cannot be empty.' });
  }

  // Check if user already exists
  if (users.has(cleanEmail)) {
    const existing = users.get(cleanEmail);
    if (existing.password !== pwd) {
      return res.status(401).json({ detail: 'Invalid password. Please enter the correct password.' });
    }
    return res.json({
      status: 'success',
      message: 'Login successful',
      user: {
        email: cleanEmail,
        displayName: existing.displayName || cleanEmail.split('@')[0].toUpperCase(),
        role: existing.role || 'host'
      },
      token: `token_${cleanEmail}_authorized`
    });
  }

  // If first time with this Gmail ID, automatically register and log in
  const dispName = cleanEmail.split('@')[0].toUpperCase();
  const newUser = {
    password: pwd,
    displayName: dispName,
    role: role || 'host',
    createdAt: Date.now()
  };
  users.set(cleanEmail, newUser);

  return res.json({
    status: 'success',
    message: 'Account created and logged in successfully',
    user: {
      email: cleanEmail,
      displayName: dispName,
      role: newUser.role
    },
    token: `token_${cleanEmail}_authorized`
  });
});

// Auth: Register / Password Update Endpoint
app.post('/api/auth/register', (req, res) => {
  const { email, password, displayName, role } = req.body || {};
  const rawEmail = (email || '').trim().toLowerCase();
  const cleanEmail = rawEmail.includes('@') ? rawEmail : `${rawEmail}@gmail.com`;
  const pwd = (password || '').trim();

  if (pwd.length < 4) {
    return res.status(400).json({ detail: 'Password must be at least 4 characters long.' });
  }

  const existing = users.get(cleanEmail);
  const dispName = (displayName || '').trim() || (existing && existing.displayName) || cleanEmail.split('@')[0].toUpperCase();
  const newUser = {
    password: pwd,
    displayName: dispName,
    role: role || 'host',
    updatedAt: Date.now()
  };
  users.set(cleanEmail, newUser);

  return res.json({
    status: 'success',
    message: 'Registration and password setup successful',
    user: {
      email: cleanEmail,
      displayName: dispName,
      role: newUser.role
    },
    token: `token_${cleanEmail}_authorized`
  });
});

// In-memory Room & PeerJS Registry (retained across warm serverless function invocations)
const rooms = global.__guardianeye_rooms || (global.__guardianeye_rooms = new Map());

app.post('/api/rooms', (req, res) => {
  const { action, code, hostPeerId, hostName, peerId, name } = req.body || {};
  const roomCode = (code || '').trim().toUpperCase();

  if (action === 'create' || hostPeerId) {
    const finalCode = roomCode || (
      Math.random().toString(36).substring(2, 5).toUpperCase() + '-' +
      Math.random().toString(36).substring(2, 5).toUpperCase()
    );
    const room = {
      code: finalCode,
      topic: (req.body && req.body.topic) || 'Strategy Session',
      hostPeerId,
      hostName: hostName || 'Host',
      peers: hostPeerId ? [{ id: hostPeerId, name: hostName || 'Host', role: 'host' }] : [],
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
    rooms.set(finalCode, room);
    return res.json({ status: 'success', room });
  }

  if (action === 'join') {
    if (!rooms.has(roomCode)) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const room = rooms.get(roomCode);
    if (room.peers.length >= 5) {
      return res.status(403).json({ error: 'Room capacity reached (maximum 5 members allowed).' });
    }
    if (!room.peers.some(p => p.id === peerId)) {
      room.peers.push({ id: peerId, name: name || 'Guest', role: 'participant' });
    }
    return res.json({ status: 'success', room });
  }

  if (action === 'leave') {
    if (rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      room.peers = room.peers.filter(p => p.id !== peerId);
      if (room.peers.length === 0) rooms.delete(roomCode);
    }
    return res.json({ status: 'success' });
  }

  return res.status(400).json({ error: 'Invalid action' });
});

// Meetings API: Create Meeting
app.post('/api/meetings/create', (req, res) => {
  const { topic, hostEmail, hostName } = req.body || {};
  const roomCode = Math.random().toString(36).substring(2, 5).toUpperCase() + '-' +
                   Math.random().toString(36).substring(2, 5).toUpperCase();
  const room = {
    code: roomCode,
    topic: (topic || 'Strategy Session').trim(),
    hostEmail: hostEmail || 'host@guardianeye.local',
    hostName: hostName || 'Host',
    peers: [],
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
  return res.json({ status: 'success', room });
});

// Meetings API: Get Meeting by Code
app.get('/api/meetings/:code', (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  const room = rooms.get(code);
  return res.json({ status: 'success', room, participantCount: room.peers ? room.peers.length : 0 });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const room = rooms.get(code);
  return res.json({
    status: 'success',
    code: room.code,
    topic: room.topic,
    hostPeerId: room.hostPeerId,
    hostName: room.hostName,
    peers: room.peers,
    participantCount: room.peers.length
  });
});

app.get('/api/rooms', (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  if (code) {
    if (!rooms.has(code)) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const room = rooms.get(code);
    return res.json({
      status: 'success',
      code: room.code,
      topic: room.topic,
      hostPeerId: room.hostPeerId,
      hostName: room.hostName,
      peers: room.peers,
      participantCount: room.peers.length
    });
  }
  return res.json({ status: 'ok', activeRooms: rooms.size });
});

// Conditionally bind HTTP listener and ExpressPeerServer when running locally or outside Vercel serverless
if (!process.env.VERCEL) {
  try {
    const { ExpressPeerServer } = require('peer');
    const server = app.listen(PORT, () => {
      console.log(`[GuardianEye PeerServer] Active and listening on http://localhost:${PORT}/peerjs`);
    });

    const peerServer = ExpressPeerServer(server, {
      debug: false,
      path: '/'
    });

    app.use('/peerjs', peerServer);

    peerServer.on('connection', (client) => {
      console.log('[PeerServer] Client connected:', client.getId());
    });

    peerServer.on('disconnect', (client) => {
      console.log('[PeerServer] Client disconnected:', client.getId());
    });
  } catch (err) {
    console.warn('[PeerServer] PeerJS standalone server notice:', err.message);
  }
}

module.exports = app;
