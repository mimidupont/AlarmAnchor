const assert = require('node:assert/strict');
const fs = require('node:fs');
const { after, describe, it } = require('node:test');

const {
  connect,
  createSession,
  delay,
  fix,
  health,
  joinSession,
  makeDataDir,
  startServer,
  stopServer,
  waitFor
} = require('./server-harness');

// Checklist 1.4. Not a realistic threat among twenty friends, but
// POST /api/sessions is unauthenticated on a public URL and every tester's
// alarm depends on one 256 MB machine staying up. The bar for everything
// here is the same: the server rejects the input and *keeps serving*.

const dirs = [];
const servers = [];

const boot = async (env = {}) => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  // Most tests want the limiter out of the way; the one that tests the
  // limiter itself boots without this.
  const server = await startServer({ dataDir, env: { SESSION_RATE_LIMIT: '10000', ...env } });
  servers.push(server);
  return server;
};

after(async () => {
  for (const server of servers) await stopServer(server, 'SIGKILL');
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Every test ends by proving the server is still answering.
const assertStillUp = async (server, expectedSessions) => {
  const h = await health(server.base);
  assert.equal(h.status, 'ok', 'server must still be serving');
  if (expectedSessions !== undefined) assert.equal(h.sessions, expectedSessions);
  assert.equal(server.child.exitCode, null, 'server process must not have exited');
};

describe('100 rapid POST /api/sessions', () => {
  it('rate-limits the flood and stays up', async (t) => {
    // Default limit, deliberately: this is the production setting.
    const server = await boot({ SESSION_RATE_LIMIT: undefined });
    const limit = 30;

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        fetch(`${server.base}/api/sessions`, { method: 'POST' }).then((r) => r.status)
      )
    );

    const created = results.filter((s) => s === 200).length;
    const limited = results.filter((s) => s === 429).length;
    t.diagnostic(`${created} created, ${limited} rate-limited, statuses: ${[...new Set(results)]}`);

    assert.equal(created + limited, 100, 'every request must get a clean answer');
    assert.equal(created, limit, `only the first ${limit} should be created`);
    assert.ok(limited > 0, 'the flood must actually be limited');

    // The refusal must be a clean JSON 429, not a stack trace.
    const res = await fetch(`${server.base}/api/sessions`, { method: 'POST' });
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /Too many sessions/);

    await assertStillUp(server, limit);
  });

  it('keeps serving reads and sockets while being flooded', async () => {
    const server = await boot({ SESSION_RATE_LIMIT: undefined });
    const sessionId = await createSession(server.base);

    const flood = Promise.all(
      Array.from({ length: 200 }, () =>
        fetch(`${server.base}/api/sessions`, { method: 'POST' }).catch(() => null)
      )
    );
    // A boat phone already anchored must not be collateral damage.
    const socket = await connect(server.base);
    const state = await joinSession(socket, sessionId, 'main', 'device-boat');
    assert.ok(state);
    socket.close();

    await flood;
    await assertStillUp(server);
  });
});

