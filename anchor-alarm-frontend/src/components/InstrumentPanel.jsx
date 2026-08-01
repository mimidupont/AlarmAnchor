import React from 'react';
import { bearingToCompass } from '../utils/geo';
import { useT } from '../i18n';
import './Chrome.css';

// U+2212 MINUS SIGN, not a hyphen: it lines up with the digits at
// tabular-nums widths and reads as a sign rather than a dash.
const MINUS = '−';

export const formatMargin = (margin) =>
  margin == null
    ? '—'
    : `${margin < 0 ? MINUS : ''}${Math.abs(Math.round(margin))} m`;

/**
 * Glanceable anchor-watch readout: giant distance-to-anchor numeral plus a
 * bearing / zone radius / margin row.
 *
 * `margin` is the signed distance to the zone boundary — positive is room
 * left, negative is meters past it. That is the number that decides whether
 * to worry, so it also drives `state` ('ok' | 'warn' | 'danger') in the
 * callers. GPS accuracy is deliberately not here: StatusPill owns health.
 *
 * `footer` is an optional extra line (e.g. last-update time on the remote
 * monitor).
 */
export default function InstrumentPanel({ distance, bearing, radius, margin, state, footer }) {
  const t = useT();
  const formattedBearing =
    bearing != null
      ? `${String(Math.round(bearing) % 360).padStart(3, '0')}° ${bearingToCompass(bearing)}`
      : '—';

  return (
    <div className={`instrument-panel instrument-${state}`}>
      <div className="instrument-label">{t('distanceToAnchor')}</div>
      <div className="instrument-value">
        {Math.round(distance)}
        <span className="instrument-unit">m</span>
      </div>
      <div className="instrument-readouts">
        <span>{formattedBearing}</span>
        <span>{t('zoneLabel')} {Math.round(radius)} m</span>
        <span>{t('zoneEdge')} {formatMargin(margin)}</span>
      </div>
      {footer}
    </div>
  );
}
