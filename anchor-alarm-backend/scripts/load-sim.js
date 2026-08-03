#!/usr/bin/env node
/* eslint-disable no-console */

// Simulated 20-boat load — checklist 1.3. Dev-only; never run against a
// backend real testers are anchored on.
//
// This exists because the failure it looks for cannot be reproduced with two
// phones: a slow leak under 40 sockets that only kills the 256 MB machine on
// night three, by which time twenty testers have lost confidence in the app.
// Two hours of flat RSS is the only cheap evidence you can get before that.
//
// Usage:
//   node scripts/load-sim.js                       # 2 h against a local server it spawns
//   node scripts/load-sim.js --duration 10m
//   node scripts/load-sim.js --url https://alarmanchor-backend.fly.dev
//   node scripts/load-sim.js --boats 20 --no-restart
//
// Against a spawned local server it also samples the server's RSS and
// restarts it at the halfway mark. Against a remote --url it can only see
// what /health exposes; use `fly status` alongside it for memory.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

// --- arguments -------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const parseDuration = (s) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(s));
  if (!m) throw new Error(`bad duration: ${s}`);
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] || 'm'];
  return Number(m[1]) * mult;
};

const CONFIG = {
  boats: Number(flag('boats', 20)),
  // 3 of them are driven outside their zone to force alarm broadcasts.
  draggers: Number(flag('draggers', 3)),
  durationMs: parseDuration(flag('duration', '2h')),
  fixIntervalMs: parseDuration(flag('fix-interval', '10s')),
  sampleIntervalMs: parseDuration(flag('sample-interval', '30s')),
  url: flag('url', null),
  restart: !has('no-restart'),
  report: flag('report', path.join(os.tmpdir(), 'anchor-load-sim-report.json'))
};

// --- boat geometry ---------------------------------------------------------

const BASE = { lat: 43.083, lng: 6.158 };
const ZONE_RADIUS_M = 40;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

const circleZone = (lat, lng, radius, steps = 16) =>
  Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return [
      lat + (radius * Math.cos(a)) / M_PER_DEG_LAT,
      lng + (radius * Math.sin(a)) / mPerDegLng(lat)
    ];
  });

// --- helpers ---------------------------------------------------------------

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const fmtBytes = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(
    Math.floor((s % 3600) / 60)
  ).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// RSS of a local process, from /proc. Only meaningful for a server we spawned.
const rssBytes = (pid) => {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    return m ? Number(m[1]) * 1024 : null;
  } catch (err) {
    return null;
  }
};

// --- the server under test -------------------------------------------------

