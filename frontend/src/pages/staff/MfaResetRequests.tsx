// SECURITY NOTES:
// - Staff can view and action MFA reset requests from here.
// - Every reset requires an out-of-band verification method and outcome
//   (AC-12 / SR-ADMIN-03); the backend enforces this, and this page captures it.
// - Non-admin staff may only resolve VOLUNTEER resets; staff/admin targets are
//   rejected by the backend (Report 1 §10.1.2). The backend also filters the
//   list itself, so non-admin staff never see staff-target requests at all.
// - The page is staff-only via ProtectedRoute, but the backend remains
//   authoritative for role checks, list scoping, and request resolution.

import { useEffect, useState } from 'react';
import { Button, Card } from '@/components';
import { api, ApiError } from '@/lib/api';
import type {
  MfaResetRequestRecord,
  MfaResetStatus,
  MfaVerificationMethod,
  MfaVerificationOutcome,
} from '@/lib/types';
import { usePageTitle } from '@/lib/usePageTitle';

const STATUS_OPTIONS: MfaResetStatus[] = ['pending', 'resolved', 'rejected'];
const METHOD_OPTIONS: { value: MfaVerificationMethod; label: string }[] = [
  { value: 'phone_call', label: 'Phone call' },
  { value: 'video_call', label: 'Video call' },
  { value: 'email', label: 'Confirmed via email' },
  { value: 'in_person', label: 'In person' },
];
const OUTCOME_OPTIONS: { value: MfaVerificationOutcome; label: string }[] = [
  { value: 'success', label: 'Success — identity confirmed' },
  { value: 'failed', label: 'Failed — identity not confirmed' },
];

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function MfaResetRequests() {
  usePageTitle('MFA resets');

  const [status, setStatus] = useState<MfaResetStatus>('pending');
  const [requests, setRequests] = useState<MfaResetRequestRecord[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [methods, setMethods] = useState<Record<number, MfaVerificationMethod | ''>>({});
  const [outcomes, setOutcomes] = useState<Record<number, MfaVerificationOutcome | ''>>({});
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  async function loadRequests(nextStatus = status) {
    setLoading(true);
    setListError(null);
    try {
      const data = await api.getMfaResetRequests(nextStatus);
      setRequests(data.results);
      setCount(data.count);
    } catch {
      setListError('Could not load MFA reset requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequests(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function handleResolve(request: MfaResetRequestRecord) {
    const method = methods[request.id] ?? '';
    const outcome = outcomes[request.id] ?? '';
    if (!method || !outcome) {
      setRowError((prev) => ({
        ...prev,
        [request.id]: 'Select both the verification method and outcome.',
      }));
      return;
    }

    setResolvingId(request.id);
    setRowError((prev) => ({ ...prev, [request.id]: '' }));
    try {
      await api.resolveMfaReset(request.id, {
        verification_method: method,
        verification_outcome: outcome,
      });
      await loadRequests(status);
    } catch (err) {
      let message = 'Something went wrong. Please try again.';
      if (err instanceof ApiError) {
        if (err.status === 400) {
          message = 'This reset could not be completed. Check the required verification details.';
        } else if (err.status === 403) {
          message = 'You do not have permission to resolve this request.';
        } else if (err.status === 404) {
          message = 'That reset request was not found.';
        }
      }
      setRowError((prev) => ({ ...prev, [request.id]: message }));
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-primary-900">MFA resets</h1>
          <p className="mt-1 text-sm text-primary-500">
            Review and resolve lost-authenticator requests. Out-of-band identity verification
            is required for every reset.
          </p>
        </div>

        <label className="block text-sm font-medium text-primary-800">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MfaResetStatus)}
            className="mt-1 block rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-primary-900 shadow-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {listError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-cream-200 px-4 py-3 text-sm text-primary-600">
          {loading ? 'Loading...' : `${count} request${count === 1 ? '' : 's'}`}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-cream-200 text-sm">
            <thead className="bg-cream-50 text-left text-xs font-semibold uppercase tracking-wide text-primary-500">
              <tr>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-100 bg-white">
              {!loading && requests.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-primary-500">
                    No requests found.
                  </td>
                </tr>
              )}

              {requests.map((request) => (
                <tr key={request.id} className="align-top">
                  <td className="px-4 py-4">
                    <p className="font-medium text-primary-900">{request.target_user_full_name}</p>
                    <p className="text-primary-500">{request.target_user_email}</p>
                    {request.target_user_phone && (
                      <p className="text-primary-500">{request.target_user_phone}</p>
                    )}
                    <p className="mt-1 text-xs uppercase tracking-wide text-primary-400">
                      {request.target_user_role}
                    </p>
                    <p className="mt-1 text-xs text-primary-400">Request #{request.id}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-primary-600">
                    {formatDateTime(request.created_at)}
                  </td>
                  <td className="min-w-[280px] px-4 py-4">
                    {request.status === 'pending' ? (
                      <div className="space-y-3">
                        {rowError[request.id] && (
                          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {rowError[request.id]}
                          </div>
                        )}
                        <label className="block text-sm font-medium text-primary-800">
                          Verification method
                          <select
                            value={methods[request.id] ?? ''}
                            onChange={(e) =>
                              setMethods((prev) => ({
                                ...prev,
                                [request.id]: e.target.value as MfaVerificationMethod | '',
                              }))
                            }
                            className="mt-1 block w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-primary-900 shadow-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                          >
                            <option value="">How was identity confirmed?</option>
                            {METHOD_OPTIONS.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-sm font-medium text-primary-800">
                          Verification outcome
                          <select
                            value={outcomes[request.id] ?? ''}
                            onChange={(e) =>
                              setOutcomes((prev) => ({
                                ...prev,
                                [request.id]: e.target.value as MfaVerificationOutcome | '',
                              }))
                            }
                            className="mt-1 block w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-primary-900 shadow-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                          >
                            <option value="">Select an outcome…</option>
                            {OUTCOME_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="text-xs text-primary-500">
                          Choosing &quot;Failed&quot; rejects this request and leaves the
                          account&apos;s MFA untouched.
                        </p>
                        <Button
                          size="sm"
                          disabled={resolvingId === request.id}
                          onClick={() => void handleResolve(request)}
                        >
                          {resolvingId === request.id ? 'Resolving…' : 'Resolve MFA reset'}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-1 text-primary-600">
                        <p className="font-medium capitalize text-primary-800">{request.status}</p>
                        {request.resolved_at && <p>{formatDateTime(request.resolved_at)}</p>}
                        {request.reviewed_by_email && <p>{request.reviewed_by_email}</p>}
                        {request.verification_method && (
                          <p className="text-primary-500">
                            Method:{' '}
                            {METHOD_OPTIONS.find((m) => m.value === request.verification_method)
                              ?.label ?? request.verification_method}
                          </p>
                        )}
                        {request.verification_outcome && (
                          <p className="text-primary-500">
                            Outcome:{' '}
                            {OUTCOME_OPTIONS.find((o) => o.value === request.verification_outcome)
                              ?.label ?? request.verification_outcome}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
