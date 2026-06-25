// SECURITY NOTES:
//
// - Client-side password validation (min 12 chars, must match) is USABILITY ONLY
//   (SR-INPUT-01). The backend enforces all password rules independently
//   (length, common-password, HIBP breach check, similarity).
//
// - The invite token is consumed exactly once server-side. An expired, already-used,
//   or malformed token returns 400. All three are treated identically here —
//   a single generic error (SR-AUTH-06; do not distinguish token states, as that
//   leaks information). An invitee whose link expired must ask an admin to resend.
//
// - On success the account is activated; first login then forces TOTP enrolment
//   (staff always require MFA). Auth state lives in the HttpOnly session cookie —
//   no token is stored client-side.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, TextField } from '@/components';
import { api, ApiError } from '@/lib/api';
import { matches, minLength, required, validate } from '@/lib/validation';
import { usePageTitle } from '@/lib/usePageTitle';

type PageState = 'form' | 'success' | 'invalid_token';

export function AcceptInvite() {
  usePageTitle('Accept invite');
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
      await api.acceptInvite(token, password);
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
            Account activated
          </h1>
          <p className="text-primary-600">
            Your password has been set. Sign in to continue — you’ll be asked to
            set up two-factor authentication on your first login.
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
            This invitation link has expired, already been used, or is invalid.
            Please ask a KakiCare administrator to send you a new invite.
          </p>
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
        Set your password
      </h1>
      <p className="mt-2 text-primary-600">
        Welcome to KakiCare. Choose a strong password to activate your staff account.
      </p>

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
            label="Password"
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
            label="Confirm password"
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
            {submitting ? 'Saving…' : 'Set password'}
          </Button>
        </form>
      </Card>
    </section>
  );
}
