import React from 'react';
import { useT } from '../i18n';
import './Map.css';

/**
 * Unified zone editor sheet, used both during initial setup (before
 * arming) and when reopened via "Adjust zone".
 *
 * Circle mode drives the radius slider, which is two-way synced with the
 * draggable green handle on the map. Shape mode hands editing over to
 * leaflet-draw's vertex handles on the real polygon; the sheet only
 * carries the hint and the reset escape hatch.
 *
 * The sheet keeps a stable height between modes so switching never makes
 * it jump, and stays short enough that the vertices being dragged are
 * not hidden underneath it.
 */
export default function ZoneSheet({
  mode,
  onModeChange,
  radius,
  onRadiusChange,
  onResetToCircle,
  onConfirm,
  confirmLabel
}) {
  const t = useT();

  return (
    <div className="radius-sheet zone-sheet">
      <div className="zone-segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'circle'}
          className={`zone-segmented-btn${mode === 'circle' ? ' zone-segmented-btn-active' : ''}`}
          onClick={() => onModeChange('circle')}
        >
          {t('zoneModeCircle')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'shape'}
          className={`zone-segmented-btn${mode === 'shape' ? ' zone-segmented-btn-active' : ''}`}
          onClick={() => onModeChange('shape')}
        >
          {t('zoneModeShape')}
        </button>
      </div>

      <div className="zone-sheet-body">
        {mode === 'circle' ? (
          <>
            <div className="radius-sheet-value">
              {radius}
              <span className="radius-sheet-unit">m</span>
            </div>
            <input
              type="range"
              className="radius-slider"
              min={10}
              max={100}
              step={5}
              value={Math.min(100, Math.max(10, radius))}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              aria-label={t('zoneModeCircle')}
            />
            <div className="radius-sheet-hint">{t('radiusHint')}</div>
          </>
        ) : (
          <>
            <div className="radius-sheet-hint zone-shape-hint">{t('shapeHint')}</div>
            <button type="button" className="action-btn zone-reset-btn" onClick={onResetToCircle}>
              {t('resetToCircle')}
            </button>
          </>
        )}
      </div>

      <button type="button" className="action-btn action-primary radius-arm-btn" onClick={onConfirm}>
        {confirmLabel}
      </button>
    </div>
  );
}
