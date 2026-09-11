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

// An acknowledgement must not outlive the watch it was about.
//
// `acknowledged` means "the skipper has seen this excursion and wants
// quiet". Until this was fixed the only thing that ever cleared it was a
// fix landing back INSIDE the zone — so a skipper who silenced one alarm
// and then re-anchored somewhere the boat was already outside of (which is
// also how most people test the alarm: leave the boat where it is and move
// the anchor) left the flag set for the life of the session. Every later
// drag was evaluated, found outside, and silenced. No alarm, no warning,
// and a session that looks armed from every screen.
//
// These drive a real server over the wire, because the flag lives in the
// session and the bug is in when it is cleared, not in the geofence.

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

// A ~55 m box, `northM` metres north of the anchorage.
const zoneAt = (northM) => {
  const d = northM / 111320;
  return [
    [43.083 + d, 6.158],
    [43.0835 + d, 6.158],
    [43.0835 + d, 6.1585],
    [43.083 + d, 6.1585]
  ];
};

const INSIDE = [43.0832, 6.1582];
const alarmed = async (server, sessionId) =>
  (await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json()).alarmed;

// Arm a zone, put the boat inside it, drag it out, and silence the alarm —
// the state every one of these tests starts from.
const silencedAfterOneAlarm = async (server) => {
  const sessionId = await createSession(server.base);
  const socket = await connect(server.base);
  await joinSession(socket, sessionId, 'main', 'device-boat');

  socket.emit('update-zone', { zone: zoneAt(0) });
  await delay(200);
  socket.emit('update-location', { location: fix(...INSIDE) });
  await delay(200);

  // Out of the zone: the alarm fires.
  const raised = waitFor(socket, 'alarm-status-changed', 3000);
  socket.emit('update-location', { location: fix(43.084, 6.1582) });
  assert.equal((await raised)?.alarmed, true, 'leaving the zone must alarm');

  socket.emit('acknowledge-alarm');
  await delay(200);
  assert.equal(await alarmed(server, sessionId), false, 'acknowledging must silence it');

  return { sessionId, socket };
};

describe('re-arming after a silenced alarm', () => {
  it('alarms again on a new zone the boat is already outside of', async () => {
    const server = await boot();
    const { sessionId, socket } = await silencedAfterOneAlarm(server);

    // The "move the anchor away" test, done a second time. The boat never
    // re-enters a zone, so nothing but the re-arm can clear the flag.
    socket.emit('update-zone', { zone: zoneAt(300) });
    await delay(200);
    socket.emit('update-location', { location: fix(...INSIDE) });
    await delay(400);

    assert.equal(
      await alarmed(server, sessionId),
      true,
      'a zone armed around a distant anchor must alarm, not inherit the old acknowledgement'
    );
    socket.close();
  });

  it('alarms again after the anchor is dropped somewhere new', async () => {
    // The server judges the zone, never the anchor — but re-dropping the
    // anchor is the skipper saying "this is a new anchoring", so the
    // acknowledgement that belonged to the old one must not survive it.
    // The boat here has not moved: it is still outside, still silenced,
    // and it is the re-drop alone that has to make it audible again.
    const server = await boot();
    const { sessionId, socket } = await silencedAfterOneAlarm(server);

    socket.emit('update-anchor', {
      anchor: { latitude: 43.086, longitude: 6.1582, accuracy: 5 },
      resetTrack: true
    });
    await delay(200);
    socket.emit('update-location', { location: fix(43.0841, 6.1582) });
    await delay(400);

    assert.equal(await alarmed(server, sessionId), true, 're-dropping the anchor re-arms the watch');
    socket.close();
  });

  it('still lets an acknowledgement silence the excursion it was about', async () => {
    // The other half of the rule: nothing here may make an acknowledgement
    // stop working while the watch is unchanged, or the skipper motoring
    // deliberately out of the anchorage cannot get any peace.
    const server = await boot();
    const { sessionId, socket } = await silencedAfterOneAlarm(server);

    for (const lat of [43.0841, 43.0842, 43.0843]) {
      socket.emit('update-location', { location: fix(lat, 6.1582) });
      await delay(200);
      assert.equal(await alarmed(server, sessionId), false, 'still silenced while outside');
    }
    socket.close();
  });

  it('re-arms as usual when the boat returns inside the zone', async () => {
    const server = await boot();
    const { sessionId, socket } = await silencedAfterOneAlarm(server);

    socket.emit('update-location', { location: fix(...INSIDE) });
    await delay(300);
    const raised = waitFor(socket, 'alarm-status-changed', 3000);
    socket.emit('update-location', { location: fix(43.084, 6.1582) });

    assert.equal((await raised)?.alarmed, true);
    assert.equal(await alarmed(server, sessionId), true);
    socket.close();
  });
});
