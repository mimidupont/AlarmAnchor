import React, { useEffect, useMemo, useRef, useState } from 'react';
import { distanceMeters, bearingDegrees, bearingToCompass, zoneRadiusMeters } from '../utils/geo';
import { useT } from '../i18n';
import './AlarmNotification.css';

const KNOTS_PER_MPS = 1.94384;
// Slide-to-silence: the thumb must travel ≥80% of the track.
const SLIDE_THRESHOLD = 0.8;

/**
 * Full-screen alarm takeover, danger-themed regardless of the current
 * theme. Stays up until explicitly silenced with the slide control — a
 * single accidental tap can never dismiss it. Mount time doubles as the
 * trigger time: the component only exists while `alarmed` is true.
 *
 * The notification / sound / haptics sequence lives in App.jsx and is
 * untouched by this component.
 */
export default function AlarmNotification({ onAcknowledge, anchor, boatLocation, zone }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  const triggeredAtRef = useRef(Date.now());

  // Drift estimation from the two most recent fixes.
  const prevFixRef = useRef(null);
  const [drift, setDrift] = useState(null);

  // Slide control state.
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!boatLocation) return;
    const cur = {
      lat: boatLocation.latitude,
      lng: boatLocation.longitude,
      at: Date.parse(boatLocation.timestamp)
    };
    const prev = prevFixRef.current;
    prevFixRef.current = cur;
    if (!prev || !(cur.at > prev.at)) return;

    const dt = (cur.at - prev.at) / 1000;
    if (dt <= 0 || dt > 120) return;

    const moved = distanceMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    const knots = (moved / dt) * KNOTS_PER_MPS;
    // Omit implausible or negligible values rather than showing noise.
    if (knots >= 0.1 && knots < 15) {
      setDrift({
        knots,
        dir: bearingToCompass(bearingDegrees(prev.lat, prev.lng, cur.lat, cur.lng))
      });
    }
  }, [boatLocation]);

  const distance =
    anchor && boatLocation
      ? distanceMeters(anchor.latitude, anchor.longitude, boatLocation.latitude, boatLocation.longitude)
      : null;
  const radius = useMemo(() => zoneRadiusMeters(anchor, zone), [anchor, zone]);

  const outsideForS = Math.max(0, Math.round((now - triggeredAtRef.current) / 1000));
  const triggeredTime = new Date(triggeredAtRef.current).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  // ---- Slide-to-silence pointer handling ----
  const maxTravel = () => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return 220;
    return track.clientWidth - thumb.offsetWidth - 8; // 4px inset each side
  };

  const handlePointerDown = (e) => {
    dragStartRef.current = e.clientX - dragX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (dragStartRef.current === null) return;
    const dx = Math.max(0, Math.min(maxTravel(), e.clientX - dragStartRef.current));
    setDragX(dx);
  };

  const handlePointerUp = () => {
    if (dragStartRef.current === null) return;
    dragStartRef.current = null;
    setDragging(false);
    if (dragX >= SLIDE_THRESHOLD * maxTravel()) {
      setDragX(maxTravel());
      onAcknowledge();
    } else {
      setDragX(0); // spring back
    }
  };

  // ---- Mini map: static SVG of the zone circle + boat vector ----
  const svg = useMemo(() => {
    if (!anchor || !boatLocation || !radius) return null;
    const size = 170;
    const c = size / 2;
    const zonePx = 55;
    const scale = zonePx / radius;
    const brg = (bearingDegrees(anchor.latitude, anchor.longitude, boatLocation.latitude, boatLocation.longitude) * Math.PI) / 180;
    const d = distance * scale;
    // Clamp the boat inside the tile even when far outside the zone.
    const clamped = Math.min(d, c - 14);
    const bx = c + Math.sin(brg) * clamped;
    const by = c - Math.cos(brg) * clamped;
    return { size, c, zonePx, bx, by };
  }, [anchor, boatLocation, radius, distance]);

  return (
    <div className="alarm-takeover">
      <div className="alarm-head">
        <div className="alarm-pulse" aria-hidden="true">⚠️</div>
        <h1 className="alarm-title">{t('anchorDragging')}</h1>
        <p className="alarm-sub">{t('triggeredInfo', { time: triggeredTime, s: outsideForS })}</p>
      </div>

      <div className="alarm-distance">
        {distance !== null ? Math.round(distance) : '—'}
        <span className="alarm-unit">m</span>
      </div>
      <p className="alarm-zone-note">
        {radius > 0 ? t('zoneIs', { n: Math.round(radius) }) : ''}
        {drift ? ` · ${t('drifting', { dir: drift.dir, kn: drift.knots.toFixed(1) })}` : ''}
      </p>

      {svg && (
        <svg
          className="alarm-minimap"
          viewBox={`0 0 ${svg.size} ${svg.size}`}
          width={svg.size}
          height={svg.size}
        >
          <circle
            cx={svg.c}
            cy={svg.c}
            r={svg.zonePx}
            fill="rgba(226, 75, 74, 0.08)"
            stroke="#a32d2d"
            strokeWidth="2"
            strokeDasharray="6 5"
          />
          <line x1={svg.c} y1={svg.c} x2={svg.bx} y2={svg.by} stroke="#e24b4a" strokeWidth="2" strokeDasharray="3 4" />
          <text x={svg.c} y={svg.c + 6} textAnchor="middle" fontSize="16">⚓</text>
          <circle cx={svg.bx} cy={svg.by} r="7" fill="#ff6b6b" stroke="#1a0505" strokeWidth="2" />
        </svg>
      )}

      <div className="slide-track" ref={trackRef}>
        <span className="slide-label">{t('slideToSilence')}</span>
        <div
          className="slide-thumb"
          ref={thumbRef}
          style={{
            transform: `translateX(${dragX}px)`,
            transition: dragging ? 'none' : 'transform 0.25s ease'
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          ➤
        </div>
      </div>
      <p className="alarm-caption">{t('rearmCaption')}</p>
    </div>
  );
}