async function startLocalServer() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-loadsim-'));
  const serverPath = path.join(__dirname, '..', 'server.js');

  const launch = () => {
    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
        // The default 30/hour is tuned for real testers behind one marina
        // wifi; the sim creates its whole fleet from one address at once.
        SESSION_RATE_LIMIT: '500',
        LOG_LEVEL: 'info'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (d) => process.stdout.write(`  server| ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`  server! ${d}`));
    return child;
  };

  let child = launch();
  const base = `http://127.0.0.1:${port}`;

  const waitHealthy = async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      try {
        if ((await fetch(`${base}/health`)).ok) return;
      } catch (err) {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error('server never became healthy');
      await delay(150);
    }
  };
  await waitHealthy();

  return {
    base,
    dataDir,
    get pid() {
      return child.pid;
    },
    // Mirrors `fly machines restart`: SIGTERM, wait, come back on the same
    // data dir. Used to prove all 20 sessions survive a mid-run restart.
    async restart() {
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
      });
      child = launch();
      await waitHealthy();
    },
    stop() {
      try {
        child.kill('SIGKILL');
      } catch (err) {
        /* already gone */
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

// --- one simulated boat ----------------------------------------------------

class Boat {
  constructor(index, base, isDragger) {
    this.index = index;
    this.base = base;
    this.isDragger = isDragger;
    this.deviceId = `sim-boat-${String(index).padStart(2, '0')}`;
    // Spread the fleet out so they are distinct sessions in distinct places.
    this.anchorLat = BASE.lat + index * 0.01;
    this.anchorLng = BASE.lng + index * 0.01;
    this.lat = this.anchorLat;
    this.lng = this.anchorLng;
    this.zone = circleZone(this.anchorLat, this.anchorLng, ZONE_RADIUS_M);
    this.drift = 0; // metres of deliberate drag, draggers only
    this.stats = { fixes: 0, alarms: 0, trackPoints: 0, errors: 0, reconnects: 0 };
  }

  async createSession() {
    const res = await fetch(`${this.base}/api/sessions`, { method: 'POST' });
    if (!res.ok) throw new Error(`create session failed: ${res.status} ${await res.text()}`);
    this.sessionId = (await res.json()).sessionId;
  }

  connectSocket(role) {
    const socket = io(this.base, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500
    });
    socket.on('connect', () => {
      socket.emit('join-session', {
        sessionId: this.sessionId,
        role,
        deviceId: role === 'main' ? this.deviceId : `${this.deviceId}-remote`
      });
    });
    socket.on('error', (msg) => {
      this.stats.errors++;
      log(`boat ${this.index} ${role} socket error: ${msg}`);
    });
    socket.io.on('reconnect', () => {
      this.stats.reconnects++;
    });
    return socket;
  }

  async start() {
    await this.createSession();
    this.main = this.connectSocket('main');
    this.remote = this.connectSocket('remote');

    // The remote monitor is what a watcher would see; count what reaches it.
    this.remote.on('alarm-status-changed', (p) => {
      if (p && p.alarmed) this.stats.alarms++;
    });
    this.remote.on('track-point', () => {
      this.stats.trackPoints++;
    });

    await delay(150);
    this.main.emit('update-anchor', {
      anchor: { latitude: this.anchorLat, longitude: this.anchorLng, accuracy: 5 },
      resetTrack: true
    });
    this.main.emit('update-zone', { zone: this.zone });
  }

  // A small random walk inside the zone, plus a steady outward drag for the
  // boats chosen to alarm.
  step() {
    const jitterM = 3;
    let northM = (Math.random() - 0.5) * jitterM;
    let eastM = (Math.random() - 0.5) * jitterM;

    if (this.isDragger) {
      // Walk out to ~2x the zone radius, then back in, so the alarm both
      // fires and clears repeatedly over the run rather than latching once.
      this.drift += 4;
      if (this.drift > 2 * ZONE_RADIUS_M) this.drift = -ZONE_RADIUS_M;
      eastM += this.drift;
    }

    // Keep the wander bounded around the anchor rather than letting the
    // random walk diverge over two hours.
    const targetLat = this.anchorLat + northM / M_PER_DEG_LAT;
    const targetLng = this.anchorLng + eastM / mPerDegLng(this.anchorLat);
    this.lat = targetLat;
    this.lng = targetLng;

    if (this.main && this.main.connected) {
      this.main.emit('update-location', {
        location: {
          latitude: this.lat,
          longitude: this.lng,
          accuracy: 4 + Math.random() * 6,
          timestamp: new Date().toISOString()
        }
      });
      this.stats.fixes++;
    }
  }

  stop() {
    if (this.main) this.main.close();
    if (this.remote) this.remote.close();
  }
}

// --- the run ---------------------------------------------------------------

async function main() {
  let server = null;
  let base = CONFIG.url;

  if (!base) {
    log('no --url given: spawning a local server to measure');
    server = await startLocalServer();
    base = server.base;
  }
  log(`target: ${base}`);
  log(
    `${CONFIG.boats} boats (${CONFIG.draggers} dragging), a fix every ` +
      `${CONFIG.fixIntervalMs / 1000}s, for ${fmtDuration(CONFIG.durationMs)}`
  );

  const boats = Array.from(
    { length: CONFIG.boats },
    (_, i) => new Boat(i, base, i < CONFIG.draggers)
  );

  for (const boat of boats) {
    await boat.start();
    await delay(60); // don't open 40 sockets in the same millisecond
  }
  log(`${boats.length} sessions created, ${boats.length * 2} sockets open`);

  const samples = [];
  const startedAt = Date.now();
  let restarted = false;
  const restartAt = startedAt + CONFIG.durationMs / 2;

  // Emit fixes on a fixed interval, jittered per boat so 20 phones don't all
  // report on the same tick.
  const fixTimers = boats.map((boat) => {
    const timer = setInterval(() => boat.step(), CONFIG.fixIntervalMs);
    setTimeout(() => boat.step(), Math.random() * CONFIG.fixIntervalMs);
    return timer;
  });

  const sample = async () => {
    const elapsed = Date.now() - startedAt;
    let health = null;
    try {
      health = await (await fetch(`${base}/health`)).json();
    } catch (err) {
      log(`/health unreachable: ${err.message}`);
    }

    let snapshotBytes = null;
    if (server) {
      try {
        snapshotBytes = fs.statSync(path.join(server.dataDir, 'sessions.json')).size;
      } catch (err) {
        /* not written yet */
      }
    }

    const entry = {
      t: new Date().toISOString(),
      elapsedMs: elapsed,
      rss: server ? rssBytes(server.pid) : null,
      sessions: health ? health.sessions : null,
      sockets: health ? health.sockets : null,
      lastSnapshotAt: health ? health.lastSnapshotAt : null,
      snapshotBytes,
      fixes: boats.reduce((n, b) => n + b.stats.fixes, 0),
      alarms: boats.reduce((n, b) => n + b.stats.alarms, 0),
      trackPoints: boats.reduce((n, b) => n + b.stats.trackPoints, 0),
      errors: boats.reduce((n, b) => n + b.stats.errors, 0),
      reconnects: boats.reduce((n, b) => n + b.stats.reconnects, 0)
    };
    samples.push(entry);

    log(
      `${fmtDuration(elapsed)}  rss=${entry.rss ? fmtBytes(entry.rss) : 'n/a'}  ` +
        `sessions=${entry.sessions}  sockets=${entry.sockets}  ` +
        `snapshot=${entry.snapshotBytes ? fmtBytes(entry.snapshotBytes) : 'n/a'}  ` +
        `fixes=${entry.fixes}  alarms=${entry.alarms}  errors=${entry.errors}`
    );
  };

  await sample();
  const sampleTimer = setInterval(sample, CONFIG.sampleIntervalMs);

  // Mid-run restart: all 20 sessions must come back.
  let restartResult = null;
  const restartTimer = setInterval(async () => {
    if (restarted || !server || !CONFIG.restart || Date.now() < restartAt) return;
    restarted = true;
    log('--- restarting the machine mid-run ---');
    const before = (await (await fetch(`${base}/health`)).json()).sessions;
    await server.restart();
    await delay(3000);
    const after = (await (await fetch(`${base}/health`)).json()).sessions;

    // Check every session by ID, not just the count.
    let recovered = 0;
    for (const boat of boats) {
      if ((await fetch(`${base}/api/sessions/${boat.sessionId}`)).ok) recovered++;
    }
    restartResult = { before, after, recovered, of: boats.length };
    log(`restart: ${recovered}/${boats.length} sessions came back (health reports ${after})`);
  }, 5000);

  await delay(CONFIG.durationMs);

  clearInterval(sampleTimer);
  clearInterval(restartTimer);
  for (const t of fixTimers) clearInterval(t);
  await sample();

  // --- verdicts ------------------------------------------------------------

  const withRss = samples.filter((s) => Number.isFinite(s.rss));
  let memory = null;
  if (withRss.length >= 3) {
    // Compare the settled second half against the first: a leak shows as a
    // rising line, and startup allocation shouldn't be counted as growth.
    const half = Math.floor(withRss.length / 2);
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const firstHalf = mean(withRss.slice(0, half).map((s) => s.rss));
    const secondHalf = mean(withRss.slice(half).map((s) => s.rss));
    const peak = Math.max(...withRss.map((s) => s.rss));
    memory = {
      firstHalfMeanBytes: Math.round(firstHalf),
      secondHalfMeanBytes: Math.round(secondHalf),
      peakBytes: peak,
      growthPercent: Number((((secondHalf - firstHalf) / firstHalf) * 100).toFixed(2)),
      // 256 MB machine: anything approaching that is fatal.
      peakPercentOfMachine: Number(((peak / (256 * 1024 * 1024)) * 100).toFixed(1))
    };
  }

  const snapshotWrites = new Set(samples.map((s) => s.lastSnapshotAt).filter(Boolean)).size;
  const totals = samples[samples.length - 1];

  const report = {
    config: CONFIG,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    memory,
    restart: restartResult,
    finalHealth: totals,
    distinctSnapshotWrites: snapshotWrites,
    perBoat: boats.map((b) => ({ index: b.index, sessionId: b.sessionId, ...b.stats })),
    samples
  };

  fs.writeFileSync(CONFIG.report, JSON.stringify(report, null, 2));

  console.log('\n=== load sim summary ===');
  console.log(`duration          ${fmtDuration(report.durationMs)}`);
  if (memory) {
    console.log(
      `memory            first half ${fmtBytes(memory.firstHalfMeanBytes)} -> ` +
        `second half ${fmtBytes(memory.secondHalfMeanBytes)} (${memory.growthPercent > 0 ? '+' : ''}${memory.growthPercent}%)`
    );
    console.log(
      `peak RSS          ${fmtBytes(memory.peakBytes)} (${memory.peakPercentOfMachine}% of a 256 MB machine)`
    );
  }
  console.log(`sessions          ${totals.sessions} (expected ${CONFIG.boats})`);
  console.log(`sockets           ${totals.sockets} (expected ${CONFIG.boats * 2})`);
  console.log(`location fixes    ${totals.fixes}`);
  console.log(`alarms seen by remotes  ${totals.alarms}`);
  console.log(`socket errors     ${totals.errors}`);
  console.log(`snapshot file     ${totals.snapshotBytes ? fmtBytes(totals.snapshotBytes) : 'n/a'}`);
  console.log(
    `snapshot writes   ${snapshotWrites} distinct (expect ~1 per 30 s, i.e. ~${Math.round(
      report.durationMs / 30000
    )})`
  );
  if (restartResult) {
    console.log(
      `mid-run restart   ${restartResult.recovered}/${restartResult.of} sessions recovered`
    );
  }
  console.log(`report written to ${CONFIG.report}`);

  for (const boat of boats) boat.stop();
  await delay(500);
  if (server) server.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('load sim failed:', err);
  process.exit(1);
});
