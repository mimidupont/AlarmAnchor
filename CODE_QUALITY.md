# Code Quality & Architecture Documentation

## 🎯 Design Principles

This codebase follows professional software engineering practices to ensure:
- **Reliability**: Robust error handling and edge case management
- **Maintainability**: Clean, modular code structure
- **Performance**: Optimized algorithms and efficient data handling
- **Scalability**: Architecture that can grow without major rewrites

---

## 🏗️ Backend Architecture

### Geofencing Algorithm
```javascript
const isPointInPolygon = (point, polygon) => {
  // Ray casting algorithm
  // Time Complexity: O(n) where n = polygon vertices
  // Space Complexity: O(1)
  // Industry standard for point-in-polygon tests
}
```

**Why Ray Casting?**
- Most efficient for arbitrary polygons
- Handles concave polygons correctly
- Well-tested mathematical algorithm
- Works for any number of vertices

### Session Management
```javascript
const sessions = new Map();
// In-memory key-value store for MVP
// Production upgrade path: MongoDB/PostgreSQL
```

**Design Decisions:**
- `Map` chosen over object for O(1) lookups
- Swept hourly, but expiry is **24 h of inactivity** — expiring on age would
  delete an overnight anchor watch out from under a live alarm
- Snapshotted to `$DATA_DIR/sessions.json`, so the Map survives a restart
  (see `snapshot.js`)
- 9-character IDs, crypto-random from a 32-character unambiguous alphabet
  (no I/O/0/1): 32^9 ≈ 3.5 × 10^13 combinations, an unguessable bearer
  token — obscurity, not authentication

### Real-Time Synchronization
```javascript
io.to(sessionId).emit('location-updated', data);
```

**Why Socket.io?**
- Built-in room support for grouping clients
- Automatic reconnection handling
- Fallback to long-polling on restricted networks
- Event-driven architecture for clean separation

### Error Handling

**Server-side validation:**
```javascript
if (!zone || zone.length < 3) return false;
// Prevents invalid polygon calculations
```

**Socket error recovery:**
```javascript
socket.on('error', (error) => {
  console.error(`${tag(socket.sessionId, socket.deviceId)} socket error:`, error);
  // Logs but doesn't crash the server
});
```

**Process-level crash handling:** `uncaughtException` and
`unhandledRejection` log the stack, force-flush the session snapshot and
exit non-zero so Fly restarts cleanly — never swallow and continue with
state that may have been corrupted mid-throw.

**CORS restricted to known origins:**
```javascript
app.use(cors({ origin: corsOrigin })); // allowlist, override via ALLOWED_ORIGINS
```
Requests with no `Origin` header stay allowed: that is what the healthcheck
and native HTTP stacks send, and refusing them would break every APK.

---

## 🎨 Frontend Architecture

### Component Structure
```
App.jsx (State Management)
├── SessionManager (UI Layer)
├── Map (Map Layer with Drawing)
├── RemoteMonitor (Display Layer)
└── AlarmNotification (Notification Layer)
```

**Design Benefits:**
- Single source of truth (App.jsx state)
- Clear separation of concerns
- Each component has one responsibility
- Easy to test individual components

### State Management

```javascript
const [sessionId, setSessionId] = useState(null);
const [zone, setZone] = useState([]);
const [locations, setLocations] = useState({});
const [alarmed, setAlarmed] = useState(false);
```

**Why useState + Socket.io instead of Redux?**
- MVP doesn't need complex state
- Redux overhead not justified for current complexity
- Socket.io provides real-time updates naturally
- Can migrate to Redux/Context if needed later

### GPS Tracking

On a real device this is a **foreground service**, not the browser
geolocation API — Android stops delivering `watchPosition` fixes once the
screen is off, which is precisely when an anchor watch matters:

```javascript
// @capacitor-community/background-geolocation — persistent notification
const id = await BackgroundGeolocation.addWatcher(
  { backgroundTitle, backgroundMessage, requestPermissions: true,
    stale: false, distanceFilter: 0 },
  (position, err) => { if (position) handleGpsFix(position); }
);
```

`@capacitor/geolocation` (`enableHighAccuracy: true`, `timeout: 10000`,
`maximumAge: 0`) is the fallback in a browser and if the watcher cannot
start.

**Configuration Choices:**
- Foreground service - keeps fixes coming with the screen off, all night
- `enableHighAccuracy: true` - trading battery for precision (safety critical)
- `maximumAge: 0` - always a fresh fix, never a cached one
- `distanceFilter: 0` - report every fix; thinning happens in `utils/track.js`

> Testers must grant location **"Allow all the time"**. On Android 11+ that
> cannot be granted from the first dialog — Settings → Apps → Anchor Alarm →
> Permissions → Location. Without it tracking stops with the screen.

### Map Implementation

**Leaflet chosen over Google Maps because:**
1. Free with OpenStreetMap
2. Lightweight (~40KB gzipped)
3. No API key required
4. Leaflet-Draw plugin for zone editing
5. Canvas rendering for performance

