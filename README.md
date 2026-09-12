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
- **Fixes it can believe** — a phone that cannot see satellites falls back to
  cell towers and wifi and hands the app a position that can be a kilometre
  out, through the same callback and looking identical. Against a 30 m zone
  that single fix is a 4 a.m. alarm about a boat that never moved, so fixes
  too imprecise to be GPS (worse than 100 m), and jumps faster than 50 kn,
  are ignored — but never for more than 10 s in a row, because a filter that
  can reject for ever is a filter that can switch the alarm off in silence.
  The 50 kn headroom is deliberate: an anchor watch gets tested by driving
  away or by teleporting a mock location, and a filter that blocks the test
  is worse than the artefact it was aimed at.
  Dropping the anchor picks the most precise of the last few seconds of
  fixes rather than whichever arrived last: the anchor is the origin of
  every distance the watch measures.
- **Alarm stream audio** — the alarm plays on Android's *alarm* stream, so a
  phone set to silent or vibrate still sounds it. Do Not Disturb can still
  suppress it unless alarms are allowed through; that is a device setting no
  app can override. Arming checks that the alarm stream is not turned down
  to zero and says so in red if it is: that is the one setting that silences
  the alarm completely while everything on screen still looks armed.
- **Foreground service** — GPS keeps running with the screen off and the app
  backgrounded.
- **Track** — the night's swing, capped at 3000 points, kept across
  reconnects and server restarts. The most diagnostic view there is when
  working out whether a 4 a.m. alarm was real.
- **Remote monitoring** — join by code or QR from another phone or a browser.
  Watchers are told when the boat goes quiet, and when the watch is ended
  deliberately. A watcher running the app with it **open** also sounds and
  vibrates when the alarm fires, including one that opens or reconnects while
  the alarm is already running.

  Two limits, both by design. A watcher phone with the app **backgrounded or
  the screen off** will not alert to a *dragging* alarm from the in-app
  audio: only the boat phone runs a foreground service. And the **hosted
  website never makes a sound** — the alarm audio is a native Android plugin,
  so a browser tab shows the alarm silently. The boat phone is the alarm; a
  watcher is a second pair of eyes, not a second alarm clock.

  **Web Push (optional)** narrows the first limit for browser monitors: when
  the backend is configured with VAPID keys, a browser watcher who grants
  notification permission is woken by the OS for a *dragging* alarm even with
  the tab backgrounded or closed. It is off unless configured, never applies
  to the boat phone, and is a backup — not a substitute for the boat's own
  alarm. See "Push notifications" under deployment below.
- **Boat battery on the watch** — the boat phone is the alarm, so a flat
  battery is the commonest way a watch silently ends. The boat warns on its
  own screen when it drops below 20% (and 10%) unplugged, and shares its
  battery level with every monitor ashore, shown in the status pill's sheet.
- **Test the alarm** — a one-tap rehearsal in the boat's status sheet plays
  the real alarm-stream audio for a couple of seconds and runs the audibility
  check, so the alarm can be trusted because it has been heard — not because
  the app said it was armed.
- **Alarm on network loss, with a delay you choose** — a monitor whose link
  to the boat breaks is showing a map of where the boat *was*, which looks
  exactly like a boat riding quietly at anchor. So the gap now rings, and the
  watcher sets how long it has to last first: **at once, 2 min, 10 min or
  1 h** (default 2 min), from the "Watch remotely" card or the status pill's
  sheet mid-watch. Both halves of the link count — the boat phone going
  quiet, and this phone losing the server — and each says which in as many
  words. The delay is the whole point: doze, a headland and a wifi handover
  break the link for seconds every night, and an alarm that cries wolf gets
  muted, which is worse than no alarm at all. It is armed twice, as an
  in-app timer and as a notification scheduled with Android, so it still
  fires with the app backgrounded (as a notification sound, which silent
  mode can suppress — the alarm-stream audio that beats silent mode needs
  the app awake). The boat phone never does any of this: it alarms from its
  own GPS with no network at all.
- **Survives restarts** — sessions are snapshotted to disk, so a deploy or a
  host migration is not the end of the night's watch.
- **Resume a watch** — if the boat phone is killed (Android, a flat battery, a
  crash) it offers to resume the same session on relaunch, coming back armed
  with the zone and anchor it had, so the watchers ashore are never stranded
  on a dead code. Only the phone that created a session may take it back —
  the session ID is shared with everyone watching, so it cannot be the thing
  that proves ownership.

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
cd anchor-alarm-backend  && npm test    # 119 tests
cd anchor-alarm-frontend && npm test    # 168 tests
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
  push.js                      optional Web Push for browser monitors
  server-harness.js            spawns real servers for the tests
  *.test.js                    snapshot, restart, abuse, CORS, geofence,
                               end-session, reconnect-sync, ownership,
                               rearm, battery, push
  scripts/load-sim.js          20-boat load simulation
  fly.toml, Dockerfile         deployment (single always-on machine)

