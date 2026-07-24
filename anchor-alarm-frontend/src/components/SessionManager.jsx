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
      alert('Veuillez entrer un ID de session');
      return;
    }
    onJoinSession(sessionIdInput.toUpperCase(), 'remote');
  };

  return (
    <div className="session-manager">
      <div className="session-container">
        <h1>⚓ Alarme de Mouillage</h1>

        <div className="option">
          <h2>Suivi du bateau</h2>
          <p>Commencez à suivre la position de votre bateau</p>
          <button onClick={handleCreate} disabled={loading} className="primary">
            {loading ? 'Création...' : 'Créer une nouvelle session'}
          </button>
        </div>

        <div className="divider">OU</div>

        <div className="option">
          <h2>Suivi à distance</h2>
          <p>Rejoindre une session de suivi existante</p>
          <div className="input-group">
            <input
              type="text"
              placeholder="Entrez l'ID de session"
              value={sessionIdInput}
              onChange={(e) => setSessionIdInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
              maxLength={9}
              className="session-input"
            />
            <button onClick={handleJoin} className="secondary">
              Rejoindre
            </button>
          </div>
        </div>

        <div className="info">
          <h3>Comment ça marche :</h3>
          <ul>
            <li>🚤 Créez une nouvelle session depuis le téléphone à bord du bateau</li>
            <li>📍 Dessinez une zone de mouillage sur la carte</li>
            <li>📱 Partagez l'ID de session avec d'autres personnes</li>
            <li>👁️ Les appareils distants peuvent suivre la position du bateau en temps réel</li>
            <li>🚨 Tout le monde est alerté si le bateau dérive hors de la zone</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
