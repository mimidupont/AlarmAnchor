// The boat phone's own battery, treated as part of the watch.
//
// A flat battery is the commonest way an anchor watch silently ends: the
// phone that IS the alarm dies, GPS stops, and the last thing every remote
// monitor saw was a boat riding quietly at anchor. The resume flow exists
// precisely because this happens. Warning before it happens — while the
// skipper can still plug in a cable — is cheaper than recovering after.
//
// This module is only the pure classification and formatting; the actual
// plugin read lives in App.jsx, because it is a platform call that cannot
// be unit-tested.

// Warn below this, and only while unplugged: a boat wired to shore power or
// a solar/12 V charger is not the failure this is about, and nagging a
// plugged-in phone is how a warning gets ignored on the night it is real.
export const LOW_BATTERY = 0.2;
// The point at which "charge me soon" becomes "charge me now" — worth a
// louder line, still not a siren (a dead battery is not a dragging boat).
export const CRITICAL_BATTERY = 0.1;

// 'ok' | 'low' | 'critical'. A charging phone is always 'ok': it is heading
// the right way regardless of the current level. An unreadable level (the
// web build, an APK without the plugin) is 'ok' too — unknown is not low,
// and a warning we cannot substantiate is worse than none.
export function batteryLevelState({ level, charging } = {}) {
  if (charging) return 'ok';
  if (!Number.isFinite(level)) return 'ok';
  if (level <= CRITICAL_BATTERY) return 'critical';
  if (level <= LOW_BATTERY) return 'low';
  return 'ok';
}

// Whole-percent string for the status sheet, or null when unreadable.
export function formatBatteryPct(level) {
  if (!Number.isFinite(level)) return null;
  const clamped = Math.max(0, Math.min(1, level));
  return `${Math.round(clamped * 100)}%`;
}

// Normalize whatever a battery source hands back into { level, charging } or
// null. Capacitor's getBatteryInfo returns { batteryLevel, isCharging }; the
// web Battery API returns { level, charging }. Levels outside 0..1 (some
// stacks send -1 for "unknown") collapse to null so they read as unknown,
// never as a full or empty battery.
export function normalizeBattery(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rawLevel = Number.isFinite(raw.batteryLevel) ? raw.batteryLevel : raw.level;
  const level = Number.isFinite(rawLevel) && rawLevel >= 0 && rawLevel <= 1 ? rawLevel : null;
  const charging =
    typeof raw.isCharging === 'boolean'
      ? raw.isCharging
      : typeof raw.charging === 'boolean'
        ? raw.charging
        : null;
  if (level === null && charging === null) return null;
  return { level, charging };
}
