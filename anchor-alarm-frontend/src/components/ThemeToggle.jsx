import React from 'react';
import { useT } from '../i18n';
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
  // The only user-facing string in the app that was not translated. Invisible
  // until a French tester turns on a screen reader, and then the one control
  // that speaks English.
  const t = useT();
  const label = t('themeLabel', { name: theme });

  return (
    <button
      className={`theme-toggle${theme === 'red' ? ' theme-toggle-red' : ''}`}
      onClick={onCycle}
      aria-label={label}
      title={label}
    >
      {THEME_ICONS[theme] || THEME_ICONS.night}
    </button>
  );
}