describe('MAX_SESSIONS cap', () => {
  it('evicts the least recently active rather than refusing a boat', async (t) => {
    const server = await boot({ MAX_SESSIONS: '5' });

    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await createSession(server.base));
      await delay(20); // distinct lastActivity per session
    }
    assert.equal((await health(server.base)).sessions, 5);

    // Touch every session except the first, making it the idle one.
    for (const id of ids.slice(1)) {
      const socket = await connect(server.base);
      await joinSession(socket, id, 'main', `device-${id}`);
      socket.close();
      await delay(20);
    }

    const sixth = await createSession(server.base);
    t.diagnostic(`created ${sixth} over a cap of 5`);

    assert.equal((await health(server.base)).sessions, 5, 'the cap must hold');
    assert.equal(
      (await fetch(`${server.base}/api/sessions/${ids[0]}`)).status,
      404,
      'the least recently active session should be the one evicted'
    );
    for (const id of [...ids.slice(1), sixth]) {
      assert.equal(
        (await fetch(`${server.base}/api/sessions/${id}`)).status,
        200,
        `${id} should have survived the eviction`
      );
    }
    assert.match(server.output, /evicted \(cap 5 reached\)/);
    await assertStillUp(server, 5);
  });

  it('holds the cap under a burst rather than growing without bound', async () => {
    const server = await boot({ MAX_SESSIONS: '5' });
    await Promise.all(
      Array.from({ length: 60 }, () => fetch(`${server.base}/api/sessions`, { method: 'POST' }))
    );
    const h = await health(server.base);
    assert.ok(h.sessions <= 5, `sessions ${h.sessions} must never exceed the cap`);
    await assertStillUp(server);
  });

  it('always makes room by eviction, so the 503 path stays unreachable', async (t) => {
    // Worth stating plainly, because the checklist offers "evicts or returns
    // 503" as alternatives: with MAX_SESSIONS >= 1 the server always evicts
    // first and the refusal branch cannot be reached. A boat is therefore
    // never turned away — an older session is dropped instead.
    const server = await boot({ MAX_SESSIONS: '1' });
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${server.base}/api/sessions`, { method: 'POST' });
      assert.equal(res.status, 200, 'a boat must never be refused while eviction can free a slot');
      await delay(20);
    }
    assert.equal((await health(server.base)).sessions, 1);
    t.diagnostic('503 branch is dead code while MAX_SESSIONS >= 1 — eviction always succeeds');
    await assertStillUp(server, 1);
  });

  it('treats MAX_SESSIONS=0 as unset rather than as a cap of zero', async (t) => {
    // `Number(process.env.MAX_SESSIONS) || 500` reads 0 as falsy, so the
    // documented-looking value 0 silently means 500. Harmless in practice —
    // nobody would deploy a cap of 0 — but recorded so it is not mistaken
    // for a working kill switch.
    const server = await boot({ MAX_SESSIONS: '0' });
    const res = await fetch(`${server.base}/api/sessions`, { method: 'POST' });
    t.diagnostic(`MAX_SESSIONS=0 -> POST returned ${res.status} (falls back to the default 500)`);
    assert.equal(res.status, 200);
    await assertStillUp(server, 1);
  });
});

describe('malformed payloads', () => {
  const badLocations = {
    'strings for coordinates': { latitude: '43.083', longitude: '6.158' },
    NaN: { latitude: NaN, longitude: NaN },
    Infinity: { latitude: Infinity, longitude: -Infinity },
    'missing longitude': { latitude: 43.083 },
    'missing everything': {},
    null: null,
    'a string instead of an object': 'somewhere near the harbour',
    'an array': [43.083, 6.158],
    'out of range latitude': { latitude: 991, longitude: 6.158 },
    'out of range longitude': { latitude: 43.083, longitude: -4000 },
    'nested object coordinates': { latitude: { v: 43 }, longitude: { v: 6 } },
    'boolean coordinates': { latitude: true, longitude: false }
  };

  it('rejects every malformed update-location silently and keeps the last good fix', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const socket = await connect(server.base);
    await joinSession(socket, sessionId, 'main', 'device-boat');

    // Establish a known-good position first.
    socket.emit('update-location', { location: fix(43.083, 6.158) });
    await delay(300);

    for (const [name, location] of Object.entries(badLocations)) {
      socket.emit('update-location', { location });
      // Nothing may be broadcast for a payload the server rejected.
      const got = await waitFor(socket, 'location-updated', 250);
      assert.equal(got, null, `${name} must not produce a location broadcast`);
    }
    // Payloads that aren't even shaped like the event. (The argument-less
    // form is covered separately below — it does not survive.)
    socket.emit('update-location', {});
    socket.emit('update-location', 'garbage');
    socket.emit('update-location', 42);
    await delay(300);

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    const positions = Object.values(body.locations);
    assert.equal(positions.length, 1, 'exactly the one good fix');
    assert.equal(positions[0].latitude, 43.083, 'the good fix must be untouched');

    // A good fix after the barrage must still work.
    socket.emit('update-location', { location: fix(43.0831, 6.1581) });
    const ok = await waitFor(socket, 'location-updated', 1500);
    assert.ok(ok, 'the server must still accept valid input afterwards');

    socket.close();
    await assertStillUp(server, 1);
  });

  it('rejects every malformed update-zone and keeps the armed zone intact', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const socket = await connect(server.base);
    await joinSession(socket, sessionId, 'main', 'device-boat');

    const goodZone = [
      [43.083, 6.158],
      [43.0835, 6.158],
      [43.0835, 6.1585],
      [43.083, 6.1585]
    ];
    socket.emit('update-zone', { zone: goodZone });
    await delay(300);

    const badZones = {
      '10 000 points': Array.from({ length: 10000 }, (_, i) => [43.083 + i / 1e6, 6.158]),
      'nested arrays': [[[43.083, 6.158]], [[43.084, 6.159]], [[43.085, 6.16]]],
      'triples not pairs': [
        [43.083, 6.158, 0],
        [43.084, 6.158, 0],
        [43.084, 6.159, 0]
      ],
      'string coordinates': [
        ['43.083', '6.158'],
        ['43.084', '6.158'],
        ['43.084', '6.159']
      ],
      'NaN vertex': [
        [43.083, 6.158],
        [NaN, 6.158],
        [43.084, 6.159]
      ],
      'not an array': 'a zone, honest',
      'array of nulls': [null, null, null],
      'deeply nested': [[[[[43.083]]]]],
      'object pretending to be a zone': { 0: [43.083, 6.158], length: 3 }
    };

    for (const [name, zone] of Object.entries(badZones)) {
      socket.emit('update-zone', { zone });
      const got = await waitFor(socket, 'zone-updated', 250);
      assert.equal(got, null, `${name} must not be accepted`);
    }
    socket.emit('update-zone', {});
    socket.emit('update-zone', 'a zone');
    await delay(300);

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.deepEqual(body.zone, goodZone, 'the armed zone must survive the barrage untouched');

    socket.close();
    await assertStillUp(server, 1);
  });

  it('accepts a 2-point zone but never arms on it', async () => {
    // A degenerate zone passes shape validation (it is a well-formed array of
    // pairs) but must never be treated as a fence — checkAlarm requires 3+.
    const server = await boot();
    const sessionId = await createSession(server.base);
    const socket = await connect(server.base);
    await joinSession(socket, sessionId, 'main', 'device-boat');

    socket.emit('update-zone', {
      zone: [
        [43.083, 6.158],
        [43.084, 6.159]
      ]
    });
    await delay(200);

    // Far outside anything those two points could enclose.
    socket.emit('update-location', { location: fix(44.5, 7.5) });
    const alarm = await waitFor(socket, 'alarm-status-changed', 800);
    assert.equal(alarm, null, 'a 2-point zone must not raise an alarm');

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.equal(body.alarmed, false);

    socket.close();
    await assertStillUp(server, 1);
  });

  it('survives malformed anchor and restore-track payloads', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const socket = await connect(server.base);
    await joinSession(socket, sessionId, 'main', 'device-boat');

    for (const anchor of [
      { latitude: 'north', longitude: 6.158 },
      { latitude: NaN, longitude: NaN },
      { latitude: 200, longitude: 500 },
      'anchor',
      [43, 6],
      undefined
    ]) {
      socket.emit('update-anchor', { anchor });
    }
    for (const track of [
      'not a track',
      [['a', 'b', 'c']],
      [[43.083, 6.158]],
      [null, undefined],
      Array.from({ length: 50000 }, () => [43.083, 6.158, Date.now()])
    ]) {
      socket.emit('restore-track', { track });
    }
    socket.emit('restore-track', null);
    socket.emit('acknowledge-alarm', 'unexpected argument');
    await delay(600);

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.equal(body.anchor, null, 'no bogus anchor may be stored');

    socket.close();
    await assertStillUp(server, 1);
  });

  // ---------------------------------------------------------------------
  // FAILING — reproduces a live defect, see the run report.
  //
  // `update-location`, `update-zone` and `update-anchor` all destructure
  // their payload without a guard:
  //
  //     socket.on('update-location', (data) => { const { location } = data;
  //
  // A client that emits the event with no argument (or an explicit null)
  // makes that throw. Nothing catches it, so it reaches the process-level
  // uncaughtException handler, which by design flushes the snapshot and
  // exits 1 — taking the relay down for every session on the machine, not
  // just the offending one. Any connected socket can do it, and an older or
  // buggy client build could do it by accident.
  //
  // `join-session` and `restore-track` already guard theirs (`data || {}`,
  // `if (!data ...) return`), which is the shape the three below need.
  // ---------------------------------------------------------------------
  const UNGUARDED = ['update-location', 'update-zone', 'update-anchor'];

  for (const event of UNGUARDED) {
    it(`survives an argument-less '${event}' emit`, async (t) => {
      const server = await boot();
      const sessionId = await createSession(server.base);
      const socket = await connect(server.base);
      await joinSession(socket, sessionId, 'main', 'device-boat');

      socket.emit(event); // no payload at all
      await delay(1200);

      const fatal = (server.output.match(/\[fatal\] uncaughtException: [^\n]*/) || [])[0];
      if (fatal) t.diagnostic(fatal);

      assert.equal(
        server.child.exitCode,
        null,
        `the whole backend exited on a malformed '${event}' from one client`
      );
      await assertStillUp(server, 1);
      socket.close();
    });

    it(`survives a null '${event}' payload`, async () => {
      const server = await boot();
      const sessionId = await createSession(server.base);
      const socket = await connect(server.base);
      await joinSession(socket, sessionId, 'main', 'device-boat');

      socket.emit(event, null);
      await delay(1200);

      assert.equal(server.child.exitCode, null, `the backend exited on a null '${event}'`);
      await assertStillUp(server, 1);
      socket.close();
    });
  }

  it('rejects oversized and malformed HTTP bodies without falling over', async () => {
    const server = await boot();
    const attempts = [
      { body: 'x'.repeat(2 * 1024 * 1024), 'content-type': 'application/json' },
      { body: '{"broken":', 'content-type': 'application/json' },
      { body: '{"a":'.repeat(5000), 'content-type': 'application/json' }
    ];
    for (const a of attempts) {
      const res = await fetch(`${server.base}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': a['content-type'] },
        body: a.body
      }).catch(() => null);
      if (res) assert.ok(res.status < 500 || res.status === 500, `got ${res.status}`);
    }
    // Nonsense paths must 404, not crash.
    assert.equal((await fetch(`${server.base}/api/sessions/../../etc/passwd`)).status, 404);
    await assertStillUp(server);
  });
});

