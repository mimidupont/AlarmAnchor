const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { readSnapshotSync, resolveDataDir, writeSnapshotSync } = require('./snapshot');

const app = express();
const server = http.createServer(app);

// --- CORS -----------------------------------------------------------------
// The webview origin depends on capacitor.config.ts: androidScheme 'http'
// makes it http://localhost, and capacitor://localhost is what an
// https/native scheme build would send. Both are listed, because getting
// this wrong breaks every native client at once — VERIFY AGAINST A REAL APK
// before shipping, and override with ALLOWED_ORIGINS (comma-separated)
// rather than editing this list if a deployment moves.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://alarm-anchor.vercel.app', // hosted frontend / QR join links
  // Vercel gives every deployment its own hostname
  // (alarm-anchor-<hash>-<scope>.vercel.app) and only aliases the newest to
  // the bare name above. A tester who opens a preview link, or the site
  // before the alias moves, arrives from one of those and used to be
  // rejected — which presents exactly as "the remote monitor works in the
  // app but not in a browser", because the native client sends no Origin
  // header and so was never subject to this check at all.
  'https://alarm-anchor-*.vercel.app',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'http://localhost:3000' // react-scripts dev server
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const ORIGINS = allowedOrigins.length ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;

// Exact match, or a '*' standing in for exactly one hostname label. Kept
// deliberately narrow — '*' never crosses a dot or a slash, so
// 'https://alarm-anchor-*.vercel.app' cannot be stretched to match another
// project's deployment or a path on some other host.
const originMatches = (pattern, origin) => {
  if (pattern === origin) return true;
  if (!pattern.includes('*')) return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^./]*');
  return new RegExp(`^${escaped}$`).test(origin);
};

const corsOrigin = (origin, callback) => {
  // No Origin header at all: same-origin requests, curl, the Fly
  // healthcheck, and most native HTTP stacks. Refusing these would break
  // the APK, so they are allowed — the tightening here is about browsers.
  if (!origin) return callback(null, true);
  if (ORIGINS.some((pattern) => originMatches(pattern, origin))) return callback(null, true);
  // Reject by omitting the header rather than throwing: the browser blocks
  // the request and the server logs it, instead of returning a 500. Say
  // what the consequence is — a silent CORS rejection is otherwise
  // indistinguishable from the backend being down.
  console.warn(
    `[cors] rejected origin ${origin} — a browser loading the app from there cannot ` +
      `connect. Add it to ALLOWED_ORIGINS (comma-separated) if it is yours.`
  );
  return callback(null, false);
};

const io = socketIo(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  },
  // A full 3000-point track restore is ~120 KB; anything an order of
  // magnitude past that is not a client of ours.
  maxHttpBufferSize: 512 * 1024
});

// Behind the Fly proxy, so the real client IP is in X-Forwarded-For. One
// hop — never `true`, which would let a client spoof its own IP and walk
// straight through the rate limiter.
app.set('trust proxy', 1);

// Middleware
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '16kb' }));

// --- Logging --------------------------------------------------------------
// Twenty testers will report "it stopped working last night" with no
// reproduction, and `fly logs` is ephemeral. Every session-scoped line
// carries the session and device ID so one boat's night can be
// reconstructed with a single grep, and the per-connect chatter of 40
// flapping sockets is kept at debug so it cannot bury the useful lines.
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const DEBUG_ENABLED = LOG_LEVEL === 'debug';

const tag = (sessionId, deviceId) =>
  `[session ${sessionId || '-'}]${deviceId ? `[device ${deviceId}]` : ''}`;

const debug = (...args) => {
  if (DEBUG_ENABLED) console.log('[debug]', ...args);
};

// Store active sessions: { sessionId: { zone, locations, alarmed, anchor } }
const sessions = new Map();

const startedAt = Date.now();

// Expiry is based on last activity, NOT creation time — an earlier version
// deleted every session one hour after it was created, so an overnight
// anchor watch silently lost its session and the alarm could never fire
// again. A session anchored for days stays alive as long as location
// updates keep coming in.
const ONE_HOUR = 60 * 60 * 1000;
const SESSION_IDLE_TTL = 24 * ONE_HOUR;

