/* eslint-env jest */
import { circlePolygonPoints, distanceMeters, isPointInPolygon, zoneMarginMeters } from './geo';
import { decideAlarm } from './alarm';

// Checklist 1.1: `isPointInPolygon` against a zone crossing the antimeridian
// and a zone at high latitude. Neither is likely for a Mediterranean tester,
// but both fail *silently* — the boat is simply reported on the wrong side of
// the fence, and the only symptom is an alarm that never fires.

// A zone straddling the 180th meridian, with its vertices normalised into
// [-180, 180] the way any real map source (or a phone's GPS) delivers them:
// ~220 m wide, ~220 m tall, centred on the meridian at 60 N.
const ANTIMERIDIAN_ZONE = [
  [59.999, 179.999],
  [60.001, 179.999],
  [60.001, -179.999],
  [59.999, -179.999]
];

describe('isPointInPolygon across the antimeridian', () => {
  it('reports a boat sitting inside the zone as inside', () => {
    // 4 m west of the meridian — unambiguously within the rectangle above.
    expect(isPointInPolygon([60.0, 179.9999], ANTIMERIDIAN_ZONE)).toBe(true);
    expect(isPointInPolygon([60.0, -179.9999], ANTIMERIDIAN_ZONE)).toBe(true);
  });

  it('does not claim a boat on the other side of the planet is inside', () => {
    // The dangerous direction: if the wrapped polygon is read as spanning
    // 359.998 degrees instead of 0.002, every point in the Atlantic falls
    // "inside" the zone and the alarm can never fire.
    expect(isPointInPolygon([60.0, 0], ANTIMERIDIAN_ZONE)).toBe(false);
    expect(isPointInPolygon([60.0, 6.158], ANTIMERIDIAN_ZONE)).toBe(false);
    expect(isPointInPolygon([60.0, -70], ANTIMERIDIAN_ZONE)).toBe(false);
  });

  it('still fences a boat that drifts north out of the zone', () => {
    expect(isPointInPolygon([60.01, 179.9999], ANTIMERIDIAN_ZONE)).toBe(false);
  });

  it('keeps the alarm decision consistent with the geometry', () => {
    const inside = decideAlarm({
      latitude: 60.0,
      longitude: 179.9999,
      zone: ANTIMERIDIAN_ZONE,
      alarmed: false,
      acknowledged: false
    });
    expect(inside.fire).toBe(false);

    const away = decideAlarm({
      latitude: 60.0,
      longitude: 6.158,
      zone: ANTIMERIDIAN_ZONE,
      alarmed: false,
      acknowledged: false
    });
    expect(away.fire).toBe(true);
  });
});

describe('isPointInPolygon at high latitude', () => {
  // 78 N — Svalbard. The longitude degrees are ~5x shorter than at the
  // Mediterranean latitudes the app was built around.
  const LAT = 78;
  const LNG = 15;
  const zone = circlePolygonPoints(LAT, LNG, 40, 32);

  const at = (north, east) => [
    LAT + north / 111320,
    LNG + east / (111320 * Math.cos((LAT * Math.PI) / 180))
  ];

  it('holds the anchor point inside a 40 m zone', () => {
    expect(isPointInPolygon([LAT, LNG], zone)).toBe(true);
  });

  it('agrees with true distance all the way round the boundary', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      for (const r of [10, 30, 50, 100]) {
        const p = at(r * Math.cos(rad), r * Math.sin(rad));
        const d = distanceMeters(LAT, LNG, p[0], p[1]);
        // The zone is a 32-gon inscribed in 40 m, so its edge sits a hair
        // inside 40 m. Only assert outside the ambiguous band.
        if (d < 38) expect(isPointInPolygon(p, zone)).toBe(true);
        if (d > 42) expect(isPointInPolygon(p, zone)).toBe(false);
      }
    }
  });

  it('still works within a degree of the pole', () => {
    const polar = circlePolygonPoints(89, 30, 40, 32);
    expect(isPointInPolygon([89, 30], polar)).toBe(true);
    // 200 m north is well outside a 40 m zone.
    expect(isPointInPolygon([89 + 200 / 111320, 30], polar)).toBe(false);
  });

  it('reports a sane margin at high latitude', () => {
    expect(zoneMarginMeters(LAT, LNG, zone)).toBeGreaterThan(38);
    const [lat, lng] = at(0, 60);
    expect(zoneMarginMeters(lat, lng, zone)).toBeLessThan(0);
  });
});
