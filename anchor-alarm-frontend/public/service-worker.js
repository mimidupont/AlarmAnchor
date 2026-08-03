/**
 * service-worker.js — a tombstone that removes itself.
 *
 * This file used to be a cache-first service worker: it precached '/' and
 * '/index.html' under a hardcoded CACHE_NAME of 'anchor-alarm-v1', and
 * served navigations from that cache before going to the network.
 *
 * Two properties combined into a site that goes blank after every deploy:
 *
 *   - the cached index.html references a content-hashed bundle
 *     (/static/js/main.<hash>.js), and a new build deletes the old hash, so
 *     the cached page loads a script that 404s and renders nothing at all;
 *   - CACHE_NAME never changed, and the activate handler only deleted
 *     caches whose name *differed* from it, so the poisoned entry was never
 *     evicted. The failure was permanent and per-device — an incognito
 *     window (no worker registered) always worked, which is what makes this
 *     so confusing to diagnose.
 *
 * Nothing in the app registers a service worker any more: notifications go
 * through Capacitor LocalNotifications, and no source file references
 * navigator.serviceWorker at all. But a registration made by an older build
 * lives forever until something replaces it, which is what this file is.
 *
 * It must keep being served at this exact path. Deleting it would leave
 * every already-registered device stuck: browsers do not reliably drop a
 * registration when its script 404s, and a device that never fetches a
 * replacement never recovers.
 *
 * Deliberately has NO fetch handler. Without one the browser goes straight
 * to the network, so even before this finishes its cleanup it is already
 * incapable of serving a stale page.
 */

// Replace the old worker immediately instead of waiting for every tab to
// close — the tabs in question are showing a blank screen and will not be
// closed in any hurry.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Take over from the old worker straight away rather than waiting for
      // every tab to close.
      try {
        await self.clients.claim();
      } catch (err) {
        // Not fatal — the cache purge below is what actually matters.
      }

      // Drop every cache this origin ever created, not just the one name we
      // happen to know about. Assuming a single known name is precisely
      // what made the original bug permanent.
      try {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      } catch (err) {
        // Storage unavailable; unregistering still stops the interception.
      }

      // Deliberately does NOT reload open pages.
      //
      // Calling client.navigate() here is tempting — the page on screen is
      // blank, and reloading it would spare the user a refresh. It was
      // tried and removed: it could not be verified reliably, it destroys
      // the tab under automation, and if anything ever re-registered this
      // worker it would loop (load -> register -> activate -> navigate ->
      // load). Purging the cache and unregistering is what actually fixes
      // the device; a refresh, which someone staring at a blank page will
      // do anyway, is a fair price for a cleanup path that cannot itself
      // break the site.

      // Finally remove the registration, so this origin has no service
      // worker at all from here on.
      try {
        await self.registration.unregister();
      } catch (err) {
        // Nothing left to do; there is no fetch handler, so the worker is
        // already inert even if the registration lingers.
      }
    })()
  );
});
