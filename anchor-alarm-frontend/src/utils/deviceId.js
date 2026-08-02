import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// A stable identity for this phone, generated once and kept forever.
//
// The server used to key a session's live positions by socket.id, which is
// regenerated on every reconnect. The disconnect handler deletes the old
// key, but ungraceful drops — dead cellular, Android doze, a phone in a bag
// under a bunk — do not always fire it promptly, so over a night of
// flapping signal a remote monitor accumulates several markers for the same
// boat. A device ID that outlives the socket fixes that at the root.

const STORAGE_KEY = 'deviceId';

let cached = null;

const randomId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (err) {
    // Fall through to the non-crypto path below.
  }
  // Last resort. Collisions only ever cost a merged marker, never an alarm.
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const readLocal = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch (err) {
    return null;
  }
};

const writeLocal = (id) => {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch (err) {
    // Private mode / quota. The in-memory value still holds for this run.
  }
};

// Synchronous, so a join can never go out without an ID. Reads localStorage
// (which the Capacitor webview persists too) and mints one if there is
// nothing there.
export function ensureDeviceId() {
  if (cached) return cached;
  cached = readLocal() || randomId();
  writeLocal(cached);
  return cached;
}

// Called once at startup. On native, Capacitor Preferences is the durable
// copy — it survives webview storage being cleared, which localStorage does
// not — so it wins when the two disagree, and is backfilled when empty.
export async function initDeviceId() {
  const local = ensureDeviceId();
  if (!Capacitor.isNativePlatform()) return local;

  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) {
      cached = value;
      if (value !== local) writeLocal(value);
      return value;
    }
    await Preferences.set({ key: STORAGE_KEY, value: local });
  } catch (err) {
    // Preferences unavailable — localStorage alone is good enough.
    console.warn('Device ID: Preferences unavailable, using local storage only', err);
  }
  return cached;
}
