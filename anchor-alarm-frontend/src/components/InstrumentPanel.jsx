import React from 'react';
import { bearingToCompass } from '../utils/geo';
import './Chrome.css';

/**
 * Glanceable anchor-watch readout: giant distance numeral plus
 * bearing / zone radius / GPS accuracy secondary row.
 *
 * `state` drives the numeral color: 'ok' | 'warn' | 'danger'.
 * `footer` is an optional extra line (e.g. last-update time on the
 * remote monitor).
 */
export default function InstrumentPanel({ distance, bearing, radius, accuracy, state, footer }) {
  const formattedBearing =
    bearing != null
      ? `${String(Math.round(bearing) % 360).padStart(3, '0')}° ${bearingToCompass(bearing)}`
      : '—';

  return (
    <div className={`instrument-panel instrument-${state}`}>
      <div className="instrument-label">Distance to anchor</div>
      <div className="instrument-value">
        {Math.round(distance)}
        <span className="instrument-unit">m</span>
      </div>
      <div className="instrument-readouts">
        <span>{formattedBearing}</span>
        <span>Zone {Math.round(radius)} m</span>
        <span>GPS {accuracy != null ? `${Math.round(accuracy)} m` : '—'}</span>
      </div>
      {footer}
    </div>
  );
}
