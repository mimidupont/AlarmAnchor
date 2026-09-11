// The "nobody is watching the boat any more" alarm, and how long it waits.
//
// A remote monitor is exactly two links: this phone to the server, and the
// server to the boat phone. Break either and the map goes on showing a
// boat sitting placidly at anchor — the last position it heard, drawn in
// the same colours as a live one. That is the failure this app exists to
// prevent, and until now it was announced by a silent modal that a phone
// in a pocket at 4 a.m. never showed anyone.
//
// So the gap now rings. The problem with ringing is that both links break
// constantly and harmlessly: a boat phone dozes, passes a headland, hands
// over between the marina wifi and 4G; the watcher's own phone does the
// same ashore. An alarm on every blip is an alarm that gets muted on the
// first night, and a muted alarm protects nothing. Hence the delay: the
// watcher chooses how long a silence has to last before it means
// something, from "tell me at once" to an hour.
//
// WHICH DEVICE THIS IS FOR: both, but they mean different things by it.
//
// On the remote monitor it is the whole alarm: break either link and the
// map lies, so a sustained gap has to ring.
//
// On the boat phone the anchor alarm still runs entirely on local GPS with
// no network at all — losing the server never makes the boat any less
// watched from on board. What it does mean is that everyone watching from
// ashore has just gone blind, and a skipper who is relying on someone
// ashore to raise the alarm wants to know the moment that safety net is
// gone. So the boat sounds this too, on the same chosen delay, but only
// once actually on watch (anchor down, zone set) — before that a dropped
// connection means nothing. Set it to "1 h" (or leave the boat offline on
// purpose) and it stays quiet.

const KEY = 'linkAlarmDelay';

// Offered in the picker, in this order. `id` is what is persisted, so
// these strings are a storage format: renaming one silently resets every
// watcher who had chosen it back to the default.
export const LINK_ALARM_DELAYS = [
  { id: 'immediate', ms: 0, labelKey: 'delayImmediate' },
  { id: '2min', ms: 2 * 60 * 1000, labelKey: 'delay2min' },
  { id: '10min', ms: 10 * 60 * 1000, labelKey: 'delay10min' },
  { id: '1h', ms: 60 * 60 * 1000, labelKey: 'delay1h' }
];

// Two minutes: long enough to sit out a doze, a tunnel or a wifi handover
// — the blips this delay exists for — and short enough that a watch which
// has genuinely stopped is reported while it still matters. It is also the
// closest option to the 90 s grace this replaced, so an existing user's
// night sounds the same as it did before they had the choice.
export const DEFAULT_LINK_ALARM_DELAY = '2min';

export const linkAlarmDelayMs = (id) => {
  const found = LINK_ALARM_DELAYS.find((d) => d.id === id);
  return found ? found.ms : linkAlarmDelayMs(DEFAULT_LINK_ALARM_DELAY);
};

export function loadLinkAlarmDelay() {
  try {
    const stored = localStorage.getItem(KEY);
    if (LINK_ALARM_DELAYS.some((d) => d.id === stored)) return stored;
  } catch (err) {
    // Storage unavailable (private mode, quota) — the default is safe.
  }
  return DEFAULT_LINK_ALARM_DELAY;
}

export function saveLinkAlarmDelay(id) {
  if (!LINK_ALARM_DELAYS.some((d) => d.id === id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch (err) {
    // Persistence is best-effort; the choice still applies to this run.
  }
}

// Is this device's view of the boat broken right now?
//
// Both halves count, and they are told apart only in what the dialog says:
// a watcher whose own phone has lost signal is just as blind as one whose
// boat phone has gone quiet, and "the boat is not being watched" is true
// either way.
export function linkIsDown({ role, connected, boatOffline, sessionEnded, armed, visible } = {}) {
  // The boat phone closed the watch on purpose and every monitor has been
  // told so in as many words. Ringing on top of that dialog would be an
  // alarm about something the watcher already knows and cannot act on.
  if (sessionEnded) return false;
  if (role === 'remote') {
    // A monitor left on the chart table MUST ring in doze — that is the
    // whole point — so its gap does not depend on the app being open.
    return !connected || Boolean(boatOffline);
  }
  if (role === 'main') {
    // boatOffline is a server->monitor signal and is never set here; the
    // only link the boat can see break is its own reach to the server.
    // Silence before the watch is armed means nothing, so ignore it.
    //
    // Foreground-only: backgrounded, the boat's socket is throttled by
    // doze and drops for reasons that have nothing to do with real
    // connectivity, so a doze-time boat gap is noise — the anchor alarm
    // runs on local GPS regardless. Only a gap the skipper can actually
    // see, with the app open, is worth sounding. `visible` is undefined for
    // callers that don't track it (and for the tests), which reads as
    // "assume visible" so the plain armed+offline case still holds.
    return Boolean(armed) && !connected && visible !== false;
  }
  return false;
}

// Milliseconds until the link alarm is due: 0 if it is due now, or null if
// there is nothing to wait for (the link is up, or already acknowledged).
//
// Expressed as "how long left" rather than as a boolean so the caller can
// arm a single timer for exactly that long instead of polling — a monitor
// left on the chart table overnight must not wake the phone once a second
// for an hour to find out that nothing has changed.
export function linkAlarmDueIn({ down, downSince, delayMs, acknowledged, now = Date.now() } = {}) {
  if (!down || acknowledged) return null;
  if (!Number.isFinite(downSince)) return null;
  const due = downSince + (Number.isFinite(delayMs) ? delayMs : 0);
  return Math.max(0, due - now);
}
