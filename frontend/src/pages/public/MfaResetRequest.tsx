// SECURITY NOTES:
// - This page is for users who have lost access to their authenticator.
// - The backend validates the email/password pair and decides whether to
//   create a reset request; the frontend must not try to infer account state.
// - The response is intentionally generic and should remain that way.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, TextField } from '@/components';
import { api, ApiError } from '@/lib/api';
import { email as emailRule, required, validate } from '@/lib/validation';
import { usePageTitle } from '@/lib/usePageTitle';

export function MfaResetRequest() {
  usePageTitle('Reset MFA');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const emailErr = validate(email, [required('Email'), emailRule()]);
    const passwordErr = validate(password, [required('Password')]);
    setEmailError(emailErr);
    setPasswordError(passwordErr);
    if (emailErr || passwordErr) return;

    setSubmitting(true);
    try {
      // SECURITY: the backend returns an identical generic response whether or
      // not the credentials were valid. We must show the same confirmation in
      // every success case and never key the UI on response contents.
      await api.requestMfaReset(email, password);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setFormError('We could not submit that request. Please check your details and try again.');
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <section className="mx-auto max-w-md py-8 my-auto">
        <Card className="space-y-4 text-center">
          <h1 className="font-serif text-2xl font-semibold text-primary-900">
            Reset request submitted
          </h1>
          <p className="text-primary-600">
            If your email and password were valid, your MFA reset request has been recorded.
            A staff member will review it and contact you after identity verification.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link to="/login" className="block sm:flex-1">
              <Button fullWidth>Back to sign in</Button>
            </Link>
            <Link to="/forgot-password" className="block sm:flex-1">
              <Button fullWidth variant="secondary">Reset password instead</Button>
            </Link>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md py-8">
      <h1 className="font-serif text-3xl font-semibold text-primary-900">
        Lost your authenticator?
      </h1>
      <p className="mt-2 text-primary-600">
        Submit a reset request using the email and password you normally sign in with.
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
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            value={email}
            error={emailError}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
          />

          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            showToggle
            value={password}
            error={passwordError}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
          />

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit reset request'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-primary-600">
        Need to sign in normally?{' '}
        <Link to="/login" className="font-medium text-primary-700 hover:text-primary-900">
          Back to sign in
        </Link>
      </p>
    </section>
  );
}
