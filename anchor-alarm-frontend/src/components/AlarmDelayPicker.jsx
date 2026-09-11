import React from 'react';
import { useT } from '../i18n';
import { LINK_ALARM_DELAYS } from '../utils/linkAlarm';
import './Chrome.css';

/**
 * How long the boat may go unheard before this phone raises the alarm.
 *
 * Only ever shown to a remote monitor: the boat phone alarms from its own
 * GPS with no network at all, so a network-loss alarm there would be noise
 * about a non-event (see utils/linkAlarm.js).
 *
 * A segmented control rather than a dropdown, for the same reason the zone
 * editor uses one: four options, and it is set with one thumb on a moving
 * boat in the dark.
 */
export default function AlarmDelayPicker({ value, onChange, label }) {
  const t = useT();

  return (
    <div className="delay-picker">
      <div className="delay-picker-label">{label ?? t('linkAlarmDelayLabel')}</div>
      <div className="delay-segmented" role="radiogroup" aria-label={t('linkAlarmDelayLabel')}>
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
      <div className="delay-picker-hint">{t('linkAlarmDelayHint')}</div>
    </div>
  );
}
