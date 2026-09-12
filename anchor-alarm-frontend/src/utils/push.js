// Web Push helpers for the remote monitor (browser only).
//
// The boat phone is the alarm and alerts locally through Capacitor; a
// browser monitor is the one that goes silent when backgrounded, and push
// is what reaches it. See public/push-sw.js and the backend push.js.
//
// Everything here degrades to a no-op when push is unsupported or the server
// has not configured it, so the app never blocks on it.

// A browser that can actually do Web Push. The native app is excluded on
// purpose: Android WebView has no web push service, and the native remote
// already alerts while open — prompting for a permission that leads nowhere
// would only train people to deny it.
export function isWebPushSupported({ nativePlatform = false } = {}) {
  if (nativePlatform) return false;
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Convert a base64url VAPID key into the Uint8Array applicationServerKey
// that PushManager.subscribe requires. Standard, fiddly, and exactly the
// kind of thing worth a unit test.
export function urlBase64ToUint8Array(base64String) {
  if (typeof base64String !== 'string' || !base64String) {
    throw new Error('a VAPID key string is required');
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
