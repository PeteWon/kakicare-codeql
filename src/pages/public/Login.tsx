import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, TextField } from '@/components';
import { api } from '@/lib/api';
import { email as emailRule, required, validate } from '@/lib/validation';

// SECURITY NOTES (KakiCare login — see security report):
//
// - Generic failure messages only. A failed login always shows the SAME
//   message ("Invalid email or password") whether the email is unknown, the
//   password is wrong, or the account is inactive. This prevents account
//   enumeration (SR-AUTH-06). The backend enforces this; the frontend must
//   never branch its message on the failure reason.
//
// - The password lives ONLY in in-memory React state below. It is never
//   logged, never written to localStorage/sessionStorage, and is dropped when
//   the component unmounts.
//
// - Session handling is done by the backend via secure, HttpOnly cookies.
//   The frontend must NOT store any auth token in localStorage or
//   sessionStorage — those are readable by JavaScript and vulnerable to XSS.
//   Do not introduce token-in-localStorage here.
//
// - MFA is enforced server-side. For a staff account, the backend will not
//   issue a privileged session on credentials alone — login returns
//   'mfa_required' and only verifyMfa completes the login. The two-step UI
//   here is a usability convenience, not the security gate.

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';
const GENERIC_MFA_ERROR = 'Invalid code. Please try again.';

type Step = 'credentials' | 'mfa';

export function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('credentials');

  // Credentials step state.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // MFA step state.
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  // Shared.
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const emailErr = validate(email, [required('Email'), emailRule()]);
    const passwordErr = validate(password, [required('Password')]);
    setEmailError(emailErr);
    setPasswordError(passwordErr);
    if (emailErr || passwordErr) return;

    setSubmitting(true);
    try {
      const result = await api.login(email, password);
      switch (result.status) {
        case 'success':
          navigate('/volunteer');
          return;
        case 'mfa_required':
          setStep('mfa');
          return;
        case 'invalid':
          // Generic message only — never reveal which part failed.
          setFormError(GENERIC_LOGIN_ERROR);
          return;
      }
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const codeErr = validate(code, [required('Code')]);
    setCodeError(codeErr);
    if (codeErr) return;
    if (code.length !== 6) {
      setCodeError('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.verifyMfa(code);
      if (result.status === 'success') {
        navigate('/staff');
        return;
      }
      setFormError(GENERIC_MFA_ERROR);
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md py-8">
      {step === 'credentials' ? (
        <>
          <h1 className="text-3xl font-semibold text-primary-900">Log in</h1>
          <p className="mt-2 text-primary-600">
            Welcome back to KakiCare.
          </p>

          <Card className="mt-6">
            <form className="space-y-4" onSubmit={handleCredentials} noValidate>
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
                onChange={(e) => setEmail(e.target.value)}
              />

              <TextField
                label="Password"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                error={passwordError}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="text-right">
                <Link
                  to="/forgot-password"
                  className="text-sm text-primary-600 hover:text-primary-800"
                >
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" fullWidth disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </Card>

          <p className="mt-6 text-center text-sm text-primary-600">
            New volunteer?{' '}
            <Link to="/register" className="font-medium text-primary-700 hover:text-primary-900">
              Create an account
            </Link>
          </p>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold text-primary-900">
            Two-factor authentication
          </h1>
          <p className="mt-2 text-primary-600">
            Enter the 6-digit code from your authenticator app.
          </p>

          <Card className="mt-6">
            <form className="space-y-4" onSubmit={handleMfa} noValidate>
              {formError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {formError}
                </div>
              ) : null}

              <TextField
                label="Authentication code"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="123456"
                value={code}
                error={codeError}
                // Strip non-digits and cap at 6 characters.
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />

              <Button type="submit" fullWidth disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify'}
              </Button>

              <Button
                type="button"
                variant="ghost"
                fullWidth
                disabled={submitting}
                onClick={() => {
                  setStep('credentials');
                  setCode('');
                  setCodeError(null);
                  setFormError(null);
                }}
              >
                Back
              </Button>
            </form>
          </Card>
        </>
      )}
    </section>
  );
}
