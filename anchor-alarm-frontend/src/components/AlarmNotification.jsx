import React, { useEffect, useState } from 'react';
import './AlarmNotification.css';

export default function AlarmNotification({ onAcknowledge }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Auto-hide after 10 seconds if not acknowledged
    const timer = setTimeout(() => {
      setVisible(false);
    }, 10000);

    return () => clearTimeout(timer);
  }, []);

  const handleAcknowledge = () => {
    setVisible(false);
    onAcknowledge();
  };

  if (!visible) return null;

  return (
    <div className="alarm-notification-overlay">
      <div className="alarm-notification">
        <div className="alarm-icon">🚨</div>
        <h1>ANCHOR ALARM!</h1>
        <p className="alarm-message">
          Your boat has drifted outside the anchor zone!
        </p>
        <div className="alert-details">
          <p>⚠️ Immediate attention required</p>
        </div>
        <button onClick={handleAcknowledge} className="acknowledge-btn">
          Acknowledge Alarm
        </button>
      </div>
    </div>
  );
}
