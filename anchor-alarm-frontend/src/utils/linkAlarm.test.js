/* eslint-env jest */
import {
  DEFAULT_LINK_ALARM_DELAY,
  LINK_ALARM_DELAYS,
  linkAlarmDelayMs,
  linkAlarmDueIn,
  linkIsDown,
  loadLinkAlarmDelay,
  saveLinkAlarmDelay
} from './linkAlarm';

// The delay is the whole point of the feature: without it the alarm rings
// on every doze and headland and gets muted on the first night. The cases
// that matter are therefore "a short blip is not an alarm" and "a real
// outage still is".

beforeEach(() => localStorage.clear());

describe('the offered delays', () => {
  it('offers immediately, 2 min, 10 min and 1 h', () => {
    expect(LINK_ALARM_DELAYS.map((d) => d.ms)).toEqual([0, 120000, 600000, 3600000]);
  });

  it('has a label key for every option', () => {
    for (const d of LINK_ALARM_DELAYS) expect(typeof d.labelKey).toBe('string');
  });

  it('falls back to the default for an unknown id', () => {
    expect(linkAlarmDelayMs('42 fathoms')).toBe(linkAlarmDelayMs(DEFAULT_LINK_ALARM_DELAY));
    expect(linkAlarmDelayMs(undefined)).toBe(120000);
  });
});

describe('persistence', () => {
  it('round-trips a choice', () => {
    saveLinkAlarmDelay('1h');
    expect(loadLinkAlarmDelay()).toBe('1h');
  });

  it('defaults when nothing was ever chosen', () => {
    expect(loadLinkAlarmDelay()).toBe(DEFAULT_LINK_ALARM_DELAY);
  });

  it('ignores a stored value that is no longer an option', () => {
    localStorage.setItem('linkAlarmDelay', 'forever');
    expect(loadLinkAlarmDelay()).toBe(DEFAULT_LINK_ALARM_DELAY);
  });

  it('refuses to store something that is not an option', () => {
    saveLinkAlarmDelay('forever');
    expect(loadLinkAlarmDelay()).toBe(DEFAULT_LINK_ALARM_DELAY);
  });
});

describe('linkIsDown', () => {
  it('is down when our own socket is down', () => {
    expect(linkIsDown({ role: 'remote', connected: false, boatOffline: false })).toBe(true);
  });

  it('is down when the boat has gone quiet', () => {
    expect(linkIsDown({ role: 'remote', connected: true, boatOffline: true })).toBe(true);
  });

  it('is up when both halves are healthy', () => {
    expect(linkIsDown({ role: 'remote', connected: true, boatOffline: false })).toBe(false);
  });

  it('is down on the boat phone once armed and its own socket drops', () => {
    // The anchor alarm still runs on local GPS, but everyone watching from
    // ashore has gone blind — see the note in linkAlarm.js.
    expect(linkIsDown({ role: 'main', connected: false, armed: true })).toBe(true);
  });

  it('ignores a boat-phone outage before the watch is armed', () => {
    // A dropped connection means nothing until there is a watch to lose.
    expect(linkIsDown({ role: 'main', connected: false, armed: false })).toBe(false);
  });

  it('is up on an armed boat phone while its socket is healthy', () => {
    // boatOffline is a server->monitor signal and must not count here.
    expect(linkIsDown({ role: 'main', connected: true, armed: true, boatOffline: true })).toBe(false);
  });

  it('is down for neither an unknown role nor a bare call', () => {
    expect(linkIsDown({ role: 'idle', connected: false, armed: true })).toBe(false);
    expect(linkIsDown({})).toBe(false);
  });
});

describe('linkAlarmDueIn', () => {
  const down = (over, delayMs, extra) =>
    linkAlarmDueIn({ down: true, downSince: 1000, delayMs, now: 1000 + over, ...extra });

  it('waits out a blip shorter than the chosen delay', () => {
    expect(down(30000, 120000)).toBe(90000);
  });

  it('is due once the silence outlasts the delay', () => {
    expect(down(120000, 120000)).toBe(0);
    expect(down(500000, 120000)).toBe(0);
  });

  it('is due at once on the immediate setting', () => {
    expect(down(0, 0)).toBe(0);
  });

  it('has nothing to wait for while the link is up', () => {
    expect(linkAlarmDueIn({ down: false, downSince: 1000, delayMs: 0, now: 99999 })).toBe(null);
  });

  it('stays quiet once the watcher has acknowledged this outage', () => {
    expect(down(500000, 120000, { acknowledged: true })).toBe(null);
  });

  it('has nothing to wait for without a start time', () => {
    expect(linkAlarmDueIn({ down: true, delayMs: 0, now: 1000 })).toBe(null);
  });

  it('treats a missing delay as immediate rather than never', () => {
    expect(down(0, undefined)).toBe(0);
  });
});

describe('a watch that ended on purpose', () => {
  it('is not a link gap', () => {
    // The boat phone closed the session and said so; the watcher gets the
    // "session ended" dialog, not an alarm about a broken connection.
    expect(
      linkIsDown({ role: 'remote', connected: false, boatOffline: true, sessionEnded: true })
    ).toBe(false);
  });

  it('is not a link gap on the boat phone either', () => {
    expect(
      linkIsDown({ role: 'main', connected: false, armed: true, sessionEnded: true })
    ).toBe(false);
  });
});