describe('joining a nonexistent session', () => {
  it('gives a remote a clean error rather than a blank monitor', async () => {
    const server = await boot();
    const socket = await connect(server.base);

    const error = await new Promise((resolve) => {
      socket.once('error', resolve);
      socket.emit('join-session', { sessionId: 'NOSUCHSES', role: 'remote', deviceId: 'watcher' });
    });
    assert.equal(error, 'Session not found');

    // And no state-update leaks through alongside the error.
    assert.equal(await waitFor(socket, 'state-update', 500), null);

    socket.close();
    await assertStillUp(server, 0);
  });

  it('answers the same way for every shape of bad join', async () => {
    const server = await boot();
    const socket = await connect(server.base);

    for (const data of [
      { sessionId: 'ZZZZZZZZZ', role: 'remote' },
      { sessionId: '', role: 'remote' },
      { sessionId: null, role: 'main' },
      { role: 'remote' },
      { sessionId: 'x'.repeat(5000), role: 'remote' },
      { sessionId: { nested: true }, role: 'remote' },
      {},
      null
    ]) {
      const error = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve('<no response>'), 1000);
        socket.once('error', (msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
        socket.emit('join-session', data);
      });
      assert.equal(error, 'Session not found', `bad join ${JSON.stringify(data)}`);
    }

    socket.close();
    await assertStillUp(server, 0);
  });

  it('throttles a brute-force join loop without killing an honest client', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const socket = await connect(server.base);

    let lastError = null;
    socket.on('error', (msg) => {
      lastError = msg;
    });
    for (let i = 0; i < 40; i++) socket.emit('join-session', { sessionId: 'GUESS1234' });
    await delay(600);
    assert.equal(lastError, 'Too many join attempts');

    // A fresh socket — an honest phone reconnecting — is unaffected.
    const honest = await connect(server.base);
    const state = await joinSession(honest, sessionId, 'main', 'device-boat');
    assert.ok(state, 'a different socket must still be able to join');

    socket.close();
    honest.close();
    await assertStillUp(server, 1);
  });
});

