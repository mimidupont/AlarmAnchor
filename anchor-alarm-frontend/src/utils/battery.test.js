/* eslint-env jest */
import {
  CRITICAL_BATTERY,
  LOW_BATTERY,
  batteryLevelState,
  formatBatteryPct,
  normalizeBattery
} from './battery';

describe('batteryLevelState', () => {
  it('warns low below the low threshold while unplugged', () => {
    expect(batteryLevelState({ level: LOW_BATTERY - 0.01, charging: false })).toBe('low');
  });

  it('escalates to critical below the critical threshold', () => {
    expect(batteryLevelState({ level: CRITICAL_BATTERY - 0.01, charging: false })).toBe('critical');
  });

  it('is ok at a healthy level', () => {
    expect(batteryLevelState({ level: 0.8, charging: false })).toBe('ok');
  });

  it('never warns while charging, however low', () => {
    // A boat on shore power or solar is not the failure this is about.
    expect(batteryLevelState({ level: 0.02, charging: true })).toBe('ok');
  });

  it('treats an unreadable level as ok, not empty', () => {
    // The web build / an APK without the plugin must not cry wolf.
    expect(batteryLevelState({ level: null, charging: false })).toBe('ok');
    expect(batteryLevelState({})).toBe('ok');
  });

  it('is low exactly at the threshold', () => {
    expect(batteryLevelState({ level: LOW_BATTERY, charging: false })).toBe('low');
  });
});

describe('formatBatteryPct', () => {
  it('renders a whole percent', () => {
    expect(formatBatteryPct(0.5)).toBe('50%');
    expect(formatBatteryPct(0.234)).toBe('23%');
  });

  it('clamps out-of-range values', () => {
    expect(formatBatteryPct(1.4)).toBe('100%');
    expect(formatBatteryPct(-0.2)).toBe('0%');
  });

  it('is null when unreadable', () => {
    expect(formatBatteryPct(null)).toBe(null);
    expect(formatBatteryPct(undefined)).toBe(null);
  });
});

describe('normalizeBattery', () => {
  it('reads the Capacitor shape', () => {
    expect(normalizeBattery({ batteryLevel: 0.75, isCharging: true })).toEqual({
      level: 0.75,
      charging: true
    });
  });

  it('reads the web Battery API shape', () => {
    expect(normalizeBattery({ level: 0.4, charging: false })).toEqual({
      level: 0.4,
      charging: false
    });
  });

  it('collapses an out-of-range level to unknown', () => {
    // Some stacks send -1 for "unknown"; it must not read as empty.
    expect(normalizeBattery({ batteryLevel: -1, isCharging: false })).toEqual({
      level: null,
      charging: false
    });
  });

  it('is null when there is nothing usable', () => {
    expect(normalizeBattery(null)).toBe(null);
    expect(normalizeBattery({})).toBe(null);
  });
});
