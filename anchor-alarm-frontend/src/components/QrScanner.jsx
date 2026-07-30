import React, { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import './SessionManager.css';

/**
 * Minimal QR scanner: getUserMedia + the native BarcodeDetector API.
 * Only ever rendered when `window.BarcodeDetector` exists (the caller
 * hides the Scan button otherwise) — no scanner library involved.
 */
export default function QrScanner({ onResult, onClose }) {
  const t = useT();
  const videoRef = useRef(null);

  useEffect(() => {
    let stream = null;
    let timer = null;
    let cancelled = false;

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
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
        console.warn('Camera unavailable:', err);
        onClose();
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onResult, onClose]);

  return (
    <div className="qr-scanner-overlay" onClick={onClose}>
      <div className="qr-scanner" onClick={(e) => e.stopPropagation()}>
        <video ref={videoRef} className="qr-video" muted playsInline />
        <p className="qr-hint">{t('scanHint')}</p>
        <button className="card-btn" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
