const fs = require('fs');
const os = require('os');
const path = require('path');

// Session snapshot persistence.
//
// The sessions Map is already plain JSON, so this is a snapshot file, not a
// database: the state is small (a few MB at 20 boats), it is written at most
// once every 30 s, and losing the last few seconds of it costs nothing — the
// boat phone holds the authoritative track and re-pushes what matters.
//
// What this buys is that a restart (a deploy, a Fly host migration, an OOM,
// a failed healthcheck) stops being an event: remote monitors reconnect to a
// populated map instead of a dead session code.
//
// Kept in its own module so the round-trip can be unit-tested without
// starting a server.

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_FILE = 'sessions.json';

// Same cap the live server enforces; re-applied on load so a hand-edited or
// older snapshot cannot reintroduce an unbounded track.
const TRACK_MAX_POINTS = 3000;

// Where the snapshot lives. `/data` is the Fly volume mount; locally there
// is no volume, so fall back to the temp dir and let development run with
// no setup at all.
function resolveDataDir(env = process.env) {
  if (env.DATA_DIR) return env.DATA_DIR;
  try {
    if (fs.existsSync('/data') && fs.statSync('/data').isDirectory()) return '/data';
  } catch (err) {
    // Not mounted, or not readable — fall through.
  }
  return path.join(os.tmpdir(), 'anchor-alarm');
}

const snapshotPath = (dir) => path.join(dir, SNAPSHOT_FILE);

const isFinitePair = (p) =>
  Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

const isFiniteTriple = (p) =>
  Array.isArray(p) &&
  p.length === 3 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Number.isFinite(p[2]);

const isValidAnchor = (a) =>
  a &&
  typeof a === 'object' &&
  Number.isFinite(a.latitude) &&
  Number.isFinite(a.longitude) &&
  Math.abs(a.latitude) <= 90 &&
  Math.abs(a.longitude) <= 180;

// The wire format. `locations` is deliberately NOT written: it is keyed by
// device IDs whose sockets die with the process, and restoring it would show
// remote monitors phantom boats that never move.
function serializeSessions(sessions, now = Date.now()) {
  const out = {};
  for (const [sessionId, session] of sessions.entries()) {
    out[sessionId] = {
      zone: Array.isArray(session.zone) ? session.zone : [],
      alarmed: !!session.alarmed,
      acknowledged: !!session.acknowledged,
      anchor: isValidAnchor(session.anchor) ? session.anchor : null,
      track: Array.isArray(session.track) ? session.track : [],
      createdAt: Number.isFinite(session.createdAt) ? session.createdAt : now,
      lastActivity: Number.isFinite(session.lastActivity) ? session.lastActivity : now
    };
  }
  return JSON.stringify({ version: SNAPSHOT_VERSION, savedAt: now, sessions: out });
}

// Parse a snapshot back into a sessions Map. Never throws: a missing, empty,
// truncated or hand-corrupted file must start the server clean, not stop it
// booting — an anchor alarm backend that refuses to start is worse than one
// that forgot last night's sessions.
//
// Returns { sessions, dropped, error }.
function parseSnapshot(raw, { now = Date.now(), idleTtlMs = Infinity } = {}) {
  const sessions = new Map();
  if (!raw || !raw.trim()) return { sessions, dropped: 0, error: null };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { sessions, dropped: 0, error: `unparseable JSON (${err.message})` };
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.sessions || typeof parsed.sessions !== 'object') {
    return { sessions, dropped: 0, error: 'unexpected snapshot shape' };
  }

  let dropped = 0;
  for (const [sessionId, value] of Object.entries(parsed.sessions)) {
    if (!sessionId || !value || typeof value !== 'object') {
      dropped++;
      continue;
    }

    const lastActivity = Number.isFinite(value.lastActivity) ? value.lastActivity : now;
    // Sessions already past the idle TTL when we boot were going to be
    // swept anyway — don't resurrect them for one sweep interval.
    if (now - lastActivity > idleTtlMs) {
      dropped++;
      continue;
    }

    sessions.set(sessionId, {
      zone: Array.isArray(value.zone) ? value.zone.filter(isFinitePair) : [],
      // Every live location belonged to a socket of the previous process.
      locations: {},
      deviceSockets: {},
      alarmed: !!value.alarmed,
      acknowledged: !!value.acknowledged,
      anchor: isValidAnchor(value.anchor) ? value.anchor : null,
      track: Array.isArray(value.track)
        ? value.track.filter(isFiniteTriple).slice(-TRACK_MAX_POINTS)
        : [],
      createdAt: Number.isFinite(value.createdAt) ? value.createdAt : lastActivity,
      lastActivity
    });
  }

  return { sessions, dropped, error: null };
}

// Atomic write: a full file to `sessions.json.tmp`, fsync, then rename.
// rename(2) is atomic within a filesystem, so a `kill -9` (or a Fly host
// yanking the machine) mid-write can leave a stale snapshot or a stray tmp
// file, but never a half-written `sessions.json` that fails to parse at boot.
function writeSnapshotSync(dir, sessions, now = Date.now()) {
  const target = snapshotPath(dir);
  const tmp = `${target}.tmp`;

  fs.mkdirSync(dir, { recursive: true });
  const payload = serializeSessions(sessions, now);

  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);

  return { path: target, bytes: Buffer.byteLength(payload), savedAt: now, count: sessions.size };
}

// Read and parse. Same contract as parseSnapshot: never throws.
function readSnapshotSync(dir, options = {}) {
  const target = snapshotPath(dir);
  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { sessions: new Map(), dropped: 0, error: null, missing: true };
    return { sessions: new Map(), dropped: 0, error: `unreadable (${err.message})`, missing: false };
  }
  return { ...parseSnapshot(raw, options), missing: false };
}

module.exports = {
  SNAPSHOT_FILE,
  SNAPSHOT_VERSION,
  TRACK_MAX_POINTS,
  parseSnapshot,
  readSnapshotSync,
  resolveDataDir,
  serializeSessions,
  snapshotPath,
  writeSnapshotSync
};
