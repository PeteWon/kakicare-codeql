import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, TextField } from '@/components';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import {
  email as emailRule,
  matches,
  minLength,
  required,
  validate,
} from '@/lib/validation';

// SECURITY NOTES (KakiCare registration):
//
// - Client-side validation is USABILITY ONLY. The backend enforces all rules
//   independently (SR-INPUT-01). Never rely on what this file checks.
//
// - The backend returns the SAME generic response whether the email is already
//   registered or not (anti-enumeration, SR-AUTH-06). The frontend reflects
//   that and does not branch on email existence.
//
// - Password is held only in in-memory React state. It is never logged, never
//   written to localStorage/sessionStorage, and is dropped on unmount.

type PageState = 'form' | 'pending';

export function Register() {
  usePageTitle('Volunteer with us');
  const [pageState, setPageState] = useState<PageState>('form');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [fullNameError, setFullNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const fullNameErr = validate(fullName, [required('Full name'), minLength(2, 'Full name')]);
    const emailErr = validate(email, [required('Email'), emailRule()]);
    const passwordErr = validate(password, [
      required('Password'),
      minLength(12, 'Password'),
    ]);
    const confirmErr = validate(confirmPassword, [
      required('Confirm password'),
      matches(password, 'Passwords'),
    ]);

    setFullNameError(fullNameErr);
    setEmailError(emailErr);
    setPasswordError(passwordErr);
    setConfirmPasswordError(confirmErr);
    if (fullNameErr || emailErr || passwordErr || confirmErr) return;

    setSubmitting(true);
    try {
      await api.register(email, fullName, password);
      setPageState('pending');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const body = err.body as Record<string, string[]> | null;
        if (body) {
          if (body.full_name?.[0]) setFullNameError(body.full_name[0]);
          if (body.email?.[0]) setEmailError(body.email[0]);
          if (body.password?.[0]) setPasswordError(body.password[0]);
        } else {
          setFormError('Please correct the errors and try again.');
        }
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (pageState === 'pending') {
    return (
      <section className="mx-auto max-w-md py-8">
        <Card className="text-center">
          <h1 className="text-2xl font-semibold text-primary-900">Check your email</h1>
          <p className="mt-3 text-primary-600">
            A verification link has been sent to <strong>{email}</strong>. Click
            it to activate your account, then come back to sign in.
          </p>
          <p className="mt-4 text-sm text-primary-500">
            The link expires in 24 hours. Check your spam folder if you don't see it.
          </p>
          <Link to="/login" className="mt-6 block">
            <Button fullWidth size="lg" variant="secondary">
              Back to sign in
            </Button>
          </Link>
          <p className="mt-4 text-sm text-primary-600">
            Didn't get the email?{' '}
            <Link
              to="/resend-verification"
              className="font-medium text-primary-700 hover:text-primary-900"
            >
              Resend verification link
            </Link>
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md py-8">
      <h1 className="text-3xl font-semibold text-primary-900">Volunteer registration</h1>
      <p className="mt-2 text-primary-600">
        Create an account to join the KakiCare befriending programme.
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
            id="fullName"
            label="Full name"
            name="fullName"
            autoComplete="name"
            autoFocus
            required
            value={fullName}
            error={fullNameError}
            onChange={(e) => setFullName(e.target.value)}
          />

          <TextField
            id="email"
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            error={emailError}
            onChange={(e) => setEmail(e.target.value)}
          />

          <TextField
            id="password"
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            error={passwordError}
            hint="At least 12 characters."
            onChange={(e) => setPassword(e.target.value)}
          />

          <TextField
            id="confirmPassword"
            label="Confirm password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirmPassword}
            error={confirmPasswordError}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-primary-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary-700 hover:text-primary-900">
          Sign in
        </Link>
      </p>
    </section>
  );
}
