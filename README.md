# ⚓ Anchor Alarm — real-time boat anchor watch

Wakes you if your boat drags its anchor. The boat's phone watches its own GPS
against a zone you set around the anchor; anyone ashore can watch the same
session from a second phone or a browser.

Two roles, and they are not symmetric:

| | **Boat phone** (`main`) | **Remote monitor** (`remote`) |
| --- | --- | --- |
| Runs | the Android app | the app, or the hosted website |
| Owns | GPS, the zone, the alarm | nothing |
| Creates the session | yes | no |
| If it fails | the boat is unwatched | somebody ashore sees less |

**The alarm is decided on the boat phone, from its own GPS.** Losing the
internet at anchor degrades the remote monitoring and nothing else — the
alarm still fires. Everything else in this repo exists to serve that.

## 🎯 What it does

- **Anchor zone** — drop the anchor, pick a radius, or drag the vertices into
  a hand-drawn shape around a quay or a mooring.
- **Local alarm** — the boat phone evaluates every GPS fix against the zone
  itself. No server involved.
- **Alarm stream audio** — the alarm plays on Android's *alarm* stream, so a
  phone set to silent or vibrate still sounds it. Do Not Disturb can still
  suppress it unless alarms are allowed through; that is a device setting no
  app can override.
- **Foreground service** — GPS keeps running with the screen off and the app
  backgrounded.
- **Track** — the night's swing, capped at 3000 points, kept across
  reconnects and server restarts. The most diagnostic view there is when
  working out whether a 4 a.m. alarm was real.
- **Remote monitoring** — join by code or QR from another phone or a browser.
  Watchers are told when the boat goes quiet, and when the watch is ended
  deliberately.
- **Survives restarts** — sessions are snapshotted to disk, so a deploy or a
  host migration is not the end of the night's watch.

## 🚀 Running it locally

Node 20+ (the test runner and global `fetch` need 18 as a hard floor;
production runs Node 22).

```bash
# terminal 1 — backend on :5000
cd anchor-alarm-backend
npm install
npm start

# terminal 2 — frontend on :3000
cd anchor-alarm-frontend
npm install
npm start
```

Then open two browser windows: create a session in one, join it with the
code in the other, and move the boat with Chrome DevTools → Sensors →
Location.

> **Creating a session only works in a development build.** A production web
> build offers joining only — the hosted site is a remote monitor, because a
> browser tab has no foreground service, no background GPS and no alarm that
> survives a locked screen. The boat phone always runs the app. See
> `src/utils/platform.js`.

See [SETUP_AND_DEPLOYMENT.md](./SETUP_AND_DEPLOYMENT.md) for deployment and
[ANDROID_BUILD.md](./ANDROID_BUILD.md) / [DISTRIBUTION.md](./DISTRIBUTION.md)
for the APK.

## 🧪 Tests

```bash
cd anchor-alarm-backend  && npm test    # 81 tests
cd anchor-alarm-frontend && npm test    # 74 tests
```

The backend suite spawns real server processes rather than requiring the
module, because most of what it asserts — restart recovery, `kill -9`
mid-write, CORS, socket lifecycle — is only true across a process boundary.
It takes a few minutes.

```bash
cd anchor-alarm-backend
npm run test:unit         # snapshot serialisation only, fast
npm run test:integration  # the slow process-level ones
npm run load-sim -- --duration 2h    # 20 simulated boats, dev only
```

`scripts/load-sim.js` opens 20 sessions with 40 sockets, walks them around
and drives three outside their zones. It spawns its own server unless given
`--url`. **Never point it at a backend real testers are anchored on.**

## 📁 Layout

```
anchor-alarm-backend/          Node + Express + Socket.io relay
  server.js                    sessions, geofence, CORS, rate limits
  snapshot.js                  crash-safe session persistence
  server-harness.js            spawns real servers for the tests
  *.test.js                    snapshot, restart, abuse, CORS, geofence,
                               end-session, reconnect-sync
  scripts/load-sim.js          20-boat load simulation
  fly.toml, Dockerfile         deployment (single always-on machine)

anchor-alarm-frontend/         React 18 + Leaflet, and the Android app
  src/App.jsx                  session, GPS watcher, alarm, socket wiring
  src/components/              map, remote monitor, zone editor, dialogs
  src/utils/                   alarm decision, geo, track, platform, ids
  src/*.test.js, src/utils/*.test.js
  android/                     Capacitor project
    .../AlarmAudioPlugin.java  alarm-stream audio + vibration
  public/service-worker.js     a tombstone that unregisters itself
```

## 🏗️ How it fits together

```
     Boat phone (main)                       Remote monitor
  ┌────────────────────┐                 ┌────────────────────┐
  │ GPS watcher        │                 │ map + instruments  │
  │ zone + anchor      │                 │ alarm state        │
  │ ALARM DECISION ★   │                 │ (read only)        │
  └─────────┬──────────┘                 └─────────┬──────────┘
            │            Socket.io                 │
            └──────────────┐        ┌──────────────┘
                           ▼        ▼
                     ┌──────────────────┐
                     │ Backend (Fly.io) │
                     │ one machine      │
                     │ • relays state   │
                     │ • evaluates the  │
                     │   zone for the   │
                     │   watchers       │
                     │ • snapshots to   │
                     │   a volume       │
                     └──────────────────┘

★ The alarm is decided here, not on the server. The server runs the same
  point-in-polygon test so watchers see the right thing, but it is never
  what makes the boat phone sound.
```

