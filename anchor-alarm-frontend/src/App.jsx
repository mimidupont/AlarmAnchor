/**
 * App.jsx - UPDATED WITH MOBILE AUDIO ALERTS + ANCHOR DROP
 * 
 * Changes from original:
 * 1. Replaced HTML5 audio element with useMobileAudioAlert hook
 * 2. Improved permission management
 * 3. Added Service Worker registration
 * 4. Better error handling for mobile audio
 * 5. Added manual anchor-drop tracking (separate from live boat GPS)
 * 6. Restored "leave session" confirmation dialog when zone/anchor would be lost
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import io from 'socket.io-client';
import Map from './components/Map';
import SessionManager from './components/SessionManager';
import RemoteMonitor from './components/RemoteMonitor';
import AlarmNotification from './components/AlarmNotification';
import ConfirmDialog from './components/ConfirmDialog';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  RECOVERY_MIN_INTERVAL_MS,
  decideAlarm,
  nextRecoveryInterval,
  sessionErrorAction
} from './utils/alarm';
import { ensureDeviceId, initDeviceId } from './utils/deviceId';
import { urlWithoutJoinParam } from './utils/joinLink';
import { forgetWatch, loadWatch, pruneOrphanTracks, saveWatch } from './utils/watch';
import { stampAllReceivedAt, stampReceivedAt } from './utils/freshness';
import { acceptFix, bestRecentFix, emptyFixFilter, pruneFixes } from './utils/gpsQuality';
import { alarmAudibility } from './utils/audibility';
import {
  linkAlarmDelayMs,
  linkAlarmDueIn,
  linkIsDown,
  loadLinkAlarmDelay,
  saveLinkAlarmDelay
} from './utils/linkAlarm';
import { LangContext, defaultLang, makeT } from './i18n';
import {
  appendPoint,
  deserializeTrack,
  serializeTrack,
  shouldRecordPoint,
  trackStorageKey
} from './utils/track';
import './App.css';

// Foreground-service GPS watcher (@capacitor-community/background-geolocation).
// Unlike @capacitor/geolocation, it keeps a fix coming when the screen is off
// or the app is backgrounded — essential for an overnight anchor watch.
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

// The alarm's actual noise, played on Android's ALARM stream.
//
// A notification channel's sound plays with USAGE_NOTIFICATION, and silent
// mode and vibrate mode are defined as silencing precisely that — so the
// anchor alarm was inaudible in the two states a phone is most likely to be
// in overnight at anchor. The alarm stream is the one a phone set to silent
// still wakes you with, which is the behaviour this needs.
const AlarmAudio = registerPlugin('AlarmAudio');

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

// Printed once at startup so "which backend is this build actually talking
// to?" is answerable from the browser console, without DevTools archaeology
// through the socket.io requests.
//
// This is not hypothetical: REACT_APP_BACKEND_URL is baked in at build time,
// and a Vercel project-level environment variable silently overrides the
// .env.production checked into the repo. When the two disagree the symptom is
// a session that plainly exists — GET /api/sessions/<id> returns it — yet
// every socket join is answered "Session not found", because the page is
// asking a different server entirely.
console.log(`⚓ Anchor Alarm — backend: ${BACKEND_URL}`);

// The notification the OS fires by itself when a monitoring gap outlives
// the chosen delay.
//
// A remote monitor spends the night with the screen off and the app frozen,
// which is exactly when a JavaScript setTimeout is least likely to run:
// Android throttles timers in a backgrounded webview and stops them
// altogether in deep doze. So the gap alarm is armed twice — a timer for
// the case where the app is awake, and this scheduled notification, which
// the OS delivers on the anchor-alarm channel whether the app is running
// or not. Whichever arrives first cancels the other.
//
// Distinct id from the dragging alarm's notification (1) so cancelling a
// pending gap alarm can never take the dragging alarm off the screen.
const LINK_ALARM_NOTIFICATION_ID = 2;

const THEMES = ['day', 'night', 'red'];

// localStorage persistence is web-only (nice-to-have); the Capacitor
// build just starts from the default and keeps theme in React state.
const loadInitialTheme = () => {
  try {
    if (!Capacitor.isNativePlatform()) {
      const stored = localStorage.getItem('theme');
      if (THEMES.includes(stored)) return stored;
    }
  } catch (err) {
    // Storage unavailable (private mode etc.) — fall through to default.
  }
  return 'day';
};

export default function App() {
  const [view, setView] = useState('session'); // 'session', 'main', 'remote'
  const [sessionId, setSessionId] = useState(null);
  const [socket, setSocket] = useState(null);
  const [zone, setZone] = useState([]);
  const [locations, setLocations] = useState({});
  const [alarmed, setAlarmed] = useState(false);
  const [error, setError] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [anchor, setAnchor] = useState(null); // { latitude, longitude, accuracy, timestamp } | null
  const [theme, setTheme] = useState(loadInitialTheme);
  const [lang, setLang] = useState(defaultLang);
  // Session just created on this (boat) phone: the session screen shows
  // the share step (ID chip + QR) until the user opens the map.
  const [createdSessionId, setCreatedSessionId] = useState(null);
  // A watch this phone started and never ended — an OS kill, a crash, a flat
  // battery. Read once at startup so the session screen can offer to resume
  // it; the server only lets the device that created a session come back to
  // it as the boat.
  const [resumable, setResumable] = useState(() => loadWatch());
  // ?join=<ID> in the URL (from a scanned QR): auto-join as remote once
  // the socket connects. Consumed exactly once.
  const joinParamRef = useRef(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('join')
      : null
  );
  // GPS track: the swing pattern over hours is the most diagnostic view
  // in an anchor watch, and how you confirm after the fact that a 4 a.m.
  // alarm was real. trackRef mirrors it for the GPS callback, same pattern
  // as zoneRef / locationsRef.
  const [track, setTrack] = useState([]);
  const trackRef = useRef([]);
  const trackDirty = useRef(false);
  const trackSavedAt = useRef(0);
  // Monitoring health, surfaced by the status pill
  const [connected, setConnected] = useState(false);
  const [gpsError, setGpsError] = useState(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  // The boat phone ended the watch: a remote monitor must be told outright,
  // not left inferring it from a map that stopped moving.
  const [sessionEnded, setSessionEnded] = useState(false);
  // The boat phone's socket dropped — app closed, killed, flat battery, no
  // signal. Indistinguishable from each other, and all recoverable, so this
  // warns immediately and only escalates to a modal if the silence lasts.
  const [boatOffline, setBoatOffline] = useState(false);
  const [monitoringStopped, setMonitoringStopped] = useState(false);
  // When the current monitoring gap started (either half of the link), or
  // null while the boat is being watched normally. Drives the one timer
  // that decides when the gap becomes an alarm.
  const [linkDownSince, setLinkDownSince] = useState(null);
  // How long a gap has to last before it rings. The watcher's choice, kept
  // across restarts — see utils/linkAlarm.js for why it is a choice at all.
  const [linkAlarmDelay, setLinkAlarmDelay] = useState(loadLinkAlarmDelay);
  // Bumped when the app comes back to the foreground, purely to re-run the
  // gap timer against the real clock — see the effect that reads it.
  const [resumeTick, setResumeTick] = useState(0);
  const offlineTimer = useRef(null);
  // Set once the watcher has read the modal, so a single outage does not
  // keep re-interrupting them. Cleared when the boat comes back, so a
  // genuinely new outage warns again.
  const monitoringStoppedAck = useRef(false);
  // The alarm stream on this phone is turned down to zero, so the alarm
  // will be silent. Checked when the watch is armed — while the boat is
  // still safely at anchor — and again whenever the alarm actually fires.
  const [alarmMuted, setAlarmMuted] = useState(false);
  // Set to the new session ID after a successful recovery, so the user can
  // re-share the code. Dismissible, and deliberately never a modal — the
  // map must stay usable.
  const [recoveryNotice, setRecoveryNotice] = useState(null);
  const gpsWatchId = useRef(null);
  const pendingLeaveRef = useRef(null);
  // Latest locations, readable from socket handlers registered once
  // (their closures would otherwise see the initial empty state forever).
  const locationsRef = useRef({});
  // Current session membership, so we can automatically re-join after a
  // socket.io reconnection (the server forgets room membership on
  // disconnect — without re-joining, GPS updates are silently dropped
  // and the alarm can never fire again).
  const sessionRef = useRef(null); // { sessionId, role } | null
  // Socket instance, reachable from the long-lived GPS watcher callback.
  const socketRef = useRef(null);
  // The last few seconds of accepted GPS fixes, newest last. Dropping the
  // anchor picks the most precise one out of this instead of requesting a
  // second concurrent fix (which is slow, and starves entirely with an
  // active watch in some environments) or trusting whichever fix happened
  // to arrive last. Pruned to the window on every fix, so it stays a
  // handful of entries however long the night is.
  const recentFixesRef = useRef([]);
  // Rolling state of the fix-quality filter — see utils/gpsQuality.js. It
  // lives in a ref because the GPS callback runs outside React's render
  // cycle and must see the verdict on the previous fix synchronously.
  const fixFilterRef = useRef(emptyFixFilter());
  // Local alarm state machine on the boat phone. The GPS callback and the
  // socket handlers both need the *current* values synchronously, so these
  // are refs updated at every state transition (not effects).
  const zoneRef = useRef([]);
  const alarmedRef = useRef(false);
  const acknowledgedRef = useRef(false);
  // The anchor, readable synchronously during session recovery (which has
  // to re-push it to the new session without waiting for a render).
  const anchorRef = useRef(null);
  // Session-recovery pacing — see recoverSession below.
  const recoveryInFlight = useRef(false);
  const recoveryAt = useRef(0);
  const recoveryInterval = useRef(RECOVERY_MIN_INTERVAL_MS);

  useEffect(() => {
    locationsRef.current = locations;
  }, [locations]);

  useEffect(() => {
    zoneRef.current = zone;
  }, [zone]);

  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);

  // Keep the resumable record in step with the live watch. The zone and the
  // anchor are what make a resumed session armed rather than merely open, so
  // they are written whenever they change rather than only at startup.
  useEffect(() => {
    if (!sessionId || sessionRef.current?.role !== 'main') return;
    saveWatch({ sessionId, zone, anchor });
  }, [sessionId, zone, anchor]);

  const t = useMemo(() => makeT(lang), [lang]);
  // Long-lived callbacks (socket handlers, GPS watcher) read the current
  // translator through this ref rather than a stale closure.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const toggleLang = () => {
    const next = lang === 'en' ? 'fr' : 'en';
    setLang(next);
    try {
      localStorage.setItem('lang', next);
    } catch (err) {
      // Persistence is best-effort only.
    }
  };

  // Persistence: an overnight watch that loses its track to an app restart
  // is exactly the case you most wanted it. Written at most every 30 s or
  // 20 points, and on pagehide / app-pause.
  const persistTrack = (sessionIdOverride) => {
    const id = sessionIdOverride || sessionRef.current?.sessionId;
    if (!id) return;
    try {
      localStorage.setItem(trackStorageKey(id), serializeTrack(trackRef.current));
      trackDirty.current = false;
      trackSavedAt.current = Date.now();
    } catch (err) {
      // Quota or private mode — the track is a nice-to-have, never fatal.
    }
  };

  const restoreTrack = (id) => {
    try {
      const raw = localStorage.getItem(trackStorageKey(id));
      if (!raw) return;
      const restored = deserializeTrack(raw);
      if (restored.length) {
        trackRef.current = restored;
        setTrack(restored);
      }
    } catch (err) {
      // Ignore — start with an empty track.
    }
  };

  // Session recovery mints a new session ID, and the track is stored under
  // a per-session key. Move it across so an app restart after a recovery
  // still finds the night's track.
  const retargetTrackStorage = (oldId, newId) => {
    if (!newId || oldId === newId) return;
    try {
      if (oldId) localStorage.removeItem(trackStorageKey(oldId));
    } catch (err) {
      // Best-effort; a stale key just expires with the browser storage.
    }
    persistTrack(newId);
  };

  const clearTrack = () => {
    const id = sessionRef.current?.sessionId;
    trackRef.current = [];
    setTrack([]);
    trackDirty.current = false;
    if (id) {
      try {
        localStorage.removeItem(trackStorageKey(id));
      } catch (err) {
        // Nothing to do.
      }
    }
  };

  // Flush on backgrounding: pagehide covers web and fires on Android when
  // the webview is paused, which is when an OS kill is most likely.
  useEffect(() => {
    const flush = () => {
      if (trackDirty.current) persistTrack();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile the durable (native Preferences) copy of the device ID once
  // at startup. ensureDeviceId() below is synchronous and already has a
  // usable value, so nothing ever waits on this.
  useEffect(() => {
    initDeviceId();
  }, []);

  // Re-push everything the boat phone is authoritative for.
  //
  // The phone keeps working with no network at all, so the skipper can move
  // the anchor or redraw the zone while offline and the server knows
  // nothing about it. Rejoining a session is not enough: the room
  // membership comes back, but the state does not, and every watcher goes
  // on showing the pre-outage zone around an anchor that has since moved —
  // confidently, with no hint that it is stale.
  //
  // Safe to repeat: update-zone and update-anchor are idempotent, and the
  // server only accepts restore-track into an empty track, so this cannot
  // overwrite a longer history than the one it is offering.
  const pushLocalState = (socket) => {
    if (!socket) return;
    if (zoneRef.current && zoneRef.current.length >= 3) {
      socket.emit('update-zone', { zone: zoneRef.current });
    }
    if (anchorRef.current) {
      // resetTrack: false — same anchoring, and the night's track is the
      // diagnostic record. An outage must never clear it.
      socket.emit('update-anchor', { anchor: anchorRef.current, resetTrack: false });
    }
    if (trackRef.current.length) {
      socket.emit('restore-track', { track: trackRef.current });
    }
    // An acknowledgement is local state too, and the one piece of it whose
    // loss is audible: a recovered session starts with acknowledged=false,
    // so without this the server raises the alarm again on the very next
    // fix while the boat is still (deliberately) outside its zone.
    if (acknowledgedRef.current) {
      socket.emit('acknowledge-alarm');
    }
  };

  const clearOfflineWatch = () => {
    if (offlineTimer.current) {
      clearTimeout(offlineTimer.current);
      offlineTimer.current = null;
    }
  };

  // ---- The monitoring gap (remote monitors only) ----
  //
  // A watcher ashore is two links: this phone to the server, and the server
  // to the boat phone. Break either and the map goes on showing a boat
  // riding quietly at anchor, drawn exactly like a live one — the last
  // position it heard. Saying so in a silent modal was no use to a phone
  // face-down on a bunk, so the gap now rings, on the alarm stream, like
  // the dragging alarm does.
  //
  // What makes that survivable is the delay: both links break constantly
  // and harmlessly (doze, a headland, a wifi handover), and an alarm that
  // cries wolf every night gets muted, which is worse than no alarm at
  // all. The watcher picks how long a silence has to last before it counts
  // — immediately, 2 min, 10 min or 1 h — and that choice is the only
  // thing standing between the two. See utils/linkAlarm.js.
  //
  // The boat phone deliberately never comes through here: it alarms from
  // its own GPS with no network at all.
  const linkDown = linkIsDown({
    role: view === 'remote' ? 'remote' : 'main',
    connected,
    boatOffline,
    sessionEnded
  });

  // Set while THIS device is sounding for a gap rather than for a drag, so
  // recovery and acknowledgement can stop that noise without ever silencing
  // a real dragging alarm that happens to be running at the same time.
  const linkAlarmSounding = useRef(false);

  const stopLinkAlarmNoise = () => {
    if (!linkAlarmSounding.current) return;
    linkAlarmSounding.current = false;
    stopAlarm();
  };

  // Hand the gap alarm to the OS as well as to a timer. See
  // LINK_ALARM_NOTIFICATION_ID: a backgrounded webview's timers are
  // throttled and, in doze, stopped, which is precisely the state a
  // monitor phone spends the night in.
  const scheduleLinkAlarmNotification = async (at) => {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: LINK_ALARM_NOTIFICATION_ID,
          title: tRef.current('notifLinkTitle'),
          body: tRef.current('notifLinkBody'),
          schedule: { at: new Date(at) },
          sound: 'alarm.mp3',
          autoCancel: true,
          channelId: 'anchor-alarm'
        }]
      });
    } catch (err) {
      // Web, or notifications refused. The in-app timer still fires.
      console.warn('Could not pre-schedule the monitoring-gap alarm:', err);
    }
  };

  const cancelLinkAlarmNotification = async () => {
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: LINK_ALARM_NOTIFICATION_ID }]
      });
    } catch (err) {
      // Nothing was scheduled, or the plugin is unavailable.
    }
  };

  const raiseLinkAlarm = () => {
    if (monitoringStoppedAck.current) return;
    // Whichever of the two armed paths gets here first retires the other.
    cancelLinkAlarmNotification();
    setMonitoringStopped(true);
    // A boat that is genuinely dragging is already making this device
    // shout. A second siren on top of it would only make the first harder
    // to silence, and the takeover screen already says something worse.
    if (alarmedRef.current) return;
    linkAlarmSounding.current = true;
    triggerAlarmSequence({
      title: tRef.current('notifLinkTitle'),
      body: tRef.current('notifLinkBody')
    });
  };

  // Start the clock on a gap, and take everything back down when both
  // halves of the link are healthy again — the situation the alarm and the
  // dialog describe is simply no longer true, so neither should outlive it.
  useEffect(() => {
    if (!linkDown) {
      setLinkDownSince(null);
      setMonitoringStopped(false);
      monitoringStoppedAck.current = false;
      clearOfflineWatch();
      cancelLinkAlarmNotification();
      stopLinkAlarmNoise();
      return;
    }
    // Only the FIRST event of a gap starts the clock: a flapping phone
    // emits boat-offline repeatedly, and restarting the delay on each one
    // would mean an outage that flaps every 90 s never reaches an alarm at
    // all, however long it lasts.
    setLinkDownSince((current) => (current === null ? Date.now() : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkDown]);

  // One timer per gap, armed for exactly what is left of the delay — not a
  // poll. A monitor left on the chart table must not wake the phone once a
  // second for an hour to discover that nothing has changed.
  //
  // Re-armed when the watcher changes the delay mid-gap, and on returning
  // to the foreground, where an alarm that came due while the timer was
  // throttled is found overdue and fires at once.
  useEffect(() => {
    clearOfflineWatch();
    if (linkDownSince === null) return undefined;

    const delayMs = linkAlarmDelayMs(linkAlarmDelay);
    const dueIn = linkAlarmDueIn({
      down: true,
      downSince: linkDownSince,
      delayMs,
      acknowledged: monitoringStoppedAck.current
    });
    if (dueIn === null) return undefined;

    // Only worth handing to the OS if there is real waiting to do; for
    // anything sooner the timer below is already the faster of the two and
    // pre-scheduling would just risk two noises at once.
    if (dueIn > 2000) scheduleLinkAlarmNotification(linkDownSince + delayMs);
    offlineTimer.current = setTimeout(raiseLinkAlarm, dueIn);
    return clearOfflineWatch;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkDownSince, linkAlarmDelay, resumeTick]);

  // Coming back to the foreground re-runs the timer effect above. Android
  // throttles a backgrounded webview's timers and stops them outright in
  // doze, so without this a gap alarm could be twenty minutes overdue and
  // still silent on screen when the watcher picks the phone up.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setResumeTick(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);

  const changeLinkAlarmDelay = (id) => {
    setLinkAlarmDelay(id);
    saveLinkAlarmDelay(id);
  };

  // Every join carries the stable device ID: the server keys the session's
  // live positions by it rather than by socket.id, so a night of flapping
  // signal shows one boat marker instead of one per reconnect.
  const emitJoin = (socket, session) => {
    if (!socket || !session) return;
    socket.emit('join-session', { ...session, deviceId: ensureDeviceId() });
  };

  // The single place the alarm flag changes, and therefore the only place
  // that can be sure to silence the noise.
  //
  // triggerAlarmSequence starts a LOOPING alarm-stream player, a repeating
  // vibration and an ongoing notification; nothing stops any of them until
  // AlarmAudio.stop() is called. That used to happen only on an explicit
  // acknowledgement, so every other way out of the alarm left the phone
  // sounding for good: the common one is the boat swinging back inside the
  // zone, which clears `alarmed`, unmounts AlarmNotification — the only UI
  // carrying the slide-to-silence control — and leaves the tester with a
  // screaming phone and nothing to tap.
  const setAlarmedState = (value) => {
    const wasAlarmed = alarmedRef.current;
    alarmedRef.current = value;
    setAlarmed(value);
    if (wasAlarmed && !value) stopAlarm();
  };

  // Redefining the watch re-arms it.
  //
  // An acknowledgement means "I have seen THIS excursion and I want quiet";
  // decideAlarm otherwise clears it only when a fix lands back inside the
  // zone. Dropping the anchor somewhere new, moving it, or confirming a
  // different zone are all the skipper saying the watch is now a different
  // watch — and re-arming around a distant anchor, or on a zone the boat is
  // already outside of, never produces a fix inside, so without this the
  // flag survives for the rest of the session. Every later drag is then
  // evaluated, found outside, and silenced: no alarm, no takeover screen,
  // no warning, and a phone that looks armed from every screen. It is the
  // quietest way this app can fail, and it is reachable from the most
  // ordinary way to test it twice — leave the boat and move the anchor.
  //
  // `alarmed` is deliberately left alone: a siren that is actually sounding
  // covers the screen with the takeover, so none of these actions can be
  // reached while it is true, and clearing it here could only ever silence
  // a real alarm. decideAlarm re-derives it from the next fix anyway.
  const rearmAlarm = () => {
    acknowledgedRef.current = false;
  };

  // How a remote monitor applies the server's alarm verdict.
  //
  // A watcher who has silenced their own device must STAY silent for the rest
  // of that alarm — otherwise the next location update, which carries the
  // still-true alarm flag, puts the full-screen takeover straight back up.
  // But it must warn again on a NEW alarm, so the suppression is cleared the
  // moment the server says the alarm is over.
  //
  // The boat phone never comes through here: it decides locally in
  // handleGpsFix, and its acknowledgement is the session-wide one.
  const applyRemoteAlarm = (alarmedNow) => {
    if (!alarmedNow) {
      acknowledgedRef.current = false;
      setAlarmedState(false);
      return;
    }
    if (acknowledgedRef.current) return;
    const alreadyShowing = alarmedRef.current;
    setAlarmedState(true);
    // Making the noise belongs HERE, not only in the alarm-status-changed
    // handler, because that event fires only on a server-side transition. A
    // watcher learns the alarm is on by three routes, and the other two used
    // to raise the takeover screen in total silence:
    //
    //   state-update     — opening the app, or reconnecting, while the boat
    //                      is already dragging
    //   location-updated — every fix after that
    //
    // So a watcher whose phone dropped signal for twenty seconds mid-drag, or
    // who opened the app to check, got a full-screen red alarm and no sound
    // at all. In a pocket that is indistinguishable from nothing happening.
    //
    // Guarded on alreadyShowing so a stream of fixes during one alarm does not
    // restart the siren on every one, and skipped entirely above when this
    // watcher has silenced their own device.
    if (!alreadyShowing) {
      // Whatever this device was sounding for, it is sounding for a
      // dragging boat now — so the gap flag must stop claiming the noise,
      // or a link that recovers a moment later would silence a real alarm.
      linkAlarmSounding.current = false;
      triggerAlarmSequence();
    }
  };

  const applyTheme = (next) => {
    setTheme(next);
    try {
      if (!Capacitor.isNativePlatform()) localStorage.setItem('theme', next);
    } catch (err) {
      // Persistence is best-effort only.
    }
  };

  const cycleTheme = () => {
    applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
  };

  // NOTE: arming deliberately does NOT change the theme. Setting a zone
  // in daylight used to flip the screen to the night palette, which is
  // unreadable in sun and surprising. The theme only ever changes when
  // the user taps the toggle, and that choice persists.

// Create the native notification channel (Android 8+ requires this)
  useEffect(() => {
    LocalNotifications.createChannel({
      id: 'anchor-alarm',
      name: 'Anchor Alarm',
      importance: 5,
      sound: 'alarm.mp3',
      vibration: true,
      lights: true
    }).catch(err => console.warn('Channel creation failed:', err));
  }, []);

  // Read the plugin's verdict on whether the alarm can be heard at all, and
  // put the banner up if it cannot. Takes a status object when the caller
  // already has one — triggerAlarmSequence gets it back from start(), so
  // the check costs nothing at the one moment it matters most.
  const applyAudibility = (status) => {
    setAlarmMuted(!alarmAudibility(status).audible);
  };

  const checkAlarmAudible = async () => {
    try {
      applyAudibility(await AlarmAudio.status());
    } catch (err) {
      // Web, or an APK without the plugin. Unknown is not muted: never
      // warn about something we could not read.
      setAlarmMuted(false);
    }
  };

  const stopAlarm = async () => {
    // Stop the noise first, and independently of the notification: if
    // cancelling the notification throws, the phone must not be left
    // sounding an alarm nobody can silence.
    try {
      await AlarmAudio.stop();
    } catch (err) {
      // Web, or an older APK without the plugin — nothing was playing.
    }
    try {
      await LocalNotifications.cancel({ notifications: [{ id: 1 }] });
    } catch (err) {
      console.warn('Could not cancel the alarm notification:', err);
    }
  };

  // Session recovery on the boat phone.
  //
  // The server losing our session — a deploy, a Fly host migration, an OOM,
  // a healthcheck restart — must be a cosmetic event. GPS keeps running,
  // the map stays up, and the anchor, zone and track are never touched.
  // All this does is mint a new session and re-push the local state so
  // remote monitors can find us again. If every step of it fails, the boat
  // phone is still fully armed on local GPS and the status pill says
  // "Offline — local only".
  const recoverSession = async () => {
    if (recoveryInFlight.current) return;
    const now = Date.now();
    if (now - recoveryAt.current < recoveryInterval.current) return;
    recoveryInFlight.current = true;
    recoveryAt.current = now;

    const previousId = sessionRef.current?.sessionId;
    try {
      // ?recovery=1 is purely diagnostic: it lets a post-mortem tell a
      // recovery mint apart from a tester creating a session by hand.
      // The device ID travels with the create: it is what the server
      // records as the session's owner, and therefore what lets this phone
      // — and only this phone — come back to the watch later.
      const response = await fetch(`${BACKEND_URL}/api/sessions?recovery=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: ensureDeviceId() })
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      if (!data?.sessionId) throw new Error('No session ID returned');

      sessionRef.current = { sessionId: data.sessionId, role: 'main' };
      setSessionId(data.sessionId);
      // The share screen renders createdSessionId, NOT sessionId — it is
      // what the big code chip and the QR are built from. Leaving it behind
      // meant that after a recovery the boat phone kept displaying a code
      // that no longer exists on the server, so anyone reading it off the
      // screen (or scanning the QR) got "Session not found" while the phone
      // itself was perfectly healthy in a new session.
      //
      // Only refreshed when it was already set: a boat phone that joined an
      // existing session by typing a code never had a share screen, and
      // must not suddenly be given one.
      setCreatedSessionId((current) => (current ? data.sessionId : current));
      retargetTrackStorage(previousId, data.sessionId);
      // The resumable record follows the new ID too, or an app restart after
      // a recovery would offer to resume a session the server has forgotten.
      saveWatch({ sessionId: data.sessionId, zone: zoneRef.current, anchor: anchorRef.current });

      const socket = socketRef.current;
      if (socket) {
        emitJoin(socket, sessionRef.current);
        // Same resync as any other reconnect — the session is brand new and
        // empty here, so this is what repopulates it.
        pushLocalState(socket);
      }

      recoveryInterval.current = RECOVERY_MIN_INTERVAL_MS;
      setRecoveryNotice(data.sessionId);
      console.log('♻️ Session recovered as', data.sessionId);
    } catch (err) {
      // Back off, so a backend that is down hard does not turn the boat
      // phone into a POST loop for the rest of the night.
      console.warn('Session recovery failed:', err);
      recoveryInterval.current = nextRecoveryInterval(recoveryInterval.current);
    } finally {
      recoveryInFlight.current = false;
    }
  };

  // Initialize Socket.io connection
  useEffect(() => {
    const newSocket = io(BACKEND_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Never give up reconnecting: a capped attempt count means a long
      // network outage would permanently disconnect the alarm.
      reconnectionAttempts: Infinity
    });

    newSocket.on('connect', () => {
      console.log('✅ Connected to server', BACKEND_URL);
      setConnected(true);
      setError(null);
      // Re-join the session after a reconnection, otherwise the server
      // no longer routes our updates and never checks the alarm.
      if (sessionRef.current) {
        emitJoin(newSocket, sessionRef.current);
        // Every reconnect resyncs, not just the ones that lost the session.
        // Anything changed during the outage exists only on this phone
        // until it says so, and socket.io's own buffered emits are no help:
        // they flush before join-session has run, so the server drops them
        // for a socket that is not yet in any session.
        if (sessionRef.current.role === 'main') {
          pushLocalState(newSocket);
        }
      } else if (joinParamRef.current) {
        // Arrived via a scanned QR link (?join=<ID>): join as remote
        // directly. The 'Session not found' error path returns to the
        // picker if the code is stale.
        const joinId = joinParamRef.current.toUpperCase();
        joinParamRef.current = null;
        // Consume it from the address bar too, not just from the ref.
        // Otherwise the link is only one-shot within this page load: on the
        // next reload the same stale code is auto-joined again, failing with
        // "Session not found" every time, and the pre-filled join box offers
        // the dead code back to the user.
        try {
          const cleaned = urlWithoutJoinParam(window.location.href);
          if (cleaned) window.history.replaceState({}, '', cleaned);
        } catch (err) {
          // History unavailable — the join below still works, the link just
          // stays in the bar.
        }
        sessionRef.current = { sessionId: joinId, role: 'remote' };
        setSessionId(joinId);
        emitJoin(newSocket, sessionRef.current);
        setView('remote');
      }
    });

    newSocket.on('disconnect', () => {
      console.log('⚠️ Disconnected from server');
      setConnected(false);
    });

    // A connection that never establishes in the first place: a browser
    // blocked by CORS, a wrong backend URL, or a backend that is down.
    // This used to be handled nowhere, so a remote watcher opening the
    // hosted site sat on the session picker forever with no explanation
    // while the same join from the APK worked — the native client sends no
    // Origin header, so it is never the one CORS rejects.
    newSocket.on('connect_error', (err) => {
      const msg = (err && err.message) || 'connection failed';
      console.error('❌ Socket connect error:', msg);
      setConnected(false);

      // The boat phone keeps alarming from its own GPS whether or not the
      // server is reachable, and the status pill already says "offline" —
      // a red banner there would be noise it cannot act on. A remote
      // monitor has nothing at all without the server, so it must say so.
      if (sessionRef.current?.role !== 'main') {
        setError(tRef.current('errUnreachable', { msg }));
      }
    });

    newSocket.on('error', (errorMsg) => {
      console.error('❌ Socket error:', errorMsg);
      const action = sessionErrorAction(sessionRef.current?.role, errorMsg);

      if (action === 'recover') {
        // The boat phone is the alarm. It must never stop GPS, leave the
        // map, or clear the anchor/zone because of a server message — the
        // server is only a relay for remote watchers. Re-mint the session
        // in the background instead, and stay silent about it: the red
        // error banner would be alarming and is not actionable.
        recoverSession();
        return;
      }

      // Tried to resume a watch that belongs to another phone. Say so in
      // those terms — "connection error" would send a tester hunting a
      // network fault that isn't there — and drop the stored watch so the
      // session screen stops offering it.
      if (action === 'disown') {
        setError(tRef.current('errNotYourSession'));
        forgetWatch();
        setResumable(null);
        sessionRef.current = null;
        stopGpsTracking();
        setView('session');
        setSessionId(null);
        return;
      }

      setError(tRef.current('errConnection', { msg: errorMsg }));

      // A remote monitor with no session genuinely has nothing to show:
      // go back to the picker instead of an empty monitor that will
      // never update.
      if (action === 'reset') {
        sessionRef.current = null;
        stopGpsTracking();
        setView('session');
        setSessionId(null);
      }
    });

    newSocket.on('state-update', (data) => {
      const isMain = sessionRef.current?.role === 'main';
      // On the boat phone, local state always wins. A server snapshot may
      // FILL IN what we don't have — rejoining a session after an app
      // restart — but must never overwrite it: session recovery joins a
      // brand-new, empty session, and that must not wipe the live zone
      // and anchor out from under an armed alarm.
      if (!isMain || !zoneRef.current || zoneRef.current.length < 3) {
        const nextZone = data.zone || [];
        setZone(nextZone);
        zoneRef.current = nextZone;
      }
      if (!isMain || !anchorRef.current) {
        const nextAnchor = data.anchor || null;
        setAnchor(nextAnchor);
        anchorRef.current = nextAnchor;
      }
      // The map on the boat phone is driven directly by the local GPS
      // watcher; don't let a server snapshot overwrite it either.
      if (!isMain) {
        // Convert each position's server-measured age into an arrival time on
        // this device's clock, right now while "now" still means the moment
        // it arrived. Everything downstream then compares like with like.
        setLocations(stampAllReceivedAt(data.locations));
        applyRemoteAlarm(data.alarmed);
      }
      // A remote joining mid-session gets the whole night at once. The boat
      // phone keeps its own locally recorded track, which is authoritative
      // and survives the server being unreachable.
      if (!isMain && Array.isArray(data.track)) {
        trackRef.current = data.track;
        setTrack(data.track);
      }
    });

    newSocket.on('track-point', (data) => {
      // Remotes append incrementally; the boat phone already recorded this
      // point locally when the fix arrived.
      if (sessionRef.current?.role === 'main') return;
      if (!data || !Array.isArray(data.point)) return;
      const next = appendPoint(trackRef.current, data.point);
      trackRef.current = next;
      setTrack(next);
    });

    newSocket.on('track-reset', () => {
      if (sessionRef.current?.role === 'main') return;
      trackRef.current = [];
      setTrack([]);
    });

    newSocket.on('zone-updated', (data) => {
      setZone(data.zone);
      zoneRef.current = data.zone;
    });

    newSocket.on('anchor-updated', (data) => {
      setAnchor(data.anchor);
    });

    newSocket.on('location-updated', (data) => {
      // The boat phone already applied this fix locally (it's our own
      // echo); only remote monitors consume it.
      if (sessionRef.current?.role === 'main') return;
      setLocations(prev => ({
        ...prev,
        [data.clientId]: stampReceivedAt(data.location, data.ageMs)
      }));
      applyRemoteAlarm(data.alarmed);
    });

    newSocket.on('alarm-status-changed', (data) => {
      console.log('🚨 Alarm status changed:', data);
      // The boat phone decides its own alarm, from its own GPS, in
      // handleGpsFix — the server's verdict is for the watchers ashore.
      // Applying it here too let a server that disagreed re-raise an alarm
      // the skipper had already silenced: session recovery mints a session
      // with acknowledged=false, so the first fix after a backend restart
      // came straight back as alarmed=true and the takeover screen and the
      // siren returned while motoring deliberately out of the anchorage.
      // pushLocalState re-pushes the acknowledgement so the watchers do not
      // see a phantom alarm either.
      if (sessionRef.current?.role === 'main') return;

      // Raising the takeover and making the noise are one decision, taken in
      // applyRemoteAlarm so that all three routes a watcher can learn about
      // an alarm behave identically.
      applyRemoteAlarm(data.alarmed);
    });

    // Half of the monitoring link; our own socket state is the other half.
    // Both feed the one gap timer above, which is where the grace period,
    // the escalation and the alarm now live — a handler that fires once
    // per event cannot express "and it is still broken twenty minutes
    // later".
    newSocket.on('boat-offline', () => {
      if (sessionRef.current?.role === 'main') return;
      setBoatOffline(true);
    });

    newSocket.on('boat-online', () => {
      if (sessionRef.current?.role === 'main') return;
      setBoatOffline(false);
    });

    newSocket.on('session-ended', () => {
      // The boat phone closed the watch deliberately. Say so, loudly and
      // modally: a remote monitor whose map merely stops updating looks
      // exactly like one whose boat is sitting quietly at anchor, and that
      // is the dangerous way to read it.
      //
      // The boat phone itself initiated this and has already torn down.
      if (sessionRef.current?.role === 'main') return;
      stopAlarm();
      // A deliberate end supersedes any pending "went quiet" warning: the
      // watcher should get one clear message, not two contradictory ones.
      // The OS-held notification has to go too — the app may well be closed
      // by the time it would have fired.
      clearOfflineWatch();
      cancelLinkAlarmNotification();
      linkAlarmSounding.current = false;
      setMonitoringStopped(false);
      setBoatOffline(false);
      setSessionEnded(true);
    });

    newSocket.on('alarm-acknowledged', (data) => {
      // The BOAT PHONE acknowledged — the server accepts this event from
      // nobody else, so it is no longer "possibly another device" as the
      // comment here used to say. Silence this device too and keep it
      // silenced until the boat is back inside the zone.
      //
      // Through setAlarmedState rather than writing the flag directly: it is
      // the one place that stops the noise on a true -> false transition, and
      // the last path in the file that went around it.
      acknowledgedRef.current = true;
      setAlarmedState(data.alarmed);
      stopAlarm();
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      stopGpsTracking();
      clearOfflineWatch();
      socketRef.current = null;
      newSocket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

// Trigger alarm with boat data.
  //
  // `override` swaps the notification's words without touching anything
  // about how the alarm sounds: the monitoring-gap alarm is every bit as
  // loud as the dragging one, but a notification reading "your boat has
  // left the anchor zone" would be a lie, and the one thing a watcher must
  // be able to do from the lock screen is tell the two apart.
  const triggerAlarmSequence = async (override) => {
    const boatLocation = Object.values(locationsRef.current)[0];
    const locationText = boatLocation
      ? `Lat: ${boatLocation.latitude.toFixed(4)}, Lng: ${boatLocation.longitude.toFixed(4)}`
      : tRef.current('unknownLocation');
    const title = override?.title || tRef.current('notifTitle');
    const body = override?.body || tRef.current('notifBody', { loc: locationText });

    // Noise first. The notification is what wakes the screen and gives
    // somewhere to tap, but it is not what has to be heard — and if
    // scheduling it fails, the alarm must still be audible.
    let audible = false;
    try {
      const status = await AlarmAudio.start();
      audible = !!(status && status.playing);
      // Nothing we can do about a muted alarm stream without overriding a
      // system volume the user chose — but the banner is how a tester who
      // reports "the alarm never went off" finds out why, and it is on
      // screen by the time they look.
      applyAudibility(status);
      console.log('Alarm audio:', JSON.stringify(status));
    } catch (err) {
      // Web, or an older APK without the plugin. Fall back to the
      // notification sound below, which is better than nothing even
      // though silent mode will suppress it.
      console.warn('Alarm audio unavailable, falling back to the notification sound:', err);
    }

    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: 1,
          title,
          body,
          // Only ask the notification to make a sound when the alarm
          // stream is not already doing it, so the two do not overlap
          // into a mess on a phone that is not silenced.
          ...(audible ? {} : { sound: 'alarm.mp3' }),
          ongoing: true,
          autoCancel: false,
          channelId: 'anchor-alarm'
        }]
      });
    } catch (err) {
      console.error('Notification failed:', err);
    }

    // Haptics on top of the plugin's own repeating waveform: harmless
    // where both run, and the only vibration on a build without the
    // plugin.
    try {
      for (let i = 0; i < 5; i++) {
        await Haptics.impact({ style: ImpactStyle.Heavy });
        await new Promise(r => setTimeout(r, 400));
      }
    } catch (err) {
      console.warn('Haptics failed:', err);
    }
  };

  // Handle session join
  const handleJoinSession = (sessionIdInput, roleInput) => {
    if (!socket) {
      setError(t('errConnecting'));
      return;
    }

    setSessionId(sessionIdInput);
    sessionRef.current = { sessionId: sessionIdInput, role: roleInput };
    // Rejoining the same session on the boat phone restores the track that
    // an app restart would otherwise have lost.
    if (roleInput === 'main') restoreTrack(sessionIdInput);

    emitJoin(socket, sessionRef.current);

    if (roleInput === 'main') {
      setView('main');
      startGpsTracking();
    } else {
      setView('remote');
    }
  };

  // Resume a watch this phone started before it was killed.
  //
  // The zone and anchor are restored from local storage BEFORE joining, so
  // the state-update the server answers with cannot overwrite them: the
  // boat phone is authoritative, and if the server has since dropped the
  // session its copy is empty anyway. That ordering is what makes a resumed
  // watch come back armed instead of merely open.
  const handleResumeWatch = () => {
    if (!resumable) return;
    const { sessionId: id, zone: savedZone, anchor: savedAnchor } = resumable;

    setZone(savedZone);
    zoneRef.current = savedZone;
    setAnchor(savedAnchor);
    anchorRef.current = savedAnchor;
    pruneOrphanTracks(id);

    handleJoinSession(id, 'main');

    // Push it straight back up. On a session the server still holds this is
    // idempotent; on one it has forgotten, the 'Session not found' path
    // mints a replacement and pushes the same state into that instead.
    pushLocalState(socketRef.current);
  };

  const handleForgetWatch = () => {
    forgetWatch();
    pruneOrphanTracks(null);
    setResumable(null);
  };

  // Handle session creation
  const handleCreateSession = async () => {
    // Prime geolocation permission (must be in user gesture)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        (err) => console.warn('GPS permission initial request failed:', err),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }

    // Request notification permission (must be in user gesture)
    try {
      const permStatus = await LocalNotifications.requestPermissions();
      if (permStatus.display !== 'granted') {
        console.warn('⚠️ Notification permission not granted. Alarms may not work.');
      }
    } catch (err) {
      console.error('Failed to request notification permission:', err);
    }

    // Create session
    try {
      const response = await fetch(`${BACKEND_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: ensureDeviceId() })
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const data = await response.json();
      // A new watch supersedes any older one, and its track blobs with it.
      saveWatch({ sessionId: data.sessionId, zone: [], anchor: null });
      setResumable(null);
      pruneOrphanTracks(data.sessionId);
      // Join + start tracking right away, but stay on the session screen:
      // it shows the share step (ID + QR) until "Open the map".
      setSessionId(data.sessionId);
      sessionRef.current = { sessionId: data.sessionId, role: 'main' };
      emitJoin(socket, sessionRef.current);
      startGpsTracking();
      setCreatedSessionId(data.sessionId);
    } catch (err) {
      setError(t('errCreateSession', { msg: err.message }));
    }
  };

  // Every GPS fix on the boat phone goes through here — whether the server
  // is reachable or not. The zone check runs LOCALLY first, so losing the
  // internet connection at anchor no longer disables the alarm; the server
  // round-trip only exists to feed remote monitors.
  const handleGpsFix = (fix) => {
    const now = Date.now();

    // Not every position a phone produces came from a satellite. A fix
    // derived from cell towers or marina wifi arrives through this same
    // callback looking identical and can be a kilometre out — against a
    // 30 m zone that is a 4 a.m. alarm about a boat that never moved. The
    // filter drops what is physically impossible and nothing else, and it
    // can never go quiet for good: see utils/gpsQuality.js.
    const verdict = acceptFix(fixFilterRef.current, fix, now);
    fixFilterRef.current = verdict.state;
    if (!verdict.accept) {
      // Deliberately NOT setGpsError: this is not a fault the user can act
      // on, and it must not paint the status pill red on one bad fix. The
      // last good position simply ages, and if the junk keeps coming the
      // pill reaches "GPS weak" and then "No GPS" on its own — which is
      // the honest description of what is happening.
      console.warn(`⚠️ Ignoring implausible GPS fix (${verdict.reason})`, fix);
      return;
    }
    if (verdict.overridden) {
      // The filter has been rejecting for longer than it is allowed to.
      // Acting on a poor fix beats a watch that has silently stopped.
      console.warn(`⚠️ Accepting a poor GPS fix (${verdict.reason}) — nothing better in 10 s`);
    }

    const { latitude, longitude, accuracy } = fix;
    const location = {
      latitude,
      longitude,
      accuracy,
      timestamp: new Date().toISOString()
    };
    recentFixesRef.current = pruneFixes(
      [...recentFixesRef.current, { ...location, receivedAt: now }],
      now
    );
    setGpsError(null);

    // Drive the map/status directly from the local fix (no server echo).
    // Carries receivedAt like a relayed one does, so the status pill applies
    // one rule everywhere — and on this phone the clock it is measured
    // against is the same clock that wrote it, which is always correct.
    setLocations({ boat: { ...location, receivedAt: now } });

    // Local alarm decision, mirroring the server's state machine: alarm
    // when outside the zone, stay silent after an acknowledgment, re-arm
    // once back inside. decideAlarm is pure and unit-tested (alarm.test.js)
    // — this is the property that keeps the alarm armed with no server.
    const next = decideAlarm({
      latitude,
      longitude,
      zone: zoneRef.current,
      alarmed: alarmedRef.current,
      acknowledged: acknowledgedRef.current
    });
    acknowledgedRef.current = next.acknowledged;
    if (next.alarmed !== alarmedRef.current) setAlarmedState(next.alarmed);
    if (next.fire) triggerAlarmSequence();

    // Record the track after the alarm check, so nothing here can delay
    // or affect the alarm decision. Timestamped with the same `now` the
    // fix was stamped with, so the track and the position can never
    // disagree about when this fix arrived.
    if (shouldRecordPoint(trackRef.current, latitude, longitude, now)) {
      const next = appendPoint(trackRef.current, [latitude, longitude, now]);
      trackRef.current = next;
      setTrack(next);
      trackDirty.current = true;
      if (now - trackSavedAt.current > 30000 || next.length % 20 === 0) {
        persistTrack();
      }
    }

    // Best-effort sync to the server for remote monitors.
    if (socketRef.current?.connected) {
      socketRef.current.emit('update-location', { location });
    }
  };

  // Start GPS tracking. On a real device this uses a foreground service
  // (persistent notification) so Android keeps delivering fixes with the
  // screen off; in a browser it falls back to a regular geolocation watch.
  const startGpsTracking = async () => {
    await stopGpsTracking();

    if (Capacitor.isNativePlatform()) {
      try {
        const id = await BackgroundGeolocation.addWatcher(
          {
            backgroundTitle: tRef.current('fgsTitle'),
            backgroundMessage: tRef.current('fgsMessage'),
            requestPermissions: true,
            stale: false,
            distanceFilter: 0
          },
          (position, err) => {
            if (err) {
              // Surfaced via the status pill ("No GPS" + detail in the
              // sheet) rather than the blocking error banner — watcher
              // errors are often transient and the banner covered the
              // top strip until manually dismissed.
              console.error('❌ GPS Error:', err);
              setGpsError(err.code === 'NOT_AUTHORIZED' ? 'permission denied' : err.message || 'watcher error');
              return;
            }
            if (position) handleGpsFix(position);
          }
        );
        gpsWatchId.current = { type: 'background', id };
        return;
      } catch (err) {
        console.warn('Background watcher unavailable, falling back:', err);
      }
    }

    try {
      // requestPermissions throws "Unimplemented" in browsers (the browser
      // shows its own prompt on first geolocation use) — don't let that
      // abort tracking.
      try {
        const permStatus = await Geolocation.requestPermissions();
        if (permStatus.location !== 'granted') {
          setError(tRef.current('errLocPermission'));
          return;
        }
      } catch (permErr) {
        console.warn('Permission pre-request unavailable, continuing:', permErr);
      }

      const watcherId = await Geolocation.watchPosition(
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        },
        (position, err) => {
          if (err) {
            // Pill-only, same reasoning as the native watcher above.
            console.error('❌ GPS Error:', err);
            setGpsError(err.message || 'watcher error');
            return;
          }
          if (position) handleGpsFix(position.coords);
        }
      );
      gpsWatchId.current = { type: 'foreground', id: watcherId };
    } catch (err) {
      console.error('Failed to start GPS tracking:', err);
      setError(`GPS error: ${err.message}`);
    }
  };

  const stopGpsTracking = async () => {
    const watch = gpsWatchId.current;
    gpsWatchId.current = null;
    if (!watch) return;
    try {
      if (watch.type === 'background') {
        await BackgroundGeolocation.removeWatcher({ id: watch.id });
      } else {
        await Geolocation.clearWatch({ id: watch.id });
      }
    } catch (err) {
      console.warn('Failed to stop GPS watcher:', err);
    }
  };

  // Handle zone update. zoneRef is set here rather than left to the effect
  // below: it is what the GPS callback evaluates the alarm against, and a
  // fix arriving between this call and the next render would otherwise be
  // judged against the zone that has just been replaced.
  const handleZoneUpdate = (newZone) => {
    setZone(newZone);
    zoneRef.current = newZone;
    rearmAlarm();
    // Arming is the moment to find out whether this phone can make a
    // noise: the boat is still safely at anchor and the skipper is still
    // looking at the screen. Finding out at 3 a.m. is finding out too late.
    if (newZone && newZone.length >= 3) checkAlarmAudible();
    if (socket && sessionId) {
      socket.emit('update-zone', { zone: newZone });
    }
  };

  // Drop anchor: capture a fresh, precise GPS fix and record it as the
  // anchor's position (distinct from the boat's live position, since
  // you typically pay out 15-35m of chain after dropping).
  const handleDropAnchor = async () => {
    try {
      let anchorData;
      // The anchor is the origin of everything the watch measures — the
      // zone is drawn around it, every distance is from it — so it is
      // worth taking the best fix available rather than the latest one.
      // The live watch is running at 1 Hz, and consecutive fixes are
      // routinely 4 m and 22 m; picking the 4 m one costs nothing and is
      // the cheapest precision in the app.
      const best = bestRecentFix(recentFixesRef.current);

      if (best) {
        anchorData = {
          latitude: best.latitude,
          longitude: best.longitude,
          accuracy: best.accuracy,
          timestamp: new Date().toISOString()
        };
      } else {
        const permStatus = await Geolocation.checkPermissions();
        if (permStatus.location !== 'granted') {
          const req = await Geolocation.requestPermissions();
          if (req.location !== 'granted') {
            setError(t('errLocPermission'));
            return;
          }
        }

        // maximumAge: 0 — without it the platform is free to answer with a
        // cached position it took minutes ago, somewhere else entirely.
        // For the one position the whole watch is measured from, waiting
        // for the real thing is always the right trade.
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000
        });

        anchorData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date().toISOString()
        };
      }

      setAnchor(anchorData);
      rearmAlarm();
      // resetTrack: a new anchoring starts a fresh track. Moving an
      // existing anchor omits the flag and keeps the history.
      if (socket && sessionId) {
        socket.emit('update-anchor', { anchor: anchorData, resetTrack: true });
      }
      // A new anchoring starts a fresh track (moving an anchor does not).
      clearTrack();
    } catch (err) {
      console.error('Failed to drop anchor:', err);
      setError(t('errDropAnchor', { msg: err.message }));
    }
  };

  // Clear anchor (e.g. weighed anchor / repositioning).
  //
  // The zone goes with it. The alarm is evaluated against the zone alone —
  // handleGpsFix never looks at the anchor — while every piece of UI calls
  // itself "Not armed" the moment the anchor is gone. Leaving the polygon
  // behind meant the two disagreed: no anchor on the map, a pill reading
  // "Not armed", a "Drop anchor" button offered, and a live alarm still
  // waiting on last night's zone to fire as the boat motors out of it.
  const handleClearAnchor = () => {
    setAnchor(null);
    handleZoneUpdate([]);
    if (socket && sessionId) {
      socket.emit('update-anchor', { anchor: null, resetTrack: true });
    }
    clearTrack();
  };

  // Move an already-dropped anchor to a corrected position. Unlike
  // dropping, this keeps the track: it is the same anchoring, just a
  // better fix on where the anchor actually lies.
  const handleAnchorUpdate = (newAnchor) => {
    setAnchor(newAnchor);
    rearmAlarm();
    if (socket && sessionId) {
      socket.emit('update-anchor', { anchor: newAnchor });
    }
  };

  // Acknowledge alarm: silence it locally right away (works offline).
  //
  // Only the boat phone tells the server. A session-wide acknowledgement
  // suppresses the alarm until the boat re-enters its zone, and the session
  // code is shared with everyone watching — so from a watcher that was a way
  // to silence a real dragging alarm on a boat they are nowhere near.
  //
  // A watcher silencing their own screen is still useful and still works: it
  // quiets this device and stays quiet for as long as this alarm lasts, while
  // the boat goes on sounding for the people aboard. applyRemoteAlarm is what
  // keeps it quiet without letting a later location update flip the takeover
  // screen back on.
  const handleAcknowledgeAlarm = () => {
    acknowledgedRef.current = true;
    setAlarmedState(false);
    stopAlarm();
    if (socket && sessionId && sessionRef.current?.role === 'main') {
      socket.emit('acknowledge-alarm');
    }
  };

  // Reset all session-related state and return to the session picker.
  const resetSessionState = () => {
    clearTrack();
    sessionRef.current = null;
    zoneRef.current = [];
    anchorRef.current = null;
    acknowledgedRef.current = false;
    recoveryAt.current = 0;
    recoveryInterval.current = RECOVERY_MIN_INTERVAL_MS;
    setRecoveryNotice(null);
    setCreatedSessionId(null);
    setView('session');
    setSessionId(null);
    setZone([]);
    setLocations({});
    setAlarmedState(false);
    setAnchor(null);
    // Leaving cancels any pending "the boat went quiet" escalation —
    // otherwise it fires on the session picker, about a boat this device is
    // no longer watching. The scheduled notification goes with it: that one
    // is held by the OS and would otherwise sound with the app closed.
    clearOfflineWatch();
    cancelLinkAlarmNotification();
    stopLinkAlarmNoise();
    monitoringStoppedAck.current = false;
    setBoatOffline(false);
    setMonitoringStopped(false);
    setLinkDownSince(null);
    // A fresh session starts with a clean GPS filter and no borrowed fixes
    // from the last anchorage.
    fixFilterRef.current = emptyFixFilter();
    recentFixesRef.current = [];
  };

  const leaveMainSession = () => {
    // Tell the server before tearing down locally, so every remote monitor
    // is told the watch is over rather than being left with a map that
    // silently stops moving. Fire-and-forget: if it does not get through,
    // the watchers fall back to the staleness warning, which is the same
    // outcome as the boat phone dying.
    try {
      socketRef.current?.emit('end-session');
    } catch (err) {
      // Socket already gone — nothing to tell anyone.
    }
    stopGpsTracking();
    stopAlarm();
    // Ending the watch on purpose is the one case there is nothing to
    // resume. A crash or an OS kill leaves the record in place, which is
    // exactly the difference this is drawing.
    forgetWatch();
    pruneOrphanTracks(null);
    setResumable(null);
    resetSessionState();
  };

  // A remote closing its own monitor never ends the watch — the boat phone
  // keeps alarming, and any other watcher keeps watching. The server
  // enforces this too; this is just the client not asking.
  const leaveRemoteSession = () => {
    resetSessionState();
  };

  // The watcher has read the "monitoring stopped" dialog. Unlike a session
  // that ended, this one is recoverable — the session still exists and the
  // boat may reconnect — so stay on the monitor with the last known
  // position and a red pill, rather than dropping back to the picker.
  const handleMonitoringStoppedAck = () => {
    monitoringStoppedAck.current = true;
    setMonitoringStopped(false);
    // Silence this gap for as long as it lasts: the watcher has read it,
    // and re-raising it every few minutes over the same unchanged outage
    // is how an alarm gets muted for good. A gap that ends and starts
    // again clears this and warns afresh.
    clearOfflineWatch();
    cancelLinkAlarmNotification();
    stopLinkAlarmNoise();
  };

  // The watcher has read the "session ended" dialog. There is nothing left
  // to show — the session is gone from the server — so go back to the
  // picker rather than leaving a frozen map on screen.
  const handleSessionEndedAck = () => {
    setSessionEnded(false);
    resetSessionState();
  };

  // Warn before leaving if there's an anchor zone or dropped anchor that
  // would be lost. Otherwise just leave immediately.
  const requestLeaveSession = (leaveFn) => {
    if (zone.length > 0 || anchor) {
      pendingLeaveRef.current = leaveFn;
      setConfirmLeaveOpen(true);
    } else {
      leaveFn();
    }
  };

  const handleConfirmLeave = () => {
    setConfirmLeaveOpen(false);
    pendingLeaveRef.current?.();
    pendingLeaveRef.current = null;
  };

  const handleCancelLeave = () => {
    setConfirmLeaveOpen(false);
    pendingLeaveRef.current = null;
  };

  return (
    <LangContext.Provider value={t}>
    <div className="app" data-theme={theme}>
      {/* Error banner */}
      {error && (
        <div className="error-banner">
          ❌ {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* The alarm stream is muted, so the alarm cannot be heard. Red and
          dismissible rather than modal: it is as serious as an error, and
          the map must stay usable while the skipper goes and fixes it. */}
      {alarmMuted && (
        <div className="error-banner">
          🔇 {t('alarmMutedWarning')}
          <button onClick={() => setAlarmMuted(false)}>×</button>
        </div>
      )}

      {/* Session recovery notice. Non-blocking and dismissible on purpose:
          the map and the alarm must stay usable while it is shown. */}
      {recoveryNotice && (
        <div className="notice-banner">
          ♻️ {t('recoveredNotice', { id: recoveryNotice })}
          <button onClick={() => setRecoveryNotice(null)}>×</button>
        </div>
      )}

      {/* Alarm takeover */}
      {alarmed && (
        <AlarmNotification
          onAcknowledge={handleAcknowledgeAlarm}
          anchor={anchor}
          boatLocation={Object.values(locations)[0] || null}
          zone={zone}
        />
      )}

      {/* The monitoring link has been broken for longer than the delay the
          watcher chose. Which half broke decides the wording — "the boat
          stopped reporting" and "this phone lost the server" call for very
          different next steps, and only one of them is about the boat.
          Suppressed while the "session ended" dialog is up: one clear
          message, not two that appear to contradict each other. */}
      {monitoringStopped && !sessionEnded && (
        <ConfirmDialog
          title={connected ? t('monitoringStoppedTitle') : t('connectionLostTitle')}
          message={connected ? t('monitoringStoppedMessage') : t('connectionLostMessage')}
          confirmLabel={t('monitoringStoppedAck')}
          danger
          onConfirm={handleMonitoringStoppedAck}
        />
      )}

      {/* The boat phone ended the watch. Single action: there is nothing to
          decide, only something the watcher has to have read. */}
      {sessionEnded && (
        <ConfirmDialog
          title={t('sessionEndedTitle')}
          message={t('sessionEndedMessage')}
          confirmLabel={t('sessionEndedAck')}
          danger
          onConfirm={handleSessionEndedAck}
        />
      )}

      {/* Leave-session confirmation overlay */}
      {confirmLeaveOpen && (
        <ConfirmDialog
          title={t('leaveTitle')}
          message={t('leaveMessage')}
          confirmLabel={t('leave')}
          cancelLabel={t('stay')}
          danger
          onConfirm={handleConfirmLeave}
          onCancel={handleCancelLeave}
        />
      )}

      {/* Debug panel (development only) */}
      {showDebug && process.env.NODE_ENV === 'development' && (
        <div style={{
          position: 'fixed',
          bottom: 10,
          right: 10,
          backgroundColor: '#222',
          color: '#0f0',
          padding: '10px',
          borderRadius: '5px',
          fontSize: '10px',
          fontFamily: 'monospace',
          zIndex: 9999
        }}>
          <div>Alarm System Status: Native (Capacitor)</div>
          <button
            onClick={triggerAlarmSequence}
            style={{ marginTop: '8px', padding: '4px' }}
          >
            Test Alarm
          </button>
          <button
            onClick={() => setShowDebug(false)}
            style={{ marginLeft: '4px', padding: '4px' }}
          >
            Close
          </button>
        </div>
      )}

      {/* Debug toggle (development only) */}
      {process.env.NODE_ENV === 'development' && view === 'session' && (
        <button
          onClick={() => setShowDebug(!showDebug)}
          style={{
            position: 'fixed',
            bottom: 10,
            left: 10,
            padding: '8px',
            fontSize: '12px',
            zIndex: 9998
          }}
        >
          {showDebug ? 'Hide Debug' : 'Show Debug'}
        </button>
      )}

      {/* Session manager view */}
      {view === 'session' && (
        <SessionManager
          onCreateSession={handleCreateSession}
          onJoinSession={handleJoinSession}
          createdSessionId={createdSessionId}
          onEnterMap={() => setView('main')}
          resumable={resumable}
          onResumeWatch={handleResumeWatch}
          onForgetWatch={handleForgetWatch}
          initialJoinId={joinParamRef.current || ''}
          lang={lang}
          onToggleLang={toggleLang}
          linkAlarmDelay={linkAlarmDelay}
          onLinkAlarmDelayChange={changeLinkAlarmDelay}
        />
      )}

      {/* Main boat tracking view */}
      {view === 'main' && (
        <Map
          zone={zone}
          locations={locations}
          sessionId={sessionId}
          onZoneUpdate={handleZoneUpdate}
          role="main"
          alarmed={alarmed}
          theme={theme}
          onCycleTheme={cycleTheme}
          connected={connected}
          gpsError={gpsError}
          anchor={anchor}
          onDropAnchor={handleDropAnchor}
          onClearAnchor={handleClearAnchor}
          onAnchorUpdate={handleAnchorUpdate}
          track={track}
          onBack={() => requestLeaveSession(leaveMainSession)}
        />
      )}

      {/* Remote monitoring view */}
      {view === 'remote' && (
        <RemoteMonitor
          zone={zone}
          locations={locations}
          sessionId={sessionId}
          anchor={anchor}
          alarmed={alarmed}
          theme={theme}
          onCycleTheme={cycleTheme}
          connected={connected}
          boatOffline={boatOffline}
          track={track}
          linkAlarmDelay={linkAlarmDelay}
          onLinkAlarmDelayChange={changeLinkAlarmDelay}
          onBack={() => requestLeaveSession(leaveRemoteSession)}
        />
      )}
    </div>
    </LangContext.Provider>
  );
}
