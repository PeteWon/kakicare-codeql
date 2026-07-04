// SECURITY NOTE: Staff-only access is enforced by the BACKEND on every
// endpoint. The ProtectedRoute here is a UX convenience only.

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import type { ApplicationStatus, Paginated, StaffApplicationSummary } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const STATUS_OPTIONS: { value: ApplicationStatus; label: string }[] = [
  { value: 'pending_review', label: 'Pending review' },
  { value: 'approved',       label: 'Approved' },
  { value: 'rejected',       label: 'Rejected' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'incomplete',     label: 'Incomplete' },
];

const STATUS_BADGE: Record<ApplicationStatus, string> = {
  pending_review:    'bg-amber-100 text-amber-800',
  approved:         'bg-green-100 text-green-800',
  rejected:         'bg-red-100 text-red-700',
  changes_requested:'bg-orange-100 text-orange-800',
  incomplete:       'bg-cream-200 text-primary-600',
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending_review:    'Pending review',
  approved:         'Approved',
  rejected:         'Rejected',
  changes_requested:'Changes requested',
  incomplete:       'Incomplete',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Applications() {
  usePageTitle('Applications');
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = (searchParams.get('status') ?? 'pending_review') as ApplicationStatus;
  const currentPage = Number(searchParams.get('page') ?? '1');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Paginated<StaffApplicationSummary> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getStaffApplications(statusFilter, currentPage);
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError("You don't have permission to view this page.");
      } else {
        setError('Could not load applications. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, currentPage]);

  useEffect(() => {
    void load();
  }, [load]);

  function setStatus(s: ApplicationStatus) {
    setSearchParams({ status: s });
  }

  function setPage(p: number) {
    setSearchParams({ status: statusFilter, page: String(p) });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">
          Volunteer applications
        </h1>
      </div>

      {/* ---- Status filter tabs ---- */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatus(opt.value)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === opt.value
                ? 'bg-primary-500 text-white'
                : 'bg-white text-primary-600 border border-cream-300 hover:bg-primary-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* ---- Loading ---- */}
      {loading && (
        <div className="flex justify-center py-12">
          <span
            role="status"
            aria-label="Loading…"
            className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
          />
        </div>
      )}

      {/* ---- Error ---- */}
      {!loading && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-3 text-sm font-medium text-red-700 underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* ---- Results ---- */}
      {!loading && !error && result && (
        <>
          <div className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-sm">
            {result.results.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-primary-500">
                No {STATUS_LABEL[statusFilter].toLowerCase()} applications.
              </p>
            ) : (
              <table className="min-w-full divide-y divide-cream-200">
                <thead className="bg-cream-50">
                  <tr>
                    {['Name', 'Email', 'Languages', 'Areas', 'Status', 'Submitted', ''].map(
                      (h) => (
                        <th
                          key={h}
                          scope="col"
                          className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-primary-500"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-100">
                  {result.results.map((app) => (
                    <tr key={app.id} className="hover:bg-cream-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-primary-900">
                        {app.user_full_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-primary-600">
                        {app.user_email}
                      </td>
                      <td className="px-4 py-3 text-sm text-primary-600">
                        {app.languages.join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-primary-600">
                        {app.travel_areas.join(', ') || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[app.application_status]}`}
                        >
                          {STATUS_LABEL[app.application_status]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-primary-400">
                        {formatDate(app.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                        <Link
                          to={`/staff/applications/${app.id}`}
                          className="font-medium text-primary-600 hover:text-primary-900 hover:underline"
                        >
                          Review →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ---- Pagination ---- */}
          {(result.previous || result.next) && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-primary-500">
                {result.count} application{result.count !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(currentPage - 1)}
                  disabled={!result.previous}
                  className="rounded-xl border border-cream-300 bg-white px-4 py-2 text-sm font-medium text-primary-700 hover:bg-cream-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(currentPage + 1)}
                  disabled={!result.next}
                  className="rounded-xl border border-cream-300 bg-white px-4 py-2 text-sm font-medium text-primary-700 hover:bg-cream-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
