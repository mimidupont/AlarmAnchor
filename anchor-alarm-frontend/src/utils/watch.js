// The boat phone's own watch, remembered across an app restart.
//
// An anchor watch outlives the process running it: Android kills backgrounded
// apps, batteries get swapped, apps crash. Before this the boat phone had no
// way back into a session it had started — creating was the only route to
// role 'main', and creating always mints a new ID — so a restart at 3 a.m.
// meant a new code, every watcher ashore stranded on the old one, and the
// night's track stranded in storage under a key nothing would ever read
// again.
//
// Only the session ID, the zone and the anchor are kept here. The track has
// its own per-session key (utils/track.js) because it is two orders of
// magnitude bigger and is written on a different schedule.
//
// The zone and the anchor are the part that matters for safety: resuming a
// session whose server-side state survived would get them back from the
// server anyway, but a session the server has since dropped is exactly when
// they are irreplaceable — and that is the case where the phone would
// otherwise come back up unarmed while looking like it had resumed.

import { trackStorageKey } from './track';

const KEY = 'watch';

// Matches the server's SESSION_IDLE_TTL: past this the session is gone from
// the server regardless, and a stale offer to resume last week's anchorage
// is worse than no offer at all.
export const WATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const isFinitePair = (p) =>
  Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

const isValidAnchor = (a) =>
  !!a &&
  typeof a === 'object' &&
  Number.isFinite(a.latitude) &&
  Number.isFinite(a.longitude);

export function saveWatch({ sessionId, zone, anchor }, now = Date.now()) {
  if (!sessionId) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        sessionId,
        zone: Array.isArray(zone) ? zone.filter(isFinitePair) : [],
        anchor: isValidAnchor(anchor) ? anchor : null,
        savedAt: now
      })
    );
  } catch (err) {
    // Quota or private mode. Resuming is a convenience; never fatal.
  }
}

// Returns { sessionId, zone, anchor, savedAt } or null. Never throws: a
// corrupted record must mean "nothing to resume", not a session screen that
// fails to render.
export function loadWatch(now = Date.now(), maxAgeMs = WATCH_MAX_AGE_MS) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.sessionId !== 'string' || !parsed.sessionId) return null;
    if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > maxAgeMs) return null;
    return {
      sessionId: parsed.sessionId,
      zone: Array.isArray(parsed.zone) ? parsed.zone.filter(isFinitePair) : [],
      anchor: isValidAnchor(parsed.anchor) ? parsed.anchor : null,
      savedAt: parsed.savedAt
    };
  } catch (err) {
    return null;
  }
}

export function forgetWatch() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    // Nothing to do.
  }
}

// Drop track blobs belonging to sessions that are over.
//
// Each is up to ~100 KB and only the current session's key was ever removed,
// so every watch that ended in a crash or an OS kill left one behind for
// good. Around fifty of them fill a typical 5 MB quota, at which point every
// localStorage write in the app starts throwing — and all of them are inside
// a catch, so the failure is silent: the track quietly stops being saved.
export function pruneOrphanTracks(keepSessionId) {
  try {
    const keep = keepSessionId ? trackStorageKey(keepSessionId) : null;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('track:') && key !== keep) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
    return doomed.length;
  } catch (err) {
    return 0;
  }
}
