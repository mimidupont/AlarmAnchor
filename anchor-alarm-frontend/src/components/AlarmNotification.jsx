import React from 'react';
import './AlarmNotification.css';

// The overlay stays on screen until the alarm is explicitly acknowledged.
// (It used to auto-hide after 10s, but since the component stays mounted
// while `alarmed` is true, later alarms would then show no overlay at all
// — and an anchor alarm should never dismiss itself anyway.)
export default function AlarmNotification({ onAcknowledge }) {
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
        <button onClick={onAcknowledge} className="acknowledge-btn">
          Acquitter l'alarme
        </button>
      </div>
    </div>
  );
}
