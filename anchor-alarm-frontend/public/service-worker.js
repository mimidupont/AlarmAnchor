/**
 * service-worker.js
 * Handles background notifications for boat alarm system
 * 
 * Deploy to: public/service-worker.js
 * 
 * Features:
 * - Background notification display
 * - Persistent alarm even when app closed
 * - Offline support with cache-first strategy
 * - User action handling (notification clicks)
 */

const CACHE_NAME = 'anchor-alarm-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/favicon.ico'
];

// Install: Cache essential assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching assets');
        return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
          console.warn('Service Worker: Some assets failed to cache', err);
          // Continue even if some assets fail
        });
      })
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('Service Worker: Deleting old cache', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim()) // Take control immediately
  );
});

// Message from app: Trigger notification
self.addEventListener('message', (event) => {
  if (event.data.type !== 'TRIGGER_ALARM') return;

  const { title, body, boatData } = event.data;

  console.log('Service Worker: Received alarm message', { title, body });

  // Show persistent notification
  self.registration.showNotification(title, {
    body: body,
    icon: '/alarm-icon-192.png',
    badge: '/alarm-badge-72.png',
    requireInteraction: true, // Forces user to dismiss
    tag: 'anchor-alarm', // Replace previous notifications
    sound: '/alarm-sound.mp3', // Optional: add sound if available
    actions: [
      {
        action: 'open-app',
        title: 'Open App',
        icon: '/check-icon.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/dismiss-icon.png'
      }
    ],
    data: {
      boatData: boatData,
      timestamp: new Date().toISOString()
    }
  }).catch((err) => {
    console.error('Service Worker: Failed to show notification', err);
  });
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked', event.action);

  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  // 'open-app' action or click on notification body
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Look for existing app window
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === '/' && 'focus' in client) {
          console.log('Service Worker: Focusing existing window');
          return client.focus();
        }
      }

      // Open new window if none exists
      if (clients.openWindow) {
        console.log('Service Worker: Opening new window');
        return clients.openWindow('/');
      }
    })
  );
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('Service Worker: Notification closed', event.notification.tag);
  // You can log this for analytics if needed
});

// Fetch: Cache-first strategy for offline support
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Don't cache Socket.io or other dynamic requests
  const url = new URL(event.request.url);
  if (url.pathname.includes('socket.io') || url.pathname.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version if available
        if (response) {
          console.log('Service Worker: Serving from cache', event.request.url);
          return response;
        }

        // Otherwise, fetch from network
        return fetch(event.request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Cache successful responses
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });

            return response;
          })
          .catch((err) => {
            console.warn('Service Worker: Fetch failed', event.request.url, err);
            // Return cached version or offline page
            return caches.match(event.request)
              .then((cachedResponse) => cachedResponse || new Response('Offline'));
          });
      })
  );
});

// Background sync (advanced feature)
// Register periodic notification check (requires permission)
self.addEventListener('sync', (event) => {
  if (event.tag === 'alarm-check') {
    event.waitUntil(
      // Perform background sync here if needed
      Promise.resolve()
    );
  }
});

console.log('Service Worker: Loaded and ready');
