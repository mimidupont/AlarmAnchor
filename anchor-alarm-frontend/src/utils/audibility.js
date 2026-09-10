// Whether this phone can actually make the alarm noise.
//
// The alarm plays on Android's ALARM stream precisely so that a phone on
// silent or vibrate still sounds it (AlarmAudioPlugin.java). What that
// stream cannot survive is being turned down to zero, and it has its own
// volume slider that nothing else on the phone routes through — so a
// perfectly healthy watch, armed on a phone whose alarm volume happens to
// be at zero, is a watch that will never make a sound. Nothing in the app
// is wrong; nothing warns; and the way you find out is that the boat
// dragged and nobody woke up.
//
// The plugin has always been able to answer this — its status() method was
// written for it, with a comment saying it exists so the app can warn
// "while the boat is still safely at anchor, instead of at 3 a.m." — and
// nothing ever called it. This is the rule it feeds.
//
// Deliberately NOT reported as inaudible:
//
//   a low but non-zero volume  — one notch of the alarm stream is loud in a
//                                quiet cabin at 3 a.m., and an app that
//                                nags about a setting that is fine teaches
//                                people to dismiss the warning that is not.
//   silent / vibrate mode      — the alarm stream is not touched by the
//                                ringer, which is the whole reason it is
//                                used here.
//   Do Not Disturb             — genuinely dangerous (it can suppress
//                                alarms unless they are allowed through)
//                                but not readable without notification
//                                policy access, and a warning we cannot
//                                substantiate is worse than the release
//                                note that covers it.
//
// So this reports exactly one thing, and only when it is certain.

// A status object we could not read at all — the web build, or an older
// APK without the plugin — must never produce a warning. "Unknown" is not
// "muted", and crying wolf on every browser tab would bury the real case.
export function alarmAudibility(status) {
  const volume = status && Number.isFinite(status.alarmVolume) ? status.alarmVolume : null;
  if (volume === null) return { audible: true, reason: 'unknown' };
  if (volume === 0) return { audible: false, reason: 'muted' };
  return { audible: true, reason: null };
}
