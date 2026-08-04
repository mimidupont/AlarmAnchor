/* eslint-env jest */
import { canCreateSession } from './platform';
import { strings } from '../strings';

// Creating a session makes this device the boat phone: role 'main', GPS
// running, owner of the alarm. A browser tab cannot do any of that, so the
// hosted site must offer joining only.

describe('canCreateSession', () => {
  it('allows the native app, which is the boat phone', () => {
    expect(canCreateSession(true, 'production')).toBe(true);
    expect(canCreateSession(true, 'development')).toBe(true);
    expect(canCreateSession(true, 'test')).toBe(true);
  });

  it('refuses a production web build — the hosted site is a monitor only', () => {
    expect(canCreateSession(false, 'production')).toBe(false);
    expect(canCreateSession(false, 'test')).toBe(false);
    expect(canCreateSession(false, undefined)).toBe(false);
  });

  it('still allows the dev server, or the app could not be worked on', () => {
    expect(canCreateSession(false, 'development')).toBe(true);
  });

  it('treats a missing platform answer as "not native"', () => {
    // Capacitor.isNativePlatform() should always return a boolean, but the
    // safe direction on an unexpected value is to withhold creation rather
    // than hand someone a boat watch a browser cannot keep.
    expect(canCreateSession(undefined, 'production')).toBe(false);
    expect(canCreateSession(null, 'production')).toBe(false);
    expect(canCreateSession('', 'production')).toBe(false);
  });
});

describe('the note explaining where sessions come from', () => {
  it('exists in every language, so the web page never looks half-missing', () => {
    for (const [lang, table] of Object.entries(strings)) {
      expect(typeof table.createInAppNote).toBe('string');
      expect(table.createInAppNote.length).toBeGreaterThan(0);
      // A stray {placeholder} would render literally to a tester.
      expect(table.createInAppNote).not.toMatch(/\{.*\}/);
      expect(lang).toBeTruthy();
    }
  });
});
