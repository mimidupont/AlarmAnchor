const assert = require('node:assert/strict');
const fs = require('node:fs');
const { after, describe, it } = require('node:test');

const {
  connect,
  createSession,
  delay,
  fix,
  joinSession,
  makeDataDir,
  startServer,
  stopServer,
  waitFor
} = require('./server-harness');

// Ending a session is the one teardown that is deliberate. Everything else
// — a dead battery, a phone in a bag under a bunk, a lost cellular link —
// looks the same from the server and must NOT end the watch. So this event
// has to be both reliable (every watcher hears it) and tightly held (only
// the boat phone can fire it).

const dirs = [];
const servers = [];

const boot = async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  const server = await startServer({ dataDir, env: { SESSION_RATE_LIMIT: '10000' } });
  servers.push(server);
  return server;
};

after(async () => {
  for (const server of servers) await stopServer(server, 'SIGKILL');
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the boat phone ending the session', () => {
  it('tells every remote monitor, not just the one that asked', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');

    const watcherA = await connect(server.base);
    await joinSession(watcherA, sessionId, 'remote', 'device-a');
    const watcherB = await connect(server.base);
    await joinSession(watcherB, sessionId, 'remote', 'device-b');
    await delay(200);

    const endedA = waitFor(watcherA, 'session-ended', 3000);
    const endedB = waitFor(watcherB, 'session-ended', 3000);
    boat.emit('end-session');

    const [a, b] = await Promise.all([endedA, endedB]);
    assert.ok(a, 'watcher A must be told the watch is over');
    assert.ok(b, 'watcher B must be told too');
    assert.ok(Date.parse(a.endedAt) > 0, 'the notice carries a usable timestamp');

    boat.close();
    watcherA.close();
    watcherB.close();
  });

  it('removes the session, so a late join is refused rather than silently empty', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    boat.emit('update-anchor', {
      anchor: { latitude: 43.083, longitude: 6.158, accuracy: 4 },
      resetTrack: true
    });
    await delay(300);

    boat.emit('end-session');
    await delay(400);

    assert.equal((await fetch(`${server.base}/api/sessions/${sessionId}`)).status, 404);
    const health = await (await fetch(`${server.base}/health`)).json();
    assert.equal(health.sessions, 0);

    // A watcher arriving with the old code is told plainly.
    const late = await connect(server.base);
    const error = await new Promise((resolve) => {
      late.once('error', resolve);
      late.emit('join-session', { sessionId, role: 'remote', deviceId: 'late' });
    });
    assert.equal(error, 'Session not found');

    late.close();
    boat.close();
  });

  it('logs it, so a night can still be reconstructed afterwards', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    boat.emit('end-session');
    await delay(300);

    assert.match(server.output, new RegExp(`\\[session ${sessionId}\\].*session ended by the boat phone`));
    boat.close();
  });
});

describe('a remote monitor cannot end the watch', () => {
  it('ignores end-session from a remote, and the boat keeps being watched', async () => {
    // The whole point of the role split: closing a tab on shore must never
    // stop the alarm on the boat, nor blind anyone else watching.
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    const watcherA = await connect(server.base);
    await joinSession(watcherA, sessionId, 'remote', 'device-a');
    const watcherB = await connect(server.base);
    await joinSession(watcherB, sessionId, 'remote', 'device-b');
    await delay(200);

    watcherA.emit('end-session');
    await delay(600);

    // Nobody was told the watch ended...
    assert.equal(await waitFor(watcherB, 'session-ended', 500), null);
    // ...the session is still there...
    assert.equal((await fetch(`${server.base}/api/sessions/${sessionId}`)).status, 200);
    assert.match(server.output, /ignored end-session from role remote/);

    // ...and it is still live: a fix from the boat still reaches watcher B.
    const update = waitFor(watcherB, 'location-updated', 2000);
    boat.emit('update-location', { location: fix(43.083, 6.158) });
    assert.ok(await update, 'the watch must carry on exactly as before');

    boat.close();
    watcherA.close();
    watcherB.close();
  });

  it('ignores end-session from a socket that never joined anything', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);
    const stranger = await connect(server.base);

    stranger.emit('end-session');
    await delay(400);

    assert.equal((await fetch(`${server.base}/api/sessions/${sessionId}`)).status, 200);
    assert.equal(server.child.exitCode, null, 'and it must not take the server down');

    stranger.close();
  });

  it('cannot be used to end somebody else\'s session', async () => {
    const server = await boot();
    const mine = await createSession(server.base);
    const theirs = await createSession(server.base);

    // A main socket, but joined to a different session than the one it
    // would like to end. socket.sessionId is what the server acts on, so
    // there is no session id to spoof in the payload.
    const attacker = await connect(server.base);
    await joinSession(attacker, mine, 'main', 'device-attacker');
    attacker.emit('end-session', { sessionId: theirs });
    await delay(400);

    assert.equal(
      (await fetch(`${server.base}/api/sessions/${theirs}`)).status,
      200,
      'the other session must be untouched'
    );
    assert.equal((await fetch(`${server.base}/api/sessions/${mine}`)).status, 404);

    attacker.close();
  });
});

