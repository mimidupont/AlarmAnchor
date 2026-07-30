import React from 'react';
import './Chrome.css';

// Text-presentation glyphs (not emoji) so the icon inherits theme color —
// red mode must not show yellow/blue emoji pixels.
const THEME_ICONS = {
  day: '☀︎',
  night: '☾',
  red: '⬤'
};

/** Floating button over the map cycling day → night → red. */
export default function ThemeToggle({ theme, onCycle }) {
  return (
    <button
      className={`theme-toggle${theme === 'red' ? ' theme-toggle-red' : ''}`}
      onClick={onCycle}
      aria-label={`Theme: ${theme}`}
      title={`Theme: ${theme}`}
    >
      {THEME_ICONS[theme] || THEME_ICONS.night}
    </button>
  );
}
