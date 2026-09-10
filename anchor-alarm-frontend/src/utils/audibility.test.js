/* eslint-env jest */
import { alarmAudibility } from './audibility';

// One rule, and the thing that matters about it is what it does NOT warn
// about: a warning that appears when nothing is wrong is a warning that
// gets dismissed unread, and this one has exactly one chance to be read.

describe('alarmAudibility', () => {
  it('reports a muted alarm stream', () => {
    expect(alarmAudibility({ alarmVolume: 0, alarmVolumeMax: 7 })).toEqual({
      audible: false,
      reason: 'muted'
    });
  });

  it('is happy with any non-zero volume, however low', () => {
    for (const alarmVolume of [1, 3, 7, 15]) {
      expect(alarmAudibility({ alarmVolume, alarmVolumeMax: 15 }).audible).toBe(true);
    }
  });

  it('never warns when it could not read the volume', () => {
    // Web, or an APK without the plugin. Unknown is not muted.
    for (const status of [null, undefined, {}, { alarmVolume: null }, { alarmVolume: 'x' }]) {
      const verdict = alarmAudibility(status);
      expect(verdict.audible).toBe(true);
      expect(verdict.reason).toBe('unknown');
    }
  });

  it('does not warn about silent or vibrate mode', () => {
    // The alarm stream is not touched by the ringer — that is why the
    // alarm is played on it in the first place.
    for (const ringerMode of [0, 1, 2]) {
      expect(alarmAudibility({ alarmVolume: 5, alarmVolumeMax: 7, ringerMode }).audible).toBe(true);
    }
  });
});