describe('the boat phone going quiet without ending the session', () => {
  it('tells watchers the boat went offline, but keeps the session alive', async () => {
    // App closed, killed, flat battery, no signal — indistinguishable, and
    // all recoverable. The watcher must be told; the session must survive.
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watcher');
    await delay(200);

    const offline = waitFor(watcher, 'boat-offline', 4000);
    boat.close();
    const notice = await offline;

    assert.ok(notice, 'the watcher must be told the boat stopped reporting');
    assert.ok(Date.parse(notice.at) > 0);
    assert.match(server.output, /boat phone went offline/);

    // Crucially the session is NOT torn down: this is recoverable.
    assert.equal((await fetch(`${server.base}/api/sessions/${sessionId}`)).status, 200);

    watcher.close();
  });

  it('tells watchers when the boat comes back, so the warning can be cancelled', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watcher');
    await delay(200);

    boat.close();
    assert.ok(await waitFor(watcher, 'boat-offline', 4000));

    // The boat reconnects — a tunnel, a doze, a wifi handover.
    const online = waitFor(watcher, 'boat-online', 4000);
    const boatAgain = await connect(server.base);
    await joinSession(boatAgain, sessionId, 'main', 'device-boat');
    assert.ok(await online, 'the watcher must be told the boat is reporting again');

    boatAgain.close();
    watcher.close();
  });

  it('does not cry wolf when a remote monitor leaves', async () => {
    // Only the boat going quiet matters. A watcher closing its tab must not
    // make the other watchers think the boat is unattended.
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    const watcherA = await connect(server.base);
    await joinSession(watcherA, sessionId, 'remote', 'device-a');
    const watcherB = await connect(server.base);
    await joinSession(watcherB, sessionId, 'remote', 'device-b');
    await delay(200);

    watcherA.close();
    await delay(800);
    assert.equal(await waitFor(watcherB, 'boat-offline', 500), null);

    boat.close();
    watcherB.close();
  });

  it('stays quiet when a stale socket dies after the boat already reconnected', async () => {
    // The flapping case: the replacement socket is live, so the late
    // disconnect of the old one must not report the boat as offline.
    const server = await boot();
    const sessionId = await createSession(server.base);

    const first = await connect(server.base);
    await joinSession(first, sessionId, 'main', 'device-boat');
    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watcher');
    await delay(200);

    // New socket for the same device joins before the old one notices.
    const second = await connect(server.base);
    await joinSession(second, sessionId, 'main', 'device-boat');
    await delay(200);

    first.close(); // the stale socket finally drops
    await delay(900);
    assert.equal(
      await waitFor(watcher, 'boat-offline', 600),
      null,
      'a superseded socket dying must not raise a false alarm'
    );

    second.close();
    watcher.close();
  });
});

describe('an ended session does not come back', () => {
  it('stays gone across a restart', async () => {
    // The snapshot must not resurrect a watch its owner deliberately closed.
    const dataDir = makeDataDir();
    dirs.push(dataDir);
    const first = await startServer({ dataDir, env: { SESSION_RATE_LIMIT: '10000' } });
    servers.push(first);

    const sessionId = await createSession(first.base);
    const boat = await connect(first.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    boat.emit('end-session');
    await delay(400);
    boat.close();
    await stopServer(first, 'SIGTERM');

    const second = await startServer({ dataDir, env: { SESSION_RATE_LIMIT: '10000' } });
    servers.push(second);
    assert.equal((await fetch(`${second.base}/api/sessions/${sessionId}`)).status, 404);
  });
});
