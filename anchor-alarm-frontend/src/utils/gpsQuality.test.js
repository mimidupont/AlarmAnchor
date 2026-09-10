/* eslint-env jest */
import {
  ANCHOR_FIX_WINDOW_MS,
  MAX_USABLE_ACCURACY_M,
  OUTLIER_OVERRIDE_MS,
  acceptFix,
  bestRecentFix,
  emptyFixFilter,
  pruneFixes
} from './gpsQuality';

// This filter sits between the GPS and the alarm, so its two failure modes
// are the two the whole app is about: letting a cell-tower fix through
// wakes the boat for nothing, and rejecting fixes for ever switches the
// alarm off in silence. The override cases below are the second one.

const ANCHOR = { lat: 43.083, lng: 6.158 };

// A fix `north` metres north of the anchorage, with a given accuracy.
const at = (north, accuracy = 5) => ({
  latitude: ANCHOR.lat + north / 111320,
  longitude: ANCHOR.lng,
  accuracy
});

describe('acceptFix', () => {
  it('accepts an ordinary GPS fix', () => {
    const out = acceptFix(emptyFixFilter(), at(0, 6), 1000);
    expect(out.accept).toBe(true);
    expect(out.reason).toBe(null);
  });

  it('rejects a fix whose accuracy is too poor to be GPS', () => {
    const out = acceptFix(emptyFixFilter(), at(0, MAX_USABLE_ACCURACY_M + 1), 1000);
    expect(out.accept).toBe(false);
    expect(out.reason).toBe('accuracy');
  });

  it('rejects coordinates that are not numbers, and never overrides that', () => {
    let state = emptyFixFilter();
    const junk = { latitude: NaN, longitude: 6.158, accuracy: 5 };
    let out = acceptFix(state, junk, 1000);
    expect(out.accept).toBe(false);
    expect(out.reason).toBe('invalid');
    out = acceptFix(out.state, junk, 1000 + OUTLIER_OVERRIDE_MS * 10);
    expect(out.accept).toBe(false);
  });

  it('rejects a jump no anchored boat could make', () => {
    let out = acceptFix(emptyFixFilter(), at(0, 5), 1000);
    // 800 m in one second.
    out = acceptFix(out.state, at(800, 5), 2000);
    expect(out.accept).toBe(false);
    expect(out.reason).toBe('jump');
  });

  it('accepts real dragging: metres per second, not hundreds', () => {
    let out = acceptFix(emptyFixFilter(), at(0, 5), 1000);
    // ~2 kn away from the anchor.
    out = acceptFix(out.state, at(1), 2000);
    expect(out.accept).toBe(true);
    out = acceptFix(out.state, at(2), 3000);
    expect(out.accept).toBe(true);
  });

  it('does not read two imprecise fixes on a still boat as a jump', () => {
    // Both fixes are honest, both are 60 m fixes, and they disagree by
    // roughly their own error radius. That is a stationary boat.
    let out = acceptFix(emptyFixFilter(), at(0, 60), 1000);
    out = acceptFix(out.state, at(70, 60), 1500);
    expect(out.accept).toBe(true);
  });

  it('believes the GPS again once a rejection streak outlasts the override', () => {
    const bad = at(0, MAX_USABLE_ACCURACY_M + 500);
    let out = acceptFix(emptyFixFilter(), at(0, 5), 1000);
    out = acceptFix(out.state, bad, 2000);
    expect(out.accept).toBe(false);

    // Still inside the override window: still rejected.
    out = acceptFix(out.state, bad, 2000 + OUTLIER_OVERRIDE_MS - 1);
    expect(out.accept).toBe(false);

    // Past it: a coarse position is better than a watch that has quietly
    // stopped updating.
    out = acceptFix(out.state, bad, 2000 + OUTLIER_OVERRIDE_MS);
    expect(out.accept).toBe(true);
    expect(out.reason).toBe('accuracy');
    expect(out.overridden).toBe(true);
  });

  it('measures the streak from the first rejection, not the last', () => {
    const bad = at(0, MAX_USABLE_ACCURACY_M + 500);
    let out = acceptFix(emptyFixFilter(), bad, 1000);
    for (let t = 2000; t < 1000 + OUTLIER_OVERRIDE_MS; t += 1000) {
      out = acceptFix(out.state, bad, t);
      expect(out.accept).toBe(false);
    }
    out = acceptFix(out.state, bad, 1000 + OUTLIER_OVERRIDE_MS);
    expect(out.accept).toBe(true);
  });

  it('clears the streak after a good fix', () => {
    const bad = at(0, MAX_USABLE_ACCURACY_M + 500);
    let out = acceptFix(emptyFixFilter(), bad, 1000);
    expect(out.state.rejectingSince).toBe(1000);
    out = acceptFix(out.state, at(0, 5), 2000);
    expect(out.accept).toBe(true);
    expect(out.state.rejectingSince).toBe(null);
  });

  it('keeps the last good position while it is rejecting', () => {
    let out = acceptFix(emptyFixFilter(), at(0, 5), 1000);
    const good = out.state.last;
    out = acceptFix(out.state, at(800, 5), 2000);
    expect(out.state.last).toEqual(good);
  });

  it('accepts a fix that carries no accuracy at all', () => {
    // Some sources omit it. Unknown is not the same as bad, and refusing
    // to act would be refusing to run the alarm.
    const out = acceptFix(emptyFixFilter(), { latitude: 43.083, longitude: 6.158 }, 1000);
    expect(out.accept).toBe(true);
  });
});

describe('bestRecentFix', () => {
  const fix = (receivedAt, accuracy) => ({
    latitude: ANCHOR.lat,
    longitude: ANCHOR.lng,
    accuracy,
    receivedAt
  });

  it('prefers the most precise fix in the window over the latest', () => {
    const precise = fix(1000, 4);
    const best = bestRecentFix([precise, fix(2000, 22)], 2000);
    expect(best).toBe(precise);
  });

  it('ignores fixes older than the window', () => {
    const recent = fix(10000, 20);
    const best = bestRecentFix([fix(10000 - ANCHOR_FIX_WINDOW_MS - 1, 3), recent], 10000);
    expect(best).toBe(recent);
  });

  it('returns null when nothing is recent enough', () => {
    expect(bestRecentFix([fix(0, 3)], 10 * ANCHOR_FIX_WINDOW_MS)).toBe(null);
    expect(bestRecentFix([], 1000)).toBe(null);
    expect(bestRecentFix(null, 1000)).toBe(null);
  });

  it('falls back to the most recent when accuracies tie', () => {
    const latest = fix(2000, 5);
    expect(bestRecentFix([fix(1000, 5), latest], 2000)).toBe(latest);
  });

  it('prefers a fix that reports its accuracy over one that does not', () => {
    const known = fix(1000, 30);
    const unknown = { latitude: ANCHOR.lat, longitude: ANCHOR.lng, receivedAt: 2000 };
    expect(bestRecentFix([unknown, known], 2000)).toBe(known);
  });
});

describe('pruneFixes', () => {
  it('drops everything older than the window', () => {
    const now = 100000;
    const kept = { latitude: 1, longitude: 2, receivedAt: now - 1000 };
    const dropped = { latitude: 1, longitude: 2, receivedAt: now - ANCHOR_FIX_WINDOW_MS - 1 };
    expect(pruneFixes([dropped, kept], now)).toEqual([kept]);
  });

  it('survives junk in the buffer', () => {
    expect(pruneFixes([null, {}, undefined], 1000)).toEqual([]);
    expect(pruneFixes(undefined, 1000)).toEqual([]);
  });
});
