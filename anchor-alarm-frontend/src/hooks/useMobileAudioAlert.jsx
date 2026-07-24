/**
 * useMobileAudioAlert.jsx
 * Production-ready custom React hook for boat geofence alarms
 * 
 * Handles:
 * - Web Audio API for cross-browser compatibility
 * - iOS 14+ notification permissions
 * - Android haptic feedback
 * - Service Worker integration
 * - Alarm state management
 * 
 * Usage:
 * const { triggerAlarm, status, requestPermission } = useMobileAudioAlert();
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export const useMobileAudioAlert = (config = {}) => {
  const audioContextRef = useRef(null);
  const oscillatorRef = useRef([]);
  const permissionPromiseRef = useRef(null);
  
  const [status, setStatus] = useState({
    ready: false,
    hasNotificationPermission: false,
    audioContextState: 'unknown',
    supportedFeatures: {
      webAudio: false,
      notifications: false,
      vibration: false,
      serviceWorker: false
    },
    lastAlarmTime: null,
    isPlaying: false
  });

  const defaultConfig = {
    frequency: 1000, // Hz
    volume: 0.4,
    duration: 500, // ms per beep
    repeatCount: 3,
    repeatDelay: 600, // ms between beeps
    ...config
  };

  // Initialize audio context and detect capabilities
  useEffect(() => {
    const initializeAudioContext = async () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        
        if (!AudioContextClass) {
          console.warn('Web Audio API not supported');
          setStatus(prev => ({ ...prev, ready: true, audioContextState: 'unsupported' }));
          return;
        }

        // Create new audio context (don't reuse old ones)
        const newContext = new AudioContextClass();
        audioContextRef.current = newContext;

        // Detect capabilities
        const features = {
          webAudio: true,
          notifications: 'Notification' in window,
          vibration: 'vibrate' in navigator,
          serviceWorker: 'serviceWorker' in navigator
        };

        // Check if notification permission already granted
        const notificationPermission = 
          'Notification' in window ? Notification.permission === 'granted' : false;

        setStatus(prev => ({
          ...prev,
          ready: true,
          audioContextState: newContext.state,
          supportedFeatures: features,
          hasNotificationPermission: notificationPermission
        }));

        console.log('Audio alert system initialized', { features });
      } catch (error) {
        console.error('Failed to initialize audio context:', error);
        setStatus(prev => ({ ...prev, ready: true, audioContextState: 'error' }));
      }
    };

    initializeAudioContext();

    // Cleanup on unmount
    return () => {
      // Stop any playing oscillators
      oscillatorRef.current.forEach(osc => {
        try {
          osc.stop();
        } catch (e) {
          // Already stopped
        }
      });
      oscillatorRef.current = [];
    };
  }, []);

  /**
   * Request notification permission from user
   * Must be called within a user gesture (click handler)
   */
  const requestPermission = useCallback(async () => {
    if (!status.supportedFeatures.notifications) {
      console.warn('Notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      setStatus(prev => ({ ...prev, hasNotificationPermission: true }));
      return true;
    }

    if (Notification.permission === 'denied') {
      console.warn('User denied notification permission');
      return false;
    }

    // permission === 'default' - request it
    if (!permissionPromiseRef.current) {
      permissionPromiseRef.current = Notification.requestPermission();
    }

    try {
      const permission = await permissionPromiseRef.current;
      const granted = permission === 'granted';
      
      setStatus(prev => ({ ...prev, hasNotificationPermission: granted }));
      
      if (granted) {
        console.log('Notification permission granted');
      }
      
      permissionPromiseRef.current = null;
      return granted;
    } catch (error) {
      console.error('Permission request failed:', error);
      permissionPromiseRef.current = null;
      return false;
    }
  }, [status.supportedFeatures.notifications]);

  /**
   * Play a single beep tone
   */
  const playBeep = useCallback(async (startTime = null) => {
    const ctx = audioContextRef.current;
    if (!ctx) return false;

    try {
      // Resume context if suspended (iOS requirement)
      if (ctx.state === 'suspended') {
        console.log('Resuming audio context...');
        await ctx.resume();
      }

      const now = startTime || ctx.currentTime;
      const duration = defaultConfig.duration / 1000; // Convert ms to seconds

      // Create oscillator
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      // Connect nodes
      oscillator.connect(gain);
      gain.connect(ctx.destination);

      // Configure oscillator
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(defaultConfig.frequency, now);

      // Configure gain (volume envelope)
      gain.gain.setValueAtTime(defaultConfig.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

      // Play
      oscillator.start(now);
      oscillator.stop(now + duration);

      // Track oscillator for cleanup
      oscillatorRef.current.push(oscillator);

      // Remove from tracking after it stops
      setTimeout(() => {
        oscillatorRef.current = oscillatorRef.current.filter(osc => osc !== oscillator);
      }, (defaultConfig.duration) * 1.5);

      return true;
    } catch (error) {
      console.error('Failed to play beep:', error);
      return false;
    }
  }, [defaultConfig.duration, defaultConfig.frequency, defaultConfig.volume]);

  /**
   * Trigger haptic feedback (vibration)
   */
  const playVibration = useCallback(() => {
    if (!status.supportedFeatures.vibration) return false;

    try {
      // Pattern: 100ms vibrate, 50ms pause, repeat 3x
      navigator.vibrate([100, 50, 100, 50, 100]);
      return true;
    } catch (error) {
      console.warn('Vibration failed:', error);
      return false;
    }
  }, [status.supportedFeatures.vibration]);

  /**
   * Show browser notification
   */
  const showNotification = useCallback((title, options = {}) => {
    if (!status.supportedFeatures.notifications || !status.hasNotificationPermission) {
      console.warn('Notifications not available or not permitted');
      return false;
    }

    try {
      const notification = new Notification(title, {
        icon: '🚨',
        badge: '⚠️',
        requireInteraction: true, // User must dismiss manually
        tag: 'anchor-alarm', // Replace previous alarms with same tag
        ...options
      });

      return notification;
    } catch (error) {
      console.error('Notification failed:', error);
      return false;
    }
  }, [status.supportedFeatures.notifications, status.hasNotificationPermission]);

  /**
   * Send alarm to Service Worker for background notification
   */
  const triggerBackgroundNotification = useCallback((boatData) => {
    if (!status.supportedFeatures.serviceWorker || !navigator.serviceWorker.controller) {
      console.warn('Service Worker not available');
      return false;
    }

    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'TRIGGER_ALARM',
        title: '⚠️ Boat Geofence Alarm',
        body: `${boatData.name || 'Your boat'} has left the anchor zone!`,
        boatData: {
          ...boatData,
          timestamp: new Date().toISOString()
        }
      });
      return true;
    } catch (error) {
      console.error('Failed to trigger background notification:', error);
      return false;
    }
  }, [status.supportedFeatures.serviceWorker]);

  /**
   * Main alarm trigger function
   * Orchestrates audio, vibration, and notifications
   */
  const triggerAlarm = useCallback(async (boatData = {}) => {
    if (status.isPlaying) {
      console.warn('Alarm already playing, ignoring duplicate trigger');
      return false;
    }

    setStatus(prev => ({ ...prev, isPlaying: true }));

    try {
      console.log('🚨 Alarm triggered for:', boatData);

      // 1. Play audio beeps
      let audioSuccess = false;
      if (status.supportedFeatures.webAudio) {
        for (let i = 0; i < defaultConfig.repeatCount; i++) {
          audioSuccess = await playBeep();
          
          if (i < defaultConfig.repeatCount - 1) {
            await new Promise(resolve => setTimeout(resolve, defaultConfig.repeatDelay));
          }
        }
      }

      // 2. Haptic feedback (parallel with audio)
      playVibration();

      // 3. Browser notification
      if (status.supportedFeatures.notifications) {
        showNotification('⚠️ Boat Alarm!', {
          body: `${boatData.name || 'Your boat'} has drifted from the anchor zone!`,
          data: boatData
        });
      }

      // 4. Background notification (if SW available)
      triggerBackgroundNotification(boatData);

      // Record alarm time
      setStatus(prev => ({
        ...prev,
        lastAlarmTime: new Date().toISOString(),
        isPlaying: false
      }));

      return true;
    } catch (error) {
      console.error('Alarm trigger failed:', error);
      setStatus(prev => ({ ...prev, isPlaying: false }));
      return false;
    }
  }, [
    status.isPlaying,
    status.supportedFeatures,
    defaultConfig.repeatCount,
    defaultConfig.repeatDelay,
    playBeep,
    playVibration,
    showNotification,
    triggerBackgroundNotification
  ]);

  /**
   * Stop alarm immediately
   */
  const stopAlarm = useCallback(() => {
    try {
      // Stop all oscillators
      oscillatorRef.current.forEach(osc => {
        try {
          osc.stop();
        } catch (e) {
          // Already stopped
        }
      });
      oscillatorRef.current = [];

      // Cancel vibration
      navigator.vibrate?.(0);

      setStatus(prev => ({ ...prev, isPlaying: false }));
      console.log('Alarm stopped');
      return true;
    } catch (error) {
      console.error('Failed to stop alarm:', error);
      return false;
    }
  }, []);

  /**
   * Test the alarm system (for debugging/demo)
   */
  const testAlarm = useCallback(async () => {
    console.log('Testing alarm system...');
    console.log('Current status:', status);

    const result = await triggerAlarm({
      name: 'Test Boat',
      location: 'Test Anchor Zone',
      isTest: true
    });

    if (!result) {
      console.warn('⚠️ Alarm test failed! Check console for errors.');
    }

    return result;
  }, [status, triggerAlarm]);

  /**
   * Get detailed status information
   */
  const getDetailedStatus = useCallback(() => {
    const ctx = audioContextRef.current;
    return {
      ...status,
      audioContextState: ctx?.state || 'uninitialized',
      audioContextSampleRate: ctx?.sampleRate,
      canPlayAudio: status.supportedFeatures.webAudio && 
                    ctx?.state !== 'closed',
      canShowNotifications: status.supportedFeatures.notifications && 
                           status.hasNotificationPermission,
      canVibrate: status.supportedFeatures.vibration
    };
  }, [status]);

  return {
    // State
    status,
    
    // Main methods
    triggerAlarm,
    stopAlarm,
    requestPermission,
    testAlarm,
    
    // Utilities
    getDetailedStatus,
    playBeep,
    playVibration,
    showNotification,
    triggerBackgroundNotification
  };
};

