import type { ButtonHTMLAttributes } from 'react';

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

export function Pill({ active, className = '', ...props }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`rounded-full border px-4 py-1.5 text-label normal-case tracking-[0.02em] transition ${
        active
          ? 'border-accent bg-accent text-bg'
          : 'border-border bg-surface-raised text-text-muted hover:text-text'
      } ${className}`}
      {...props}
    />
  );
}
