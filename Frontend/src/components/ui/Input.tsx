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
const dateWrapperClass =
  'h-11 min-h-11 max-h-11 w-full shrink-0 flex items-center overflow-hidden rounded-xl border border-border bg-surface-raised px-4 text-body text-text focus-within:ring-2 focus-within:ring-accent-soft focus-within:border-accent';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  if (props.type === 'date') {
    // Native date-control rendering can paint beyond the input's CSS box.
    // Use a fixed outer box as the visual boundary so WebKit's internal UI
    // cannot make this field appear taller than the adjacent controls.
    return (
      <span className={`${dateWrapperClass} ${className}`}>
        <input
          {...props}
          className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-body text-text focus:outline-none"
        />
      </span>
    );
  }
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