### Alarm System

**The alarm decision is local, on the boat phone.** Every GPS fix goes
through `handleGpsFix` in `App.jsx`, which calls the pure `decideAlarm()` in
`utils/alarm.js` before anything touches the network:

```javascript
// utils/alarm.js — no socket, no server state, no connection flag
const next = decideAlarm({
  latitude, longitude,
  zone: zoneRef.current,
  alarmed: alarmedRef.current,
  acknowledged: acknowledgedRef.current
});
if (next.fire) triggerAlarmSequence();
```

This is the property that makes the app safe: losing the internet at anchor
does not disable the alarm. It is covered by `utils/alarm.test.js`,
including a suite that runs with `fetch` throwing.

`triggerAlarmSequence()` then raises the alarm through Capacitor — a native
`LocalNotifications` entry on a high-importance channel with `alarm.mp3` and
`ongoing: true`, plus repeated `Haptics` impacts. Native notifications, not
the Web Notification API: this ships as an Android app and has to wake
someone asleep with the screen off.

### Event Handling

```javascript
socket.on('alarm-status-changed', (data) => {
  // Only ever a mirror. The boat phone has usually already decided locally
  // and fired; this stops a remote monitor from double-firing.
  const alreadyAlarmed = alarmedRef.current;
  setAlarmed(data.alarmed);
  if (data.alarmed && !alreadyAlarmed) triggerAlarmSequence();
});
```

**Who decides what:**
- The boat phone (`role: 'main'`) is the alarm and decides on its own GPS.
- The server runs the same check so **remote monitors** learn about an alarm
  they cannot see for themselves.
- Server messages never disarm the boat phone. `sessionErrorAction()` makes
  a lost session trigger recovery on `main` (mint a new session, re-push
  local state, keep tracking) and only sends a `remote` back to the picker.
- On the boat phone a server `state-update` may fill in zone/anchor it does
  not have, never overwrite what it does.

---

## 🔒 Security Architecture

### Current (MVP)
- No authentication
- Session ID as access token
- 9-char random ID provides obscurity (not security)

### Production Roadmap
```javascript
// Phase 1: Authentication
socket.handshake.auth.token

// Phase 2: Encryption
const crypto = require('crypto');
location.coordinates = encrypt(location.coordinates, userKey);

// Phase 3: Authorization
const canViewSession = checkPermission(userId, sessionId);
```

### CORS Security

```javascript
const ORIGINS = allowedOrigins.length ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;
// Vercel frontend + capacitor://localhost + http://localhost (webview scheme)
app.use(cors({ origin: corsOrigin }));
```

Override with the `ALLOWED_ORIGINS` env var rather than editing the list.
**Verify against a real APK before shipping** — a missing origin breaks
every native client at once. Rejections are logged (`[cors] rejected
origin …`).

### Abuse limits
- `express-rate-limit` on `POST /api/sessions`: 30 per IP per hour,
  deliberately loose because testers on one marina wifi share an IP
- `MAX_SESSIONS` 500, least-recently-active evicted before any 503
- 20 `join-session` attempts per socket per minute
- 256-vertex zone cap, 512 KB socket payload ceiling, 16 KB JSON body

---

## 📊 Performance Optimizations

### Backend

**Memory Efficiency:**
- Sessions expire after **24 h of inactivity**, not 1 h after creation — an
  earlier version deleted overnight anchor watches out from under the alarm
- Snapshotted to disk every 30 s (dirty-flag) and on SIGTERM, so a restart
  is not a data-loss event
- Hard cap of 500 sessions, least-recently-active evicted first
- No duplicate location storage
- Uses Map instead of Object (O(1) lookup)

**CPU Efficiency:**
- Geofencing: O(n) per check (n = polygon vertices, typically 10-50)
- Check only on location update (not constant)
- Socket.io only emits when state changes

**Network Efficiency:**
- Location updates: ~50 bytes per 10 seconds = 5 bytes/sec per device
- Zone updates: ~1KB once, then ~100 bytes if edited
- Alarm events: ~100 bytes when triggered

### Frontend

**Render Optimization:**
- Map re-renders only when zone/location changes
- Leaflet handles map rendering (canvas-based)
- useRef for non-state values (map instance, watch ID)

**DOM Efficiency:**
- CSS Grid for responsive layouts
- CSS animations for smooth transitions
- No unnecessary re-renders (proper useEffect dependencies)

---

## 🧪 Testing Strategy

### Manual Testing Checklist
- [ ] Backend startup without errors
- [ ] Socket.io connections establish
- [ ] Session creation generates unique ID
- [ ] Zone drawing doesn't crash
- [ ] Geofencing detects boundary correctly
- [ ] Alarm triggers at correct moment
- [ ] Multiple clients sync correctly
- [ ] Graceful handling of disconnections
- [ ] Error messages are helpful

