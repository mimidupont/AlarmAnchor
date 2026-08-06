import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import './SessionManager.css';

/**
 * Minimal QR scanner: getUserMedia + the native BarcodeDetector API.
 * Only ever rendered when `window.BarcodeDetector` exists (the caller
 * hides the Scan button otherwise) — no scanner library involved.
 *
 * Every failure is shown rather than swallowed. This used to call
 * onClose() in the catch, so a rejected camera made the scanner open and
 * vanish in the same frame — which reads as "the scanner is broken" and
 * gives the tester nothing to report. The commonest cause was the app
 * lacking the CAMERA permission entirely, which is invisible from here.
 */
export default function QrScanner({ onResult, onClose }) {
  const t = useT();
  const videoRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stream = null;
    let timer = null;
    let cancelled = false;

    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (err) {
      setError('unsupported');
      return undefined;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('unsupported');
      return undefined;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (!videoRef.current) return;
        videoRef.current.srcObject = s;
        videoRef.current.play().catch(() => {});
        timer = setInterval(async () => {
          if (!videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) onResult(codes[0].rawValue);
          } catch (err) {
            // detect() throws while the video has no frames yet — ignore.
          }
        }, 400);
      })
      .catch((err) => {
        console.warn('Camera unavailable:', err && err.name, err && err.message);
        // NotAllowedError covers both a user refusal and a missing
        // manifest permission; the webview reports them identically, so
        // the message has to cover both.
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          setError('denied');
        } else if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
          setError('nocamera');
        } else {
          setError('generic');
        }
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [onResult, onClose]);

  const message =
    error === 'denied'
      ? t('scanErrorDenied')
      : error === 'nocamera'
        ? t('scanErrorNoCamera')
        : error === 'unsupported'
          ? t('scanErrorUnsupported')
          : error
            ? t('scanErrorGeneric')
            : null;

  return (
    <div className="qr-scanner-overlay" onClick={onClose}>
      <div className="qr-scanner" onClick={(e) => e.stopPropagation()}>
        {!error && <video ref={videoRef} className="qr-video" muted playsInline />}
        <p className="qr-hint">{message || t('scanHint')}</p>
        {error && <p className="qr-hint">{t('scanErrorFallback')}</p>}
        <button className="card-btn" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
