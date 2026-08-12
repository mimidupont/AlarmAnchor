/* eslint-env jest */
import {
  DEAD_MS,
  STALE_MS,
  fixAgeMs,
  gpsHealth,
  stampAllReceivedAt,
  stampReceivedAt
} from './freshness';

// The watcher's half of "is this boat being watched". decideAlarm keeps the
// boat phone honest; this keeps the phone ashore honest, and its failure mode
// is worse in one direction: a pill that says everything is fine.

const NOW = 1_700_000_000_000;
const fix = (extra = {}) => ({
  latitude: 43.08,
  longitude: 6.15,
  accuracy: 5,
  timestamp: new Date(NOW).toISOString(),
  ...extra
});

describe('turning a server-measured age into a local arrival time', () => {
  it('treats a freshly relayed position as arriving now', () => {
    expect(stampReceivedAt(fix(), 0, NOW).receivedAt).toBe(NOW);
  });

  it('backdates one the server had been holding', () => {
    // A watcher joining mid-session is handed whatever the server last had.
    expect(stampReceivedAt(fix(), 45_000, NOW).receivedAt).toBe(NOW - 45_000);
  });

  it('falls back to "now" when there is no age to apply', () => {
    for (const missing of [undefined, null, NaN, -5]) {
      expect(stampReceivedAt(fix(), missing, NOW).receivedAt).toBe(NOW);
    }
  });

  it('stamps every device in a join payload', () => {
    const stamped = stampAllReceivedAt(
      { boat: fix({ ageMs: 10_000 }), other: fix({ ageMs: 0 }) },
      NOW
    );
    expect(stamped.boat.receivedAt).toBe(NOW - 10_000);
    expect(stamped.other.receivedAt).toBe(NOW);
  });
});

describe('measuring how old a fix is', () => {
  it('uses the local arrival time in preference to the boat\'s clock', () => {
    const location = fix({
      receivedAt: NOW - 5_000,
      timestamp: new Date(NOW - 3 * 60 * 60 * 1000).toISOString() // wildly off
    });
    expect(fixAgeMs(location, NOW)).toBe(5_000);
  });

  it('falls back to the timestamp against an older server', () => {
    const location = fix({ timestamp: new Date(NOW - 20_000).toISOString() });
    expect(fixAgeMs(location, NOW)).toBe(20_000);
  });

  it('reports nothing measurable rather than guessing', () => {
    expect(fixAgeMs(null, NOW)).toBeNull();
    expect(fixAgeMs(fix({ timestamp: 'not a date' }), NOW)).toBeNull();
  });
});

describe('a boat phone whose clock disagrees with the watcher\'s', () => {
  // The bug this module exists to remove. In each case the DATA is identical
  // and stale; only the boat's clock differs.
  const staleBy = 5 * 60 * 1000;

  const withSkew = (skewMs) =>
    // What the boat wrote (its clock), stamped on arrival 5 minutes ago.
    fix({
      timestamp: new Date(NOW - staleBy + skewMs).toISOString(),
      receivedAt: NOW - staleBy
    });

  it('is reported dead whichever way the clock is wrong', () => {
    for (const skew of [0, +10 * 60 * 1000, -10 * 60 * 1000]) {
      const health = gpsHealth({ location: withSkew(skew), now: NOW });
      expect({ skew, dead: health.dead }).toEqual({ skew, dead: true });
    }
  });

  it('would have been called healthy by the old cross-clock rule', () => {
    // Guards the regression directly: a boat clock 10 minutes fast makes
    // now - Date.parse(timestamp) negative, so no threshold is crossed.
    const fastClock = withSkew(10 * 60 * 1000);
    const oldRuleAge = NOW - Date.parse(fastClock.timestamp);
    expect(oldRuleAge).toBeLessThan(0);
    expect(oldRuleAge > DEAD_MS).toBe(false); // the old code's verdict: alive
    expect(gpsHealth({ location: fastClock, now: NOW }).dead).toBe(true);
  });

  it('does not cry wolf over fresh data from a slow clock', () => {
    // The other direction: a boat clock 10 minutes behind used to show a
    // permanent red "No data" over data that had just arrived.
    const slowClockFresh = fix({
      timestamp: new Date(NOW - 10 * 60 * 1000).toISOString(),
      receivedAt: NOW
    });
    const health = gpsHealth({ location: slowClockFresh, now: NOW });
    expect(health.dead).toBe(false);
    expect(health.weak).toBe(false);
  });
});

describe('the ordinary states', () => {
  it('is healthy on a recent, accurate fix', () => {
    expect(gpsHealth({ location: fix({ receivedAt: NOW - 1000 }), now: NOW })).toMatchObject({
      dead: false,
      weak: false
    });
  });

  it('is weak on a fix going stale, dead once it is past the limit', () => {
    expect(gpsHealth({ location: fix({ receivedAt: NOW - STALE_MS - 1 }), now: NOW })).toMatchObject(
      { dead: false, weak: true }
    );
    expect(gpsHealth({ location: fix({ receivedAt: NOW - DEAD_MS - 1 }), now: NOW })).toMatchObject(
      { dead: true }
    );
  });

  it('is weak on a poor accuracy even when the fix is instant', () => {
    expect(
      gpsHealth({ location: fix({ receivedAt: NOW, accuracy: 40 }), now: NOW })
    ).toMatchObject({ dead: false, weak: true });
  });

  it('is dead on a watcher error, and with no fix at all', () => {
    expect(gpsHealth({ location: fix({ receivedAt: NOW }), gpsError: 'permission denied', now: NOW }).dead)
      .toBe(true);
    expect(gpsHealth({ location: null, now: NOW }).dead).toBe(true);
  });

  it('never reports a negative age when a clock is corrected under it', () => {
    const health = gpsHealth({ location: fix({ receivedAt: NOW + 60_000 }), now: NOW });
    expect(health.ageMs).toBe(0);
    expect(health.dead).toBe(false);
  });
});
