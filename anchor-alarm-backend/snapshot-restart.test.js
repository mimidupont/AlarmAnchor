const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { after, before, describe, it } = require('node:test');

const {
  connect,
  createSession,
  delay,
  fix,
  joinSession,
  makeDataDir,
  startServer,
  stopServer
} = require('./server-harness');

// Checklist 1.2. The module-level round-trip is covered in snapshot.test.js;
// everything here deliberately crosses the process boundary, because that is
// the thing being claimed — "restart the machine and the sessions come back"
// is not proven by calling a function twice in one process.

const dirs = [];
const servers = [];

const newDir = () => {
  const dir = makeDataDir();
  dirs.push(dir);
  return dir;
};

const boot = async (dataDir, env) => {
  const server = await startServer({ dataDir, env });
  servers.push(server);
  return server;
};

after(async () => {
  for (const server of servers) await stopServer(server, 'SIGKILL');
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('write sessions -> restart process -> identical state restored', () => {
  it('brings back the zone, anchor and full track after a SIGTERM restart', async (t) => {
    t.diagnostic('boot 1: create a session and arm it');
    const dataDir = newDir();
    const first = await boot(dataDir);

    const sessionId = await createSession(first.base);
    const socket = await connect(first.base);
    await joinSession(socket, sessionId, 'main', 'device-boat');

    const zone = [
      [43.083, 6.158],
      [43.0835, 6.158],
      [43.0835, 6.1585],
      [43.083, 6.1585]
    ];
    const anchor = { latitude: 43.0832, longitude: 6.1582, accuracy: 4 };

    socket.emit('update-zone', { zone });
    socket.emit('update-anchor', { anchor, resetTrack: true });

    // Enough spaced fixes to build a real track. The 20 s spacing clears the
    // server's 15 s thinning interval so every one is recorded.
    const base = Date.now() - 20 * 20000;
    for (let i = 0; i < 20; i++) {
      socket.emit('update-location', {
        location: fix(43.0832 + i / 1e6, 6.1582, {
          timestamp: new Date(base + i * 20000).toISOString()
        })
      });
      await delay(15);
    }
    await delay(400);

    const before = await (await fetch(`${first.base}/api/sessions/${sessionId}`)).json();
    assert.equal(before.zone.length, 4);

    socket.close();
    // SIGTERM is what `fly deploy` and `fly machines restart` send.
    await stopServer(first, 'SIGTERM');
    assert.match(first.output, /flushing snapshot/);

    t.diagnostic('boot 2: same data dir, fresh process');
    const second = await boot(dataDir);
    assert.match(second.output, /restored 1 session/);

    const after_ = await (await fetch(`${second.base}/api/sessions/${sessionId}`)).json();
    assert.deepEqual(after_.zone, before.zone, 'zone must survive the restart');
    assert.deepEqual(after_.anchor, before.anchor, 'anchor must survive the restart');

    // The track is not on the REST payload, so read it back over a join.
    const rejoined = await connect(second.base);
    const state = await joinSession(rejoined, sessionId, 'remote', 'device-watcher');
    assert.equal(state.track.length, 20, 'the whole track must come back');
    assert.deepEqual(state.zone, zone);
    assert.deepEqual(state.anchor, anchor);
    rejoined.close();

    // Live positions must NOT come back: that socket died with the process,
    // and a restored marker is a boat that looks alive and never moves.
    assert.deepEqual(state.locations, {}, 'locations must be cleared on load');
  });

  it('restores many sessions at once, the way a real restart would', async () => {
    const dataDir = newDir();
    const first = await boot(dataDir);

    const ids = [];
    for (let i = 0; i < 10; i++) ids.push(await createSession(first.base));

    const sockets = [];
    for (const [i, id] of ids.entries()) {
      const socket = await connect(first.base);
      await joinSession(socket, id, 'main', `device-${i}`);
      socket.emit('update-anchor', {
        anchor: { latitude: 43.08 + i / 1000, longitude: 6.15, accuracy: 5 },
        resetTrack: true
      });
      sockets.push(socket);
    }
    await delay(400);
    for (const s of sockets) s.close();
    await stopServer(first, 'SIGTERM');

    const second = await boot(dataDir);
    const health = await (await fetch(`${second.base}/health`)).json();
    assert.equal(health.sessions, 10);

    for (const [i, id] of ids.entries()) {
      const res = await fetch(`${second.base}/api/sessions/${id}`);
      assert.equal(res.status, 200, `session ${id} must come back`);
      const body = await res.json();
      assert.ok(Math.abs(body.anchor.latitude - (43.08 + i / 1000)) < 1e-9);
    }
  });
});

describe('kill -9 during a write leaves a valid file', () => {
  it('never publishes a half-written sessions.json', async (t) => {
    // Hammer writeSnapshotSync in a child process with a payload big enough
    // that a write is not instantaneous, then SIGKILL mid-flight. rename(2)
    // is the only thing that publishes the file, so the final path must
    // always parse — a stale snapshot is fine, a truncated one is not.
    const dataDir = newDir();
    const script = path.join(dataDir, 'writer.js');
    fs.writeFileSync(
      script,
      `
      const { writeSnapshotSync } = require(${JSON.stringify(path.join(__dirname, 'snapshot.js'))});
      const dir = process.argv[2];
      // ~20 sessions x 3000 track points: a couple of MB, so the write takes
      // long enough for a kill to land inside it.
      const track = Array.from({ length: 3000 }, (_, i) => [43.083 + i / 1e6, 6.158, 1700000000000 + i]);
      const sessions = new Map();
      for (let i = 0; i < 20; i++) {
        sessions.set('SESSION' + String(i).padStart(2, '0'), {
          zone: [[43.083, 6.158], [43.084, 6.158], [43.084, 6.159]],
          alarmed: false, acknowledged: false,
          anchor: { latitude: 43.083, longitude: 6.158 },
          track, createdAt: 1, lastActivity: Date.now()
        });
      }
      process.send && process.send('ready');
      for (;;) writeSnapshotSync(dir, sessions);
      `
    );

    const target = path.join(dataDir, 'sessions.json');
    let killedMidWrite = 0;

    for (let attempt = 0; attempt < 12; attempt++) {
      const child = spawn(process.execPath, [script, dataDir], { stdio: 'ignore' });
      // Let it get into the write loop, then kill at a varying offset so the
      // kill lands at different points inside the write.
      await delay(120 + attempt * 25);
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));

      const exists = fs.existsSync(target);
      if (!exists) continue; // killed before the first rename — nothing published yet

      const raw = fs.readFileSync(target, 'utf8');
      let parsed;
      assert.doesNotThrow(() => {
        parsed = JSON.parse(raw);
      }, `sessions.json was truncated by SIGKILL on attempt ${attempt}`);
      assert.equal(Object.keys(parsed.sessions).length, 20);

      // A stray .tmp is acceptable debris; a corrupt final file is not.
      if (fs.existsSync(`${target}.tmp`)) killedMidWrite++;
      fs.rmSync(`${target}.tmp`, { force: true });
    }

    t.diagnostic(`kill landed mid-write (stray .tmp left) on ${killedMidWrite}/12 attempts`);
    assert.ok(killedMidWrite > 0, 'no kill actually landed during a write — test proved nothing');
  });

  it('boots cleanly from whatever a kill -9 left behind', async () => {
    const dataDir = newDir();
    const first = await boot(dataDir);
    const sessionId = await createSession(first.base);
    const socket = await connect(first.base);
    await joinSession(socket, sessionId, 'main', 'device-boat');
    socket.emit('update-anchor', {
      anchor: { latitude: 43.083, longitude: 6.158, accuracy: 4 },
      resetTrack: true
    });

    // Force at least one timer snapshot to reach disk before pulling the plug.
    await delay(31000);
    assert.ok(fs.existsSync(first.snapshotFile), 'the 30 s timer must have written a snapshot');
    socket.close();

    // No SIGTERM handler runs on SIGKILL: this is the host-yanked-the-machine
    // case, not a deploy.
    await stopServer(first, 'SIGKILL');

    const second = await boot(dataDir);
    const res = await fetch(`${second.base}/api/sessions/${sessionId}`);
    assert.equal(res.status, 200, 'the last timer snapshot must still be usable');
  });
});

