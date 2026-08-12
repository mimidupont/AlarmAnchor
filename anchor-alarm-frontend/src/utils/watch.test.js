/* eslint-env jest */
import {
  WATCH_MAX_AGE_MS,
  forgetWatch,
  loadWatch,
  pruneOrphanTracks,
  saveWatch
} from './watch';
import { trackStorageKey } from './track';

// The boat phone's way back into a watch it started. Everything here runs on
// a phone that has just been killed and relaunched, so the interesting cases
// are all about what survives and what must not be trusted.

const ZONE = [
  [43.08, 6.15],
  [43.081, 6.15],
  [43.081, 6.151]
];
const ANCHOR = { latitude: 43.08, longitude: 6.15, accuracy: 4 };

beforeEach(() => localStorage.clear());

describe('remembering a watch', () => {
  it('round-trips the session, the zone and the anchor', () => {
    saveWatch({ sessionId: 'ABC123XYZ', zone: ZONE, anchor: ANCHOR });
    const loaded = loadWatch();
    expect(loaded.sessionId).toBe('ABC123XYZ');
    expect(loaded.zone).toEqual(ZONE);
    expect(loaded.anchor).toEqual(ANCHOR);
  });

  it('keeps the zone and anchor, not just the code', () => {
    // The point of storing them: a resumed watch has to come back ARMED.
    // A session the server has since dropped cannot supply them, and a
    // phone that resumes unarmed while looking resumed is the worst
    // outcome this feature could have.
    saveWatch({ sessionId: 'ABC123XYZ', zone: ZONE, anchor: ANCHOR });
    const loaded = loadWatch();
    expect(loaded.zone.length).toBeGreaterThanOrEqual(3);
    expect(loaded.anchor).not.toBeNull();
  });

  it('forgets a watch that was ended deliberately', () => {
    saveWatch({ sessionId: 'ABC123XYZ', zone: ZONE, anchor: ANCHOR });
    forgetWatch();
    expect(loadWatch()).toBeNull();
  });

  it('does not offer a watch older than the server would keep', () => {
    const now = Date.now();
    saveWatch({ sessionId: 'ABC123XYZ', zone: ZONE, anchor: ANCHOR }, now - WATCH_MAX_AGE_MS - 1);
    expect(loadWatch(now)).toBeNull();
    // ...but one from earlier the same night is still good.
    saveWatch({ sessionId: 'ABC123XYZ', zone: ZONE, anchor: ANCHOR }, now - 8 * 60 * 60 * 1000);
    expect(loadWatch(now)).not.toBeNull();
  });

  it('treats a corrupted record as nothing to resume', () => {
    for (const junk of ['', 'not json', '{}', '{"sessionId":""}', '[]', 'null']) {
      localStorage.setItem('watch', junk);
      expect(loadWatch()).toBeNull();
    }
  });

  it('drops garbage coordinates rather than restoring an unusable zone', () => {
    localStorage.setItem(
      'watch',
      JSON.stringify({
        sessionId: 'ABC123XYZ',
        zone: [[43.08, 6.15], ['x', 6.15], [NaN, 1], [43.081, 6.151]],
        anchor: { latitude: 'nope', longitude: 6.15 },
        savedAt: Date.now()
      })
    );
    const loaded = loadWatch();
    expect(loaded.zone).toEqual([
      [43.08, 6.15],
      [43.081, 6.151]
    ]);
    expect(loaded.anchor).toBeNull();
  });
});

describe('pruning orphaned track blobs', () => {
  // Each track is up to ~100 KB and only the live session's key was ever
  // removed, so a watch that ended in a crash left one behind for good.
  // Around fifty of those fill a typical quota, after which every
  // localStorage write in the app throws — inside a catch, silently.
  it('removes every track but the one still in use', () => {
    localStorage.setItem(trackStorageKey('OLD1'), '[]');
    localStorage.setItem(trackStorageKey('OLD2'), '[]');
    localStorage.setItem(trackStorageKey('KEEP'), '[[1,2,3]]');
    localStorage.setItem('theme', 'night');

    expect(pruneOrphanTracks('KEEP')).toBe(2);
    expect(localStorage.getItem(trackStorageKey('OLD1'))).toBeNull();
    expect(localStorage.getItem(trackStorageKey('KEEP'))).toBe('[[1,2,3]]');
    // Unrelated keys are none of its business.
    expect(localStorage.getItem('theme')).toBe('night');
  });

  it('removes all of them when no watch is being kept', () => {
    localStorage.setItem(trackStorageKey('OLD1'), '[]');
    localStorage.setItem(trackStorageKey('OLD2'), '[]');
    expect(pruneOrphanTracks(null)).toBe(2);
    expect(localStorage.length).toBe(0);
  });
});
