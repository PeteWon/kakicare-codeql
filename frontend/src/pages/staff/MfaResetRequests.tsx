// SECURITY NOTES:
// - Staff can action MFA reset requests from here.
// - Every reset requires an out-of-band verification method and outcome
//   (AC-12 / SR-ADMIN-03); the backend enforces this, and this page captures it.
// - Non-admin staff may only resolve VOLUNTEER resets; staff/admin targets are
//   rejected by the backend (Report 1 §10.1.2).
// - The page is staff-only via ProtectedRoute, but the backend remains
//   authoritative for role checks and request resolution.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Card, TextField } from '@/components';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';

export function MfaResetRequests() {
  usePageTitle('MFA resets');

  const [requestId, setRequestId] = useState('');
  const [verificationMethod, setVerificationMethod] = useState('');
  const [verificationOutcome, setVerificationOutcome] = useState('');
  const [requestIdError, setRequestIdError] = useState<string | null>(null);
  const [methodError, setMethodError] = useState<string | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setResultMessage(null);

    const requestIdNum = Number(requestId);
    const requestIdErr = !requestId || Number.isNaN(requestIdNum) || requestIdNum <= 0
      ? 'Enter a valid request ID.'
      : null;
    // AC-12 / SR-ADMIN-03: out-of-band verification is required for every reset,
    // so both fields are mandatory here (the backend also enforces this).
    const methodErr = verificationMethod.trim() ? null : 'Record the verification method used.';
    const outcomeErr = verificationOutcome.trim() ? null : 'Record the verification outcome.';
    setRequestIdError(requestIdErr);
    setMethodError(methodErr);
    setOutcomeError(outcomeErr);
    if (requestIdErr || methodErr || outcomeErr) return;

    setSubmitting(true);
    try {
      const response = await api.resolveMfaReset(requestIdNum, {
        verification_method: verificationMethod.trim(),
        verification_outcome: verificationOutcome.trim(),
      });
      setResultMessage(response.detail);
      setRequestId('');
      setVerificationMethod('');
      setVerificationOutcome('');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setFormError('This reset could not be completed. Check the request ID and required verification details.');
        } else if (err.status === 403) {
          setFormError('You do not have permission to resolve this request.');
        } else if (err.status === 404) {
          setFormError('That reset request was not found.');
        } else {
          setFormError('Something went wrong. Please try again.');
        }
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-primary-900">MFA resets</h1>
        <p className="mt-1 text-sm text-primary-500">
          Resolve lost-authenticator requests. Out-of-band identity verification is required for every reset — record the method and outcome before resolving.
        </p>
      </div>

      <Card className="max-w-2xl space-y-4">
        {resultMessage ? (
          <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {resultMessage}
          </div>
        ) : null}

        {formError ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {formError}
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <TextField
            label="Reset request ID"
            name="requestId"
            inputMode="numeric"
            value={requestId}
            error={requestIdError}
            hint="Use the request reference provided by the user or from your case notes."
            onChange={(e) => {
              setRequestId(e.target.value.replace(/\D/g, '').slice(0, 10));
              setRequestIdError(null);
            }}
          />

          <TextField
            label="Verification method"
            name="verificationMethod"
            value={verificationMethod}
            error={methodError}
            hint="Required; e.g. phone callback, in-person ID check."
            onChange={(e) => {
              setVerificationMethod(e.target.value);
              setMethodError(null);
            }}
          />

          <TextField
            label="Verification outcome"
            name="verificationOutcome"
            value={verificationOutcome}
            error={outcomeError}
            hint="Required; e.g. identity matched, failed verification."
            onChange={(e) => {
              setVerificationOutcome(e.target.value);
              setOutcomeError(null);
            }}
          />

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Resolving…' : 'Resolve MFA reset'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
