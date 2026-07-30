import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import QrScanner from './QrScanner';
import { APP_VERSION } from '../version';
import './SessionManager.css';

// The QR encodes a join URL so a stock camera app can open the hosted
// frontend directly; the in-app scanner and the App's ?join= parser
// accept both the URL form and a raw session ID.
const joinUrlFor = (sessionId) =>
  `${process.env.REACT_APP_FRONTEND_URL || window.location.origin}/?join=${sessionId}`;

export const parseJoinCode = (raw) => {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const fromUrl = url.searchParams.get('join');
    if (fromUrl) return fromUrl.toUpperCase();
  } catch (err) {
    // Not a URL — treat as a raw code below.
  }
  const code = String(raw).trim().toUpperCase();
  return /^[A-Z0-9]{6,12}$/.test(code) ? code : null;
};

export default function SessionManager({
  onCreateSession,
  onJoinSession,
  createdSessionId,
  onEnterMap,
  initialJoinId
}) {
  const [sessionIdInput, setSessionIdInput] = useState(initialJoinId || '');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  const copiedTimer = useRef(null);

  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const handleCreate = async () => {
    setLoading(true);
    try {
      await onCreateSession();
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = (id) => {
    const code = parseJoinCode(id ?? sessionIdInput);
    if (!code) {
      alert('Please enter a valid session ID');
      return;
    }
    onJoinSession(code, 'remote');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(createdSessionId);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };

  const handleScanResult = useCallback((raw) => {
    const code = parseJoinCode(raw);
    if (code) {
      setScanning(false);
      setSessionIdInput(code);
      onJoinSession(code, 'remote');
    }
  }, [onJoinSession]);

  const handleScanClose = useCallback(() => setScanning(false), []);

  // ---- Share step: session just created on the boat phone ----
  if (createdSessionId) {
    return (
      <div className="session-manager">
        <div className="session-container">
          <h1>⚓ Anchor Alarm</h1>

          <div className="card share-card">
            <h2>Session created</h2>
            <button className="share-chip" onClick={handleCopy}>
              {copied ? 'Copied' : createdSessionId}
            </button>
            <div className="qr-tile">
              <QRCodeSVG value={joinUrlFor(createdSessionId)} size={220} marginSize={2} />
            </div>
            <p className="card-note">
              Scan from another phone to watch remotely — or share the ID.
            </p>
            <button className="card-btn card-btn-primary" onClick={onEnterMap}>
              Open the map
            </button>
          </div>

          <div className="version-tag">v{APP_VERSION}</div>
        </div>
      </div>
    );
  }

  // ---- Default: two stacked cards ----
  return (
    <div className="session-manager">
      <div className="session-container">
        <h1>⚓ Anchor Alarm</h1>

        <div className="card">
          <h2>⚓ Start monitoring</h2>
          <p className="card-note">This phone stays on the boat</p>
          <button className="card-btn card-btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating…' : 'Create a session'}
          </button>
        </div>

        <div className="card">
          <h2>👀 Watch remotely</h2>
          <p className="card-note">Join a session running on the boat</p>
          <input
            type="text"
            placeholder="Session ID"
            value={sessionIdInput}
            onChange={(e) => setSessionIdInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            maxLength={9}
            className="session-input"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="join-row">
            <button className="card-btn" onClick={() => handleJoin()}>
              Join
            </button>
            {canScan && (
              <button className="card-btn" onClick={() => setScanning(true)}>
                Scan QR
              </button>
            )}
          </div>
        </div>

        <div className="version-tag">v{APP_VERSION}</div>
      </div>

      {scanning && <QrScanner onResult={handleScanResult} onClose={handleScanClose} />}
    </div>
  );
}
