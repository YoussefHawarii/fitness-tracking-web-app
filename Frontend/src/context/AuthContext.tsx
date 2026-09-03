import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { getStoredToken, setStoredTokens, type StoredTokens } from '../services/apiClient';
import { logout as logoutRequest } from '../services/authService';

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (tokens: StoredTokens) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: token !== null,
      login: (tokens: StoredTokens) => {
        setStoredTokens(tokens);
        setToken(tokens.accessToken);
      },
      logout: async () => {
        try {
          await logoutRequest();
        } catch {
          // Best-effort revoke — clear the local session regardless.
        } finally {
          setStoredTokens(null);
          setToken(null);
        }
      },
    }),
    [token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
