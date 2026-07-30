import { createContext, useContext } from 'react';
import { strings } from './strings';

// Tiny i18n: t(key, vars) does a plain object lookup with {var}
// substitution, falling back en → key so a missing translation is
// visible but never crashes.

export const defaultLang = () => {
  try {
    const stored = localStorage.getItem('lang');
    if (stored === 'en' || stored === 'fr') return stored;
  } catch (err) {
    // Storage unavailable — fall through to browser language.
  }
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
};

export const makeT = (lang) => (key, vars) => {
  let s = (strings[lang] && strings[lang][key]) ?? strings.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
};

export const LangContext = createContext(makeT('en'));
export const useT = () => useContext(LangContext);
