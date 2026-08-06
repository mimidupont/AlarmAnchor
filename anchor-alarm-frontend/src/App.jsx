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

// How long the boat phone may be silent before a watcher is told outright
// that nobody is monitoring. Matches the status pill's "no data" threshold,
// so the pill and the modal never disagree about the same silence.
//
// A boat phone reconnects constantly — doze, a headland, a marina wifi
// handover — and a modal on every blip is a modal nobody reads. Overridable
// only so this can be exercised without a 90 s wait; production builds set
// nothing and get the default.
const BOAT_OFFLINE_GRACE_MS = Number(process.env.REACT_APP_OFFLINE_GRACE_MS) || 90 * 1000;

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
  const offlineTimer = useRef(null);
  // Set once the watcher has read the modal, so a single outage does not
  // keep re-interrupting them. Cleared when the boat comes back, so a
  // genuinely new outage warns again.
  const monitoringStoppedAck = useRef(false);
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
  // Most recent GPS fix from the watcher, with arrival time. Used to drop
  // the anchor instantly from the live watch instead of requesting a
  // second concurrent fix (which is slow, and starves entirely with an
  // active watch in some environments).
  const lastFixRef = useRef(null);
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

  const clearOfflineWatch = () => {
    if (offlineTimer.current) {
      clearTimeout(offlineTimer.current);
      offlineTimer.current = null;
    }
  };

  // Every join carries the stable device ID: the server keys the session's
  // live positions by it rather than by socket.id, so a night of flapping
  // signal shows one boat marker instead of one per reconnect.
  const emitJoin = (socket, session) => {
    if (!socket || !session) return;
    socket.emit('join-session', { ...session, deviceId: ensureDeviceId() });
  };

  const setAlarmedState = (value) => {
    alarmedRef.current = value;
    setAlarmed(value);
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

  const stopAlarm = async () => {
    await LocalNotifications.cancel({ notifications: [{ id: 1 }] });
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
      const response = await fetch(`${BACKEND_URL}/api/sessions?recovery=1`, { method: 'POST' });
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

      const socket = socketRef.current;
      if (socket) {
        emitJoin(socket, sessionRef.current);
        if (zoneRef.current && zoneRef.current.length >= 3) {
          socket.emit('update-zone', { zone: zoneRef.current });
        }
        if (anchorRef.current) {
          // resetTrack: false — this is the same anchoring, and the
          // night's track has to survive the recovery.
          socket.emit('update-anchor', { anchor: anchorRef.current, resetTrack: false });
        }
        if (trackRef.current.length) {
          socket.emit('restore-track', { track: trackRef.current });
        }
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
        setLocations(data.locations);
        alarmedRef.current = data.alarmed;
        setAlarmed(data.alarmed);
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
        [data.clientId]: data.location
      }));
      alarmedRef.current = data.alarmed;
      setAlarmed(data.alarmed);
    });

    newSocket.on('alarm-status-changed', (data) => {
      console.log('🚨 Alarm status changed:', data);
      // Don't re-fire the notification/haptics if the local check on the
      // boat phone already raised this alarm.
      const alreadyAlarmed = alarmedRef.current;
      alarmedRef.current = data.alarmed;
      setAlarmed(data.alarmed);
      if (data.alarmed && !alreadyAlarmed) {
        triggerAlarmSequence();
      }
    });

    newSocket.on('boat-offline', () => {
      if (sessionRef.current?.role === 'main') return;
      setBoatOffline(true);
      clearOfflineWatch();
      // Grace period before shouting. A boat phone reconnects constantly —
      // doze, a headland, a marina wifi handover — and a modal on every
      // blip is a modal nobody reads. 90 s matches the staleness threshold
      // the status pill already uses for "no data".
      offlineTimer.current = setTimeout(() => {
        if (!monitoringStoppedAck.current) setMonitoringStopped(true);
      }, BOAT_OFFLINE_GRACE_MS);
    });

    newSocket.on('boat-online', () => {
      if (sessionRef.current?.role === 'main') return;
      // The boat is reporting again: cancel the pending warning, and take
      // the modal away if it is already up — the situation it describes is
      // no longer true.
      clearOfflineWatch();
      setBoatOffline(false);
      setMonitoringStopped(false);
      monitoringStoppedAck.current = false;
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
      clearOfflineWatch();
      setMonitoringStopped(false);
      setBoatOffline(false);
      setSessionEnded(true);
    });

    newSocket.on('alarm-acknowledged', (data) => {
      // Someone (possibly on another device) acknowledged: silence the
      // local alarm too, and keep it silenced until back inside the zone.
      acknowledgedRef.current = true;
      alarmedRef.current = data.alarmed;
      setAlarmed(data.alarmed);
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

// Trigger alarm with boat data
  const triggerAlarmSequence = async () => {
    const boatLocation = Object.values(locationsRef.current)[0];
    const locationText = boatLocation
      ? `Lat: ${boatLocation.latitude.toFixed(4)}, Lng: ${boatLocation.longitude.toFixed(4)}`
      : tRef.current('unknownLocation');

    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: 1,
          title: tRef.current('notifTitle'),
          body: tRef.current('notifBody', { loc: locationText }),
          sound: 'alarm.mp3',
          ongoing: true,
          autoCancel: false,
          channelId: 'anchor-alarm'
        }]
      });
    } catch (err) {
      console.error('Notification failed:', err);
    }

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
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const data = await response.json();
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
  const handleGpsFix = ({ latitude, longitude, accuracy }) => {
    const location = {
      latitude,
      longitude,
      accuracy,
      timestamp: new Date().toISOString()
    };
    lastFixRef.current = { ...location, receivedAt: Date.now() };
    setGpsError(null);

    // Drive the map/status directly from the local fix (no server echo).
    setLocations({ boat: location });

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
    // or affect the alarm decision.
    const now = Date.parse(location.timestamp) || Date.now();
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

  // Handle zone update
  const handleZoneUpdate = (newZone) => {
    setZone(newZone);
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
      const lastFix = lastFixRef.current;

      if (lastFix && Date.now() - lastFix.receivedAt < 10000) {
        // The live high-accuracy watch already has a fresh fix — use it
        // directly (instant, and avoids a second concurrent GPS request).
        anchorData = {
          latitude: lastFix.latitude,
          longitude: lastFix.longitude,
          accuracy: lastFix.accuracy,
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

        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000
        });

        anchorData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date().toISOString()
        };
      }

      setAnchor(anchorData);
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

  // Clear anchor (e.g. weighed anchor / repositioning)
  const handleClearAnchor = () => {
    setAnchor(null);
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
    if (socket && sessionId) {
      socket.emit('update-anchor', { anchor: newAnchor });
    }
  };

  // Acknowledge alarm: silence it locally right away (works offline) and
  // tell the server so other devices are silenced too. The local state
  // machine re-arms once the boat is back inside the zone.
  const handleAcknowledgeAlarm = () => {
    acknowledgedRef.current = true;
    setAlarmedState(false);
    stopAlarm();
    if (socket && sessionId) {
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
    // no longer watching.
    clearOfflineWatch();
    monitoringStoppedAck.current = false;
    setBoatOffline(false);
    setMonitoringStopped(false);
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

      {/* The boat phone has gone quiet for longer than the grace period.
          Suppressed while the "session ended" dialog is up: one clear
          message, not two that appear to contradict each other. */}
      {monitoringStopped && !sessionEnded && (
        <ConfirmDialog
          title={t('monitoringStoppedTitle')}
          message={t('monitoringStoppedMessage')}
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
          initialJoinId={joinParamRef.current || ''}
          lang={lang}
          onToggleLang={toggleLang}
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
          onBack={() => requestLeaveSession(leaveRemoteSession)}
        />
      )}
    </div>
    </LangContext.Provider>
  );
}
