import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import QRCode from 'react-qr-code';
import { api, ApiError } from '@/lib/api';
import { Button, Card, CardTitle, TextField } from '@/components';
import { matches, minLength, required, validate } from '@/lib/validation';
import { usePageTitle } from '@/lib/usePageTitle';
import type { MfaSetupResult, UserRole } from '@/lib/types';

// ---------------------------------------------------------------------------
// Change-password section
// ---------------------------------------------------------------------------

function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [nextError, setNextError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccess(false);

    const currentErr = validate(current, [required('Current password')]);
    const nextErr = validate(next, [
      required('New password'),
      minLength(12, 'New password'),
    ]) ?? (next === current ? 'New password must differ from your current password.' : null);
    const confirmErr = validate(confirm, [
      required('Confirm password'),
      matches(next, 'Passwords'),
    ]);
    setCurrentError(currentErr);
    setNextError(nextErr);
    setConfirmError(confirmErr);
    if (currentErr || nextErr || confirmErr) return;

    setSubmitting(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.body) {
        const body = err.body as Record<string, string[]>;
        if (body.current_password) setCurrentError(body.current_password[0]);
        if (body.new_password) setNextError(body.new_password[0]);
      } else {
        setCurrentError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="change-password-heading">
      <CardTitle id="change-password-heading" className="mb-3">
        Change password
      </CardTitle>
      <Card>
        {success && (
          <p role="status" className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            Password changed successfully.
          </p>
        )}
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <TextField
            label="Current password"
            type="password"
            name="current-password"
            autoComplete="current-password"
            value={current}
            error={currentError}
            onChange={(e) => {
              setCurrent(e.target.value);
              setCurrentError(null);
              setSuccess(false);
            }}
          />
          <TextField
            label="New password"
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={next}
            error={nextError}
            onChange={(e) => {
              setNext(e.target.value);
              setNextError(null);
              setSuccess(false);
            }}
          />
          <TextField
            label="Confirm new password"
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirm}
            error={confirmError}
            onChange={(e) => {
              setConfirm(e.target.value);
              setConfirmError(null);
              setSuccess(false);
            }}
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Change password'}
          </Button>
        </form>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MFA section
// ---------------------------------------------------------------------------

function MfaSection({ role }: { role: UserRole }) {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Enable flow
  const [setupStep, setSetupStep] = useState<'idle' | 'setup'>('idle');
  const [setupData, setSetupData] = useState<MfaSetupResult | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupCode, setSetupCode] = useState('');
  const [setupCodeError, setSetupCodeError] = useState<string | null>(null);
  const [backupsAcknowledged, setBackupsAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api.getMfaStatus()
      .then((s) => setEnrolled(s.enrolled))
      .catch(() => setError('Could not load MFA status.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleDisable() {
    setError(null);
    setSuccessMsg(null);
    setDisabling(true);
    try {
      await api.disableMfa();
      setEnrolled(false);
      setSuccessMsg('MFA has been disabled.');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setDisabling(false);
    }
  }

  async function handleStartSetup() {
    setError(null);
    setSuccessMsg(null);
    setSetupLoading(true);
    setSetupStep('setup');
    try {
      const data = await api.setupMfa();
      setSetupData(data);
    } catch {
      setError('Could not start MFA setup. Please try again.');
      setSetupStep('idle');
    } finally {
      setSetupLoading(false);
    }
  }

  function handleCancelSetup() {
    setSetupStep('idle');
    setSetupData(null);
    setSetupCode('');
    setSetupCodeError(null);
    setBackupsAcknowledged(false);
  }

  async function handleConfirmSetup(e: FormEvent) {
    e.preventDefault();
    const trimmed = setupCode.trim();
    if (trimmed.length < 6 || trimmed.length > 8) {
      setSetupCodeError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setConfirming(true);
    setSetupCodeError(null);
    try {
      const result = await api.verifyMfa({ code: trimmed });
      if (result.status === 'enrolled') {
        setEnrolled(true);
        setSetupStep('idle');
        setSetupData(null);
        setSetupCode('');
        setBackupsAcknowledged(false);
        setSuccessMsg('MFA has been enabled.');
      } else {
        setSetupCodeError('Invalid code. Please try again.');
      }
    } catch {
      setSetupCodeError('Something went wrong. Please try again.');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section aria-labelledby="mfa-heading">
      <CardTitle id="mfa-heading" className="mb-3">
        Two-factor authentication (MFA)
      </CardTitle>
      <Card className="space-y-3">
        {loading && <p className="text-sm text-primary-500">Loading…</p>}

        {!loading && error && (
          <p role="alert" className="text-sm text-red-600">{error}</p>
        )}

        {!loading && enrolled !== null && setupStep === 'idle' && (
          <>
            <p className="text-sm text-primary-700">
              Status:{' '}
              <span className={enrolled ? 'font-semibold text-green-700' : 'text-primary-500'}>
                {enrolled ? 'Enabled' : 'Not enabled'}
              </span>
            </p>

            {successMsg && (
              <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
                {successMsg}
              </p>
            )}

            {role === 'staff' ? (
              <p className="text-sm text-primary-500">
                MFA is mandatory for staff accounts and cannot be disabled here.
              </p>
            ) : enrolled ? (
              <Button variant="secondary" disabled={disabling} onClick={() => void handleDisable()}>
                {disabling ? 'Disabling…' : 'Disable MFA'}
              </Button>
            ) : (
              <Button onClick={() => void handleStartSetup()}>
                Enable MFA
              </Button>
            )}
          </>
        )}

        {!loading && setupStep === 'setup' && (
          <div className="space-y-5">
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

                <form className="space-y-4" onSubmit={handleConfirmSetup} noValidate>
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
                  <div className="flex gap-3">
                    <Button type="submit" disabled={confirming || !backupsAcknowledged}>
                      {confirming ? 'Verifying…' : 'Verify and enable'}
                    </Button>
                    <Button type="button" variant="secondary" disabled={confirming} onClick={handleCancelSetup}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AccountSettings() {
  usePageTitle('Account settings');
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    api.getCurrentUser()
      .then((u) => setRole(u.role))
      .catch(() => {/* non-critical — MFA section falls back gracefully */});
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-2xl font-semibold text-primary-900">Account settings</h1>
      <ChangePasswordSection />
      {role !== null && <MfaSection role={role} />}
    </div>
  );
}
