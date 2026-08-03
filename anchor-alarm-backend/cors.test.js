const assert = require('node:assert/strict');
const fs = require('node:fs');
const { after, describe, it } = require('node:test');

const { createSession, delay, health, makeDataDir, startServer, stopServer } = require('./server-harness');

// A browser that cannot pass CORS cannot open a socket, and the symptom is
// indistinguishable from the backend being down: the remote monitor never
// appears. The native app is immune — its HTTP stack sends no Origin header
// — which is why this reads as "works in the app, not in the browser".

const dirs = [];
const servers = [];

const boot = async (env = {}) => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  const server = await startServer({ dataDir, env: { SESSION_RATE_LIMIT: '10000', ...env } });
  servers.push(server);
  return server;
};

after(async () => {
  for (const server of servers) await stopServer(server, 'SIGKILL');
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

// What a browser actually needs: the preflight/actual response must carry
// Access-Control-Allow-Origin, or the fetch and the socket handshake fail.
const allowedFor = async (base, origin, path = '/api/sessions') => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { Origin: origin } });
  return res.headers.get('access-control-allow-origin');
};

// The socket.io handshake is the thing that actually matters for the map.
const handshakeAllowedFor = async (base, origin) => {
  const res = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: origin }
  });
  return res.headers.get('access-control-allow-origin');
};

describe('browser origins that must be able to join', () => {
  it('allows the production Vercel site', async () => {
    const server = await boot();
    const origin = 'https://alarm-anchor.vercel.app';
    assert.equal(await allowedFor(server.base, origin), origin);
    assert.equal(await handshakeAllowedFor(server.base, origin), origin);
  });

  it('allows a Vercel preview deployment of the same project', async (t) => {
    // The regression: only the bare alias was listed, so every per-deploy
    // hostname was rejected and a browser opening it silently failed.
    const server = await boot();
    for (const origin of [
      'https://alarm-anchor-git-main-mimidupont.vercel.app',
      'https://alarm-anchor-abc123def.vercel.app',
      'https://alarm-anchor-9f2c1b4-mimidupont-projects.vercel.app'
    ]) {
      assert.equal(await allowedFor(server.base, origin), origin, `REST blocked ${origin}`);
      assert.equal(
        await handshakeAllowedFor(server.base, origin),
        origin,
        `socket handshake blocked ${origin}`
      );
      t.diagnostic(`allowed ${origin}`);
    }
  });

  it('allows the local dev server and the Capacitor webview', async () => {
    const server = await boot();
    for (const origin of [
      'http://localhost:3000',
      'http://localhost',
      'capacitor://localhost',
      'ionic://localhost'
    ]) {
      assert.equal(await allowedFor(server.base, origin), origin, `blocked ${origin}`);
    }
  });

  it('allows a request with no Origin at all — the APK and the healthcheck', async () => {
    const server = await boot();
    const res = await fetch(`${server.base}/health`);
    assert.equal(res.status, 200);
    // The native client must never be subject to the browser allow-list.
    const sessionId = await createSession(server.base);
    assert.ok(sessionId);
  });
});

describe('origins that must still be rejected', () => {
  it('does not let the wildcard escape its label or its project', async () => {
    const server = await boot();
    for (const origin of [
      'https://evil.com',
      'https://alarm-anchor.vercel.app.evil.com',
      'https://some-other-project.vercel.app',
      // '*' must not cross a dot: this is a different host, not a preview.
      'https://alarm-anchor-x.evil.vercel.app',
      'http://alarm-anchor.vercel.app' // wrong scheme
    ]) {
      assert.equal(await allowedFor(server.base, origin), null, `should have rejected ${origin}`);
    }
  });

  it('logs the rejection with an actionable hint', async () => {
    const server = await boot();
    await allowedFor(server.base, 'https://not-mine.example');
    await delay(200);
    assert.match(server.output, /\[cors\] rejected origin https:\/\/not-mine\.example/);
    assert.match(server.output, /ALLOWED_ORIGINS/, 'the log must say how to fix it');
  });
});

describe('ALLOWED_ORIGINS override', () => {
  it('replaces the defaults when set, and still supports wildcards', async () => {
    const server = await boot({
      ALLOWED_ORIGINS: 'https://anchor.example.com, https://*.staging.example.com'
    });

    assert.equal(
      await allowedFor(server.base, 'https://anchor.example.com'),
      'https://anchor.example.com'
    );
    assert.equal(
      await allowedFor(server.base, 'https://pr-42.staging.example.com'),
      'https://pr-42.staging.example.com'
    );
    // The defaults are replaced, not merged — an explicit list means it.
    assert.equal(await allowedFor(server.base, 'https://alarm-anchor.vercel.app'), null);
    // And the app is still reachable with no Origin.
    assert.equal((await health(server.base)).status, 'ok');
  });

  it('reports the effective allowlist so a mangled secret is visible', async (t) => {
    // `fly secrets list` shows names and digests only. Without this, a shell
    // that rewrote the value (Git Bash turns capacitor://localhost into a
    // Windows path) fails silently, in browsers only.
    const server = await boot({
      ALLOWED_ORIGINS: 'https://anchor.example.com,capacitor://localhost'
    });

    const h = await health(server.base);
    assert.deepEqual(h.allowedOrigins, ['https://anchor.example.com', 'capacitor://localhost']);
    assert.equal(h.allowedOriginsSource, 'ALLOWED_ORIGINS');
    assert.match(server.output, /\[cors\] allowing 2 origin\(s\) from ALLOWED_ORIGINS/);
    t.diagnostic(`/health reports: ${h.allowedOrigins.join(', ')}`);
  });

  it('says so when it is running on the built-in default list', async () => {
    const server = await boot();
    const h = await health(server.base);
    assert.equal(h.allowedOriginsSource, 'default');
    assert.ok(h.allowedOrigins.includes('https://alarm-anchor.vercel.app'));
    assert.ok(h.allowedOrigins.includes('https://alarm-anchor-*.vercel.app'));
    assert.match(server.output, /\[cors\] allowing \d+ origin\(s\) from the built-in default/);
  });
});