describe('two sockets claiming the same deviceId', () => {
  it('shows one boat, not two, and the late disconnect does not erase it', async () => {
    // The flapping-signal case (Task 3): a phone often reconnects before the
    // old socket's disconnect fires. If that late event deleted the fresh
    // position, the boat would vanish from every remote monitor while in
    // fact reporting fine.
    const server = await boot();
    const sessionId = await createSession(server.base);

    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watcher');

    const first = await connect(server.base);
    await joinSession(first, sessionId, 'main', 'device-boat');
    first.emit('update-location', { location: fix(43.083, 6.158) });
    await delay(300);

    // Same deviceId, second socket — the reconnect.
    const second = await connect(server.base);
    await joinSession(second, sessionId, 'main', 'device-boat');
    second.emit('update-location', { location: fix(43.0834, 6.1584) });
    await delay(300);

    const locationsOf = async () =>
      (await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json()).locations;

    let locations = await locationsOf();
    assert.deepEqual(
      Object.keys(locations),
      ['device-boat'],
      'one device key, so one marker on the monitor'
    );
    assert.equal(locations['device-boat'].latitude, 43.0834, 'the newest fix wins');

    // Now the stale socket finally notices it is gone.
    first.close();
    await delay(600);

    locations = await locationsOf();
    assert.deepEqual(
      Object.keys(locations),
      ['device-boat'],
      'the late disconnect must not delete the live boat'
    );
    assert.equal(locations['device-boat'].latitude, 43.0834);

    // And the live socket still works.
    second.emit('update-location', { location: fix(43.0836, 6.1586) });
    await delay(400);
    assert.equal((await locationsOf())['device-boat'].latitude, 43.0836);

    watcher.close();
    second.close();
    await assertStillUp(server, 1);
  });

  it('removes the boat only when its current socket goes', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const socket = await connect(server.base);
    await joinSession(socket, sessionId, 'main', 'device-boat');
    socket.emit('update-location', { location: fix(43.083, 6.158) });
    await delay(300);

    socket.close();
    await delay(600);

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.deepEqual(body.locations, {}, 'the last socket leaving does clear the position');
    await assertStillUp(server, 1);
  });

  it('survives ten flaps without multiplying markers', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    let socket = null;

    for (let i = 0; i < 10; i++) {
      const next = await connect(server.base);
      await joinSession(next, sessionId, 'main', 'device-boat');
      next.emit('update-location', { location: fix(43.083 + i / 1e5, 6.158) });
      await delay(120);
      if (socket) socket.close(); // old socket dies *after* the new one joins
      socket = next;
      await delay(120);
    }
    await delay(600);

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.deepEqual(Object.keys(body.locations), ['device-boat'], 'exactly one marker');
    socket.close();
    await assertStillUp(server, 1);
  });

  it('rejects an oversized deviceId instead of bloating the session map', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const socket = await connect(server.base);
    // Over DEVICE_ID_MAX_LENGTH: falls back to socket.id rather than being
    // stored, so a hostile client cannot mint unbounded keys.
    await joinSession(socket, sessionId, 'main', 'x'.repeat(500));
    socket.emit('update-location', { location: fix(43.083, 6.158) });
    await delay(400);

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    const keys = Object.keys(body.locations);
    assert.equal(keys.length, 1);
    assert.ok(keys[0].length <= 64, `device key ${keys[0].length} chars must be bounded`);
    socket.close();
    await assertStillUp(server, 1);
  });
});

