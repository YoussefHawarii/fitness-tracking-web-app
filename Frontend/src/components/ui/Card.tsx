import type { HTMLAttributes, MouseEvent } from 'react';

type CardProps = HTMLAttributes<HTMLDivElement> & { holo?: boolean };

export function Card({ className = '', holo = false, onMouseMove, ...props }: CardProps) {
  return (
    <div
      {...props}
      onMouseMove={(e: MouseEvent<HTMLDivElement>) => {
        if (holo) {
          const rect = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
          e.currentTarget.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
        }
        onMouseMove?.(e);
      }}
      className={`rounded-card border border-border bg-surface shadow-card ${holo ? 'holo-card' : ''} ${className}`}
    />
  );
}

export function StatusChip({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-label text-accent ${className}`}
    />
  );
}

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div className={`inline-flex gap-2 rounded-xl border border-border bg-surface p-1 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-4 py-2 text-label normal-case tracking-[0.02em] transition ${
            value === opt.value
              ? 'bg-accent text-bg'
              : 'text-text-muted hover:text-text'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
