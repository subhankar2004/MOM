export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'mom.theme';

/**
 * Runs in <head> before the page paints, so dark-mode users never see a white flash.
 * Kept as a string because it is inlined, not bundled.
 */
export const themeInitScript = `(function(){try{var c=localStorage.getItem('${THEME_STORAGE_KEY}');var d=c==='dark'||(c!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;

export function applyTheme(choice: ThemeChoice): void {
  const dark =
    choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // storage blocked (private mode): the choice lasts for this page only
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

const THEME_EVENT = 'mom:theme-change';

/** For useSyncExternalStore: re-read the choice when it changes here or in another tab. */
export function subscribeThemeChoice(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    if (readThemeChoice() === 'system') applyTheme('system');
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onChange);
  media.addEventListener('change', onSystemChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onChange);
    media.removeEventListener('change', onSystemChange);
  };
}

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}
