import { isPointInPolygon } from './geo';

// The alarm decision, extracted from handleGpsFix so it can be tested
// without a GPS, a socket or a React tree. This is the property that makes
// the app safe: the boat phone decides locally, so losing the internet at
// anchor does not disable the alarm. Nothing in here may depend on the
// socket, the server, or anything that can be unreachable at 4 a.m.
//
// State machine (identical to the server's, so both reach the same verdict):
//   inside the zone            -> silent, re-armed (acknowledgement cleared)
//   outside, not acknowledged  -> alarm fires (once, not on every fix)
//   outside, acknowledged      -> silent until the boat returns inside
//
// Returns the next state plus `fire`, which is true only on the transition
// into the alarm — the caller uses it to raise the notification/haptics.
export function decideAlarm({ latitude, longitude, zone, alarmed, acknowledged }) {
  // Fewer than 3 vertices is not a zone: nothing is armed, so nothing
  // changes. Never invent an alarm state out of an unusable zone.
  if (!zone || zone.length < 3) {
    return { alarmed, acknowledged, fire: false };
  }

  const outside = !isPointInPolygon([latitude, longitude], zone);

  if (!outside) {
    return { alarmed: false, acknowledged: false, fire: false };
  }

  if (acknowledged || alarmed) {
    return { alarmed, acknowledged, fire: false };
  }

  return { alarmed: true, acknowledged, fire: true };
}

// What the boat phone / a remote monitor should do about a socket `error`.
//
// The two roles must behave differently, and getting this wrong is the most
// dangerous bug the app can have:
//
//   'remote' — a monitor whose session is gone has genuinely nothing to
//              show. Returning to the picker is correct.
//   'main'   — the boat phone IS the alarm. A server message must never
//              stop GPS, leave the map, or clear the anchor or zone. The
//              server is a relay for remote watchers, nothing more. So on
//              a lost session it re-mints one and re-pushes local state.
export function sessionErrorAction(role, errorMsg) {
  if (errorMsg !== 'Session not found') return 'none';
  return role === 'main' ? 'recover' : 'reset';
}

// Recovery pacing. A backend that is down hard must not turn the boat
// phone into a POST loop: one attempt per 30 s, doubling up to 5 minutes,
// reset on success.
export const RECOVERY_MIN_INTERVAL_MS = 30 * 1000;
export const RECOVERY_MAX_INTERVAL_MS = 5 * 60 * 1000;

export const nextRecoveryInterval = (current) =>
  Math.min(current * 2, RECOVERY_MAX_INTERVAL_MS);
