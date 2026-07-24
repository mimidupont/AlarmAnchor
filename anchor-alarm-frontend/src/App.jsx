/**
 * App.jsx - UPDATED WITH MOBILE AUDIO ALERTS
 * 
 * Changes from original:
 * 1. Replaced HTML5 audio element with useMobileAudioAlert hook
 * 2. Improved permission management
 * 3. Added Service Worker registration
 * 4. Better error handling for mobile audio
 */

import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Map from './components/Map';
import SessionManager from './components/SessionManager';
import RemoteMonitor from './components/RemoteMonitor';
import AlarmNotification from './components/AlarmNotification';
import useMobileAudioAlert, { AlarmStatusIndicator } from './hooks/useMobileAudioAlert';
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
  const [showDebug, setShowDebug] = useState(false);
  const gpsWatchId = useRef(null);
  
  // Initialize mobile audio alert system
  const {
    triggerAlarm: playAlarm,
    stopAlarm,
    requestPermission,
    status: alarmStatus,
    testAlarm
  } = useMobileAudioAlert({
    frequency: 1000,
    volume: 0.4,
    repeatCount: 3,
    repeatDelay: 600
  });

  // Register Service Worker on mount
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
          console.log('✅ Service Worker registered:', registration);
        })
        .catch(err => {
          console.warn('⚠️ Service Worker registration failed:', err);
        });
    }
  }, []);

  // Initialize Socket.io connection
  useEffect(() => {
    const newSocket = io(BACKEND_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('✅ Connected to server');
      setError(null);
    });

    newSocket.on('disconnect', () => {
      console.log('⚠️ Disconnected from server');
    });

    newSocket.on('error', (errorMsg) => {
      console.error('❌ Socket error:', errorMsg);
      setError(`Connection error: ${errorMsg}`);
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
      console.log('🚨 Alarm triggered:', data);
      setAlarmed(data.alarmed);
      if (data.alarmed) {
        triggerAlarmSequence();
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

  // Trigger alarm with boat data
  const triggerAlarmSequence = async () => {
    const boatLocation = Object.values(locations)[0];
    
    const boatData = {
      name: 'Your Boat',
      location: boatLocation 
        ? `Lat: ${boatLocation.latitude.toFixed(4)}, Lng: ${boatLocation.longitude.toFixed(4)}`
        : 'Unknown Location',
      coordinates: boatLocation,
      timestamp: new Date().toISOString()
    };

    const success = await playAlarm(boatData);
    
    if (!success) {
      console.warn('⚠️ Audio alert failed, trying fallback');
      // Show more visible notification as fallback
      if (Notification.permission === 'granted') {
        new Notification('🚨 BOAT ALARM', {
          body: 'Your boat has left the anchor zone! Tap to open app.',
          requireInteraction: true,
          tag: 'anchor-alarm'
        });
      }
    }
  };

  // Handle session join
  const handleJoinSession = (sessionIdInput, roleInput) => {
    if (!socket) {
      setError('Connecting to server, please wait...');
      return;
    }

    setSessionId(sessionIdInput);

    socket.emit('join-session', {
      sessionId: sessionIdInput,
      role: roleInput
    });

    if (roleInput === 'main') {
      setView('main');
      startGpsTracking(sessionIdInput);
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
      const hasPermission = await requestPermission();
      if (!hasPermission) {
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
      const data = await response.json();
      handleJoinSession(data.sessionId, 'main');
    } catch (err) {
      setError(`Failed to create session: ${err.message}`);
    }
  };

  // Start GPS tracking
  const startGpsTracking = (currentSessionId) => {
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

        if (socket && currentSessionId) {
          socket.emit('update-location', { location });
        }
      },
      (error) => {
        console.error('❌ GPS Error:', error);
        setError(`GPS error: ${error.message}`);
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

  // Acknowledge alarm
  const handleAcknowledgeAlarm = () => {
    stopAlarm();
    if (socket && sessionId) {
      socket.emit('acknowledge-alarm');
    }
  };

  return (
    <div className="app">
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
          zIndex: 9999,
          maxWidth: '300px',
          maxHeight: '200px',
          overflow: 'auto'
        }}>
          <div>Alarm System Status:</div>
          <AlarmStatusIndicator />
          <button 
            onClick={testAlarm}
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
          onBack={() => {
            if (gpsWatchId.current) {
              navigator.geolocation.clearWatch(gpsWatchId.current);
            }
            stopAlarm();
            setView('session');
            setSessionId(null);
            setZone([]);
            setLocations({});
            setAlarmed(false);
          }}
        />
      )}

      {/* Remote monitoring view */}
      {view === 'remote' && (
        <RemoteMonitor
          zone={zone}
          locations={locations}
          sessionId={sessionId}
          onBack={() => {
            setView('session');
            setSessionId(null);
            setZone([]);
            setLocations({});
            setAlarmed(false);
          }}
        />
      )}
    </div>
  );
}
