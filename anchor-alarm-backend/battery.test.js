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

// The boat phone is the alarm, so its battery is part of the watch: a flat
// battery is the commonest way the watch silently ends. The boat shares its
// battery and the server relays it to the monitors ashore — but only the
// boat's, and only from the boat.

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

describe('boat battery relay', () => {
  it('relays the boat battery to every remote monitor', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watch');
    await delay(200);

    const got = waitFor(watcher, 'battery-updated', 3000);
    boat.emit('update-battery', { battery: { level: 0.15, charging: false } });

    const msg = await got;
    assert.equal(msg.battery.level, 0.15);
    assert.equal(msg.battery.charging, false);
    assert.ok(Date.parse(msg.battery.at) > 0, 'the report carries a usable timestamp');
  });

  it('hands the last known battery to a monitor joining later', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    boat.emit('update-battery', { battery: { level: 0.42, charging: true } });
    await delay(200);

    const watcher = await connect(server.base);
    const state = waitFor(watcher, 'state-update', 3000);
    watcher.emit('join-session', { sessionId, role: 'remote', deviceId: 'device-late' });

    const msg = await state;
    assert.ok(msg.battery, 'the join snapshot carries the boat battery');
    assert.equal(msg.battery.level, 0.42);
    assert.equal(msg.battery.charging, true);
  });

  it('ignores a battery report from a remote monitor', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watch');
    await delay(200);

    // A remote forging a battery reading must not reach anyone.
    let leaked = false;
    watcher.on('battery-updated', () => { leaked = true; });
    const other = await connect(server.base);
    await joinSession(other, sessionId, 'remote', 'device-other');
    other.on('battery-updated', () => { leaked = true; });

    watcher.emit('update-battery', { battery: { level: 0.99, charging: true } });
    await delay(300);
    assert.equal(leaked, false, 'a remote cannot push a battery reading to the session');
  });

  it('rejects a nonsense battery level', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watch');
    await delay(200);

    let received = false;
    watcher.on('battery-updated', () => { received = true; });
    boat.emit('update-battery', { battery: { level: 5, charging: 'yes' } });
    await delay(300);
    assert.equal(received, false, 'an out-of-range level with no valid field is dropped');
  });
});