// --- Snapshot persistence -------------------------------------------------
// Sessions live in memory, which used to mean "do not redeploy during a
// night at anchor". With 20 testers that is not a workable constraint, and
// restarts you don't control (host migration, healthcheck, OOM) happen
// anyway. The whole Map is snapshotted to disk on a dirty-flag timer and on
// shutdown, and read back at boot.
const DATA_DIR = resolveDataDir();
const SNAPSHOT_INTERVAL_MS = 30 * 1000;
let snapshotDirty = false;
let lastSnapshotAt = null;

const markDirty = () => {
  snapshotDirty = true;
};

// `force` is for shutdown: write even if nothing changed since the last
// timer tick, so the file always reflects the process's final state.
const writeSnapshot = ({ force = false, reason = 'timer' } = {}) => {
  if (!snapshotDirty && !force) return null;
  try {
    const result = writeSnapshotSync(DATA_DIR, sessions);
    snapshotDirty = false;
    lastSnapshotAt = result.savedAt;
    console.log(
      `[snapshot] wrote ${result.count} session(s), ${result.bytes} bytes (${reason})`
    );
    return result;
  } catch (err) {
    // A failed snapshot must never take the server down: the live sessions
    // in memory are still serving every armed alarm.
    console.error(`[snapshot] write failed (${reason}):`, err.message);
    return null;
  }
};

const restoreSnapshot = () => {
  const { sessions: restored, dropped, error, missing } = readSnapshotSync(DATA_DIR, {
    idleTtlMs: SESSION_IDLE_TTL
  });

  if (error) {
    console.warn(`[snapshot] ignoring ${DATA_DIR}: ${error} — starting clean`);
    return;
  }
  if (missing) {
    console.log(`[snapshot] no snapshot in ${DATA_DIR} — starting clean`);
    return;
  }

  for (const [sessionId, session] of restored.entries()) {
    sessions.set(sessionId, session);
  }
  console.log(
    `[snapshot] restored ${restored.size} session(s) from ${DATA_DIR}` +
      (dropped ? `, dropped ${dropped} expired/invalid` : '')
  );
};

// Helper: Generate session ID (9 chars, unambiguous alphabet, crypto-random —
// Math.random().toString(36) could yield short IDs and is guessable)
const SESSION_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateSessionId = () => {
  const bytes = crypto.randomBytes(9);
  let id = '';
  for (const b of bytes) id += SESSION_ID_ALPHABET[b % SESSION_ID_ALPHABET.length];
  return id;
};

// Track thinning. A raw watch can deliver a fix every second; keeping all
// of them is wasteful and renders as a fuzzy blob of GPS noise. Record a
// point when the boat has moved far enough OR enough time has passed — the
// time rule matters because a boat sitting still all night still needs
// points, or a calm followed by a drag looks like a two-point track.
const TRACK_MIN_MOVE_M = 2;
const TRACK_MIN_INTERVAL_MS = 15000;
// ~12 h at one point per 15 s. The track is the first structure in a
// session that grows with time, so the cap is enforced on push, never
// lazily.
const TRACK_MAX_POINTS = 3000;

// Same haversine as the client uses, kept local to avoid a dependency.
const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Points are flat [lat, lng, t] triples rather than objects: roughly a
// quarter of the heap per session, and smaller on the wire.
const shouldRecordTrackPoint = (track, lat, lng, t) => {
  if (track.length === 0) return true;
  const [pLat, pLng, pT] = track[track.length - 1];
  if (t - pT >= TRACK_MIN_INTERVAL_MS) return true;
  return haversineMeters(pLat, pLng, lat, lng) >= TRACK_MIN_MOVE_M;
};

// Helper: mark a session as recently used (drives expiry). Every mutating
// event goes through here, so it is also where the snapshot dirty flag is
// set — never write on the event itself, or a boat sending a fix a second
// would write the whole file a second.
const touchSession = (session) => {
  session.lastActivity = Date.now();
  markDirty();
};

// Helper: minimal shape validation for client-supplied coordinates
const isValidLocation = (loc) =>
  loc &&
  Number.isFinite(loc.latitude) &&
  Number.isFinite(loc.longitude) &&
  Math.abs(loc.latitude) <= 90 &&
  Math.abs(loc.longitude) <= 180;

