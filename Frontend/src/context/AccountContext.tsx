import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getAccount, type AccountProfile } from '../services/accountService';

interface AccountContextValue {
  account: AccountProfile | null;
  error: string | null;
  refresh: () => void;
}

const AccountContext = createContext<AccountContextValue | undefined>(undefined);

// Shared account state so a save on the Account/Settings page (display name,
// avatar) is reflected immediately in the sidebar's ProfileMenu without a
// full page reload (specs/008-sidebar-profile-account FR-013, T037).
export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getAccount()
      .then((data) => {
        setAccount(data);
        setError(null);
      })
      .catch(() => setError('Could not load your account settings.'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<AccountContextValue>(
    () => ({ account, error, refresh }),
    [account, error, refresh],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountContext(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) {
    throw new Error('useAccountContext must be used within an AccountProvider');
  }
  return ctx;
}
