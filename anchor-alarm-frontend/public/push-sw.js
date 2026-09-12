/**
 * push-sw.js — the Web Push service worker for remote monitors.
 *
 * A browser tab makes no alarm sound and, once backgrounded, cannot run the
 * app's own alert at all. This worker is the one thing that reaches a
 * backgrounded or closed tab: the OS wakes it on a push from the server
 * (see the backend push.js) and it shows the alarm.
 *
 * Registered at a distinct path from the old '/service-worker.js' tombstone
 * on purpose — that file exists only to unregister itself, and must not be
 * reused. This worker has NO fetch handler, so it never caches or intercepts
 * navigation: the cache-poisoning bug that the tombstone cleans up cannot
 * recur here.
 *
 * Boat phones never register this — they are the alarm and alert locally
 * through Capacitor. This is for watchers in a browser only.
 */

// Take over promptly so a watcher who just granted permission is covered
// without having to reload.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // A push with no or malformed body still deserves to wake someone.
    data = {};
  }

  const title = data.title || '\u{1F6A8} Anchor alarm';
  const body = data.body || 'The boat has left the anchor zone.';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // One dragging alarm per session: collapse repeats onto the same
      // notification rather than stacking a wall of them, but renotify so a
      // fresh alarm still buzzes.
      tag: `anchor-alarm-${data.sessionId || 'session'}`,
      renotify: true,
      // Do not let it auto-dismiss: a dragging boat is exactly the alert a
      // watcher must find still on screen when they pick the phone up.
      requireInteraction: true,
      icon: '/logo192.png',
      badge: '/logo192.png',
      data
    })
  );
});

// Tapping the notification focuses an existing app tab, or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
      return undefined;
    })
  );
});