// A client-supplied device ID. Anything unusable falls back to socket.id at
// the call site; anything oversized is rejected rather than truncated, so a
// hostile client cannot bloat the session map with near-identical keys.
const DEVICE_ID_MAX_LENGTH = 64;
const normalizeDeviceId = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > DEVICE_ID_MAX_LENGTH) return null;
  return trimmed;
};

// A hand-drawn zone is a handful of vertices and the circle editor emits
// 16; the cap only exists so a crafted payload cannot make every
// point-in-polygon check on every GPS fix expensive.
const MAX_ZONE_VERTICES = 256;

const isValidZone = (zone) =>
  Array.isArray(zone) &&
  zone.length <= MAX_ZONE_VERTICES &&
  zone.every(
    (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
  );

// Signed longitude difference wrapped into [-180, 180]. An anchor zone spans
// tens of metres, so two longitudes more than 180 degrees apart can only mean
// the 180th meridian lies between them. Must stay identical to
// lngDeltaDegrees in the client's utils/geo.js, or the boat phone and the
// server reach different verdicts about the same fix.
const lngDeltaDegrees = (lng, refLng) => {
  let d = (lng - refLng) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

// Helper: Check if point is inside polygon using ray casting algorithm.
// Longitudes are unwrapped around the polygon's first vertex first, so a
// zone straddling the antimeridian is tested as the small shape it is
// instead of one spanning 359.998 degrees (which inverts the verdict).
const isPointInPolygon = (point, polygon) => {
  if (!polygon || polygon.length < 3) return false;

  const [x, rawY] = point;
  const refLng = polygon[0][1];
  const y = refLng + lngDeltaDegrees(rawY, refLng);
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = refLng + lngDeltaDegrees(polygon[i][1], refLng);
    const xj = polygon[j][0];
    const yj = refLng + lngDeltaDegrees(polygon[j][1], refLng);

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

// --- Abuse limits ---------------------------------------------------------
// Not a realistic threat among friends, but POST /api/sessions is
// unauthenticated on a public URL and every tester's alarm now depends on
// this 256 MB machine staying up. Cheap insurance.

// Deliberately loose: testers behind one marina wifi or a CGNAT share an
// IP, and a boat phone re-mints a session on every backend restart
// (session recovery). Too tight here would break the honest case.
const sessionCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.SESSION_RATE_LIMIT) || 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sessions created from this address. Try again later.' }
});

const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 500;

// When the cap is reached, drop the session that has been idle longest
// before refusing anyone. An abandoned session from this morning is worth
// less than a boat trying to arm its alarm right now.
const evictLeastRecentlyActive = () => {
  let oldestId = null;
  let oldestAt = Infinity;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActivity < oldestAt) {
      oldestAt = session.lastActivity;
      oldestId = sessionId;
    }
  }
  if (oldestId) {
    sessions.delete(oldestId);
    markDirty();
    console.log(`[session ${oldestId}] evicted (cap ${MAX_SESSIONS} reached)`);
  }
  return oldestId;
};

// REST API: Create new session
app.post('/api/sessions', sessionCreateLimiter, (req, res) => {
  if (sessions.size >= MAX_SESSIONS) evictLeastRecentlyActive();
  if (sessions.size >= MAX_SESSIONS) {
    console.error(`[sessions] at capacity (${MAX_SESSIONS}), refusing to create`);
    return res.status(503).json({ error: 'Server at capacity. Try again shortly.' });
  }

  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    zone: [],
    // Live positions, keyed by stable device ID (see normalizeDeviceId).
    locations: {},
    // deviceId -> the socket.id currently representing it. Runtime only;
    // never snapshotted, since every socket dies with the process.
    deviceSockets: {},
    alarmed: false,
    // Once acknowledged, the alarm stays silent until the boat re-enters
    // the zone (re-arming), instead of re-firing on every GPS fix.
    acknowledged: false,
    anchor: null,
    track: [],
    createdAt: Date.now(),
    lastActivity: Date.now()
  });
  markDirty();

  // The client flags a recovery mint (the boat phone's session was lost to
  // a restart) so the two are distinguishable in a post-mortem.
  const recovered = req.query && req.query.recovery === '1';
  console.log(`${tag(sessionId)} created${recovered ? ' (session recovery)' : ''}`);

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

