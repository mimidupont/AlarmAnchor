const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { configureWebPush, isValidSubscription, sendPush } = require('./push');

const validSub = (endpoint = 'https://push.example/abc') => ({
  endpoint,
  keys: { p256dh: 'key', auth: 'auth' }
});

describe('configureWebPush', () => {
  const fakeLib = () => {
    const calls = [];
    return { calls, setVapidDetails: (...a) => calls.push(a) };
  };

  it('enables and reports the public key when fully configured', () => {
    const lib = fakeLib();
    const res = configureWebPush(
      { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@y.z' },
      lib
    );
    assert.deepEqual(res, { enabled: true, publicKey: 'pub' });
    assert.deepEqual(lib.calls[0], ['mailto:x@y.z', 'pub', 'priv']);
  });

  it('defaults the subject when none is given', () => {
    const lib = fakeLib();
    configureWebPush({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }, lib);
    assert.equal(lib.calls[0][0], 'mailto:anchor-alarm@example.invalid');
  });

  it('stays disabled without a key pair', () => {
    assert.deepEqual(configureWebPush({ VAPID_PUBLIC_KEY: 'pub' }, fakeLib()), {
      enabled: false,
      publicKey: null
    });
  });

  it('stays disabled with no library installed', () => {
    assert.deepEqual(
      configureWebPush({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }, null),
      { enabled: false, publicKey: null }
    );
  });
});

describe('isValidSubscription', () => {
  it('accepts a well-formed https subscription', () => {
    assert.equal(isValidSubscription(validSub()), true);
  });

  it('rejects a non-https endpoint', () => {
    assert.equal(isValidSubscription({ ...validSub(), endpoint: 'http://x/y' }), false);
  });

  it('rejects a subscription missing its keys', () => {
    assert.equal(isValidSubscription({ endpoint: 'https://x/y' }), false);
    assert.equal(isValidSubscription({ endpoint: 'https://x/y', keys: { p256dh: 'k' } }), false);
  });

  it('rejects junk', () => {
    assert.equal(isValidSubscription(null), false);
    assert.equal(isValidSubscription('nope'), false);
  });
});

describe('sendPush', () => {
  it('sends to every subscription and counts successes', async () => {
    const sent = [];
    const lib = { sendNotification: async (sub, body) => sent.push([sub.endpoint, body]) };
    const res = await sendPush({
      lib,
      subscriptions: [validSub('https://a/1'), validSub('https://b/2')],
      payload: { title: 'x' }
    });
    assert.deepEqual(res, { sent: 2, expired: 0, failed: 0 });
    assert.equal(sent.length, 2);
    assert.equal(sent[0][1], JSON.stringify({ title: 'x' }));
  });

  it('prunes expired endpoints (404/410) via onExpired', async () => {
    const gone = [];
    const lib = {
      sendNotification: async (sub) => {
        if (sub.endpoint.includes('dead')) {
          const err = new Error('gone');
          err.statusCode = 410;
          throw err;
        }
      }
    };
    const res = await sendPush({
      lib,
      subscriptions: [validSub('https://ok/1'), validSub('https://dead/2')],
      payload: {},
      onExpired: (endpoint) => gone.push(endpoint)
    });
    assert.deepEqual(res, { sent: 1, expired: 1, failed: 0 });
    assert.deepEqual(gone, ['https://dead/2']);
  });

  it('counts other failures without pruning them', async () => {
    const gone = [];
    const lib = {
      sendNotification: async () => {
        const err = new Error('boom');
        err.statusCode = 500;
        throw err;
      }
    };
    const res = await sendPush({
      lib,
      subscriptions: [validSub()],
      payload: {},
      onExpired: (e) => gone.push(e)
    });
    assert.deepEqual(res, { sent: 0, expired: 0, failed: 1 });
    assert.deepEqual(gone, [], 'a transient failure must not drop the subscription');
  });

  it('is a no-op with no library or no subscriptions', async () => {
    assert.deepEqual(await sendPush({ lib: null, subscriptions: [validSub()] }), {
      sent: 0,
      expired: 0,
      failed: 0
    });
    assert.deepEqual(await sendPush({ lib: { sendNotification: async () => {} }, subscriptions: [] }), {
      sent: 0,
      expired: 0,
      failed: 0
    });
  });
});