describe('a corrupted snapshot never stops the server booting', () => {
  const cases = {
    'truncated mid-object': '{"version":1,"sessions":{"ABCDEFGHJ":{"zone":[[43.0',
    'hand-edited into nonsense': '{"version":1,"sessions":{"ABCDEFGHJ":{"zone":[[43.0,6.1],,]}}}',
    'not an object at all': '[1,2,3]',
    'binary garbage': ' ÿ not json at all  ',
    'empty file': ''
  };

  for (const [name, contents] of Object.entries(cases)) {
    it(`starts clean and warns — ${name}`, async () => {
      const dataDir = newDir();
      fs.writeFileSync(path.join(dataDir, 'sessions.json'), contents);

      const server = await boot(dataDir);
      // Booting at all is most of the assertion: an anchor alarm backend
      // that refuses to start is worse than one that forgot last night.
      const health = await (await fetch(`${server.base}/health`)).json();
      assert.equal(health.status, 'ok');
      assert.equal(health.sessions, 0, 'must start clean, not with junk sessions');

      if (contents.trim()) {
        assert.match(server.output, /\[snapshot\] ignoring/, 'must log a warning saying why');
        assert.match(server.output, /starting clean/);
      }

      // And it must still be able to serve a new session immediately.
      const sessionId = await createSession(server.base);
      assert.equal((await fetch(`${server.base}/api/sessions/${sessionId}`)).status, 200);
    });
  }

  it('overwrites the corrupt file with a good one instead of tripping on it forever', async () => {
    const dataDir = newDir();
    fs.writeFileSync(path.join(dataDir, 'sessions.json'), '{"sessions": tru');

    const first = await boot(dataDir);
    const sessionId = await createSession(first.base);
    await stopServer(first, 'SIGTERM');

    const second = await boot(dataDir);
    assert.doesNotMatch(second.output, /\[snapshot\] ignoring/);
    assert.equal((await fetch(`${second.base}/api/sessions/${sessionId}`)).status, 200);
  });
});

