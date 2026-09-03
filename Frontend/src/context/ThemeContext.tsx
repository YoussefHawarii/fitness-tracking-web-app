import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getAccount, updatePreferences, type Appearance } from '../services/accountService';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'theme';

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null; // localStorage unavailable (e.g. private browsing)
  }
}

function osPreferredTheme(): Theme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  } catch {
    return 'dark';
  }
}

function resolveInitialTheme(): Theme {
  return readStoredTheme() ?? osPreferredTheme();
}

function applyThemeAttribute(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Applied as early as this module is imported (before first paint), so the
// correct theme is already on <html> by the time React renders — avoids a
// flash of the wrong theme (research.md §3).
if (typeof document !== 'undefined') {
  applyThemeAttribute(resolveInitialTheme());
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function toAppearance(theme: Theme): Appearance {
  return theme === 'light' ? 'LIGHT' : 'DARK';
}

function fromAppearance(appearance: Appearance): Theme {
  return appearance === 'LIGHT' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  // Once the signed-in account's saved preference loads, it wins over
  // whatever localStorage/OS guess was used for the very first paint —
  // the explicit account-level choice is the source of truth (spec Story 2
  // Scenario 3).
  useEffect(() => {
    let cancelled = false;
    getAccount()
      .then((account) => {
        if (cancelled || !account.appearancePreference) return;
        const accountTheme = fromAppearance(account.appearancePreference);
        setThemeState(accountTheme);
        applyThemeAttribute(accountTheme);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, accountTheme);
        } catch {
          // best-effort mirror only
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (next: Theme) => {
        setThemeState(next);
        applyThemeAttribute(next);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // best-effort mirror only
        }
        void updatePreferences({ appearancePreference: toAppearance(next) });
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