// Per-socket join budget — see the join-session handler.
const JOIN_ATTEMPT_LIMIT = 20;
const JOIN_ATTEMPT_WINDOW_MS = 60 * 1000;

const withinJoinBudget = (socket) => {
  const now = Date.now();
  if (!socket.joinBudget || now - socket.joinBudget.windowStart > JOIN_ATTEMPT_WINDOW_MS) {
    socket.joinBudget = { windowStart: now, count: 0 };
  }
  socket.joinBudget.count += 1;
  return socket.joinBudget.count <= JOIN_ATTEMPT_LIMIT;
};

// Socket.io connections
io.on('connection', (socket) => {
  debug(`socket connected: ${socket.id}`);

  // Join a session
  socket.on('join-session', (data) => {
    // Throttle guessing attempts. The 32^9 keyspace makes brute force
    // impractical anyway, but an unbounded join loop is free CPU denial.
    // Counted per socket, and an honest client joins once per socket, so
    // this never touches a boat phone reconnecting all night.
    if (!withinJoinBudget(socket)) {
      socket.emit('error', 'Too many join attempts');
      return;
    }

    const { sessionId, role } = data || {}; // role: 'main' or 'remote'
    const session = sessions.get(sessionId);

    if (!session) {
      // Logged, because a rejected join was otherwise completely invisible:
      // a tester reports "Session not found" and `fly logs` has nothing to
      // compare against the code the boat phone actually minted. Truncated
      // and type-checked so a hostile or broken client cannot flood the log
      // with a megabyte of "session id".
      const attempted = typeof sessionId === 'string' ? sessionId.slice(0, 32) : '(invalid)';
      console.warn(
        `[session ${attempted || '-'}] join rejected as ${role || 'unknown'}: ` +
          `no such session (${sessions.size} live)`
      );
      socket.emit('error', 'Session not found');
      return;
    }

    // Identity outlives the socket. Falling back to socket.id keeps a
    // client from an older build working — it just gets the old
    // one-marker-per-reconnect behaviour until it updates.
    const deviceId = normalizeDeviceId(data && data.deviceId) || socket.id;

    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.role = role;
    socket.deviceId = deviceId;
    if (!session.deviceSockets) session.deviceSockets = {};
    // A reconnect (or a second tab) replaces the previous socket for this
    // device. The location entry is keyed by deviceId, so it carries over
    // untouched instead of turning into a second boat.
    session.deviceSockets[deviceId] = socket.id;
    touchSession(session);

    console.log(`${tag(sessionId, deviceId)} joined as ${role || 'unknown'} (socket ${socket.id})`);

    // Send current state to new client
    // The track ships with the join payload so a remote monitor opening at
    // 2 a.m. immediately sees the whole night, then appends from track-point.
    socket.emit('state-update', {
      zone: session.zone,
      locations: session.locations,
      alarmed: session.alarmed,
      anchor: session.anchor,
      track: session.track
    });

    // Notify others in session. clientId is kept alongside deviceId for one
    // release: testers will be running mixed builds during the beta.
    io.to(sessionId).emit('client-joined', { clientId: deviceId, deviceId, role });
  });

  // Update zone (from main app)
  socket.on('update-zone', (data) => {
    // `data || {}`, not `data`: an event emitted with no argument (or an
    // explicit null) would otherwise throw here, and nothing catches a
    // socket handler — it reaches the uncaughtException handler below,
    // which exits the process. One malformed client would take the relay
    // down for every boat on the machine.
    const { zone } = data || {};
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
    const { anchor, resetTrack } = data || {};
    const session = sessions.get(socket.sessionId);

    if (session && (anchor === null || isValidLocation(anchor))) {
      session.anchor = anchor;
      // The track is scoped to one anchoring: dropping or raising starts
      // fresh, but *moving* an existing anchor keeps the history, which is
      // why the client sends the flag rather than the server guessing.
      if (resetTrack) {
        session.track = [];
        io.to(socket.sessionId).emit('track-reset');
      }
      touchSession(session);
      io.to(socket.sessionId).emit('anchor-updated', { anchor });
    }
  });

  // Bulk-restore a track into a fresh session. Used by the boat phone's
  // session recovery: when the server has lost the session (a restart),
  // the phone mints a new one and re-pushes the night it recorded locally,
  // which is authoritative. Only ever accepted into an empty track, so a
  // stray client cannot overwrite a session's real history.
  socket.on('restore-track', (data) => {
    const session = sessions.get(socket.sessionId);
    if (!session || session.track.length > 0) return;
    if (!data || !Array.isArray(data.track)) return;

    const points = data.track
      .filter(
        (p) =>
          Array.isArray(p) &&
          p.length === 3 &&
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) &&
          Number.isFinite(p[2])
      )
      .slice(-TRACK_MAX_POINTS);

    if (points.length === 0) return;

    session.track = points;
    touchSession(session);
  });

  // Update location (from main app)
  socket.on('update-location', (data) => {
    const { location } = data || {};
    const session = sessions.get(socket.sessionId);

    if (!session || !isValidLocation(location)) return;

    // Keyed by device, not by socket: a reconnect updates the same entry
    // instead of adding a marker.
    const deviceId = socket.deviceId || socket.id;
    session.locations[deviceId] = location;
    touchSession(session);

    // Thin server-side rather than trusting the client to do it.
    const t = Date.parse(location.timestamp) || Date.now();
    if (shouldRecordTrackPoint(session.track, location.latitude, location.longitude, t)) {
      const point = [location.latitude, location.longitude, t];
      session.track.push(point);
      if (session.track.length > TRACK_MAX_POINTS) {
        session.track.splice(0, session.track.length - TRACK_MAX_POINTS);
      }
      io.to(socket.sessionId).emit('track-point', { point });
    }

    // Check if alarm should trigger. An acknowledged alarm stays silent
    // while the boat remains outside; returning inside the zone re-arms it.
    const outsideZone = checkAlarm(location, session.zone);
    if (!outsideZone) session.acknowledged = false;

    const shouldAlarm = outsideZone && !session.acknowledged;
    const wasAlarmed = session.alarmed;

    session.alarmed = shouldAlarm;

    // Broadcast location update to all clients in session. clientId still
    // carries the same value as deviceId for one release, so a remote
    // monitor on an older build keeps working during the beta.
    io.to(socket.sessionId).emit('location-updated', {
      clientId: deviceId,
      deviceId,
      location,
      alarmed: shouldAlarm
    });

    // If alarm state changed, notify
    if (shouldAlarm !== wasAlarmed) {
      console.log(
        `${tag(socket.sessionId, deviceId)} alarm ${shouldAlarm ? 'RAISED' : 'cleared'} ` +
          `at ${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`
      );
      io.to(socket.sessionId).emit('alarm-status-changed', {
        alarmed: shouldAlarm,
        triggeredAt: new Date().toISOString()
      });
    }
  });

  // End the session deliberately — the boat phone closing the watch.
  //
  // Distinct from a socket simply going away, which is indistinguishable
  // from a flat battery or a dead cellular link and must NOT tear the
  // session down. This is the explicit "we are done here" that lets remote
  // monitors say so instead of quietly showing a map that has stopped
  // moving — the reading that looks reassuring and is not.
  socket.on('end-session', () => {
    const sessionId = socket.sessionId;
    const session = sessions.get(sessionId);
    if (!session) return;

    // Only the boat phone owns the watch. A remote closing its tab must
    // never end monitoring for the boat or for anyone else watching.
    if (socket.role !== 'main') {
      console.warn(
        `${tag(sessionId, socket.deviceId)} ignored end-session from role ` +
          `${socket.role || 'unknown'} — only the boat phone may end a session`
      );
      return;
    }

    console.log(`${tag(sessionId, socket.deviceId)} session ended by the boat phone`);
    io.to(sessionId).emit('session-ended', { endedAt: new Date().toISOString() });
    sessions.delete(sessionId);
    markDirty();
  });

  // Acknowledge alarm (reset after notification)
  socket.on('acknowledge-alarm', () => {
    const session = sessions.get(socket.sessionId);
    if (session) {
      session.alarmed = false;
      session.acknowledged = true;
      touchSession(session);
      console.log(`${tag(socket.sessionId, socket.deviceId)} alarm acknowledged`);
      io.to(socket.sessionId).emit('alarm-acknowledged', { alarmed: false });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    debug(`socket disconnected: ${socket.id}`);

    if (!socket.sessionId) return;

    const session = sessions.get(socket.sessionId);
    const deviceId = socket.deviceId || socket.id;

    if (session) {
      // Only clear the entry if this socket is still the device's current
      // one. A flapping phone often reconnects before the old socket's
      // disconnect fires, and without this guard that late event would
      // delete the *fresh* position — the boat would vanish from every
      // remote monitor while it was in fact reporting fine.
      const current = session.deviceSockets && session.deviceSockets[deviceId];
      if (!current || current === socket.id) {
        delete session.locations[deviceId];
        if (session.deviceSockets) delete session.deviceSockets[deviceId];
        io.to(socket.sessionId).emit('client-left', { clientId: deviceId, deviceId });
      }
      return;
    }

    io.to(socket.sessionId).emit('client-left', { clientId: deviceId, deviceId });
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`${tag(socket.sessionId, socket.deviceId)} socket error:`, error);
  });
});

