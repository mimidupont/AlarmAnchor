const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Store active sessions: { sessionId: { zone, locations, alarmed, anchor } }
const sessions = new Map();

// Helper: Generate session ID (9 chars, unambiguous alphabet, crypto-random —
// Math.random().toString(36) could yield short IDs and is guessable)
const SESSION_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateSessionId = () => {
  const bytes = crypto.randomBytes(9);
  let id = '';
  for (const b of bytes) id += SESSION_ID_ALPHABET[b % SESSION_ID_ALPHABET.length];
  return id;
};

// Helper: mark a session as recently used (drives expiry)
const touchSession = (session) => {
  session.lastActivity = Date.now();
};

// Helper: minimal shape validation for client-supplied coordinates
const isValidLocation = (loc) =>
  loc &&
  Number.isFinite(loc.latitude) &&
  Number.isFinite(loc.longitude) &&
  Math.abs(loc.latitude) <= 90 &&
  Math.abs(loc.longitude) <= 180;

const isValidZone = (zone) =>
  Array.isArray(zone) &&
  zone.every(
    (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
  );

// Helper: Check if point is inside polygon using ray casting algorithm
const isPointInPolygon = (point, polygon) => {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
};

// Helper: Check if alarm should be triggered
const checkAlarm = (location, zone) => {
  if (!zone || zone.length < 3) return false; // Need at least 3 points for a polygon
  const latLng = [location.latitude, location.longitude];
  return !isPointInPolygon(latLng, zone);
};

// REST API: Create new session
app.post('/api/sessions', (req, res) => {
  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    zone: [],
    locations: {},
    alarmed: false,
    // Once acknowledged, the alarm stays silent until the boat re-enters
    // the zone (re-arming), instead of re-firing on every GPS fix.
    acknowledged: false,
    anchor: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  });

  res.json({ sessionId });
});

// REST API: Get session info
app.get('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    sessionId,
    zone: session.zone,
    locations: session.locations,
    alarmed: session.alarmed,
    anchor: session.anchor
  });
});

// Socket.io connections
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Join a session
  socket.on('join-session', (data) => {
    const { sessionId, role } = data; // role: 'main' or 'remote'
    const session = sessions.get(sessionId);

    if (!session) {
      socket.emit('error', 'Session not found');
      return;
    }

    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.role = role;
    touchSession(session);

    console.log(`Client ${socket.id} joined session ${sessionId} as ${role}`);

    // Send current state to new client
    socket.emit('state-update', {
      zone: session.zone,
      locations: session.locations,
      alarmed: session.alarmed,
      anchor: session.anchor
    });

    // Notify others in session
    io.to(sessionId).emit('client-joined', { clientId: socket.id, role });
  });

  // Update zone (from main app)
  socket.on('update-zone', (data) => {
    const { zone } = data;
    const session = sessions.get(socket.sessionId);

    if (session && isValidZone(zone)) {
      session.zone = zone;
      touchSession(session);
      io.to(socket.sessionId).emit('zone-updated', { zone });
    }
  });

  // Update anchor position (from main app). anchor is either
  // { latitude, longitude, accuracy, timestamp } or null to clear it.
  socket.on('update-anchor', (data) => {
    const { anchor } = data;
    const session = sessions.get(socket.sessionId);

    if (session && (anchor === null || isValidLocation(anchor))) {
      session.anchor = anchor;
      touchSession(session);
      io.to(socket.sessionId).emit('anchor-updated', { anchor });
    }
  });

  // Update location (from main app)
  socket.on('update-location', (data) => {
    const { location } = data;
    const session = sessions.get(socket.sessionId);

    if (!session || !isValidLocation(location)) return;

    session.locations[socket.id] = location;
    touchSession(session);

    // Check if alarm should trigger. An acknowledged alarm stays silent
    // while the boat remains outside; returning inside the zone re-arms it.
    const outsideZone = checkAlarm(location, session.zone);
    if (!outsideZone) session.acknowledged = false;

    const shouldAlarm = outsideZone && !session.acknowledged;
    const wasAlarmed = session.alarmed;

    session.alarmed = shouldAlarm;

    // Broadcast location update to all clients in session
    io.to(socket.sessionId).emit('location-updated', {
      clientId: socket.id,
      location,
      alarmed: shouldAlarm
    });

    // If alarm state changed, notify
    if (shouldAlarm !== wasAlarmed) {
      io.to(socket.sessionId).emit('alarm-status-changed', {
        alarmed: shouldAlarm,
        triggeredAt: new Date().toISOString()
      });
    }
  });

  // Acknowledge alarm (reset after notification)
  socket.on('acknowledge-alarm', () => {
    const session = sessions.get(socket.sessionId);
    if (session) {
      session.alarmed = false;
      session.acknowledged = true;
      touchSession(session);
      io.to(socket.sessionId).emit('alarm-acknowledged', { alarmed: false });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);

    if (socket.sessionId) {
      const session = sessions.get(socket.sessionId);
      if (session) {
        delete session.locations[socket.id];
      }

      io.to(socket.sessionId).emit('client-left', { clientId: socket.id });
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Cleanup idle sessions. Expiry is based on last activity, NOT creation
// time — the previous version deleted every session one hour after it was
// created, so an overnight anchor watch silently lost its session and the
// alarm could never fire again. A session anchored for days stays alive as
// long as location updates keep coming in.
const ONE_HOUR = 60 * 60 * 1000;
const SESSION_IDLE_TTL = 24 * ONE_HOUR;
setInterval(() => {
  const now = Date.now();

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_IDLE_TTL) {
      sessions.delete(sessionId);
      console.log(`Cleaned up idle session: ${sessionId}`);
    }
  }
}, ONE_HOUR);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Anchor Alarm server running on port ${PORT}`);
});
