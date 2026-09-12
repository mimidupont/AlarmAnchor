const assert = require('node:assert/strict');
const fs = require('node:fs');
const { after, describe, it } = require('node:test');
const webpush = require('web-push');

const { health, makeDataDir, startServer, stopServer } = require('./server-harness');

// Push is optional and off by default. These check the configuration wiring
// end to end — the key a browser needs is exposed only when the server is
// actually configured, and never with a usable value otherwise — without
// needing a real push service to accept a delivery.

const dirs = [];
const servers = [];

const boot = async (env) => {
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

describe('web push configuration', () => {
  it('exposes no key and reports push off when unconfigured', async () => {
    const server = await boot();
    const res = await (await fetch(`${server.base}/api/push/vapid-public-key`)).json();
    assert.equal(res.key, null);
    const h = await health(server.base);
    assert.equal(h.push, false);
  });

  it('exposes the public key and reports push on when configured', async () => {
    const keys = webpush.generateVAPIDKeys();
    const server = await boot({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:test@anchor.invalid'
    });
    const res = await (await fetch(`${server.base}/api/push/vapid-public-key`)).json();
    assert.equal(res.key, keys.publicKey);
    const h = await health(server.base);
    assert.equal(h.push, true);
  });
});
