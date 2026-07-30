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

import React, { useState, useEffect, useRef } from 'react';
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
import { isPointInPolygon } from './utils/geo';
import './App.css';

// Foreground-service GPS watcher (@capacitor-community/background-geolocation).
// Unlike @capacitor/geolocation, it keeps a fix coming when the screen is off
// or the app is backgrounded — essential for an overnight anchor watch.
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

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
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
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

  useEffect(() => {
    locationsRef.current = locations;
  }, [locations]);

  useEffect(() => {
    zoneRef.current = zone;
  }, [zone]);

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

  // Auto-switch to night when the alarm arms (anchor set + zone
  // confirmed). Only on the false→true transition, so the user can still
  // cycle to any theme afterwards without being fought.
  const armed = Boolean(anchor) && zone.length >= 3;
  const wasArmedRef = useRef(false);
  useEffect(() => {
    if (armed && !wasArmedRef.current) applyTheme('night');
    wasArmedRef.current = armed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

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
      console.log('✅ Connected to server');
      setError(null);
      // Re-join the session after a reconnection, otherwise the server
      // no longer routes our updates and never checks the alarm.
      if (sessionRef.current) {
        newSocket.emit('join-session', sessionRef.current);
      }
    });

    newSocket.on('disconnect', () => {
      console.log('⚠️ Disconnected from server');
    });

    newSocket.on('error', (errorMsg) => {
      console.error('❌ Socket error:', errorMsg);
      setError(`Connection error: ${errorMsg}`);
      // Joining a non-existent/expired session: go back to the picker
      // instead of showing an empty monitor that will never update.
      if (errorMsg === 'Session not found') {
        sessionRef.current = null;
        stopGpsTracking();
        setView('session');
        setSessionId(null);
      }
    });

    newSocket.on('state-update', (data) => {
      setZone(data.zone);
      zoneRef.current = data.zone;
      // On the boat phone the map is driven directly by the local GPS
      // watcher; don't let a server snapshot overwrite it.
      if (sessionRef.current?.role !== 'main') {
        setLocations(data.locations);
        alarmedRef.current = data.alarmed;
        setAlarmed(data.alarmed);
      }
      setAnchor(data.anchor || null);
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
      : 'Unknown location';

    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: 1,
          title: '🚨 ANCHOR ALARM',
          body: `Your boat has left the anchor zone! ${locationText}`,
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
      setError('Connecting to server, please wait...');
      return;
    }

    setSessionId(sessionIdInput);
    sessionRef.current = { sessionId: sessionIdInput, role: roleInput };

    socket.emit('join-session', {
      sessionId: sessionIdInput,
      role: roleInput
    });

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
      handleJoinSession(data.sessionId, 'main');
    } catch (err) {
      setError(`Failed to create session: ${err.message}`);
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

    // Drive the map/status directly from the local fix (no server echo).
    setLocations({ boat: location });

    // Local alarm decision, mirroring the server's state machine: alarm
    // when outside the zone, stay silent after an acknowledgment, re-arm
    // once back inside.
    const currentZone = zoneRef.current;
    if (currentZone && currentZone.length >= 3) {
      const outside = !isPointInPolygon([latitude, longitude], currentZone);
      if (!outside) {
        acknowledgedRef.current = false;
        if (alarmedRef.current) setAlarmedState(false);
      } else if (!acknowledgedRef.current && !alarmedRef.current) {
        setAlarmedState(true);
        triggerAlarmSequence();
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
            backgroundTitle: 'Alarme de mouillage active',
            backgroundMessage: 'Surveillance de la position du bateau',
            requestPermissions: true,
            stale: false,
            distanceFilter: 0
          },
          (position, err) => {
            if (err) {
              console.error('❌ GPS Error:', err);
              if (err.code === 'NOT_AUTHORIZED') {
                setError('Permission de localisation refusée — ouvrez les réglages Android pour l\'autoriser');
              } else {
                setError(`GPS error: ${err.message}`);
              }
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
          setError('Location permission was not granted');
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
            console.error('❌ GPS Error:', err);
            setError(`GPS error: ${err.message}`);
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
            setError("Permission de localisation refusée, impossible de poser l'ancre");
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
      if (socket && sessionId) {
        socket.emit('update-anchor', { anchor: anchorData });
      }
    } catch (err) {
      console.error('Failed to drop anchor:', err);
      setError(`Impossible de définir la position de l'ancre : ${err.message}`);
    }
  };

  // Clear anchor (e.g. weighed anchor / repositioning)
  const handleClearAnchor = () => {
    setAnchor(null);
    if (socket && sessionId) {
      socket.emit('update-anchor', { anchor: null });
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
    sessionRef.current = null;
    zoneRef.current = [];
    acknowledgedRef.current = false;
    setView('session');
    setSessionId(null);
    setZone([]);
    setLocations({});
    setAlarmedState(false);
    setAnchor(null);
  };

  const leaveMainSession = () => {
    stopGpsTracking();
    stopAlarm();
    resetSessionState();
  };

  const leaveRemoteSession = () => {
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
    <div className="app" data-theme={theme}>
      {/* Error banner */}
      {error && (
        <div className="error-banner">
          ❌ {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Alarm notification overlay */}
      {alarmed && (
        <AlarmNotification onAcknowledge={handleAcknowledgeAlarm} />
      )}

      {/* Leave-session confirmation overlay */}
      {confirmLeaveOpen && (
        <ConfirmDialog
          title="Quitter la session ?"
          message="Si vous quittez maintenant, la position de l'ancre et la zone de mouillage seront perdues."
          confirmLabel="Quitter"
          cancelLabel="Rester"
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
          anchor={anchor}
          onDropAnchor={handleDropAnchor}
          onClearAnchor={handleClearAnchor}
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
          onBack={() => requestLeaveSession(leaveRemoteSession)}
        />
      )}
    </div>
  );
}
