/* eslint-env jest */
import { urlWithoutJoinParam } from './joinLink';

// A ?join= deep link must be consumed once. Left in the address bar it
// re-fires on every reload, so a code that has since expired produces
// "Session not found" forever — on a page whose actual session is fine.

describe('urlWithoutJoinParam', () => {
  it('strips the join code and keeps the rest of the URL', () => {
    expect(urlWithoutJoinParam('https://alarm-anchor.vercel.app/?join=UCTA6PAP8')).toBe('/');
  });

  it('preserves other query parameters', () => {
    expect(urlWithoutJoinParam('https://x.app/?lang=fr&join=ABCD12345&debug=1')).toBe(
      '/?lang=fr&debug=1'
    );
  });

  it('preserves the path and the hash', () => {
    expect(urlWithoutJoinParam('https://x.app/watch/?join=ABCD12345#map')).toBe('/watch/#map');
  });

  it('returns null when there is nothing to strip, so no history entry is written', () => {
    expect(urlWithoutJoinParam('https://alarm-anchor.vercel.app/')).toBeNull();
    expect(urlWithoutJoinParam('https://x.app/?lang=fr')).toBeNull();
  });

  it('never throws on input that is not a URL', () => {
    for (const bad of ['', 'not a url', '/relative/only', null, undefined, 42, {}]) {
      expect(() => urlWithoutJoinParam(bad)).not.toThrow();
      expect(urlWithoutJoinParam(bad)).toBeNull();
    }
  });

  it('strips an empty join param too', () => {
    // '?join=' is still a deep link as far as the reader is concerned.
    expect(urlWithoutJoinParam('https://x.app/?join=')).toBe('/');
  });
});
