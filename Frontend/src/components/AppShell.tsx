import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ProfileMenu } from './profile-menu/ProfileMenu';
import {
  BarChartIcon,
  HomeIcon,
  PlusCircleIcon,
  TargetIcon,
} from './ui/icons';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Home', icon: HomeIcon },
  { to: '/food-log', label: 'Log food', icon: PlusCircleIcon },
  { to: '/weight-trend', label: 'Progress', icon: BarChartIcon },
  { to: '/goals', label: 'Goals', icon: TargetIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text md:flex">
      <aside className="hidden shrink-0 flex-col border-r border-border bg-surface px-5 py-6 md:flex md:w-64">
        <p className="px-2 text-label text-text-muted">Energy ledger</p>
        <nav className="mt-8 flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg border border-transparent px-4 py-2.5 text-body font-semibold transition ${
                  isActive
                    ? 'border-border bg-surface-raised text-accent'
                    : 'text-text-muted hover:bg-surface-raised/60 hover:text-text'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`text-label ${isActive ? 'text-accent' : 'text-text-muted/40'}`}
                  >
                    {isActive ? '›' : '·'}
                  </span>
                  <Icon width={19} height={19} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <ProfileMenu className="mt-auto" menuAnchor="up" />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-4 md:hidden">
          <div className="flex items-center gap-2">
            <span className="pulse-dot" />
            <span className="text-heading">Energy ledger</span>
          </div>
          <ProfileMenu menuAnchor="down" compact />
        </header>

        <main className="flex-1 pb-24 md:pb-8">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-around border-t border-border bg-surface px-2 py-2 md:hidden">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                  isActive ? 'text-accent' : 'text-text-muted'
                }`
              }
            >
              <Icon width={22} height={22} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
