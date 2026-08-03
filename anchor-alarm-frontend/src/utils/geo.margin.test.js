/* eslint-env jest */
import { circlePolygonPoints, isPointInPolygon, zoneMarginMeters } from './geo';
import { decideAlarm } from './alarm';

// Checklist 1.1: `zoneMarginMeters` sign always agrees with
// `isPointInPolygon`.
//
// This matters because the two drive different things the user sees: the
// margin drives the "room left" readout and the warn threshold, the polygon
// test drives the alarm. If they ever disagree, the app shows a comfortable
// "12 m to spare" while the alarm is screaming, or the reverse — which is
// how a tester learns to distrust the app.

const ANCHOR = { lat: 43.083, lng: 6.158 };
const mPerDegLng = 111320 * Math.cos((ANCHOR.lat * Math.PI) / 180);

const at = (north, east) => [ANCHOR.lat + north / 111320, ANCHOR.lng + east / mPerDegLng];

// A deterministic pseudo-random generator, so a failure is reproducible
// rather than a flake someone re-runs until it passes.
const makeRandom = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const SHAPES = {
  'circle 40 m': circlePolygonPoints(ANCHOR.lat, ANCHOR.lng, 40, 16),
  'circle 40 m, smooth': circlePolygonPoints(ANCHOR.lat, ANCHOR.lng, 40, 64),
  'tight circle 8 m': circlePolygonPoints(ANCHOR.lat, ANCHOR.lng, 8, 16),
  'wide circle 200 m': circlePolygonPoints(ANCHOR.lat, ANCHOR.lng, 200, 32),
  triangle: [at(60, 0), at(-30, 50), at(-30, -50)],
  // A hand-drawn zone hugging a quay: concave, with a deep notch.
  'concave notch': [
    at(50, -50),
    at(50, 50),
    at(5, 50),
    at(5, 2),
    at(-5, 2),
    at(-5, 50),
    at(-50, 50),
    at(-50, -50)
  ],
  // The kind of long thin zone you get dragging a shape along a pontoon.
  sliver: [at(2, -80), at(2, 80), at(-2, 80), at(-2, -80)],
  // Same ring wound the other way — winding order must not flip the sign.
  'circle reversed': circlePolygonPoints(ANCHOR.lat, ANCHOR.lng, 40, 16).slice().reverse()
};

describe('zoneMarginMeters sign agrees with isPointInPolygon', () => {
  for (const [name, zone] of Object.entries(SHAPES)) {
    it(`holds over 2000 random points — ${name}`, () => {
      const random = makeRandom(20250803);
      let insideSeen = 0;
      let outsideSeen = 0;

      for (let i = 0; i < 2000; i++) {
        // Spread points over a box comfortably larger than every shape, so
        // both sides of the boundary are exercised.
        const [lat, lng] = at((random() - 0.5) * 500, (random() - 0.5) * 500);
        const margin = zoneMarginMeters(lat, lng, zone);
        const inside = isPointInPolygon([lat, lng], zone);

        expect(margin).not.toBeNull();

        // The one honest exception: a point landing exactly on the boundary
        // has margin 0 and either verdict is defensible. Nothing in a metre
        // of the edge is asserted, to leave room for float error.
        if (Math.abs(margin) < 0.001) continue;

        expect(margin > 0).toBe(inside);
        if (inside) insideSeen++;
        else outsideSeen++;
      }

      // Guard against a vacuous pass: the sweep must actually straddle the
      // boundary rather than landing entirely on one side.
      expect(insideSeen).toBeGreaterThan(0);
      expect(outsideSeen).toBeGreaterThan(0);
    });
  }

  it('agrees with the alarm decision itself, not just the polygon test', () => {
    const random = makeRandom(777);
    const zone = SHAPES['concave notch'];

    for (let i = 0; i < 1000; i++) {
      const [latitude, longitude] = at((random() - 0.5) * 300, (random() - 0.5) * 300);
      const margin = zoneMarginMeters(latitude, longitude, zone);
      if (Math.abs(margin) < 0.001) continue;

      const { fire } = decideAlarm({
        latitude,
        longitude,
        zone,
        alarmed: false,
        acknowledged: false
      });
      // Negative margin means past the boundary, which is exactly when a
      // freshly armed, unacknowledged alarm must fire.
      expect(fire).toBe(margin < 0);
    }
  });

  it('crosses zero exactly once walking out through the boundary', () => {
    const zone = SHAPES['circle 40 m, smooth'];
    let flips = 0;
    let previous = null;

    for (let d = 0; d <= 80; d += 0.25) {
      const [lat, lng] = at(0, d);
      const margin = zoneMarginMeters(lat, lng, zone);
      const inside = isPointInPolygon([lat, lng], zone);
      expect(margin > 0).toBe(inside);
      if (previous !== null && inside !== previous) flips++;
      previous = inside;
    }

    // No chattering along the walk — one clean transition out.
    expect(flips).toBe(1);
  });

  it('returns null for both, consistently, when there is no usable zone', () => {
    for (const zone of [null, undefined, [], [at(0, 0)], [at(0, 0), at(10, 10)]]) {
      expect(zoneMarginMeters(ANCHOR.lat, ANCHOR.lng, zone)).toBeNull();
      // ...and the alarm treats the same input as "nothing is armed".
      const next = decideAlarm({
        latitude: ANCHOR.lat,
        longitude: ANCHOR.lng,
        zone,
        alarmed: false,
        acknowledged: false
      });
      expect(next.fire).toBe(false);
    }
  });
});
