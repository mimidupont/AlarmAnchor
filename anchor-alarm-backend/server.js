const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

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

// Store active sessions: { sessionId: { zone, locations, alarmed } }
const sessions = new Map();

// Helper: Generate session ID
const generateSessionId = () => Math.random().toString(36).substr(2, 9).toUpperCase();

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
    createdAt: Date.now()
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
    alarmed: session.alarmed
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

    console.log(`Client ${socket.id} joined session ${sessionId} as ${role}`);

    // Send current state to new client
    socket.emit('state-update', {
      zone: session.zone,
      locations: session.locations,
      alarmed: session.alarmed
    });

    // Notify others in session
    io.to(sessionId).emit('client-joined', { clientId: socket.id, role });
  });

  // Update zone (from main app)
  socket.on('update-zone', (data) => {
    const { zone } = data;
    const session = sessions.get(socket.sessionId);

    if (session) {
      session.zone = zone;
      io.to(socket.sessionId).emit('zone-updated', { zone });
    }
  });

  // Update location (from main app)
  socket.on('update-location', (data) => {
    const { location } = data;
    const session = sessions.get(socket.sessionId);

    if (!session) return;

    session.locations[socket.id] = location;

    // Check if alarm should trigger
    const shouldAlarm = checkAlarm(location, session.zone);
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

// Cleanup old sessions every 1 hour
const oneHour = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.createdAt > oneHour) {
      sessions.delete(sessionId);
      console.log(`Cleaned up old session: ${sessionId}`);
    }
  }
}, oneHour);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Anchor Alarm server running on port ${PORT}`);
});
