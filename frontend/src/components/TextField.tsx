import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Validation/usability error message shown below the field. */
  error?: string | null;
  hint?: string;
}

export function TextField({
  label,
  error,
  hint,
  id,
  className = '',
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy = error
    ? `${fieldId}-error`
    : hint
      ? `${fieldId}-hint`
      : undefined;

  return (
    <div className="w-full">
      <label htmlFor={fieldId} className="block text-sm font-medium text-primary-800">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1 block w-full h-11 rounded-xl border bg-white px-3 text-base text-primary-950 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
          error ? 'border-red-400' : 'border-cream-300'
        } ${className}`}
        {...props}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1 text-sm text-primary-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