### Automated Testing (Future)
```javascript
// Backend tests
describe('isPointInPolygon', () => {
  it('should detect point inside triangle');
  it('should detect point outside triangle');
  it('should handle edge cases');
});

// Frontend tests
describe('Map component', () => {
  it('should render without crashing');
  it('should handle GPS updates');
});
```

---

## 🚀 Deployment Considerations

### Backend Deployment

**Fly.io chosen because** (see `anchor-alarm-backend/DEPLOY_FLY.md`):
- One always-on `shared-cpu-1x` / 256 MB machine, no cold start — an alarm
  relay must not be waking up when the first fix arrives
- Native WebSocket support for Socket.io
- A volume mounted at `/data` for the session snapshot, in the same region

**Deliberately one machine.** Never `fly scale count 2`: sessions live in
that machine's memory and on its own volume, and a second machine would
receive joins for sessions it can neither find nor read.

**Scaling path** — none of this is needed at beta size (20 boats plus ~20
remote monitors is ~40 sockets and 2–4 messages/second):
```
Snapshot file (now)
    ↓  only past a few hundred concurrent sessions
Shared store (Redis) + Socket.io adapter, dropping the volume
    ↓
Authentication, then horizontal scaling
```

### Frontend Deployment

**Vercel.com chosen because:**
- Built for React
- Automatic code splitting
- CDN included
- Free tier supports unlimited sites

---

## 📈 Monitoring & Debugging

### Backend Logging
Every session-scoped line carries the session and device ID, so one boat's
night is reconstructable with a single grep of `fly logs`:
```javascript
console.log(`${tag(sessionId, deviceId)} joined as ${role} (socket ${socket.id})`);
// [session K7QM2XPWA][device 6f2c…] alarm RAISED at 43.08312,6.15794
```
Per-connect/disconnect chatter is at debug level (`LOG_LEVEL=debug`) so 40
flapping sockets cannot bury it. `GET /health` reports uptime, session
count, socket count and the last snapshot time.

**Production upgrade:**
```javascript
const winston = require('winston');
logger.info('User action', { userId, action, timestamp });
```

### Browser DevTools
1. **Network Tab**: Watch Socket.io messages
2. **Console**: Check for errors
3. **Application**: Inspect localStorage/cookies (future auth)
4. **Sources**: Debug JavaScript

---

## 🔄 Code Review Checklist

When modifying this code, ensure:

- [ ] No hardcoded values (use config)
- [ ] All errors caught with try-catch
- [ ] Null checks before object access
- [ ] Async operations handled correctly
- [ ] Memory leaks prevented (cleanup in useEffect)
- [ ] Event listeners removed on unmount
- [ ] No console.log in production code
- [ ] No sensitive data in logs
- [ ] Compatible with IE11+ (if required)

---

## 🎓 Learning Resources

**For contributors to understand this codebase:**

1. **Geofencing**: [Point-in-Polygon Algorithms](https://en.wikipedia.org/wiki/Point_in_polygon)
2. **Socket.io**: [Official Documentation](https://socket.io/docs/)
3. **Leaflet**: [Interactive Map Library](https://leafletjs.com/)
4. **React Hooks**: [React Official Docs](https://react.dev/reference/react)

---

## 🐛 Known Limitations & Improvements

### Current Limitations
1. **No authentication**: anyone with the session ID can watch. The 9-char
   ID from a 32-character alphabet is an unguessable bearer token (32^9),
   which is fine among friends and required to change before any public
   launch.
2. **Single server by design**: sessions live in one machine's memory and on
   its volume. Fine at beta size; horizontal scaling needs a shared store.
3. **Android only**: no iOS project in this repo.
4. **Session state is a snapshot, not a database**: up to 30 s of server
   state can be lost to a hard kill. The boat phone holds the authoritative
   track and re-pushes it, so this costs remote monitors detail, never the
   alarm.

### Done during beta hardening
- ✅ Snapshot persistence across restarts (`snapshot.js`, Fly volume)
- ✅ Boat phone never stops GPS on a server error; recovers the session
- ✅ Stable device IDs instead of `socket.id`
- ✅ Rate limiting, session cap, CORS allowlist, payload bounds
- ✅ Crash handlers and session-scoped logging
- ✅ Tests (Jest on the frontend, `node --test` on the backend)

### Still planned
1. Authentication before any public launch
2. Monitoring (Sentry) if 20 testers is not enough signal
3. CI/CD (GitHub Actions) running both test suites
4. iOS, if there is demand

---

## 📝 Summary

This codebase demonstrates:
- ✅ Production-ready error handling
- ✅ Efficient algorithms (Ray casting for geofencing)
- ✅ Clean component architecture
- ✅ Proper async/await patterns
- ✅ Graceful degradation
- ✅ Responsive design
- ✅ Real-time synchronization
- ✅ Clear separation of concerns

**It's built to be understood, maintained, and extended by other developers.**
