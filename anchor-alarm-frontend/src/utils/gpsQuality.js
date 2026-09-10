// Which GPS fixes the anchor watch is allowed to believe.
//
// A phone does not only produce GPS fixes. When the satellites are hard to
// see — under a hard dodger, below decks, in a squall — Android falls back
// to the network provider and hands the app a position derived from cell
// towers or from whatever wifi the marina has. It arrives through exactly
// the same callback, looks exactly like a GPS fix, and is routinely 300 m
// to 3 km wrong. Against a 30 m anchor zone that single fix lands the boat
// outside, decideAlarm fires, and the crew is woken at 4 a.m. by a boat
// that never moved. The next fix, seconds later, is back on top of the
// anchor.
//
// The other failure is the same thing seen from the boat: a burst of
// nonsense that puts the boat 800 m away and back again inside ten
// seconds. No anchored boat travels at 30 knots, so that displacement is
// not a position, it is an artefact.
//
// So every fix passes through acceptFix before anything is allowed to act
// on it. Two gates, both deliberately generous — this is here to reject
// what is physically impossible, not to second-guess a merely mediocre
// fix:
//
//   accuracy — worse than MAX_USABLE_ACCURACY_M is not a GPS fix at all
//   speed    — a jump implying more than MAX_PLAUSIBLE_SPEED_MPS (50 kn),
//              beyond what both fixes' own error radii could explain
//
// THE OVERRIDE IS THE SAFETY PROPERTY. A filter that can reject fixes for
// ever is a filter that can silently switch the alarm off: the boat phone
// would sit there with a stale position, perfectly quiet, while the boat
// dragged out of the anchorage. So a rejection streak lasting longer than
// OUTLIER_OVERRIDE_MS accepts the next fix regardless. Bad data that is
// all we have still beats no data: a coarse fix can still say "you are
// 400 m from your anchor", and that alarm — false or not — wakes someone
// who can look outside. Nothing about the pill's "No GPS" state does.
//
// Pure and unit-tested (gpsQuality.test.js) for the same reason
// decideAlarm is: this now sits between the GPS and the alarm, and a bug
// here is a bug in whether the alarm fires at all.

import { distanceMeters } from './geo';

// Beyond this, the fix did not come from satellites. A genuine GPS fix on
// a boat with a clear sky view is 3-10 m; 100 m is already a phone that is
// struggling badly, and everything past it is cell/wifi triangulation.
export const MAX_USABLE_ACCURACY_M = 100;

// 25 m/s ≈ 50 kn. Far above anything a boat does — one that has broken out
// of its anchorage makes 1-3 kn, under tow or motoring off 6-8 — and the
// artefacts this is aimed at are nothing like marginal: a cell-tower fix
// lands hundreds of metres away between two 1 Hz updates, which reads as
// several hundred metres per second.
//
// The headroom is for the people testing the alarm. An anchor watch is
// tested by taking the phone away from the anchor, and the two ways anyone
// does that — driving, and a mock-location app that teleports the position
// — are exactly what a tight speed gate rejects. A tester who is told "it
// didn't ring" by their own tooling learns nothing about the alarm, and a
// filter that gets in the way of testing the alarm is worse than the
// artefact it was aimed at.
export const MAX_PLAUSIBLE_SPEED_MPS = 25;

// The longest the filter may go on rejecting before it has to believe the
// GPS again. See the override note above.
//
// Ten seconds, not thirty: this is the worst case by which a genuine drag
// that the filter has misjudged — or a tester teleporting the phone — is
// audible anyway, and ten seconds of delay on an anchor alarm is nothing
// while thirty is long enough for a tester to conclude it is broken.
export const OUTLIER_OVERRIDE_MS = 10 * 1000;

// How far back "drop the anchor here" is allowed to look for a better fix.
//
// The trade is precision against staleness: a boat backing down at 1.5 kn
// covers 0.8 m/s, so an older but tighter fix is only worth having while it
// is still describing roughly where the boat is now. Four seconds catches
// three or four fixes at 1 Hz and bounds the staleness at about 3 m, which
// is less than the accuracy spread it is choosing between.
export const ANCHOR_FIX_WINDOW_MS = 4 * 1000;

