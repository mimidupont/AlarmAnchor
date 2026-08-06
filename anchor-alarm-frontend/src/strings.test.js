/* eslint-env jest */
import { strings } from './strings';

// Both languages are hand-maintained side by side, so a key added to one
// and forgotten in the other is the obvious failure. A missing key renders
// as the raw key name to a French tester — ugly on the session screen,
// genuinely bad on a dialog that says the boat is no longer being watched.

const LANGS = Object.keys(strings);

describe('translation tables', () => {
  it('covers both languages', () => {
    expect(LANGS).toEqual(expect.arrayContaining(['en', 'fr']));
  });

  it('has exactly the same keys in every language', () => {
    const reference = Object.keys(strings.en).sort();
    for (const lang of LANGS) {
      expect({ lang, keys: Object.keys(strings[lang]).sort() }).toEqual({
        lang,
        keys: reference
      });
    }
  });

  it('has a non-empty string for every key', () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(strings[lang])) {
        expect(typeof value).toBe('string');
        expect(`${lang}.${key} = ${JSON.stringify(value)}`).not.toMatch(/= ""$/);
      }
    }
  });

  it('uses the same placeholders on both sides of a translation', () => {
    // t(key, vars) substitutes {name}. A placeholder that exists in one
    // language and not the other renders literally, or silently drops the
    // value — a session code or a distance the reader needed.
    const placeholders = (s) => (s.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
    for (const key of Object.keys(strings.en)) {
      for (const lang of LANGS) {
        expect({ key, lang, vars: placeholders(strings[lang][key]) }).toEqual({
          key,
          lang,
          vars: placeholders(strings.en[key])
        });
      }
    }
  });

  it('has the session-ended dialog in both languages', () => {
    // The specific thing this feature turns on: a watcher must be told, in
    // their own language, that nobody is watching the boat any more.
    for (const lang of LANGS) {
      expect(strings[lang].sessionEndedTitle).toBeTruthy();
      expect(strings[lang].sessionEndedMessage).toBeTruthy();
      expect(strings[lang].sessionEndedAck).toBeTruthy();
    }
  });
});
