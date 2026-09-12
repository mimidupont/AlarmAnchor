// Web Push for remote monitors.
//
// A remote monitor in a browser tab makes no sound and, once backgrounded,
// cannot even run its in-app alert — so a boat that drags while the watcher
// ashore has switched apps goes unheard. A push notification is the one
// thing that reaches a backgrounded browser: the OS wakes the service
// worker (see public/push-sw.js) and shows the alarm even with the tab
// closed.
//
// The boat phone is unaffected: it is the alarm, decides locally, and needs
// none of this. Push targets are watchers only.
//
// Entirely optional. With no VAPID keys configured the whole feature is a
// no-op — nothing is sent, no endpoint is exposed with a usable key, and the
// app simply never offers push. Kept in its own module so the send logic can
// be unit-tested without a live push service.

let defaultLib = null;
try {
  // Optional dependency: a deployment that does not want push need not
  // install it, and the server still boots.
  defaultLib = require('web-push');
} catch (err) {
  defaultLib = null;
}

// Configure web-push from the environment. Returns { enabled, publicKey },
// and only reports enabled when a library and a full key pair are present —
// a half-configured deployment stays off rather than throwing at send time.
function configureWebPush(env = process.env, lib = defaultLib) {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  // A contact URI is required by the spec; a sensible default keeps a
  // minimal deployment (just the key pair) working.
  const subject = env.VAPID_SUBJECT || 'mailto:anchor-alarm@example.invalid';

  if (!lib || !publicKey || !privateKey) {
    return { enabled: false, publicKey: null };
  }
  try {
    lib.setVapidDetails(subject, publicKey, privateKey);
    return { enabled: true, publicKey };
  } catch (err) {
    return { enabled: false, publicKey: null, error: err.message };
  }
}

// A subscription we are willing to store. Deliberately strict: an endpoint
// must be an https URL and the two keys must be present, so a stray or
// malformed client cannot fill a session with junk that fails on every send.
function isValidSubscription(sub) {
  return (
    !!sub &&
    typeof sub === 'object' &&
    typeof sub.endpoint === 'string' &&
    sub.endpoint.startsWith('https://') &&
    !!sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  );
}

// Fan out one notification to every subscription. Never rejects: one dead
// endpoint must not stop the others from being alerted about a dragging
// boat. A 404/410 means the browser dropped the subscription, so it is
// reported through onExpired for the caller to prune.
async function sendPush({ lib = defaultLib, subscriptions = [], payload, onExpired } = {}) {
  const result = { sent: 0, expired: 0, failed: 0 };
  if (!lib || !Array.isArray(subscriptions) || subscriptions.length === 0) return result;

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload || {});

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await lib.sendNotification(sub, body);
        result.sent += 1;
      } catch (err) {
        const code = err && (err.statusCode || err.status);
        if (code === 404 || code === 410) {
          result.expired += 1;
          if (typeof onExpired === 'function') onExpired(sub && sub.endpoint);
        } else {
          result.failed += 1;
        }
      }
    })
  );

  return result;
}

module.exports = { configureWebPush, isValidSubscription, sendPush };
