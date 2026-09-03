import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccountContext } from '../../context/AccountContext';
import { Avatar } from './Avatar';
import { ChevronDownIcon, LogOutIcon, SettingsIcon, UserIcon } from '../ui/icons';

interface ProfileMenuProps {
  className?: string;
  /** 'up' anchors the dropdown above the trigger (for a bottom-pinned sidebar
   * entry); 'down' anchors it below (for a top header entry). */
  menuAnchor?: 'up' | 'down';
  /** Avatar-only trigger, no name/chevron — for tight mobile header space. */
  compact?: boolean;
}

export function ProfileMenu({
  className = '',
  menuAnchor = 'up',
  compact = false,
}: ProfileMenuProps) {
  const { logout } = useAuth();
  const { account } = useAccountContext();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const displayName = account?.displayName ?? '…';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {open && (
        <div
          role="menu"
          className={`absolute right-0 z-20 flex w-56 flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-card ${
            menuAnchor === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <Link
            to="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-body font-semibold text-text transition hover:bg-surface"
          >
            <UserIcon width={18} height={18} />
            Profile/Account
          </Link>
          <Link
            to="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-body font-semibold text-text transition hover:bg-surface"
          >
            <SettingsIcon width={18} height={18} />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex items-center gap-3 border-t border-border px-4 py-2.5 text-left text-body font-semibold text-warn transition hover:bg-warn-soft"
          >
            <LogOutIcon width={18} height={18} />
            Log out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={compact ? `Profile menu for ${displayName}` : undefined}
        className={
          compact
            ? 'flex items-center rounded-full transition hover:opacity-80'
            : 'flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-border hover:bg-surface-raised/60'
        }
      >
        <Avatar avatarUrl={account?.avatarUrl ?? null} displayName={displayName} size={compact ? 30 : 34} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate text-body font-semibold text-text">{displayName}</span>
            <ChevronDownIcon width={16} height={16} className="shrink-0 text-text-muted" />
          </>
        )}
      </button>
    </div>
  );
}
