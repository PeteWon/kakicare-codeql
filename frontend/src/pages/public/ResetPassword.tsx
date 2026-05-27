// SECURITY NOTES:
//
// - Client-side password validation (min 12 chars, must match) is USABILITY ONLY
//   (SR-INPUT-01). The backend enforces all password rules independently.
//
// - The reset token is consumed exactly once server-side. An expired, already-used,
//   or malformed token returns 400. All three are treated identically here —
//   a single generic error with a link to request a new one (SR-AUTH-06; do not
//   distinguish between token states, as that leaks information).
//
// - On success the backend invalidates all existing sessions for this account.
//   The success state informs the user to sign in again with the new password.
//
// - Auth state lives in the HttpOnly session cookie. No token is stored client-side.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, TextField } from '@/components';
import { api, ApiError } from '@/lib/api';
import { matches, minLength, required, validate } from '@/lib/validation';

type PageState = 'form' | 'success' | 'invalid_token';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  // If there's no token in the URL, skip straight to the error state.
  const [pageState, setPageState] = useState<PageState>(
    token ? 'form' : 'invalid_token',
  );

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Usability-only checks — backend validates independently (SR-INPUT-01).
    const passwordErr = validate(password, [
      required('Password'),
      minLength(12, 'Password'),
    ]);
    const confirmErr = validate(confirmPassword, [
      required('Confirm password'),
      matches(password, 'Passwords'),
    ]);
    setPasswordError(passwordErr);
    setConfirmPasswordError(confirmErr);
    if (passwordErr || confirmErr) return;

    setSubmitting(true);
    try {
      await api.confirmPasswordReset(token, password);
      setPageState('success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        // SR-AUTH-06: show the same error for expired, already-used, and invalid
        // tokens — distinguishing them would leak token state.
        setPageState('invalid_token');
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (pageState === 'success') {
    return (
      <section className="mx-auto max-w-md py-8">
        <Card className="space-y-4 text-center">
          <h1 className="font-serif text-2xl font-semibold text-primary-900">
            Password updated
          </h1>
          <p className="text-primary-600">
            Your password has been reset. For security, all existing sessions have
            been signed out — please sign in with your new password.
          </p>
          <Link to="/login" className="block">
            <Button fullWidth>Sign in</Button>
          </Link>
        </Card>
      </section>
    );
  }

  if (pageState === 'invalid_token') {
    return (
      <section className="mx-auto max-w-md py-8">
        <Card className="space-y-4 text-center">
          <h1 className="font-serif text-2xl font-semibold text-primary-900">
            Link expired or invalid
          </h1>
          <p className="text-primary-600">
            This password reset link has expired, already been used, or is
            invalid. Request a new one below.
          </p>
          <Link to="/forgot-password" className="block">
            <Button fullWidth>Request new reset link</Button>
          </Link>
          <Link to="/login" className="block">
            <Button fullWidth variant="ghost">Back to sign in</Button>
          </Link>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md py-8">
      <h1 className="font-serif text-3xl font-semibold text-primary-900">
        Set new password
      </h1>
      <p className="mt-2 text-primary-600">Choose a strong password for your account.</p>

      <Card className="mt-6">
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {formError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {formError}
            </div>
          ) : null}

          <TextField
            label="New password"
            type="password"
            name="password"
            autoComplete="new-password"
            autoFocus
            hint="At least 12 characters."
            value={password}
            error={passwordError}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
          />

          <TextField
            label="Confirm new password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            error={confirmPasswordError}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setConfirmPasswordError(null);
            }}
          />

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
      </Card>
    </section>
  );
}
