import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Validation/usability error message shown below the field. */
  error?: string | null;
  hint?: string;
  /** Renders an eye-icon toggle to reveal/hide a password field. */
  showToggle?: boolean;
}

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="h-5 w-5" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="h-5 w-5" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function TextField({
  label,
  error,
  hint,
  id,
  className = '',
  showToggle,
  type,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [showPassword, setShowPassword] = useState(false);

  const describedBy = error
    ? `${fieldId}-error`
    : hint
      ? `${fieldId}-hint`
      : undefined;

  const resolvedType = showToggle && type === 'password'
    ? (showPassword ? 'text' : 'password')
    : type;

  const inputEl = (
    <input
      id={fieldId}
      type={resolvedType}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={`mt-1 block w-full h-11 rounded-xl border bg-white px-3 text-base text-primary-950 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
        error ? 'border-red-400' : 'border-cream-300'
      } ${showToggle ? 'pr-10' : ''} ${className}`}
      {...props}
    />
  );

  return (
    <div className="w-full">
      <label htmlFor={fieldId} className="block text-sm font-medium text-primary-800">
        {label}
      </label>
      {showToggle ? (
        <div className="relative">
          {inputEl}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-primary-400 hover:text-primary-700"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      ) : inputEl}
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
