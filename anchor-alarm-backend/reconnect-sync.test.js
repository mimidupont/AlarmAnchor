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

// The boat phone holds the authoritative state: it keeps working with no
// network at all, so anything the skipper changes while offline — moving
// the anchor, redrawing the zone — exists only on that phone until it can
// say so. If a reconnect does not re-push it, remote monitors keep showing
// last night's zone around an anchor that has moved, and believe it.
//
// These tests describe what a watcher must see, so they hold regardless of
// whether socket.io happens to buffer an emit across a reconnect.

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

const LAT = 43.083;
const LNG = 6.158;

const circle = (lat, lng, radius, steps = 16) =>
  Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return [
      lat + (radius * Math.cos(a)) / 111320,
      lng + (radius * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180))
    ];
  });

// What the boat phone does on (re)joining: announce itself, then re-push
// everything it is authoritative for. This is the contract the client has
// to honour; the tests below assert the watcher-visible consequences.
const resyncAsBoat = async (socket, sessionId, { zone, anchor, track }) => {
  await joinSession(socket, sessionId, 'main', 'device-boat');
  if (zone) socket.emit('update-zone', { zone });
  if (anchor) socket.emit('update-anchor', { anchor, resetTrack: false });
  if (track && track.length) socket.emit('restore-track', { track });
  await delay(300);
};

describe('the boat phone reconnecting after an outage', () => {
  it('re-pushes a zone redrawn while it was offline', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    const original = circle(LAT, LNG, 40);
    await resyncAsBoat(boat, sessionId, {
      zone: original,
      anchor: { latitude: LAT, longitude: LNG, accuracy: 4 }
    });

    const watcher = await connect(server.base);
    const first = await joinSession(watcher, sessionId, 'remote', 'device-watcher');
    assert.equal(first.zone.length, 16);

    // Boat drops off the network and the skipper enlarges the zone.
    boat.close();
    await delay(400);
    const enlarged = circle(LAT, LNG, 80);

    // Back online: a bare rejoin is not enough — the change must follow.
    const boatAgain = await connect(server.base);
    const zoneUpdate = waitFor(watcher, 'zone-updated', 4000);
    await resyncAsBoat(boatAgain, sessionId, {
      zone: enlarged,
      anchor: { latitude: LAT, longitude: LNG, accuracy: 4 }
    });

    const pushed = await zoneUpdate;
    assert.ok(pushed, 'the watcher must be sent the new zone on reconnect');

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    const radius = Math.abs(body.zone[0][0] - LAT) * 111320;
    assert.ok(radius > 70, `server should hold the 80 m zone, got ~${radius.toFixed(0)} m`);

    boatAgain.close();
    watcher.close();
  });

  it('re-pushes an anchor moved while it was offline', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await resyncAsBoat(boat, sessionId, {
      zone: circle(LAT, LNG, 40),
      anchor: { latitude: LAT, longitude: LNG, accuracy: 4 }
    });

    const watcher = await connect(server.base);
    await joinSession(watcher, sessionId, 'remote', 'device-watcher');

    boat.close();
    await delay(400);

    // Re-anchored 60 m north while out of contact.
    const moved = { latitude: LAT + 60 / 111320, longitude: LNG, accuracy: 4 };
    const boatAgain = await connect(server.base);
    const anchorUpdate = waitFor(watcher, 'anchor-updated', 4000);
    await resyncAsBoat(boatAgain, sessionId, { zone: circle(moved.latitude, LNG, 40), anchor: moved });

    const pushed = await anchorUpdate;
    assert.ok(pushed, 'the watcher must be sent the moved anchor');
    assert.ok(
      Math.abs(pushed.anchor.latitude - moved.latitude) < 1e-9,
      'and it must be the new position, not the old one'
    );

    boatAgain.close();
    watcher.close();
  });

  it('leaves a watcher joining later with the corrected state, not the stale one', async () => {
    // The dangerous version: nobody is watching during the outage, and a
    // watcher arrives afterwards. It must not be handed the old zone.
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await resyncAsBoat(boat, sessionId, {
      zone: circle(LAT, LNG, 40),
      anchor: { latitude: LAT, longitude: LNG, accuracy: 4 }
    });
    boat.close();
    await delay(400);

    const moved = { latitude: LAT + 100 / 111320, longitude: LNG, accuracy: 4 };
    const boatAgain = await connect(server.base);
    await resyncAsBoat(boatAgain, sessionId, {
      zone: circle(moved.latitude, LNG, 55),
      anchor: moved
    });

    const watcher = await connect(server.base);
    const state = await joinSession(watcher, sessionId, 'remote', 'device-late');
    assert.ok(
      Math.abs(state.anchor.latitude - moved.latitude) < 1e-9,
      'a late watcher must get the corrected anchor'
    );
    const radius = Math.abs(state.zone[0][0] - moved.latitude) * 111320;
    assert.ok(radius > 50 && radius < 60, `and the corrected zone, got ~${radius.toFixed(0)} m`);

    boatAgain.close();
    watcher.close();
  });

  it('keeps the track across the reconnect rather than resetting it', async () => {
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await joinSession(boat, sessionId, 'main', 'device-boat');
    boat.emit('update-anchor', {
      anchor: { latitude: LAT, longitude: LNG, accuracy: 4 },
      resetTrack: true
    });
    const base = Date.now() - 10 * 20000;
    for (let i = 0; i < 10; i++) {
      boat.emit('update-location', {
        location: fix(LAT + i / 1e6, LNG, { timestamp: new Date(base + i * 20000).toISOString() })
      });
      await delay(15);
    }
    await delay(400);
    boat.close();
    await delay(400);

    // Reconnect re-pushes the anchor with resetTrack: false — the night's
    // track has to survive an outage, it is the whole diagnostic record.
    const boatAgain = await connect(server.base);
    await resyncAsBoat(boatAgain, sessionId, {
      anchor: { latitude: LAT, longitude: LNG, accuracy: 4 }
    });

    const watcher = await connect(server.base);
    const state = await joinSession(watcher, sessionId, 'remote', 'device-watcher');
    assert.equal(state.track.length, 10, 'the track must not be cleared by a reconnect');

    boatAgain.close();
    watcher.close();
  });
});

describe('what happens without a resync', () => {
  it('shows the watcher stale state — the bug being fixed', async () => {
    // Documents the failure mode: rejoin only, no re-push. The server (and
    // therefore every watcher) keeps the pre-outage zone.
    const server = await boot();
    const sessionId = await createSession(server.base);

    const boat = await connect(server.base);
    await resyncAsBoat(boat, sessionId, {
      zone: circle(LAT, LNG, 40),
      anchor: { latitude: LAT, longitude: LNG, accuracy: 4 }
    });
    boat.close();
    await delay(400);

    // Reconnect WITHOUT re-pushing anything.
    const boatAgain = await connect(server.base);
    await joinSession(boatAgain, sessionId, 'main', 'device-boat');
    await delay(400);

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    const radius = Math.abs(body.zone[0][0] - LAT) * 111320;
    assert.ok(
      radius > 35 && radius < 45,
      'without a re-push the server still holds the OLD zone — which is exactly ' +
        'why the client must re-push on every reconnect'
    );

    boatAgain.close();
  });
});
