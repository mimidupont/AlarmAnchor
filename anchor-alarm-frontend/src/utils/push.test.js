/* eslint-env jest */
import { isWebPushSupported, urlBase64ToUint8Array } from './push';

describe('isWebPushSupported', () => {
  it('is false on the native platform regardless of the webview', () => {
    // The native remote alerts while open; web push leads nowhere there.
    expect(isWebPushSupported({ nativePlatform: true })).toBe(false);
  });

  it('is true in a browser with the push APIs present', () => {
    // jsdom provides navigator/window; stub the two capability flags.
    const hadPM = 'PushManager' in window;
    const hadN = 'Notification' in window;
    window.PushManager = window.PushManager || function () {};
    window.Notification = window.Notification || function () {};
    Object.defineProperty(navigator, 'serviceWorker', {
      value: navigator.serviceWorker || {},
      configurable: true
    });
    try {
      expect(isWebPushSupported({ nativePlatform: false })).toBe(true);
    } finally {
      if (!hadPM) delete window.PushManager;
      if (!hadN) delete window.Notification;
    }
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url VAPID key to the right bytes', () => {
    // "hello" is aGVsbG8 in base64url (no padding).
    const out = urlBase64ToUint8Array('aGVsbG8');
    expect(Array.from(out)).toEqual([104, 101, 108, 108, 111]);
  });

  it('handles base64url-specific characters', () => {
    // 0xfb 0xff 0xbf encodes to -_-_ in base64url (+ / would be standard).
    const out = urlBase64ToUint8Array('-_-_');
    expect(Array.from(out)).toEqual([251, 255, 191]);
  });

  it('throws on an empty or non-string key', () => {
    expect(() => urlBase64ToUint8Array('')).toThrow();
    expect(() => urlBase64ToUint8Array(null)).toThrow();
  });
});
