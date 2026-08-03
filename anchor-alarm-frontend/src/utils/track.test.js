/* eslint-env jest */
import {
  TRACK_MAX_POINTS,
  TRACK_MIN_INTERVAL_MS,
  TRACK_MIN_MOVE_M,
  appendPoint,
  deserializeTrack,
  serializeTrack,
  shouldRecordPoint,
  splitTrackByAge
} from './track';

// Checklist 1.1: the track is the only structure in the app that grows with
// time. Two properties have to hold or an overnight watch either fills the
// heap or records a drag as a two-point line.

const ANCHOR = { lat: 43.083, lng: 6.158 };
const T0 = 1_700_000_000_000;

// A point `north` metres north / `east` metres east of the anchor.
const at = (north, east = 0) => [
  ANCHOR.lat + north / 111320,
  ANCHOR.lng + east / (111320 * Math.cos((ANCHOR.lat * Math.PI) / 180))
];

describe('shouldRecordPoint', () => {
  it('always records the first point of a track', () => {
    expect(shouldRecordPoint([], ANCHOR.lat, ANCHOR.lng, T0)).toBe(true);
    expect(shouldRecordPoint(null, ANCHOR.lat, ANCHOR.lng, T0)).toBe(true);
    expect(shouldRecordPoint(undefined, ANCHOR.lat, ANCHOR.lng, T0)).toBe(true);
  });

  it('records on the interval even when the boat has not moved at all', () => {
    // The rule that stops a six-hour calm followed by a drag from looking
    // like a two-point track.
    const track = [[ANCHOR.lat, ANCHOR.lng, T0]];
    expect(shouldRecordPoint(track, ANCHOR.lat, ANCHOR.lng, T0 + TRACK_MIN_INTERVAL_MS)).toBe(true);
    expect(shouldRecordPoint(track, ANCHOR.lat, ANCHOR.lng, T0 + TRACK_MIN_INTERVAL_MS + 1)).toBe(
      true
    );
  });

  it('rejects a fix that is both too soon and too close', () => {
    const track = [[ANCHOR.lat, ANCHOR.lng, T0]];
    const [lat, lng] = at(TRACK_MIN_MOVE_M - 0.5);
    expect(shouldRecordPoint(track, lat, lng, T0 + TRACK_MIN_INTERVAL_MS - 1)).toBe(false);
    // The degenerate case a 1 Hz watch produces: same spot, one second later.
    expect(shouldRecordPoint(track, ANCHOR.lat, ANCHOR.lng, T0 + 1000)).toBe(false);
  });

  it('records on distance even when the interval has not elapsed', () => {
    const track = [[ANCHOR.lat, ANCHOR.lng, T0]];
    const [lat, lng] = at(TRACK_MIN_MOVE_M + 0.5);
    expect(shouldRecordPoint(track, lat, lng, T0 + 1000)).toBe(true);
    // Distance is measured in any direction, not just north.
    const [eLat, eLng] = at(0, TRACK_MIN_MOVE_M + 0.5);
    expect(shouldRecordPoint(track, eLat, eLng, T0 + 1000)).toBe(true);
  });

  it('measures against the last point, not the first', () => {
    const track = [
      [ANCHOR.lat, ANCHOR.lng, T0],
      [...at(50), T0 + 1000]
    ];
    // Back at the anchor is 50 m from the *last* point, so it records...
    expect(shouldRecordPoint(track, ANCHOR.lat, ANCHOR.lng, T0 + 2000)).toBe(true);
    // ...but sitting still at that last point does not.
    const [lat, lng] = at(50);
    expect(shouldRecordPoint(track, lat, lng, T0 + 2000)).toBe(false);
  });

  it('thins a 1 Hz watch to the interval when the boat sits still', () => {
    // A full hour of once-a-second fixes on a boat that never moves.
    let track = [];
    for (let i = 0; i <= 3600; i++) {
      if (shouldRecordPoint(track, ANCHOR.lat, ANCHOR.lng, T0 + i * 1000)) {
        track = appendPoint(track, [ANCHOR.lat, ANCHOR.lng, T0 + i * 1000]);
      }
    }
    // 3600 s at one point per 15 s, plus the first.
    expect(track.length).toBe(3600 / (TRACK_MIN_INTERVAL_MS / 1000) + 1);
  });
});