Sessions live in memory and are snapshotted to a Fly volume every 30 s and on
shutdown, so a restart restores them. Idle sessions expire after 24 hours;
the sweep runs hourly. Writes are atomic — a `kill -9` mid-write leaves the
previous snapshot intact, never a truncated one.

## 🔌 The wire protocol

The events that carry meaning. The server also broadcasts the derived ones a
client just applies — `state-update`, `location-updated`, `zone-updated`,
`anchor-updated`, `track-point`, `track-reset`, `alarm-status-changed`,
`alarm-acknowledged`, `client-joined`, `client-left`.

| Event | From | Meaning |
| --- | --- | --- |
| `join-session` | both | join, and receive the current state |
| `update-location` | main | a GPS fix; the server thins it into the track |
| `update-zone` / `update-anchor` | main | the zone or anchor changed |
| `restore-track` | main | bulk-restore a locally held track |
| `acknowledge-alarm` | both | silence until the boat re-enters the zone |
| `end-session` | main only | the watch is over; session deleted |
| `boat-offline` / `boat-online` | server | the boat phone's socket dropped / came back |
| `session-ended` | server | the boat phone ended the watch |

The boat phone re-pushes its zone, anchor and track on **every** reconnect,
not just when the server has lost the session. It keeps working with no
network, so anything changed during an outage exists only on that phone
until it says so again.

HTTP is only `POST /api/sessions`, `GET /api/sessions/:id` and `GET /health`.
There is no route for `/` — a bare visit to the backend returning
`Cannot GET /` is Express answering, not a fault.

## ☁️ Deployment

- **Backend** → Fly.io, **one** always-on machine with a volume. Never scale
  past one: sessions live in that machine's memory and its own volume. See
  [`anchor-alarm-backend/DEPLOY_FLY.md`](anchor-alarm-backend/DEPLOY_FLY.md).
- **Frontend** → Vercel, built from `anchor-alarm-frontend`.
- **Android** → `npm run ship:android` (build + Firebase App Distribution).

> ⚠️ `anchor-alarm-frontend/.env.production` is committed and already holds
> the right backend URL. A `REACT_APP_BACKEND_URL` set in the Vercel
> dashboard **overrides** it silently, and a stale value there produces a
> memorably confusing failure: the site loads, the socket connects, and every
> join is answered "Session not found" — because the browser is asking a
> different backend than the phone. Check the first line the app logs to the
> browser console before debugging anything else:
>
> ```
> ⚓ Anchor Alarm — backend: https://alarmanchor-backend.fly.dev
> ```

## 🔒 Security

No authentication: anyone with a session ID can watch that boat. Session IDs
are 9 characters from a 32-character unambiguous alphabet (no `I`, `O`, `0`,
`1`), crypto-random, so guessing is impractical — but they are the only thing
protecting a session.

Already in place: a browser origin allow-list, rate limiting on session
creation (30/hour/IP) and on socket join attempts, payload validation and
size caps, and a session cap with least-recently-active eviction.

Not in place, and would be needed for anything beyond a friendly beta:
user accounts, authorisation on join, encryption of stored positions, and a
real database.

## 🐛 Troubleshooting

| Symptom | Cause |
| --- | --- |
| Website loads but every join says "Session not found" | The build is talking to the wrong backend. Check the console line above. |
| Website is blank, incognito works | A stale service worker on that device. Refresh two or three times; it now unregisters itself. |
| Remote works in the app but not in a browser | CORS. `fly logs` prints `[cors] rejected origin …` with the exact hostname. |
| Alarm doesn't sound on silent | Check the alarm *stream* volume, and whether DND is allowing alarms. |
| QR scanner opens and closes instantly | Camera permission refused for the app. |
| Backend won't start | Port 5000 in use — `PORT=5001 npm start`. |
| `Cannot GET /` on the backend URL | Expected. Use `/health`. |

## 📊 Measured, not guessed

From a 20-boat load simulation against a local instance of the deployed
build (`npm run load-sim`):

- 20 sessions, 40 sockets, ~9,000 location fixes, **0 socket errors**
- snapshot writes at exactly 30.0 s intervals — 0.019 writes per fix, not one
  per fix
- mid-run restart: **20/20 sessions recovered**
- a simulated 24-hour session holds the track at exactly the 3000-point cap,
  with RSS flat (−0.2%) and a 153 KB snapshot

**Not yet established:** the checklist's two-hour flat-memory run. The run
was stopped at 1h15m with RSS rising 2.64 MB/h (peak 76 MB of 256 MB). That
is consistent with tracks filling toward their cap rather than a leak — the
24-hour test above drives them *to* the cap and shows memory flat — but the
plateau has not actually been observed. Treat it as unverified.

## 📋 Status

Pre-beta. Known gaps, honestly:

- The two-hour memory soak above is incomplete.
- The APK fingerprint has not been checked against the reference SHA-256 in
  [DISTRIBUTION.md](./DISTRIBUTION.md).
- The alarm-stream audio plugin is new and needs verifying on real hardware
  in silent, vibrate and Do Not Disturb.
- Remote monitors in a browser get no sound of their own when the alarm
  fires — only the boat phone makes noise.
- Whether the foreground service survives swiping the app from recents is
  device-dependent and not yet characterised per manufacturer.

Anyone testing this should keep their existing anchor watch running
alongside it.

## 📄 License

MIT