// Cleanup idle sessions (see SESSION_IDLE_TTL above).
setInterval(() => {
  const now = Date.now();

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_IDLE_TTL) {
      sessions.delete(sessionId);
      markDirty();
      console.log(`${tag(sessionId)} expired (idle > ${SESSION_IDLE_TTL / ONE_HOUR} h)`);
    }
  }
}, ONE_HOUR);

// Snapshot on a timer, not per event. Under a full night of 20 boats this
// is one write every 30 s regardless of GPS rate.
setInterval(() => writeSnapshot({ reason: 'timer' }), SNAPSHOT_INTERVAL_MS).unref();

// Flush synchronously on the way out. `fly deploy` sends SIGTERM, so a
// planned restart loses nothing at all.
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, flushing snapshot`);
  writeSnapshot({ force: true, reason: signal });
  server.close(() => process.exit(0));
  // Don't let a lingering websocket hold the process open past the
  // platform's grace period — the snapshot is already on disk.
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Health check. Doubles as the beta's one-line status page — a single curl
// answers "is it up, does it still have my session, and is it snapshotting".
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    sessions: sessions.size,
    sockets: io.engine.clientsCount,
    lastSnapshotAt: lastSnapshotAt ? new Date(lastSnapshotAt).toISOString() : null,
    dataDir: DATA_DIR,
    // The effective browser allowlist. `fly secrets list` shows only names
    // and digests, so this is the only way to confirm from outside that
    // ALLOWED_ORIGINS arrived intact — a shell that mangled it (Git Bash
    // rewrites `capacitor://localhost` into a Windows path) otherwise fails
    // silently, and only in browsers.
    allowedOrigins: ORIGINS,
    allowedOriginsSource: allowedOrigins.length ? 'ALLOWED_ORIGINS' : 'default'
  });
});