describe('sessions past SESSION_IDLE_TTL are dropped on load', () => {
  it('drops a session idle for more than 24 h and keeps a fresh one', async () => {
    const dataDir = newDir();
    const now = Date.now();
    const session = (lastActivity) => ({
      zone: [
        [43.083, 6.158],
        [43.084, 6.158],
        [43.084, 6.159]
      ],
      alarmed: false,
      acknowledged: false,
      anchor: { latitude: 43.083, longitude: 6.158 },
      track: [],
      createdAt: lastActivity,
      lastActivity
    });

    fs.writeFileSync(
      path.join(dataDir, 'sessions.json'),
      JSON.stringify({
        version: 1,
        savedAt: now,
        sessions: {
          FRESHONE1: session(now - 60 * 60 * 1000), // 1 h idle
          EDGECASE1: session(now - 23 * 60 * 60 * 1000), // 23 h idle
          STALEONE1: session(now - 25 * 60 * 60 * 1000), // 25 h idle
          ANCIENT01: session(now - 40 * 24 * 60 * 60 * 1000)
        }
      })
    );

    const server = await boot(dataDir);
    assert.match(server.output, /dropped 2 expired\/invalid/);

    assert.equal((await fetch(`${server.base}/api/sessions/FRESHONE1`)).status, 200);
    assert.equal((await fetch(`${server.base}/api/sessions/EDGECASE1`)).status, 200);
    assert.equal((await fetch(`${server.base}/api/sessions/STALEONE1`)).status, 404);
    assert.equal((await fetch(`${server.base}/api/sessions/ANCIENT01`)).status, 404);

    const health = await (await fetch(`${server.base}/health`)).json();
    assert.equal(health.sessions, 2);
  });
});
