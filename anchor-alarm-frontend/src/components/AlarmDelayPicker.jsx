import React from 'react';
import { useT } from '../i18n';
import { LINK_ALARM_DELAYS } from '../utils/linkAlarm';
import './Chrome.css';

/**
 * How long a connection may stay broken before this phone raises the alarm.
 *
 * Shown on both devices, because both can lose the link — but they mean
 * different things by it, so the caller supplies the wording. On a remote
 * monitor it is the whole alarm; on the boat it warns that the shore has
 * gone blind while the local-GPS anchor alarm keeps running. See
 * utils/linkAlarm.js.
 *
 * A segmented control rather than a dropdown, for the same reason the zone
 * editor uses one: four options, and it is set with one thumb on a moving
 * boat in the dark.
 */
export default function AlarmDelayPicker({ value, onChange, label, hint }) {
  const t = useT();
  const labelText = label ?? t('linkAlarmDelayLabel');

  return (
    <div className="delay-picker">
      <div className="delay-picker-label">{labelText}</div>
      <div className="delay-segmented" role="radiogroup" aria-label={labelText}>
        {LINK_ALARM_DELAYS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            className={`delay-segmented-btn${
              value === option.id ? ' delay-segmented-btn-active' : ''
            }`}
            onClick={() => onChange(option.id)}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
      <div className="delay-picker-hint">{hint ?? t('linkAlarmDelayHint')}</div>
    </div>
  );
}
