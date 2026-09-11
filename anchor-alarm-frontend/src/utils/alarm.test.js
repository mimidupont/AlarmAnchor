/* eslint-env jest */
import {
  RECOVERY_MAX_INTERVAL_MS,
  RECOVERY_MIN_INTERVAL_MS,
  decideAlarm,
  nextRecoveryInterval,
  sessionErrorAction
} from './alarm';
import { circlePolygonPoints } from './geo';

// The local zone check is the property that makes this app safe: the boat
// phone decides on its own GPS, so losing the internet at anchor does not
// disable the alarm. It used to be protected only by a comment. This file
// is the lock.

const ANCHOR = { lat: 43.083, lng: 6.158 };
const ZONE = circlePolygonPoints(ANCHOR.lat, ANCHOR.lng, 40, 32);

// A point `north` metres north of the anchor.
const at = (north) => ({
  latitude: ANCHOR.lat + north / 111320,
  longitude: ANCHOR.lng
});

const INSIDE = at(10);
const OUTSIDE = at(80);

const fix = (position, state) =>
  decideAlarm({ ...position, zone: ZONE, ...state });

const ARMED_IDLE = { alarmed: false, acknowledged: false };

describe('decideAlarm', () => {
  it('fires when the boat is outside the zone and nothing is acknowledged', () => {
    const next = fix(OUTSIDE, ARMED_IDLE);
    expect(next.alarmed).toBe(true);
    expect(next.fire).toBe(true);
  });

  it('stays silent while the boat is inside the zone', () => {
    const next = fix(INSIDE, ARMED_IDLE);
    expect(next.alarmed).toBe(false);
    expect(next.fire).toBe(false);
  });

  it('does not re-fire on every fix while already alarming', () => {
    const first = fix(OUTSIDE, ARMED_IDLE);
    const second = fix(OUTSIDE, first);
    expect(second.alarmed).toBe(true);
    expect(second.fire).toBe(false);
  });

  it('stays silent outside the zone once acknowledged', () => {
    const acknowledged = { alarmed: false, acknowledged: true };
    const next = fix(OUTSIDE, acknowledged);
    expect(next.alarmed).toBe(false);
    expect(next.fire).toBe(false);
  });

  it('re-arms and clears the acknowledgement when the boat returns inside', () => {
    const acknowledged = { alarmed: false, acknowledged: true };
    const back = fix(INSIDE, acknowledged);
    expect(back.acknowledged).toBe(false);
    expect(back.alarmed).toBe(false);

    // ...and drifting out again must alarm, not stay silenced.
    const outAgain = fix(OUTSIDE, back);
    expect(outAgain.alarmed).toBe(true);
    expect(outAgain.fire).toBe(true);
  });

  it('leaves the state untouched when there is no usable zone', () => {
    for (const zone of [undefined, null, [], [[43.08, 6.15], [43.081, 6.151]]]) {
      const next = decideAlarm({ ...OUTSIDE, zone, alarmed: false, acknowledged: false });
      expect(next).toEqual({ alarmed: false, acknowledged: false, fire: false });
    }
  });
});

describe('decideAlarm with the server unreachable', () => {
  // Every case above must still hold with no network of any kind. The
  // decision takes no socket, no connection flag and no server state — this
  // makes that structural property a failing test if anyone reintroduces a
  // dependency on the backend.
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = () => {
      throw new Error('network disabled: the alarm must not need the server');
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('still fires, silences and re-arms offline', () => {
    const fired = fix(OUTSIDE, ARMED_IDLE);
    expect(fired).toEqual({ alarmed: true, acknowledged: false, fire: true });

    const acknowledged = fix(OUTSIDE, { alarmed: false, acknowledged: true });
    expect(acknowledged.fire).toBe(false);

    const rearmed = fix(INSIDE, { alarmed: false, acknowledged: true });
    expect(rearmed.acknowledged).toBe(false);
    expect(fix(OUTSIDE, rearmed).fire).toBe(true);
  });
});

describe('sessionErrorAction', () => {
  it('recovers instead of tearing down when the boat phone loses its session', () => {
    // The critical one. 'recover' is what keeps GPS running, the map up and
    // the zone intact; anything else disarms the alarm for the night.
    expect(sessionErrorAction('main', 'Session not found')).toBe('recover');
  });

  it('sends a remote monitor back to the picker', () => {
    expect(sessionErrorAction('remote', 'Session not found')).toBe('reset');
  });

  it('treats a client with no role yet as a remote', () => {
    expect(sessionErrorAction(undefined, 'Session not found')).toBe('reset');
  });

  it('ignores every other server error, for both roles', () => {
    for (const role of ['main', 'remote', undefined]) {
      expect(sessionErrorAction(role, 'Too many join attempts')).toBe('none');
      expect(sessionErrorAction(role, 'something else entirely')).toBe('none');
    }
  });
});

describe('recovery pacing', () => {
  it('backs off geometrically and stops at the ceiling', () => {
    let interval = RECOVERY_MIN_INTERVAL_MS;
    const seen = [];
    for (let i = 0; i < 12; i++) {
      interval = nextRecoveryInterval(interval);
      seen.push(interval);
    }
    expect(seen[0]).toBe(RECOVERY_MIN_INTERVAL_MS * 2);
    expect(Math.max(...seen)).toBe(RECOVERY_MAX_INTERVAL_MS);
    // A backend that is down hard must never become a POST loop.
    expect(seen.every((ms) => ms >= RECOVERY_MIN_INTERVAL_MS)).toBe(true);
  });
});

// Why App.jsx's rearmAlarm() has to exist.
//
// decideAlarm is right to keep an acknowledged alarm silent while the boat
// stays outside — that is the skipper motoring deliberately out of the
// anchorage. What it cannot know is that the WATCH has changed underneath
// it. The only thing that clears the flag here is a fix landing back
// inside the zone, and the tests below are the two shapes where that fix
// never comes. In both of them the alarm is silent for ever: not a missed
// transition, an alarm that is switched off with nothing on screen saying
// so. App.jsx therefore clears the acknowledgement itself whenever the
// anchor or the zone changes — if that call is ever removed, this is the
// behaviour that comes back.
describe('an acknowledgement outliving its watch', () => {
  it('silences a zone the boat is already outside of, for ever', () => {
    const zoneFarAway = circlePolygonPoints(ANCHOR.lat + 0.005, ANCHOR.lng, 40, 32);
    let state = { alarmed: false, acknowledged: true };

    for (let i = 0; i < 100; i++) {
      state = decideAlarm({ ...INSIDE, zone: zoneFarAway, ...state });
      expect(state.fire).toBe(false);
      expect(state.alarmed).toBe(false);
    }
    // Still set: nothing here can ever clear it.
    expect(state.acknowledged).toBe(true);
  });

  it('survives the zone being cleared and rebuilt', () => {
    // Raising the anchor takes the zone with it, and a zone of fewer than
    // three points is not a zone — so the short-circuit hands the flag
    // straight back, and it is waiting for the next anchorage.
    let state = decideAlarm({ ...OUTSIDE, zone: [], alarmed: false, acknowledged: true });
    expect(state.acknowledged).toBe(true);
    state = decideAlarm({ ...OUTSIDE, zone: ZONE, ...state });
    expect(state.fire).toBe(false);
  });

  it('is cleared the moment a fix does land inside — the case that hid this', () => {
    // Re-anchoring where the boat actually is self-heals on the next fix,
    // which is why the bug survived every test that moved the phone.
    const state = decideAlarm({ ...INSIDE, zone: ZONE, alarmed: false, acknowledged: true });
    expect(state.acknowledged).toBe(false);
  });
});
