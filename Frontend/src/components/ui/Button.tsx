import type { ButtonHTMLAttributes, MouseEvent } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

function trackPointer(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`);
  event.currentTarget.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`);
}

export function PrimaryButton({ className = '', onMouseMove, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      onMouseMove={(e) => {
        trackPointer(e);
        onMouseMove?.(e);
      }}
      className={`spot-btn inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-label normal-case tracking-[0.02em] text-bg transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}

export function SecondaryButton({ className = '', onMouseMove, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      onMouseMove={(e) => {
        trackPointer(e);
        onMouseMove?.(e);
      }}
      className={`spot-btn inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-label normal-case tracking-[0.02em] text-text transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}
