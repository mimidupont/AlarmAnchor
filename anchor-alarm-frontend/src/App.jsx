import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Map from './components/Map';
import SessionManager from './components/SessionManager';
import RemoteMonitor from './components/RemoteMonitor';
import AlarmNotification from './components/AlarmNotification';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

export default function App() {
  const [view, setView] = useState('session'); // 'session', 'main', 'remote'
  const [sessionId, setSessionId] = useState(null);
  const [socket, setSocket] = useState(null);
  const [zone, setZone] = useState([]);
  const [locations, setLocations] = useState({});
  const [alarmed, setAlarmed] = useState(false);
  const [error, setError] = useState(null);
  const gpsWatchId = useRef(null);
  const alarmAudioRef = useRef(null);
  const alarmTimeout = useRef(null);

  // Initialize Socket.io connection
  useEffect(() => {
    const newSocket = io(BACKEND_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('Connected to backend');
      setError(null);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from backend');
    });

    newSocket.on('error', (errorMsg) => {
      console.error('Socket error:', errorMsg);
      setError(errorMsg);
    });

    newSocket.on('state-update', (data) => {
      setZone(data.zone);
      setLocations(data.locations);
      setAlarmed(data.alarmed);
    });

    newSocket.on('zone-updated', (data) => {
      setZone(data.zone);
    });

    newSocket.on('location-updated', (data) => {
      setLocations(prev => ({
        ...prev,
        [data.clientId]: data.location
      }));
      setAlarmed(data.alarmed);
    });

    newSocket.on('alarm-status-changed', (data) => {
      setAlarmed(data.alarmed);
      if (data.alarmed) {
        triggerAlarm();
      }
    });

    newSocket.on('alarm-acknowledged', (data) => {
      setAlarmed(data.alarmed);
      stopAlarm();
    });

    setSocket(newSocket);

    return () => {
      if (gpsWatchId.current) {
        navigator.geolocation.clearWatch(gpsWatchId.current);
      }
      newSocket.close();
    };
  }, []);

  // Handle session join
  const handleJoinSession = (sessionIdInput, roleInput) => {
    if (!socket) {
      setError('Socket not connected yet, please wait...');
      return;
    }

    setSessionId(sessionIdInput);

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
    try {
      const response = await fetch(`${BACKEND_URL}/api/sessions`, {
        method: 'POST'
      });
      const data = await response.json();
      handleJoinSession(data.sessionId, 'main');
    } catch (err) {
      setError('Failed to create session: ' + err.message);
    }
  };

  // Start GPS tracking
  const startGpsTracking = () => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported on this device');
      return;
    }

    gpsWatchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const location = {
          latitude,
          longitude,
          accuracy,
          timestamp: new Date().toISOString()
        };

        if (socket && sessionId) {
          socket.emit('update-location', { location });
        }
      },
      (error) => {
        console.error('GPS error:', error);
        setError('GPS Error: ' + error.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  // Handle zone update
  const handleZoneUpdate = (newZone) => {
    setZone(newZone);
    if (socket && sessionId) {
      socket.emit('update-zone', { zone: newZone });
    }
  };

  // Trigger alarm
  const triggerAlarm = () => {
    // Play sound
    if (alarmAudioRef.current) {
      alarmAudioRef.current.play().catch(err => console.warn('Could not play audio:', err));
    }

    // Browser notification
    if (Notification.permission === 'granted') {
      new Notification('⚠️ ANCHOR ALARM', {
        body: 'Boat has drifted outside anchor zone!',
        icon: '🚨',
        tag: 'anchor-alarm',
        requireInteraction: true
      });
    }

    // Vibration
    if (navigator.vibrate) {
      navigator.vibrate([500, 200, 500, 200, 500]);
    }
  };

  // Stop alarm
  const stopAlarm = () => {
    if (alarmAudioRef.current) {
      alarmAudioRef.current.pause();
      alarmAudioRef.current.currentTime = 0;
    }

    if (alarmTimeout.current) {
      clearTimeout(alarmTimeout.current);
    }
  };

  // Acknowledge alarm
  const handleAcknowledgeAlarm = () => {
    stopAlarm();
    if (socket && sessionId) {
      socket.emit('acknowledge-alarm');
    }
  };

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <div className="app">
      {/* Hidden audio element for alarm sound */}
      <audio
        ref={alarmAudioRef}
        src="data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA=="
        loop
      />

      {error && (
        <div className="error-banner">
          ❌ {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {alarmed && (
        <AlarmNotification onAcknowledge={handleAcknowledgeAlarm} />
      )}

      {view === 'session' && (
        <SessionManager
          onCreateSession={handleCreateSession}
          onJoinSession={handleJoinSession}
        />
      )}

      {view === 'main' && (
        <Map
          zone={zone}
          locations={locations}
          sessionId={sessionId}
          onZoneUpdate={handleZoneUpdate}
          role="main"
          onBack={() => {
            if (gpsWatchId.current) {
              navigator.geolocation.clearWatch(gpsWatchId.current);
            }
            setView('session');
            setSessionId(null);
            setRole(null);
            setZone([]);
            setLocations({});
          }}
        />
      )}

      {view === 'remote' && (
        <RemoteMonitor
          zone={zone}
          locations={locations}
          sessionId={sessionId}
          onBack={() => {
            setView('session');
            setSessionId(null);
            setRole(null);
            setZone([]);
            setLocations({});
          }}
        />
      )}
    </div>
  );
}
