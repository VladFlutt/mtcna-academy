// Language selection. English is the default; Russian is chosen by the toggle or a Russian browser.
// Switching the language reloads the page, so strings can be picked once with T().

const KEY = 'mtcna-academy-v1'

function initial() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}').lang
    if (saved === 'en' || saved === 'ru') return saved
  } catch {}
  try { if (/^ru\b/i.test(navigator.language || '')) return 'ru' } catch {}
  return 'en'
}

export const LANG = typeof window === 'undefined' ? 'en' : initial()
export const T = (en, ru) => (LANG === 'ru' && ru !== undefined ? ru : en)

if (typeof document !== 'undefined') document.documentElement.lang = LANG
