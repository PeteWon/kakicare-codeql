import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, CardTitle, TextField } from '@/components';
import { minLength, required, validate } from '@/lib/validation';
import { usePageTitle } from '@/lib/usePageTitle';
import type { UserRole } from '@/lib/types';

// ---------------------------------------------------------------------------
// Change-password section
// ---------------------------------------------------------------------------

function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [nextError, setNextError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccess(false);

    const currentErr = validate(current, [required('Current password')]);
    const nextErr = validate(next, [
      required('New password'),
      minLength(12, 'New password'),
    ]);
    setCurrentError(currentErr);
    setNextError(nextErr);
    if (currentErr || nextErr) return;

    setSubmitting(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
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
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api.getMfaStatus()
      .then((s) => setEnrolled(s.enrolled))
      .catch(() => setError('Could not load MFA status.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleDisable() {
    setError(null);
    setSuccess(false);
    setDisabling(true);
    try {
      await api.disableMfa();
      setEnrolled(false);
      setSuccess(true);
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

  return (
    <section aria-labelledby="mfa-heading">
      <CardTitle id="mfa-heading" className="mb-3">
        Two-factor authentication (MFA)
      </CardTitle>
      <Card className="space-y-3">
        {loading && (
          <p className="text-sm text-primary-500">Loading…</p>
        )}

        {!loading && error && (
          <p role="alert" className="text-sm text-red-600">{error}</p>
        )}

        {!loading && enrolled !== null && (
          <>
            <p className="text-sm text-primary-700">
              Status:{' '}
              <span className={enrolled ? 'font-semibold text-green-700' : 'text-primary-500'}>
                {enrolled ? 'Enabled' : 'Not enabled'}
              </span>
            </p>

            {success && (
              <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
                MFA has been disabled.
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
              <p className="text-sm text-primary-500">
                You can enable MFA from the login flow after your next sign-in.
              </p>
            )}
          </>
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
