// SECURITY NOTES:
// - Staff-only page; enforced by backend. ProtectedRoute is UX only.
// - AC-05: Listing all pairings for a volunteer helps staff spot repeat
//   targeting that may indicate stalking-type behaviour. Do not filter this
//   list in ways that hide historical pairings from staff.
// - Any senior-identifying data shown here is governed by the backend's
//   data-minimisation serialiser — do not extend types expecting contact fields.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import type { Paginated, StaffMatch, StaffMatchStatus } from '@/lib/types';

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

// ---------------------------------------------------------------------------
// Double opt-in indicator — one chip per party
// ---------------------------------------------------------------------------

function ConsentChip({
  label,
  confirmedAt,
}: {
  label: string;
  confirmedAt: string | null;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        confirmedAt
          ? 'bg-green-100 text-green-800'
          : 'bg-cream-200 text-primary-500'
      }`}
    >
      {label} {confirmedAt ? '✓' : '—'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<StaffMatchStatus, string> = {
  proposed: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  ended: 'bg-cream-200 text-primary-500',
};

const STATUS_LABEL: Record<StaffMatchStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  ended: 'Ended',
};

const FILTER_OPTIONS: { value: '' | StaffMatchStatus; label: string }[] = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'active', label: 'Active' },
  { value: 'ended', label: 'Ended' },
  { value: '', label: 'All' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function StaffMatches() {
  usePageTitle('Matches');
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = (searchParams.get('status') ?? 'proposed') as StaffMatchStatus | '';
  const currentPage = Number(searchParams.get('page') ?? '1');
  const location = useLocation();
  const successMessage = (location.state as { successMessage?: string } | null)
    ?.successMessage;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Paginated<StaffMatch> | null>(null);

  // Per-row action state — which match is showing the "end" confirmation.
  const [confirmEndId, setConfirmEndId] = useState<number | null>(null);
  // Which match has an in-flight action.
  const [loadingActionId, setLoadingActionId] = useState<number | null>(null);
  // Per-row error (cleared on next action attempt).
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMatches({
        status: statusFilter || undefined,
        page: currentPage > 1 ? currentPage : undefined,
      });
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError("You don't have permission to view this page.");
      } else {
        setError('Could not load matches. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, currentPage]);

  useEffect(() => { void load(); }, [load]);

  function setStatus(s: '' | StaffMatchStatus) {
    setSearchParams(s ? { status: s } : {});
  }

  function setPage(p: number) {
    const params: Record<string, string> = { page: String(p) };
    if (statusFilter) params.status = statusFilter;
    setSearchParams(params);
  }

  async function handleRecordConfirmation(matchId: number) {
    setLoadingActionId(matchId);
    setRowError(null);
    try {
      await api.recordSeniorConfirmation(matchId);
      void load();
    } catch {
      setRowError({ id: matchId, message: 'Action failed. Please try again.' });
    } finally {
      setLoadingActionId(null);
    }
  }

  async function handleEndMatch(matchId: number) {
    setLoadingActionId(matchId);
    setRowError(null);
    try {
      await api.endMatch(matchId);
      setConfirmEndId(null);
      void load();
    } catch {
      setRowError({ id: matchId, message: 'Could not end match. Please try again.' });
      setConfirmEndId(null);
    } finally {
      setLoadingActionId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Matches</h1>
        <Link
          to="/staff/matches/new"
          className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
        >
          + Propose new match
        </Link>
      </div>

      {/* ---- Success banner (from ProposeMatch redirect) ---- */}
      {successMessage && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4">
          <p className="text-sm font-medium text-green-800">{successMessage}</p>
        </div>
      )}

      {/* ---- Status filter tabs ---- */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatus(opt.value)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === opt.value
                ? 'bg-primary-500 text-white'
                : 'border border-cream-300 bg-white text-primary-600 hover:bg-primary-50'
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
                No {statusFilter ? STATUS_LABEL[statusFilter].toLowerCase() : ''} matches found.
              </p>
            ) : (
              <table className="min-w-full divide-y divide-cream-200">
                <thead className="bg-cream-50">
                  <tr>
                    {[
                      'Volunteer',
                      'Senior',
                      'Status',
                      'Double opt-in',
                      'Proposed',
                      'Actions',
                    ].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-primary-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-100">
                  {result.results.map((match) => (
                    <Fragment key={match.id}>
                      <tr className="hover:bg-cream-50">
                        {/* Volunteer */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-primary-900">
                            {match.volunteer_full_name}
                          </p>
                          <p className="text-xs text-primary-400">{match.volunteer_email}</p>
                        </td>

                        {/* Senior */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-primary-900">
                            {match.senior_full_name}
                          </p>
                        </td>

                        {/* Status */}
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[match.status]}`}
                          >
                            {STATUS_LABEL[match.status]}
                          </span>
                        </td>

                        {/* Double opt-in indicators */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <ConsentChip
                              label="Volunteer"
                              confirmedAt={match.volunteer_accepted_at}
                            />
                            <ConsentChip
                              label="Senior"
                              confirmedAt={match.senior_confirmed_at}
                            />
                          </div>
                        </td>

                        {/* Proposed date */}
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-primary-400">
                          {formatDate(match.created_at)}
                        </td>

                        {/* Actions */}
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          {loadingActionId === match.id ? (
                            <span className="flex items-center gap-1.5 text-primary-400">
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-100 border-t-primary-500" />
                              Processing…
                            </span>
                          ) : match.status === 'proposed' &&
                            !match.senior_confirmed_at ? (
                            <button
                              onClick={() => void handleRecordConfirmation(match.id)}
                              className="rounded-xl border border-primary-200 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50"
                            >
                              Record senior confirmation
                            </button>
                          ) : match.status === 'active' &&
                            confirmEndId !== match.id ? (
                            <button
                              onClick={() => setConfirmEndId(match.id)}
                              className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              End match
                            </button>
                          ) : match.status === 'ended' ? (
                            <span className="text-primary-300">—</span>
                          ) : null}
                        </td>
                      </tr>

                      {/* Per-row error */}
                      {rowError?.id === match.id && (
                        <tr>
                          <td
                            colSpan={6}
                            className="bg-red-50 px-4 py-2 text-xs text-red-700"
                          >
                            {rowError.message}
                          </td>
                        </tr>
                      )}

                      {/* Inline end-match confirmation */}
                      {confirmEndId === match.id && (
                        <tr>
                          <td
                            colSpan={6}
                            className="bg-red-50 px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <p className="text-sm text-red-800">
                                End this match between{' '}
                                <strong>{match.volunteer_full_name}</strong> and{' '}
                                <strong>{match.senior_full_name}</strong>? This cannot be
                                undone.
                              </p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => void handleEndMatch(match.id)}
                                  className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                                >
                                  Yes, end match
                                </button>
                                <button
                                  onClick={() => setConfirmEndId(null)}
                                  className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ---- Pagination ---- */}
          {(result.previous || result.next) && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-primary-500">
                {result.count} match{result.count !== 1 ? 'es' : ''}
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