/**
 * PermissionGate Component
 * Wraps app and ensures permissions are requested
 */
export const PermissionGate = ({ children, onPermissionGranted }) => {
  const { status, requestPermission } = useMobileAudioAlert();
  const [permissionRequested, setPermissionRequested] = useState(false);

  useEffect(() => {
    if (status.ready && !permissionRequested) {
      requestPermission().then((granted) => {
        setPermissionRequested(true);
        if (granted) {
          onPermissionGranted?.();
        }
      });
    }
  }, [status.ready, permissionRequested, requestPermission, onPermissionGranted]);

  if (!status.ready) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p>Initializing alarm system...</p>
      </div>
    );
  }

  return children;
};

/**
 * AlarmStatusIndicator Component
 * Visual indicator of alarm system capabilities
 */
export const AlarmStatusIndicator = () => {
  const { status, testAlarm } = useMobileAudioAlert();

  if (!status.ready) return null;

  const { supportedFeatures, hasNotificationPermission } = status;

  return (
    <div style={{
      padding: '12px',
      backgroundColor: '#f5f5f5',
      borderRadius: '8px',
      fontSize: '12px',
      fontFamily: 'monospace'
    }}>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>Alarm System Status:</div>
      <div>Audio: {supportedFeatures.webAudio ? '✅' : '❌'}</div>
      <div>Notifications: {supportedFeatures.notifications && hasNotificationPermission ? '✅' : '❌'}</div>
      <div>Vibration: {supportedFeatures.vibration ? '✅' : '❌'}</div>
      <div>Service Worker: {supportedFeatures.serviceWorker ? '✅' : '❌'}</div>
      <button 
        onClick={testAlarm}
        style={{
          marginTop: '8px',
          padding: '4px 8px',
          cursor: 'pointer'
        }}
      >
        Test Alarm
      </button>
    </div>
  );
};

export default useMobileAudioAlert;
