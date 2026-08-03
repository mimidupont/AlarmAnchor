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

// The server's isPointInPolygon and the client's utils/geo.js copy have to
// reach the same verdict about the same fix — that is the whole basis for
// the boat phone alarming locally while the server alarms for the remote
// monitor. These tests drive a real session over the wire, so a change to
// one copy and not the other shows up as a failure here rather than as a
// remote monitor that disagrees with the phone in your hand at 3 a.m.

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

// A ~220 m box straddling the 180th meridian at 60 N, vertices normalised
// into [-180, 180] the way a real GPS or map source delivers them.
const ANTIMERIDIAN_ZONE = [
  [59.999, 179.999],
  [60.001, 179.999],
  [60.001, -179.999],
  [59.999, -179.999]
];

const armed = async (server, zone) => {
  const sessionId = await createSession(server.base);
  const socket = await connect(server.base);
  await joinSession(socket, sessionId, 'main', 'device-boat');
  socket.emit('update-zone', { zone });
  await delay(250);
  return { sessionId, socket };
};

describe('the server geofence across the antimeridian', () => {
  it('does not alarm for a boat sitting inside a zone that spans the meridian', async () => {
    const server = await boot();
    const { sessionId, socket } = await armed(server, ANTIMERIDIAN_ZONE);

    for (const [lat, lng] of [
      [60.0, 179.9999],
      [60.0, -179.9999],
      [60.0, 179.9995],
      [59.9995, -179.9995]
    ]) {
      socket.emit('update-location', { location: fix(lat, lng) });
      await delay(200);
    }
    await delay(300);

    const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.equal(body.alarmed, false, 'a boat inside the zone must not be alarming');
    socket.close();
  });

  it('alarms for a boat that leaves across the meridian', async () => {
    const server = await boot();
    const { socket } = await armed(server, ANTIMERIDIAN_ZONE);

    socket.emit('update-location', { location: fix(60.0, 179.9999) });
    await delay(300);

    // ~250 m east, over the meridian and out the far side of the box.
    const alarm = waitFor(socket, 'alarm-status-changed', 3000);
    socket.emit('update-location', { location: fix(60.0, -179.9955) });
    const raised = await alarm;

    assert.ok(raised, 'leaving the zone must raise the alarm');
    assert.equal(raised.alarmed, true);
    socket.close();
  });

  it('never treats the other side of the planet as inside the zone', async () => {
    // The dangerous direction: read as spanning 359.998 degrees, the zone
    // swallows most of the globe and the alarm can never fire.
    const server = await boot();
    const { sessionId, socket } = await armed(server, ANTIMERIDIAN_ZONE);

    for (const [lat, lng] of [
      [60.0, 0],
      [60.0, 6.158],
      [60.0, -70],
      [60.0, 90]
    ]) {
      socket.emit('update-location', { location: fix(lat, lng) });
      await delay(250);
      const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
      assert.equal(body.alarmed, true, `a boat at lng ${lng} is outside and must alarm`);
      // Return inside so the next case tests a fresh transition.
      socket.emit('update-location', { location: fix(60.0, 179.9999) });
      await delay(250);
    }
    socket.close();
  });

  it('still behaves normally for an ordinary zone far from the meridian', async () => {
    const server = await boot();
    const zone = [
      [43.083, 6.158],
      [43.0835, 6.158],
      [43.0835, 6.1585],
      [43.083, 6.1585]
    ];
    const { sessionId, socket } = await armed(server, zone);

    socket.emit('update-location', { location: fix(43.0832, 6.1582) });
    await delay(400);
    let body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.equal(body.alarmed, false, 'inside the zone: silent');

    socket.emit('update-location', { location: fix(43.09, 6.17) });
    await delay(400);
    body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
    assert.equal(body.alarmed, true, 'outside the zone: alarming');

    socket.close();
  });

  it('agrees with the client copy of the algorithm, point for point', async () => {
    // Runs the exact table the client's geo.antimeridian.test.js asserts,
    // through the server, so the two implementations cannot drift apart.
    const server = await boot();
    const { sessionId, socket } = await armed(server, ANTIMERIDIAN_ZONE);

    const cases = [
      { lat: 60.0, lng: 179.9999, expectAlarm: false },
      { lat: 60.0, lng: -179.9999, expectAlarm: false },
      { lat: 60.0, lng: 0, expectAlarm: true },
      { lat: 60.0, lng: 6.158, expectAlarm: true },
      { lat: 60.0, lng: -70, expectAlarm: true },
      { lat: 60.01, lng: 179.9999, expectAlarm: true }
    ];

    for (const { lat, lng, expectAlarm } of cases) {
      // Clear any latched acknowledgement by returning inside first.
      socket.emit('update-location', { location: fix(60.0, 179.9999) });
      await delay(200);
      socket.emit('update-location', { location: fix(lat, lng) });
      await delay(250);

      const body = await (await fetch(`${server.base}/api/sessions/${sessionId}`)).json();
      assert.equal(
        body.alarmed,
        expectAlarm,
        `server disagrees with the client at ${lat},${lng}`
      );
    }
    socket.close();
  });
});
