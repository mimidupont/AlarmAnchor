import { distanceMeters } from './geo';

// A track point is a flat [lat, lng, t] triple (t = epoch ms). Flat rather
// than {lat,lng,t} objects: a fraction of the heap and of the serialized
// size, which matters for a structure that grows all night.

// Thinning — a raw watch can deliver a fix per second; keeping all of them
// is wasteful and renders as a fuzzy blob of GPS noise. Record when the
// boat has moved far enough OR enough time has passed. The time rule is
// what stops a six-hour calm followed by a drag from looking like a
// two-point track.
export const TRACK_MIN_MOVE_M = 2;
export const TRACK_MIN_INTERVAL_MS = 15000;
// ~12 h at one point per 15 s.
export const TRACK_MAX_POINTS = 3000;
export const TRACK_RECENT_MS = 60 * 60 * 1000;

export function shouldRecordPoint(track, lat, lng, t) {
  if (!track || track.length === 0) return true;
  const [pLat, pLng, pT] = track[track.length - 1];
  if (t - pT >= TRACK_MIN_INTERVAL_MS) return true;
  return distanceMeters(pLat, pLng, lat, lng) >= TRACK_MIN_MOVE_M;
}

// Append with the cap enforced on push, never lazily — this is the only
// structure in the app that grows with time.
export function appendPoint(track, point) {
  const next = track.length >= TRACK_MAX_POINTS ? track.slice(track.length - TRACK_MAX_POINTS + 1) : track.slice();
  next.push(point);
  return next;
}

// Split into [older, recent] for the age fade. The two overlap by one
// point so the polylines join without a visible gap.
export function splitTrackByAge(track, now = Date.now(), windowMs = TRACK_RECENT_MS) {
  if (!track || track.length === 0) return [[], []];
  const cutoff = now - windowMs;
  const idx = track.findIndex((p) => p[2] >= cutoff);
  if (idx <= 0) return idx === 0 ? [[], track] : [track, []];
  return [track.slice(0, idx + 1), track.slice(idx)];
}

// Coordinates are rounded to 6 decimals (~0.1 m) before storage: a
// 3000-point track then serializes to roughly 100 KB, comfortably inside
// the quota.
const round6 = (n) => Math.round(n * 1e6) / 1e6;

export function serializeTrack(track) {
  return JSON.stringify(track.map(([lat, lng, t]) => [round6(lat), round6(lng), t]));
}

export function deserializeTrack(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) => Array.isArray(p) && p.length === 3 && Number.isFinite(p[0]) && Number.isFinite(p[1])
    );
  } catch (err) {
    return [];
  }
}

export const trackStorageKey = (sessionId) => `track:${sessionId}`;