export const emptyFixFilter = () => ({ last: null, rejectingSince: null });

const accuracyOf = (fix) =>
  fix && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 ? fix.accuracy : null;

// Decide whether to act on `fix`, given the filter state from the previous
// call. Returns the next state plus `accept` and, when something was
// wrong, the `reason` — 'invalid', 'accuracy' or 'jump'. A fix accepted
// only because the override expired reports the reason it would have been
// rejected for, with `overridden: true`, so the caller can log the
// degradation without changing what it does.
export function acceptFix(state, fix, now = Date.now()) {
  const prev = state || emptyFixFilter();

  // Coordinates that are not numbers are never usable, and no override
  // applies: acting on NaN is not a degraded reading, it is a crash or an
  // alarm decision taken against nothing.
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
    return { state: prev, accept: false, reason: 'invalid', overridden: false };
  }

  const accuracy = accuracyOf(fix);
  let reason = null;

  if (accuracy !== null && accuracy > MAX_USABLE_ACCURACY_M) {
    reason = 'accuracy';
  } else if (prev.last) {
    const seconds = (now - prev.last.at) / 1000;
    if (seconds > 0) {
      const moved = distanceMeters(
        prev.last.latitude,
        prev.last.longitude,
        fix.latitude,
        fix.longitude
      );
      // Subtract what the two fixes' own error radii could account for, so
      // two honest but imprecise fixes on a stationary boat are never read
      // as a jump between them.
      const explainable = (accuracy || 0) + (prev.last.accuracy || 0);
      if (moved - explainable > MAX_PLAUSIBLE_SPEED_MPS * seconds) reason = 'jump';
    }
  }

  const accepted = {
    state: {
      last: { latitude: fix.latitude, longitude: fix.longitude, accuracy, at: now },
      rejectingSince: null
    },
    accept: true
  };

  if (!reason) return { ...accepted, reason: null, overridden: false };

  const since = Number.isFinite(prev.rejectingSince) ? prev.rejectingSince : now;
  if (now - since >= OUTLIER_OVERRIDE_MS) {
    return { ...accepted, reason, overridden: true };
  }

  return {
    state: { last: prev.last, rejectingSince: since },
    accept: false,
    reason,
    overridden: false
  };
}

// The most precise fix in the last `windowMs`, for dropping the anchor.
//
// The anchor is the origin of everything the watch measures — the zone is
// drawn around it and every distance is from it — so it is the one
// position worth spending a moment to get right. The live watcher is
// already running at 1 Hz, so by the time the button is pressed there are
// usually two or three fixes to choose between, and they are rarely
// equally good: a 4 m fix and a 22 m fix seconds apart is ordinary. Taking
// whichever happened to arrive last throws that away for nothing.
//
// Ties (and fixes carrying no accuracy at all) fall back to the most
// recent, which is the old behaviour.
export function bestRecentFix(fixes, now = Date.now(), windowMs = ANCHOR_FIX_WINDOW_MS) {
  if (!Array.isArray(fixes)) return null;
  let best = null;
  for (const fix of fixes) {
    if (!fix || !Number.isFinite(fix.receivedAt)) continue;
    if (now - fix.receivedAt > windowMs || fix.receivedAt > now) continue;
    if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) continue;
    if (!best) {
      best = fix;
      continue;
    }
    const a = accuracyOf(fix);
    const b = accuracyOf(best);
    if (a === null && b === null) {
      if (fix.receivedAt >= best.receivedAt) best = fix;
    } else if (b === null) {
      best = fix;
    } else if (a !== null) {
      if (a < b || (a === b && fix.receivedAt >= best.receivedAt)) best = fix;
    }
  }
  return best;
}

// Keep the recent-fix buffer bounded and window-sized. Called on every fix,
// so it must stay cheap and must never grow without limit across a night.
export function pruneFixes(fixes, now = Date.now(), windowMs = ANCHOR_FIX_WINDOW_MS) {
  if (!Array.isArray(fixes)) return [];
  return fixes.filter((f) => f && Number.isFinite(f.receivedAt) && now - f.receivedAt <= windowMs);
}
