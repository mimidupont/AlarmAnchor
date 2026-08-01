/* eslint-env jest */
import {
  circlePolygonPoints,
  distanceMeters,
  nearestZonePoint,
  translatePolygon,
  zoneMarginMeters
} from './geo';

const ANCHOR = { lat: 43.083, lng: 6.158 };
// A 40 m circular zone, as produced by the circle-mode editor.
const circle40 = circlePolygonPoints(ANCHOR.lat, ANCHOR.lng, 40, 64);

// Offset a point by meters north/east of the anchor.
const at = (north, east) => [
  ANCHOR.lat + north / 111320,
  ANCHOR.lng + east / (111320 * Math.cos((ANCHOR.lat * Math.PI) / 180))
];

describe('zoneMarginMeters', () => {
  it('reports the full radius at the center of a circular zone', () => {
    const m = zoneMarginMeters(ANCHOR.lat, ANCHOR.lng, circle40);
    expect(m).toBeGreaterThan(39);
    expect(m).toBeLessThanOrEqual(40.1);
  });

  it('reports the remaining room 30 m out in a 40 m zone', () => {
    const [lat, lng] = at(30, 0);
    expect(zoneMarginMeters(lat, lng, circle40)).toBeCloseTo(10, 0);
  });

  it('goes negative outside the zone, by the distance past the boundary', () => {
    const [lat, lng] = at(0, 46);
    const m = zoneMarginMeters(lat, lng, circle40);
    expect(m).toBeLessThan(0);
    expect(m).toBeCloseTo(-6, 0);
  });

  it('measures to a concave notch, not across it', () => {
    // Square zone ~100 m across with a deep notch cut into the east side.
    const square = [
      at(50, -50), at(50, 50), at(5, 50), at(5, 2),
      at(-5, 2), at(-5, 50), at(-50, 50), at(-50, -50)
    ];
    const [lat, lng] = at(0, 0); // sits in the mouth of the notch
    const m = zoneMarginMeters(lat, lng, square);
    // The notch wall is 2 m away; the far side of the square is 50 m.
    expect(m).toBeCloseTo(2, 0);
  });

  it('returns null without a usable zone', () => {
    expect(zoneMarginMeters(ANCHOR.lat, ANCHOR.lng, [])).toBeNull();
    expect(zoneMarginMeters(ANCHOR.lat, ANCHOR.lng, null)).toBeNull();
    expect(zoneMarginMeters(ANCHOR.lat, ANCHOR.lng, [at(0, 0), at(1, 1)])).toBeNull();
  });

  it('agrees in sign with the alarm across the boundary', () => {
    for (let d = 30; d <= 50; d += 2) {
      const [lat, lng] = at(0, d);
      const margin = zoneMarginMeters(lat, lng, circle40);
      const inside = margin > 0;
      // The zone is a 64-gon inscribed in 40 m, so its true edge is a hair
      // inside 40 m; allow a 1 m band around the nominal radius.
      if (d < 39) expect(inside).toBe(true);
      if (d > 41) expect(inside).toBe(false);
    }
  });
});

describe('nearestZonePoint', () => {
  it('lands on the boundary in the direction of travel', () => {
    const [lat, lng] = at(0, 30); // 30 m east of the anchor
    const p = nearestZonePoint(lat, lng, circle40);
    expect(p).not.toBeNull();
    // ~10 m away, and further east than the boat (toward the near edge).
    expect(distanceMeters(lat, lng, p[0], p[1])).toBeCloseTo(10, 0);
    expect(p[1]).toBeGreaterThan(lng);
  });

  it('returns null without a usable zone', () => {
    expect(nearestZonePoint(ANCHOR.lat, ANCHOR.lng, [])).toBeNull();
  });
});

describe('translatePolygon', () => {
  it('preserves shape and size while shifting position', () => {
    const dLat = 12 / 111320;
    const moved = translatePolygon(circle40, dLat, 0);
    expect(moved).toHaveLength(circle40.length);
    // Every vertex moved by the same 12 m.
    for (let i = 0; i < circle40.length; i++) {
      const d = distanceMeters(circle40[i][0], circle40[i][1], moved[i][0], moved[i][1]);
      expect(d).toBeCloseTo(12, 1);
    }
    // The margin at the new center matches the old margin at the old center.
    const before = zoneMarginMeters(ANCHOR.lat, ANCHOR.lng, circle40);
    const after = zoneMarginMeters(ANCHOR.lat + dLat, ANCHOR.lng, moved);
    expect(after).toBeCloseTo(before, 3);
  });
});