describe('appendPoint', () => {
  it('appends normally below the cap', () => {
    const track = appendPoint([], [ANCHOR.lat, ANCHOR.lng, T0]);
    expect(track).toEqual([[ANCHOR.lat, ANCHOR.lng, T0]]);
  });

  it('never exceeds TRACK_MAX_POINTS, however long the night runs', () => {
    let track = [];
    // Well past the cap: ~24 h at one point per 15 s is 5760 points.
    for (let i = 0; i < TRACK_MAX_POINTS + 2500; i++) {
      track = appendPoint(track, [ANCHOR.lat, ANCHOR.lng, T0 + i * 1000]);
      expect(track.length).toBeLessThanOrEqual(TRACK_MAX_POINTS);
    }
    expect(track.length).toBe(TRACK_MAX_POINTS);
  });

  it('drops the oldest points and keeps the newest', () => {
    let track = [];
    for (let i = 0; i < TRACK_MAX_POINTS + 100; i++) {
      track = appendPoint(track, [ANCHOR.lat, ANCHOR.lng, T0 + i]);
    }
    // The most recent point is always the last one written...
    expect(track[track.length - 1][2]).toBe(T0 + TRACK_MAX_POINTS + 99);
    // ...and the window is contiguous, oldest first.
    expect(track[0][2]).toBe(T0 + 100);
    for (let i = 1; i < track.length; i++) {
      expect(track[i][2]).toBeGreaterThan(track[i - 1][2]);
    }
  });

  it('enforces the cap on a track that arrives over it', () => {
    // e.g. a hand-edited or older restore payload.
    const oversized = Array.from({ length: TRACK_MAX_POINTS + 500 }, (_, i) => [
      ANCHOR.lat,
      ANCHOR.lng,
      T0 + i
    ]);
    expect(appendPoint(oversized, [ANCHOR.lat, ANCHOR.lng, T0 + 99999]).length).toBe(
      TRACK_MAX_POINTS
    );
  });

  it('does not mutate the track it was given', () => {
    const track = [[ANCHOR.lat, ANCHOR.lng, T0]];
    const next = appendPoint(track, [ANCHOR.lat, ANCHOR.lng, T0 + 1]);
    expect(track).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

describe('track storage round-trip', () => {
  it('survives serialize/deserialize at the cap', () => {
    const track = Array.from({ length: TRACK_MAX_POINTS }, (_, i) => [
      ANCHOR.lat + i / 1e6,
      ANCHOR.lng,
      T0 + i * 1000
    ]);
    const raw = serializeTrack(track);
    // ~100 KB budget for a full track, comfortably inside the quota.
    expect(raw.length).toBeLessThan(150_000);
    expect(deserializeTrack(raw)).toHaveLength(TRACK_MAX_POINTS);
  });

  it('returns an empty track rather than throwing on garbage', () => {
    expect(deserializeTrack('not json')).toEqual([]);
    expect(deserializeTrack('{"nope":1}')).toEqual([]);
    expect(deserializeTrack('[[1,2],[null,null,null]]')).toEqual([]);
  });
});

describe('splitTrackByAge', () => {
  it('splits older from recent with a one-point overlap so the line joins', () => {
    const now = T0 + 2 * 60 * 60 * 1000;
    const track = [
      [ANCHOR.lat, ANCHOR.lng, now - 90 * 60 * 1000],
      [ANCHOR.lat, ANCHOR.lng, now - 70 * 60 * 1000],
      [ANCHOR.lat, ANCHOR.lng, now - 30 * 60 * 1000],
      [ANCHOR.lat, ANCHOR.lng, now - 1000]
    ];
    const [older, recent] = splitTrackByAge(track, now);
    expect(older[older.length - 1]).toBe(recent[0]);
    expect(older.length + recent.length).toBe(track.length + 1);
  });

  it('handles an empty track', () => {
    expect(splitTrackByAge([], T0)).toEqual([[], []]);
  });
});
