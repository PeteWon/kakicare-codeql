// SECURITY NOTE (SR-AUTH-06 — anti-enumeration):
//   The backend returns an identical 200 response whether the submitted email is
//   an unverified account, an already-verified account, or unknown. This page
//   reflects that: after submitting we ALWAYS show the same confirmation message
//   regardless of outcome, and we swallow API errors rather than branching on
//   them, so a network or 4xx error cannot reveal account state. Never add a
//   branch here that shows a different message based on the email.
//
// - Auth state lives in the HttpOnly session cookie. No token is stored client-side.
// - Client-side email validation is USABILITY ONLY (SR-INPUT-01).

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, TextField } from '@/components';
import { api } from '@/lib/api';
import { email as emailRule, required, validate } from '@/lib/validation';
import { usePageTitle } from '@/lib/usePageTitle';

type PageState = 'form' | 'sent';

export function ResendVerification() {
  usePageTitle('Resend verification email');
  const [pageState, setPageState] = useState<PageState>('form');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const emailErr = validate(email, [required('Email'), emailRule()]);
    setEmailError(emailErr);
    if (emailErr) return;

    setSubmitting(true);
    try {
      await api.resendVerification(email);
    } catch {
      // SR-AUTH-06: intentionally swallowed — any error branch here could reveal
      // whether the email is a registered/unverified account. Always show the
      // generic message.
    } finally {
      setSubmitting(false);
    }
    // Always transition to 'sent', regardless of API outcome.
    setPageState('sent');
  }

  if (pageState === 'sent') {
    return (
      <section className="mx-auto max-w-md py-8 my-auto">
        <Card className="space-y-4 text-center">
          <h1 className="font-serif text-2xl font-semibold text-primary-900">
            Check your email
          </h1>
          {/* SR-AUTH-06: identical message whether or not the email needs verifying. */}
          <p className="text-primary-600">
            If <strong>{email}</strong> needs verification, we've sent a new
            verification link. Check your inbox and spam folder — the link expires
            in 24 hours.
          </p>
          <Link to="/login" className="block">
            <Button fullWidth variant="secondary">
              Back to sign in
            </Button>
          </Link>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md py-8">
      <h1 className="font-serif text-3xl font-semibold text-primary-900">
        Resend verification email
      </h1>
      <p className="mt-2 text-primary-600">
        Didn't get the verification link, or did it expire? Enter your email and
        we'll send a new one.
      </p>

      <Card className="mt-6">
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
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

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Sending…' : 'Send verification link'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-primary-600">
        Already verified?{' '}
        <Link
          to="/login"
          className="font-medium text-primary-700 hover:text-primary-900"
        >
          Sign in
        </Link>
      </p>
    </section>
  );
}
