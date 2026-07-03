import { useEffect, useState } from 'react';
import { Button, Card } from '@/components';
import { api, ApiError } from '@/lib/api';
import type {
  DeactivationDecision,
  DeactivationRequestStatus,
  VolunteerDeactivationRequest,
} from '@/lib/types';
import { usePageTitle } from '@/lib/usePageTitle';

const STATUS_OPTIONS: DeactivationRequestStatus[] = ['pending', 'approved', 'rejected'];

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function statusLabel(status: DeactivationRequestStatus): string {
  return status.replace('_', ' ');
}

export function DeactivationRequests() {
  usePageTitle('Deactivation requests');

  const [status, setStatus] = useState<DeactivationRequestStatus>('pending');
  const [requests, setRequests] = useState<VolunteerDeactivationRequest[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staffNotes, setStaffNotes] = useState<Record<number, string>>({});
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  async function loadRequests(nextStatus = status) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDeactivationRequests(nextStatus);
      setRequests(data.results);
      setCount(data.count);
    } catch {
      setError('Could not load deactivation requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequests(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function handleResolve(
    request: VolunteerDeactivationRequest,
    decision: DeactivationDecision,
  ) {
    setResolvingId(request.id);
    setError(null);
    try {
      await api.resolveDeactivationRequest(
        request.id,
        decision,
        staffNotes[request.id]?.trim() ?? '',
      );
      setStaffNotes((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
      await loadRequests(status);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setError('This request has already been resolved.');
        } else if (err.status === 403) {
          setError('You do not have permission to resolve deactivation requests.');
        } else if (err.status === 404) {
          setError('That request was not found.');
        } else {
          setError('Something went wrong. Please try again.');
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-primary-900">
            Deactivation requests
          </h1>
          <p className="mt-1 text-sm text-primary-500">
            Review volunteer account deactivation requests.
          </p>
        </div>

        <label className="block text-sm font-medium text-primary-800">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as DeactivationRequestStatus)}
            className="mt-1 block rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-primary-900 shadow-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
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
                <th className="px-4 py-3">Volunteer</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-100 bg-white">
              {!loading && requests.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-primary-500">
                    No requests found.
                  </td>
                </tr>
              )}

              {requests.map((request) => (
                <tr key={request.id} className="align-top">
                  <td className="px-4 py-4">
                    <p className="font-medium text-primary-900">{request.requester_full_name}</p>
                    <p className="text-primary-500">{request.requester_email}</p>
                    <p className="mt-1 text-xs text-primary-400">Request #{request.id}</p>
                  </td>
                  <td className="max-w-md px-4 py-4 text-primary-700">
                    {request.reason || <span className="text-primary-400">No reason provided.</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-primary-600">
                    {formatDateTime(request.created_at)}
                  </td>
                  <td className="min-w-[280px] px-4 py-4">
                    {request.status === 'pending' ? (
                      <div className="space-y-3">
                        <textarea
                          rows={3}
                          maxLength={1000}
                          value={staffNotes[request.id] ?? ''}
                          onChange={(e) =>
                            setStaffNotes((prev) => ({
                              ...prev,
                              [request.id]: e.target.value,
                            }))
                          }
                          className="block w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-primary-900 shadow-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={resolvingId === request.id}
                            onClick={() => void handleResolve(request, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={resolvingId === request.id}
                            onClick={() => void handleResolve(request, 'reject')}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1 text-primary-600">
                        <p className="font-medium capitalize text-primary-800">
                          {request.status}
                        </p>
                        {request.reviewed_at && <p>{formatDateTime(request.reviewed_at)}</p>}
                        {request.reviewed_by_email && <p>{request.reviewed_by_email}</p>}
                        {request.staff_note && <p className="text-primary-500">{request.staff_note}</p>}
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
