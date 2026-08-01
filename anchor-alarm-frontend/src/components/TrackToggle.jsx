import React from 'react';
import { useT } from '../i18n';
import './Chrome.css';

export const TRACK_MODES = ['all', 'hour', 'off'];

// Text-presentation glyphs, not emoji, so the icon inherits theme color —
// red night-vision mode must not show colored pixels.
const ICONS = { all: '⟿', hour: '⌒', off: '⌀' };

/** Floating button over the map cycling All → 1 h → Off. */
export default function TrackToggle({ mode, onCycle }) {
  const t = useT();
  const label = { all: t('trackAll'), hour: t('trackLastHour'), off: t('trackOff') }[mode];

  return (
    <button
      className={`theme-toggle track-toggle${mode === 'off' ? ' track-toggle-off' : ''}`}
      onClick={onCycle}
      aria-label={label}
      title={label}
    >
      {ICONS[mode] || ICONS.all}
    </button>
  );
}
