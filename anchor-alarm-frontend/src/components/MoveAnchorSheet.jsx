import React from 'react';
import { bearingToCompass } from '../utils/geo';
import { useT } from '../i18n';
import './Map.css';

/**
 * Bottom sheet for move-anchor mode. The drag itself happens on the map;
 * this shows how far the anchor has been nudged and owns the commit /
 * abort actions.
 *
 * `offset` is { distance, bearing } from the original position, or null
 * when the anchor has not been moved yet.
 */
export default function MoveAnchorSheet({ offset, onUseBoatPosition, onSave, onCancel }) {
  const t = useT();

  const moved =
    offset && offset.distance >= 0.5
      ? t('anchorMoved', {
          d: Math.round(offset.distance),
          brg: `${String(Math.round(offset.bearing) % 360).padStart(3, '0')}° ${bearingToCompass(offset.bearing)}`
        })
      : null;

  return (
    <div className="radius-sheet move-sheet">
      <div className="radius-sheet-hint">{t('moveAnchorHint')}</div>

      <div className="move-offset" aria-live="polite">
        {moved || '—'}
      </div>

      <button type="button" className="action-btn move-boat-btn" onClick={onUseBoatPosition}>
        {t('useBoatPosition')}
      </button>

      <div className="move-actions">
        <button type="button" className="action-btn" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="button" className="action-btn action-primary" onClick={onSave}>
          {t('save')}
        </button>
      </div>
    </div>
  );
}
