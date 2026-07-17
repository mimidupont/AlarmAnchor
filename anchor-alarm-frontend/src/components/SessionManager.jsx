import React, { useState } from 'react';
import './SessionManager.css';

export default function SessionManager({ onCreateSession, onJoinSession }) {
  const [sessionIdInput, setSessionIdInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = () => {
    setLoading(true);
    onCreateSession();
    setLoading(false);
  };

  const handleJoin = () => {
    if (!sessionIdInput.trim()) {
      alert('Please enter a session ID');
      return;
    }
    onJoinSession(sessionIdInput.toUpperCase(), 'remote');
  };

  return (
    <div className="session-manager">
      <div className="session-container">
        <h1>⚓ Anchor Alarm</h1>

        <div className="option">
          <h2>Boat Monitor</h2>
          <p>Start monitoring your boat's position</p>
          <button onClick={handleCreate} disabled={loading} className="primary">
            {loading ? 'Creating...' : 'Create New Session'}
          </button>
        </div>

        <div className="divider">OR</div>

        <div className="option">
          <h2>Remote Monitor</h2>
          <p>Join an existing boat monitoring session</p>
          <div className="input-group">
            <input
              type="text"
              placeholder="Enter Session ID"
              value={sessionIdInput}
              onChange={(e) => setSessionIdInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
              maxLength={9}
              className="session-input"
            />
            <button onClick={handleJoin} className="secondary">
              Join Session
            </button>
          </div>
        </div>

        <div className="info">
          <h3>How it works:</h3>
          <ul>
            <li>🚤 Create a new session on your boat's phone</li>
            <li>📍 Draw an anchor zone on the map</li>
            <li>📱 Share the Session ID with others</li>
            <li>👁️ Remote devices can monitor the boat's position in real-time</li>
            <li>🚨 Everyone gets alerted if the boat drifts outside the zone</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