// --- Crash handling -------------------------------------------------------
// Never swallow and continue: a process that keeps serving alarms from
// state it corrupted mid-throw is worse than one that restarts. Log the
// stack, flush the snapshot so the restart resumes where this process left
// off, then exit non-zero and let Fly bring it back.
const crash = (kind, err) => {
  console.error(`[fatal] ${kind}:`, err && err.stack ? err.stack : err);
  try {
    writeSnapshot({ force: true, reason: kind });
  } catch (writeErr) {
    console.error('[fatal] snapshot flush also failed:', writeErr.message);
  }
  process.exit(1);
};

process.on('uncaughtException', (err) => crash('uncaughtException', err));
process.on('unhandledRejection', (reason) => crash('unhandledRejection', reason));

const PORT = process.env.PORT || 5000;
restoreSnapshot();
server.listen(PORT, () => {
  console.log(`Anchor Alarm server running on port ${PORT} (data dir: ${DATA_DIR})`);
  // Printed every boot so `fly logs` answers "did my ALLOWED_ORIGINS
  // actually apply, and is the browser origin in it?" without guesswork.
  console.log(
    `[cors] allowing ${ORIGINS.length} origin(s) from ` +
      `${allowedOrigins.length ? 'ALLOWED_ORIGINS' : 'the built-in default'}: ${ORIGINS.join(', ')}`
  );
});
