import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { Button, Card, TextField } from '@/components';
import { api, ApiError } from '@/lib/api';
import { fetchCurrentUser, homePathForRole } from '@/lib/auth';
import type { MfaSetupResult, UserRole } from '@/lib/types';
import { email as emailRule, required, validate } from '@/lib/validation';

// SECURITY NOTES (KakiCare login):
//
// - Generic failure message only. A failed login ALWAYS shows "Invalid email or
//   password" regardless of whether the email is unknown, password wrong, or
//   account inactive. This prevents account enumeration (SR-AUTH-06). The
//   backend enforces this; the frontend must not branch on the failure reason.
//
// - Password lives ONLY in in-memory React state. Never logged, never written to
//   localStorage/sessionStorage, dropped on unmount.
//
// - Session lives in the backend's HttpOnly cookie. The frontend never receives
//   or stores a token — it only reads the status field from the response.
//
// - MFA is enforced server-side. For staff, the backend issues a full session
//   only after verifyMfa succeeds. The two-step UI is a usability convenience,
//   not the security gate.

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';
const GENERIC_MFA_ERROR = 'Invalid code. Please try again.';

// credentials  → email + password form (initial)
// mfa          → TOTP/backup-code entry for enrolled users
// mfa_setup    → first-time MFA enrolment (staff on first login)
type Step = 'credentials' | 'mfa' | 'mfa_setup';

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Only redirect to relative paths — prevents open-redirect attacks.
  const rawNext = searchParams.get('next') ?? '';
  const nextPath =
    rawNext.startsWith('/') && !rawNext.startsWith('//')
      ? rawNext
      : null;

  const [step, setStep] = useState<Step>('credentials');

  // credentials step
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // mfa step — current enrolled user
  const [mfaRole, setMfaRole] = useState<UserRole>('staff');
  const [code, setCode] = useState('');
  const [backupMode, setBackupMode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  // mfa_setup step — first-time MFA enrolment
  const [setupData, setSetupData] = useState<MfaSetupResult | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupCode, setSetupCode] = useState('');
  const [setupCodeError, setSetupCodeError] = useState<string | null>(null);
  const [backupsAcknowledged, setBackupsAcknowledged] = useState(false);

  // shared
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Redirect away if already authenticated.
  const [checkingAuth, setCheckingAuth] = useState(true);
  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (user) navigate(homePathForRole(user.role), { replace: true });
      else setCheckingAuth(false);
    });
  }, [navigate]);

  // ── Credentials step ────────────────────────────────────────────────────

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
          navigate(nextPath ?? homePathForRole(result.role));
          return;
        case 'mfa_required':
          if (result.mfa_enrolled) {
            // User already has a confirmed TOTP device — go to verify step.
            // Role is not in this response; staff always require MFA so assume
            // staff. Volunteers with MFA opted in are also possible.
            setMfaRole('staff');
            setStep('mfa');
          } else {
            // First login (staff) — must set up MFA before completing login.
            setStep('mfa_setup');
            void triggerMfaSetup();
          }
          return;
        case 'invalid':
          setFormError(GENERIC_LOGIN_ERROR);
          return;
      }
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── MFA verify step (existing enrolled device) ──────────────────────────

  function resetMfaStep() {
    setCode('');
    setCodeError(null);
    setFormError(null);
    setBackupMode(false);
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmed = code.trim();

    if (backupMode) {
      if (trimmed.length !== 10) {
        setCodeError('Backup codes are exactly 10 characters.');
        return;
      }
    } else {
      const codeErr = validate(trimmed, [required('Code')]);
      setCodeError(codeErr);
      if (codeErr) return;
      if (trimmed.length < 6 || trimmed.length > 8) {
        setCodeError('Enter the 6-digit code from your authenticator app.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = backupMode
        ? { backup_code: trimmed }
        : { code: trimmed };
      const result = await api.verifyMfa(payload);
      if (result.status === 'success') {
        navigate(nextPath ?? homePathForRole(result.role));
        return;
      }
      setFormError(GENERIC_MFA_ERROR);
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── MFA setup step (first-time enrolment) ───────────────────────────────

  async function triggerMfaSetup() {
    setSetupLoading(true);
    setFormError(null);
    try {
      const data = await api.setupMfa();
      setSetupData(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Session expired during setup — start over.
        setStep('credentials');
        setFormError('Your session expired. Please sign in again.');
      } else {
        setFormError('Could not start MFA setup. Please try again.');
      }
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleMfaSetup(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmed = setupCode.trim();
    if (trimmed.length < 6 || trimmed.length > 8) {
      setSetupCodeError('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.verifyMfa({ code: trimmed });
      if (result.status === 'success') {
        navigate(nextPath ?? homePathForRole(result.role));
        return;
      }
      setSetupCodeError(GENERIC_MFA_ERROR);
    } catch (err) {
      // 5-minute mid-login window can elapse during MFA setup — surface a clear
      // recovery path back to credentials rather than leaving the user stuck.
      if (err instanceof ApiError && err.status === 401) {
        setStep('credentials');
        setSetupData(null);
        setSetupCode('');
        setSetupCodeError(null);
        setBackupsAcknowledged(false);
        setFormError('Your sign-in window has expired. Please sign in again.');
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (checkingAuth) return null;

  if (step === 'mfa_setup') {
    return (
      <section className="mx-auto max-w-md py-8 my-auto">
        <h1 className="text-3xl font-semibold text-primary-900">
          Set up two-factor authentication
        </h1>
        <p className="mt-2 text-primary-600">
          Your account requires MFA. Scan the QR code with your authenticator app
          (Microsoft Authenticator, Google Authenticator, etc.), save your backup
          codes, then enter the 6-digit code to complete sign-in.
        </p>

        <Card className="mt-6 space-y-5">
          {formError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {formError}
            </div>
          ) : null}

          {setupLoading || !setupData ? (
            <div className="flex items-center justify-center py-6">
              <span
                role="status"
                aria-label="Loading setup…"
                className="h-8 w-8 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
              />
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-primary-800">Scan with your authenticator app</p>
                  <div className="mt-2 flex justify-center rounded-xl bg-white p-4 shadow-sm ring-1 ring-cream-200">
                    <QRCode value={setupData.config_url} size={180} />
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-primary-800">
                    Can't scan?{' '}
                    <span className="font-normal text-primary-500">
                      Enter this key manually in your authenticator app.
                    </span>
                  </p>
                  <p className="mt-1 break-all rounded-xl bg-cream-100 px-3 py-2 font-mono text-sm text-primary-900 select-all">
                    {setupData.secret_key}
                  </p>
                  <p className="mt-1 text-xs text-primary-500">Issuer: KakiCare</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-primary-800">
                  Backup codes{' '}
                  <span className="font-normal text-red-600">(save these now — shown once only)</span>
                </p>
                <ul className="mt-2 grid grid-cols-2 gap-1">
                  {setupData.backup_codes.map((c) => (
                    <li
                      key={c}
                      className="rounded-lg bg-cream-100 px-2 py-1 font-mono text-sm text-primary-900"
                    >
                      {c}
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex items-center gap-2 text-sm text-primary-700">
                  <input
                    type="checkbox"
                    checked={backupsAcknowledged}
                    onChange={(e) => setBackupsAcknowledged(e.target.checked)}
                    className="rounded border-cream-300"
                  />
                  I've saved my backup codes
                </label>
              </div>

              <form className="space-y-4" onSubmit={handleMfaSetup} noValidate>
                <TextField
                  label="Authentication code"
                  name="setupCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={8}
                  placeholder="123456"
                  value={setupCode}
                  error={setupCodeError}
                  hint="Enter the 6-digit code from your authenticator app."
                  onChange={(e) => {
                    setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 8));
                    setSetupCodeError(null);
                  }}
                />

                <Button
                  type="submit"
                  fullWidth
                  disabled={submitting || !backupsAcknowledged}
                >
                  {submitting ? 'Verifying…' : 'Verify and sign in'}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  fullWidth
                  disabled={submitting}
                  onClick={() => {
                    setStep('credentials');
                    setSetupData(null);
                    setSetupCode('');
                    setSetupCodeError(null);
                    setFormError(null);
                    setBackupsAcknowledged(false);
                  }}
                >
                  Back
                </Button>
              </form>
            </>
          )}
        </Card>
      </section>
    );
  }

  if (step === 'mfa') {
    void mfaRole; // role captured for potential future use (e.g. showing volunteer vs staff label)
    return (
      <section className="mx-auto max-w-md py-8 my-auto">
        <h1 className="text-3xl font-semibold text-primary-900">
          Two-factor authentication
        </h1>
        <p className="mt-2 text-primary-600">
          {backupMode
            ? 'Enter one of your 10-character backup codes.'
            : 'Enter the 6-digit code from your authenticator app.'}
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

            {backupMode ? (
              <TextField
                label="Backup code"
                name="backupCode"
                autoComplete="off"
                autoFocus
                maxLength={10}
                placeholder="e.g. a1b2c3d4e5"
                value={code}
                error={codeError}
                onChange={(e) => {
                  setCode(e.target.value.slice(0, 10));
                  setCodeError(null);
                }}
              />
            ) : (
              <TextField
                label="Authentication code"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={8}
                placeholder="123456"
                value={code}
                error={codeError}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 8));
                  setCodeError(null);
                }}
              />
            )}

            <button
              type="button"
              className="text-sm text-primary-600 hover:text-primary-800"
              onClick={() => {
                setBackupMode((m) => !m);
                setCode('');
                setCodeError(null);
                setFormError(null);
              }}
            >
              {backupMode ? 'Use authenticator app instead' : 'Use a backup code instead'}
            </button>

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
                resetMfaStep();
              }}
            >
              Back
            </Button>
          </form>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md py-8">
      <h1 className="text-3xl font-semibold text-primary-900">Sign in</h1>
      <p className="mt-2 text-primary-600">Welcome back to KakiCare.</p>

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
            showToggle
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
    </section>
  );
}
