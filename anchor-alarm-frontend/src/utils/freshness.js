// How old the boat's last position is, and what that means.
//
// Extracted from StatusPill so the rule can be tested without a React tree,
// for the same reason decideAlarm was extracted from handleGpsFix: this is
// the other half of "is the boat being watched", and the half a watcher
// ashore relies on completely.
//
// THE RULE: never subtract one device's clock from another's.
//
// Freshness used to be `Date.now() - Date.parse(location.timestamp)` — the
// watcher's clock minus a timestamp written by the boat's clock. Any
// disagreement between the two devices lands straight in that number, and
// the two directions fail differently:
//
//   boat clock fast  -> the age goes negative, no threshold is ever crossed,
//                       and the watcher is shown a green "Watching" pill
//                       indefinitely over a phone whose GPS died hours ago.
//                       Silent false reassurance: the exact failure this app
//                       exists to prevent.
//   boat clock slow  -> a permanent red "No data" over perfectly good data,
//                       which teaches the watcher to ignore the pill.
//
// So positions carry an ELAPSED AGE from the server (measured entirely on the
// server's own clock) and every client immediately converts that into an
// arrival time on ITS OWN clock. All later comparisons are then within one
// clock. Elapsed durations survive the trip between devices; instants do not.

export const STALE_MS = 30 * 1000;
export const DEAD_MS = 90 * 1000;
export const WEAK_ACCURACY_M = 25;

// Convert a server-supplied age into a local arrival instant. Positions the
// boat phone records about itself never go through the server and carry no
// age; `now` is then already the right answer.
export function stampReceivedAt(location, ageMs, now = Date.now()) {
  if (!location) return location;
  const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
  return { ...location, receivedAt: now - age };
}

export function stampAllReceivedAt(locations, now = Date.now()) {
  const out = {};
  for (const [deviceId, loc] of Object.entries(locations || {})) {
    if (loc) out[deviceId] = stampReceivedAt(loc, loc.ageMs, now);
  }
  return out;
}

// Age of a position in milliseconds, or null if there is nothing to measure.
//
// `receivedAt` is always preferred because it is on this device's clock.
// Falling back to the boat's `timestamp` keeps a client talking to an older
// server working — degraded to the old cross-clock behaviour rather than
// reporting no fix at all, which would read as "No GPS" and be worse.
export function fixAgeMs(location, now = Date.now()) {
  if (!location) return null;
  if (Number.isFinite(location.receivedAt)) return now - location.receivedAt;
  const parsed = Date.parse(location.timestamp);
  return Number.isNaN(parsed) ? null : now - parsed;
}

// The GPS half of the status pill: dead, weak, or fine.
//
// A negative age can only mean a clock moved under us — a device time
// correction, or an older server with no age to send. Treat it as fresh
// rather than letting it slip past the thresholds unnoticed, and never let
// it read as healthier than a genuinely fresh fix.
export function gpsHealth({ location, gpsError, now = Date.now() } = {}) {
  const rawAge = fixAgeMs(location, now);
  const ageMs = rawAge === null ? null : Math.max(0, rawAge);
  const accuracy = location ? location.accuracy : null;

  const dead = gpsError != null || ageMs === null || ageMs > DEAD_MS;
  const weak =
    !dead && ((accuracy != null && accuracy > WEAK_ACCURACY_M) || ageMs > STALE_MS);

  return { dead, weak, ageMs };
}
