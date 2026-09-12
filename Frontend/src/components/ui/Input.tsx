import type {
  HTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

const fieldClass =
  'w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-body text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-soft focus:border-accent';

// h-11 pins Input/Select to an identical 44px box — <select> doesn't honor
// text-body's line-height for its closed-box height the way <input> does
// (its height comes from the browser's own font-metric calculation
// instead), so relying on py-2.5 + line-height alone leaves a select a
// couple pixels shorter than a same-styled input sitting next to it.
// Textarea is intentionally excluded: its height comes from `rows`, not a
// fixed control height, and h-11 would collapse a multi-row textarea.
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} h-11 ${className}`} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldClass} h-11 ${className}`} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldClass} ${className}`} />;
}

export function FieldLabel({ className = '', ...props }: HTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={`flex flex-col gap-1.5 text-body text-text ${className}`} />;
}