anchor-alarm-frontend/         React 18 + Leaflet, and the Android app
  src/App.jsx                  session, GPS watcher, alarm, socket wiring
  src/components/              map, remote monitor, zone editor, dialogs
  src/utils/                   alarm decision, GPS fix quality, link-loss
                               alarm, battery, web-push, geo, track,
                               platform, ids
  src/*.test.js, src/utils/*.test.js
  android/                     Capacitor project
    .../AlarmAudioPlugin.java  alarm-stream audio + vibration
  public/service-worker.js     a tombstone that unregisters itself
  public/push-sw.js            Web Push service worker (browser monitors)
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
`alarm-acknowledged`, `battery-updated`, `client-joined`, `client-left`.

| Event | From | Meaning |
| --- | --- | --- |
| `join-session` | both | join, and receive the current state. Joining as `main` is refused unless the device ID matches the one that created the session |
| `update-location` | main only | a GPS fix; the server thins it into the track. Relayed back with `ageMs`, an elapsed age measured on the server's clock, so watchers never subtract one device's clock from another's |
| `update-zone` / `update-anchor` | main only | the zone or anchor changed |
| `restore-track` | main only | bulk-restore a locally held track |
| `update-battery` | main only | the boat phone's battery `{ level, charging }`, relayed to watchers as `battery-updated` so they can see the phone that IS the alarm running low |
| `acknowledge-alarm` | main only | silence session-wide until the boat re-enters the zone. A watcher silencing its own device does not send this — it quiets that screen locally and the boat goes on sounding |
| `end-session` | main only | the watch is over; session deleted |
| `register-push` | remote only | a browser monitor's Web Push subscription, so a dragging alarm can wake a backgrounded tab. Ignored unless the backend has VAPID keys configured (see Deployment) |
| `boat-offline` / `boat-online` | server | the boat phone's socket dropped / came back |
| `session-ended` | server | the boat phone ended the watch |

The boat phone re-pushes its zone, anchor, track and — if the alarm has been
silenced — its acknowledgement on **every** reconnect, not just when the
server has lost the session. It keeps working with no network, so anything
changed during an outage exists only on that phone until it says so again.
The acknowledgement matters as much as the rest: a recovered session starts
with `acknowledged: false`, and without the re-push the server would raise
the alarm again on the next fix from a boat that is outside its zone quite
deliberately.

`alarm-status-changed` is for the watchers. The boat phone ignores it and
uses its own local verdict — the server is never what makes it sound.

HTTP is only `POST /api/sessions`, `GET /api/sessions/:id`, `GET /health`
and `GET /api/push/vapid-public-key` (the Web Push key, or `null` when push
is not configured). There is no route for `/` — a bare visit to the backend
returning `Cannot GET /` is Express answering, not a fault.

## ☁️ Deployment

- **Backend** → Fly.io, **one** always-on machine with a volume. Never scale
  past one: sessions live in that machine's memory and its own volume. See
  [`anchor-alarm-backend/DEPLOY_FLY.md`](anchor-alarm-backend/DEPLOY_FLY.md).
- **Frontend** → Vercel, built from `anchor-alarm-frontend`.
- **Android** → `npm run ship:android` (build + Firebase App Distribution).

### Push notifications (optional)

Web Push lets a **browser** monitor be woken for a dragging alarm while its
tab is backgrounded or closed. It is entirely optional: with no keys set the
backend exposes no usable key, the app never asks for notification
permission, and nothing changes. The boat phone never uses it.

To enable it, generate a VAPID key pair once and set three backend env vars:

```bash
npx web-push generate-vapid-keys
# then, on the backend (e.g. `fly secrets set ...`):
#   VAPID_PUBLIC_KEY=<public key>
#   VAPID_PRIVATE_KEY=<private key>
#   VAPID_SUBJECT=mailto:you@example.com   # a contact URI (mailto: or https:)
```

The frontend needs no build-time config — it fetches the public key from the
backend at `/api/push/vapid-public-key` and offers push only when one is
returned. `GET /health` reports `"push": true` once it is on. Native
app monitors are excluded on purpose (Android WebView has no web push
service, and the app already alerts while open); this is for browsers.

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

No authentication: anyone with a session ID can watch that boat. Watching is
all it buys them — taking the session over as the boat phone is refused
unless the device ID matches the one that created it. Session IDs
are 9 characters from a 32-character unambiguous alphabet (no `I`, `O`, `0`,
`1`), crypto-random, so guessing is impractical — but they are the only thing
protecting a session.

**Every event that changes a watch is boat-phone only** — `update-zone`,
`update-anchor`, `update-location`, `restore-track`, `acknowledge-alarm`,
`end-session` — and joining as the boat phone requires the device ID that
created the session. Before that guard existed, anyone holding a code could
join as an ordinary watcher and erase the zone, which the boat phone applies
unconditionally and evaluates its alarm against: a remote kill switch for the
alarm. They could also forge a position (telling every watcher ashore the
alarm had cleared while the boat dragged), silence a live alarm, move the
anchor and wipe the track. All were confirmed working against a running
instance, and all are refused now.

Already in place: a browser origin allow-list, rate limiting on session
creation (30/hour/IP) and on socket join attempts, payload validation and
size caps, and a session cap with least-recently-active eviction.

Not in place, and would be needed for anything beyond a friendly beta:
user accounts, authorisation on join, encryption of stored positions, and a
real database. Two known soft spots: the `alarm-anchor-*.vercel.app` origin
pattern matches any Vercel project named that way, not only ours (low impact
— there are no cookies to steal cross-origin); and `GET /api/sessions/:id`
is not rate limited, which does not help guessing a 32^9 keyspace but is a
free scanning surface.

## 🐛 Troubleshooting

| Symptom | Cause |
| --- | --- |
| Website loads but every join says "Session not found" | The build is talking to the wrong backend. Check the console line above. |
| Website is blank, incognito works | A stale service worker on that device. Refresh two or three times; it now unregisters itself. |
| Remote works in the app but not in a browser | CORS. `fly logs` prints `[cors] rejected origin …` with the exact hostname. |
| Alarm doesn't sound on silent | Check the alarm *stream* volume, and whether DND is allowing alarms. |
| Remote monitor's pill looks wrong for the data it is showing | Should no longer happen: freshness is measured from an elapsed age, not from the boat phone's clock. If it recurs, check the console for an `ageMs` of `null` — that means an old backend. |
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
