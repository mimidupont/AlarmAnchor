const assert = require('node:assert/strict');
const fs = require('node:fs');
const { after, describe, it } = require('node:test');

const {
  connect,
  createSession,
  delay,
  joinSession,
  makeDataDir,
  startServer,
  stopServer,
  waitFor
} = require('./server-harness');

// Resuming a watch as the boat phone is the privileged move in this app: the
// 'main' role owns the alarm, the zone, the anchor and the right to end the
// session. The session ID is a bearer token handed to everyone watching from
// shore, so "knows the code" cannot be the test for it — otherwise any
// watcher could rejoin as the boat and start redrawing the zone the boat is
// actually anchored on. The creating device's ID is what is checked.

const dirs = [];
const servers = [];

const boot = async (opts = {}) => {
  const dataDir = opts.dataDir || makeDataDir();
  if (!opts.dataDir) dirs.push(dataDir);
  const server = await startServer({ dataDir, env: { SESSION_RATE_LIMIT: '10000' } });
  servers.push(server);
  return server;
};

after(async () => {
  for (const server of servers) await stopServer(server, 'SIGKILL');
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Create a session the way the app does now: the boat phone's device ID
// travels with the request and becomes the session's owner.
const createOwnedSession = async (base, deviceId) => {
  const res = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId })
  });
  if (!res.ok) throw new Error(`create session failed: ${res.status}`);
  return (await res.json()).sessionId;
};

// join-session that resolves to the error instead of rejecting, so a refusal
// can be asserted on directly.
const tryJoin = (socket, sessionId, role, deviceId) =>
  new Promise((resolve) => {
    const done = (result) => {
      socket.off('error', onError);
      socket.off('state-update', onState);
      resolve(result);
    };
    const onError = (message) => done({ ok: false, message });
    const onState = (state) => done({ ok: true, state });
    socket.once('error', onError);
    socket.once('state-update', onState);
    socket.emit('join-session', { sessionId, role, deviceId });
    setTimeout(() => done({ ok: false, message: '(timeout)' }), 3000);
  });

describe('resuming a watch as the boat phone', () => {
  it('lets the device that created the session come back to it', async () => {
    const server = await boot();
    const sessionId = await createOwnedSession(server.base, 'device-boat');

    // First run of the app.
    const first = await connect(server.base);
    await joinSession(first, sessionId, 'main', 'device-boat');
    first.emit('update-anchor', {
      anchor: { latitude: 43.08, longitude: 6.15, accuracy: 4 },
      resetTrack: true
    });
    await delay(300);
    first.close(); // killed by Android
    await delay(400);

    // Relaunched, same phone, same session.
    const again = await connect(server.base);
    const result = await tryJoin(again, sessionId, 'main', 'device-boat');
    assert.ok(result.ok, `the owning device must be allowed back in, got ${result.message}`);
    assert.ok(result.state.anchor, 'and must be handed the session state it left behind');

    again.close();
  });

  it('refuses a different device trying to take the watch over', async () => {
    const server = await boot();
    const sessionId = await createOwnedSession(server.base, 'device-boat');

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    await delay(200);

    // A watcher ashore has the code — that is how watching works — and tries
    // to join as the boat.
    const watcher = await connect(server.base);
    const result = await tryJoin(watcher, sessionId, 'main', 'device-watcher');

    assert.equal(result.ok, false, 'a different device must not become the boat phone');
    assert.equal(result.message, 'Session belongs to another device');

    boat.close();
    watcher.close();
  });

  it('still lets that device watch as a remote', async () => {
    // Refusing the takeover must not lock a watcher out of watching.
    const server = await boot();
    const sessionId = await createOwnedSession(server.base, 'device-boat');

    const watcher = await connect(server.base);
    const rejected = await tryJoin(watcher, sessionId, 'main', 'device-watcher');
    assert.equal(rejected.ok, false);

    const accepted = await tryJoin(watcher, sessionId, 'remote', 'device-watcher');
    assert.ok(accepted.ok, 'watching from shore needs only the code, as before');

    watcher.close();
  });

  it('does not let a refused device end the session either', async () => {
    // The refused join must leave no trace on the socket: if socket.role had
    // been set to 'main' before the check, end-session would have obeyed it.
    const server = await boot();
    const sessionId = await createOwnedSession(server.base, 'device-boat');

    const attacker = await connect(server.base);
    await tryJoin(attacker, sessionId, 'main', 'device-attacker');
    attacker.emit('end-session');
    await delay(400);

    assert.equal(
      (await fetch(`${server.base}/api/sessions/${sessionId}`)).status,
      200,
      'the session must survive an end-session from a refused device'
    );

    attacker.close();
  });

  it('survives a restart — a reboot must not release the claim', async () => {
    // Ownership lives in the snapshot. Without that, every deploy would
    // briefly turn every live session into a free-for-all.
    const dataDir = makeDataDir();
    dirs.push(dataDir);
    const server = await boot({ dataDir });
    const sessionId = await createOwnedSession(server.base, 'device-boat');

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    await delay(300);
    boat.close();

    await stopServer(server, 'SIGTERM'); // flushes the snapshot
    const restarted = await boot({ dataDir });

    const stranger = await connect(restarted.base);
    const result = await tryJoin(stranger, sessionId, 'main', 'device-stranger');
    assert.equal(result.ok, false, 'the claim must survive the restart');
    assert.equal(result.message, 'Session belongs to another device');
    stranger.close();

    const owner = await connect(restarted.base);
    const mine = await tryJoin(owner, sessionId, 'main', 'device-boat');
    assert.ok(mine.ok, 'and the owner must still get back in after the restart');
    owner.close();
  });

  it('leaves an unclaimed session claimable, so an older client still works', async () => {
    // Sessions created before this existed (and by clients that send no
    // deviceId) have no owner. Locking those out would strand a live boat
    // on deploy day; the first main join claims them instead.
    const server = await boot();
    const sessionId = await createSession(server.base); // no deviceId

    const boat = await connect(server.base);
    const first = await tryJoin(boat, sessionId, 'main', 'device-boat');
    assert.ok(first.ok, 'an unowned session must accept the first boat phone');
    await delay(200);

    const other = await connect(server.base);
    const second = await tryJoin(other, sessionId, 'main', 'device-other');
    assert.equal(second.ok, false, 'but it is claimed from then on');

    boat.close();
    other.close();
  });

  it('does not disturb the watchers when a takeover is refused', async () => {
    const server = await boot();
    const sessionId = await createOwnedSession(server.base, 'device-boat');

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watcher');
    await delay(200);

    // A refused join must not announce itself as a new client, and must
    // certainly not look like the boat coming online.
    const joined = waitFor(watcher, 'client-joined', 1500);
    const online = waitFor(watcher, 'boat-online', 1500);

    const attacker = await connect(server.base);
    await tryJoin(attacker, sessionId, 'main', 'device-attacker');

    assert.equal(await joined, null, 'no client-joined for a refused device');
    assert.equal(await online, null, 'and no boat-online');

    boat.close();
    watcher.close();
    attacker.close();
  });
});
