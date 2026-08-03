const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Shared plumbing for the tests that need a real server process rather than
// a required module: snapshot restart round-trips, kill -9 atomicity and the
// abuse cases all have to exercise the process boundary to mean anything.

const SERVER = path.join(__dirname, 'server.js');

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const makeDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-server-'));

// Boot server.js as its own process and wait until /health answers.
async function startServer({ dataDir, env = {}, port } = {}) {
  const dir = dataDir || makeDataDir();
  const p = port || (await freePort());

  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(p),
      DATA_DIR: dir,
      // Keep the test output readable; individual tests opt into debug.
      LOG_LEVEL: 'info',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (d) => {
    output += d.toString();
  });
  child.stderr.on('data', (d) => {
    output += d.toString();
  });

  const base = `http://127.0.0.1:${p}`;
  const server = {
    child,
    port: p,
    dataDir: dir,
    base,
    get output() {
      return output;
    },
    snapshotFile: path.join(dir, 'sessions.json')
  };

  // Poll /health rather than sleeping a fixed amount: on a loaded CI box the
  // boot can take a while, and a fixed sleep is how these tests turn flaky.
  const deadline = Date.now() + 15000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode}):\n${output}`);
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) break;
    } catch (err) {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`server never became healthy:\n${output}`);
    await delay(100);
  }

  return server;
}

// Stop with the signal a real platform would send. SIGTERM gives the server
// its shutdown path (which flushes the snapshot); SIGKILL does not.
function stopServer(server, signal = 'SIGTERM') {
  return new Promise((resolve) => {
    if (!server || !server.child || server.child.exitCode !== null) return resolve();
    server.child.once('exit', () => resolve());
    server.child.kill(signal);
    // Don't hang the suite if a process refuses to die.
    setTimeout(() => {
      try {
        server.child.kill('SIGKILL');
      } catch (err) {
        /* already gone */
      }
      resolve();
    }, 8000).unref();
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createSession = async (base) => {
  const res = await fetch(`${base}/api/sessions`, { method: 'POST' });
  if (!res.ok) throw new Error(`create session failed: ${res.status}`);
  const { sessionId } = await res.json();
  return sessionId;
};

const health = async (base) => (await fetch(`${base}/health`)).json();

// Connect a socket.io client and resolve once it is actually connected.
function connect(base, { transports = ['websocket'] } = {}) {
  const { io } = require('socket.io-client');
  const socket = io(base, { transports, reconnection: false, timeout: 8000 });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timed out')), 10000).unref();
  });
}

// Join a session and resolve with the state-update the server sends back.
function joinSession(socket, sessionId, role, deviceId) {
  return new Promise((resolve, reject) => {
    const onState = (state) => {
      socket.off('error', onError);
      resolve(state);
    };
    const onError = (msg) => {
      socket.off('state-update', onState);
      reject(new Error(String(msg)));
    };
    socket.once('state-update', onState);
    socket.once('error', onError);
    socket.emit('join-session', { sessionId, role, deviceId });
    setTimeout(() => reject(new Error('join timed out')), 8000).unref();
  });
}

// Wait for a named event, or resolve null if it never arrives. Used to prove
// a *negative* (the server stayed silent on a malformed payload) as well as
// a positive.
function waitFor(socket, event, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(null);
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload === undefined ? {} : payload);
    };
    socket.on(event, onEvent);
  });
}

const fix = (lat, lng, extra = {}) => ({
  latitude: lat,
  longitude: lng,
  accuracy: 5,
  timestamp: new Date().toISOString(),
  ...extra
});

module.exports = {
  connect,
  createSession,
  delay,
  fix,
  freePort,
  health,
  joinSession,
  makeDataDir,
  startServer,
  stopServer,
  waitFor
};
