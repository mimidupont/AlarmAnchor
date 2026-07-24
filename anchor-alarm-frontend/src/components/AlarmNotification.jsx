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
        <h1>ALARME MOUILLAGE !</h1>
        <p className="alarm-message">
          Votre bateau a dérivé hors de la zone de mouillage !
        </p>
        <div className="alert-details">
          <p>⚠️ Attention immédiate requise</p>
        </div>
        <button onClick={handleAcknowledge} className="acknowledge-btn">
          Acquitter l'alarme
        </button>
      </div>
    </div>
  );
}
