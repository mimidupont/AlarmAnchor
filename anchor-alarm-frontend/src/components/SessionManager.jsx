import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { QRCodeSVG } from 'qrcode.react';
import QrScanner from './QrScanner';
import { useT } from '../i18n';
import { APP_VERSION } from '../version';
import { canCreateSession } from '../utils/platform';
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
  initialJoinId,
  lang,
  onToggleLang
}) {
  const t = useT();
  const [sessionIdInput, setSessionIdInput] = useState(initialJoinId || '');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  const copiedTimer = useRef(null);

  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  // The hosted site is a remote monitor only — the boat phone runs the app.
  const canCreate = canCreateSession(Capacitor.isNativePlatform(), process.env.NODE_ENV);

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
      alert(t('invalidSessionId'));
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
          <h1>{t('appTitle')}</h1>

          <div className="card share-card">
            <h2>{t('sessionCreated')}</h2>
            <button className="share-chip" onClick={handleCopy}>
              {copied ? t('copied') : createdSessionId}
            </button>
            <div className="qr-tile">
              <QRCodeSVG value={joinUrlFor(createdSessionId)} size={220} marginSize={2} />
            </div>
            <p className="card-note">{t('shareHint')}</p>
            <button className="card-btn card-btn-primary" onClick={onEnterMap}>
              {t('openMap')}
            </button>
          </div>

          <div className="footer-row">
            <button className="lang-toggle" onClick={onToggleLang}>
              {lang === 'en' ? 'Français' : 'English'}
            </button>
            <span className="version-tag">v{APP_VERSION}</span>
          </div>
        </div>
      </div>
    );
  }

  // ---- Default: two stacked cards ----
  return (
    <div className="session-manager">
      <div className="session-container">
        <h1>{t('appTitle')}</h1>

        {canCreate && (
          <div className="card">
            <h2>{t('startMonitoring')}</h2>
            <p className="card-note">{t('startMonitoringNote')}</p>
            <button className="card-btn card-btn-primary" onClick={handleCreate} disabled={loading}>
              {loading ? t('creating') : t('createSession')}
            </button>
          </div>
        )}

        <div className="card">
          <h2>{t('watchRemotely')}</h2>
          <p className="card-note">{t('watchRemotelyNote')}</p>
          <input
            type="text"
            placeholder={t('sessionIdPlaceholder')}
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
              {t('join')}
            </button>
            {canScan && (
              <button className="card-btn" onClick={() => setScanning(true)}>
                {t('scanQr')}
              </button>
            )}
          </div>
          {/* Without this the web page just looks like it is missing half
              its options. Say where a session actually comes from. */}
          {!canCreate && <p className="card-note">{t('createInAppNote')}</p>}
        </div>

        <div className="footer-row">
            <button className="lang-toggle" onClick={onToggleLang}>
              {lang === 'en' ? 'Français' : 'English'}
            </button>
            <span className="version-tag">v{APP_VERSION}</span>
          </div>
      </div>

      {scanning && <QrScanner onResult={handleScanResult} onClose={handleScanClose} />}
    </div>
  );
}
