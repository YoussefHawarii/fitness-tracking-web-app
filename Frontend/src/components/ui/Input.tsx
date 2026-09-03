import type {
  HTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

const fieldClass =
  'w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-body text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-soft focus:border-accent';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} ${className}`} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldClass} ${className}`} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldClass} ${className}`} />;
}

export function FieldLabel({ className = '', ...props }: HTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={`flex flex-col gap-1.5 text-body text-text ${className}`} />;
}