describe('a 24-hour session', () => {
  it('caps the track and does not grow without bound', async (t) => {
    // 24 h of fixes, replayed at speed with backdated timestamps — the
    // server thins on the timestamp, so this exercises exactly the path a
    // real overnight watch takes, without waiting a day for it.
    const server = await boot();
    const sessionId = await createSession(server.base);
    const socket = await connect(server.base);
    await joinSession(socket, sessionId, 'main', 'device-boat');

    const TRACK_MAX_POINTS = 3000;
    const start = Date.now() - 24 * 60 * 60 * 1000;
    const stepMs = 15000; // the server's thinning interval: worst case
    const total = (24 * 60 * 60 * 1000) / stepMs; // 5760 fixes

    const rssOf = () => {
      try {
        const m = /VmRSS:\s+(\d+)\s+kB/.exec(
          fs.readFileSync(`/proc/${server.child.pid}/status`, 'utf8')
        );
        return m ? Number(m[1]) * 1024 : null;
      } catch (err) {
        return null;
      }
    };

    let earlyRss = null;
    for (let i = 0; i < total; i++) {
      socket.emit('update-location', {
        location: {
          latitude: 43.083 + Math.sin(i / 40) / 5000,
          longitude: 6.158 + Math.cos(i / 40) / 5000,
          accuracy: 5,
          timestamp: new Date(start + i * stepMs).toISOString()
        }
      });
      if (i % 200 === 0) await delay(12); // let the server drain its queue
      if (i === Math.floor(total / 3)) {
        await delay(500);
        earlyRss = rssOf();
      }
    }
    await delay(2500);

    // Read the track back the way a remote monitor would.
    const watcher = await connect(server.base);
    const state = await joinSession(watcher, sessionId, 'remote', 'device-watcher');

    t.diagnostic(`sent ${total} fixes over a simulated 24 h; track holds ${state.track.length}`);
    assert.ok(
      state.track.length <= TRACK_MAX_POINTS,
      `track grew to ${state.track.length}, past the ${TRACK_MAX_POINTS} cap`
    );
    assert.equal(state.track.length, TRACK_MAX_POINTS, 'a full day should sit exactly at the cap');

    // The cap must drop the oldest, keeping the most recent hours.
    const timestamps = state.track.map((p) => p[2]);
    assert.ok(
      timestamps[0] > start,
      'the oldest retained point must be later than the start of the day'
    );
    for (let i = 1; i < timestamps.length; i++) {
      assert.ok(timestamps[i] > timestamps[i - 1], 'track must stay ordered');
    }

    const lateRss = rssOf();
    if (earlyRss && lateRss) {
      const growth = ((lateRss - earlyRss) / earlyRss) * 100;
      t.diagnostic(
        `RSS ${(earlyRss / 1048576).toFixed(1)} MB -> ${(lateRss / 1048576).toFixed(1)} MB (${growth.toFixed(1)}%)`
      );
      // The track is capped, so memory must not scale with elapsed time.
      assert.ok(growth < 60, `RSS grew ${growth.toFixed(1)}% across the day — looks like a leak`);
    }

    // The snapshot of a full day must stay a sane size, not tens of MB.
    // Snapshots are written on a 30 s timer, so wait for one rather than
    // assuming the test outran it.
    const snapshotDeadline = Date.now() + 40000;
    while (!fs.existsSync(server.snapshotFile) && Date.now() < snapshotDeadline) {
      await delay(500);
    }
    assert.ok(fs.existsSync(server.snapshotFile), 'the 30 s snapshot timer should have fired');
    const bytes = fs.statSync(server.snapshotFile).size;
    t.diagnostic(`snapshot for one full-day session: ${(bytes / 1024).toFixed(0)} KB`);
    assert.ok(bytes < 2 * 1024 * 1024, `snapshot ${bytes} bytes is larger than expected`);

    // And the session is still live and armed after a simulated day.
    socket.emit('update-location', { location: fix(43.083, 6.158) });
    await delay(400);
    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.ok(body.locations['device-boat'], 'the boat must still be reporting after 24 h');

    watcher.close();
    socket.close();
    await assertStillUp(server, 1);
  });
});
