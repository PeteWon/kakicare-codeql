// SECURITY NOTE: Staff-only page. ProtectedRoute is a UX guard only; the
// backend enforces authorisation on every request. Handle 401/403 defensively.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import type { ConcernStatus, Paginated, WelfareConcern } from '@/lib/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STATUS_FILTERS: { value: ConcernStatus | ''; label: string }[] = [
  { value: 'open',     label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: '',         label: 'All' },
];

const TABLE_COLS = [
  'Senior',
  'Raised by',
  'Date raised',
  'Status',
  'Actions',
] as const;

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
// Page
// ---------------------------------------------------------------------------

export function Concerns() {
  usePageTitle('Concerns');
  const [statusFilter, setStatusFilter] = useState<ConcernStatus | ''>('open');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Paginated<WelfareConcern> | null>(null);

  // At most one resolve form open at a time.
  const [resolveFormId, setResolveFormId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getConcerns(statusFilter || undefined);
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError("You don't have permission to view this page.");
      } else {
        setError('Could not load concerns. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function openResolveForm(id: string) {
    setResolveFormId(id);
    setResolutionNote('');
    setRowError(null);
  }

  async function handleResolve(id: string) {
    setLoadingActionId(id);
    setRowError(null);
    try {
      await api.resolveConcern(id, resolutionNote.trim() || undefined);
      setResolveFormId(null);
      setResolutionNote('');
      void load();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? 'This concern has already been resolved.'
          : err instanceof ApiError && err.status === 400
            ? ((err.body as { detail?: string })?.detail ?? 'Cannot resolve this concern.')
            : 'Something went wrong. Please try again.';
      setRowError({ id, message: msg });
      setResolveFormId(null);
    } finally {
      setLoadingActionId(null);
    }
  }

  const COL_SPAN = TABLE_COLS.length;

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-primary-900">
        Welfare concerns
      </h1>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value === '' ? 'all' : f.value}
              onClick={() => {
                setStatusFilter(f.value as ConcernStatus | '');
                setResolveFormId(null);
                setRowError(null);
              }}
              className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary-500 text-white'
                  : 'border border-cream-300 bg-white text-primary-600 hover:bg-primary-50'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <span
            role="status"
            aria-label="Loading…"
            className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
          />
        </div>
      )}

      {/* Error */}
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

      {/* Results */}
      {!loading && !error && result && (
        <div className="overflow-x-auto rounded-2xl border border-cream-300 bg-white shadow-sm">
          {result.results.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-primary-500">
              No {statusFilter ? `${statusFilter} ` : ''}concerns found.
            </p>
          ) : (
            <table className="min-w-full divide-y divide-cream-200">
              <thead className="bg-cream-50">
                <tr>
                  {TABLE_COLS.map((h) => (
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
                {result.results.map((concern) => (
                  <Fragment key={concern.id}>
                    {/* Main data row */}
                    <tr className="hover:bg-cream-50">
                      {/* Senior */}
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-primary-900">
                          {concern.target_senior.full_name}
                        </p>
                      </td>

                      {/* Raised by */}
                      <td className="px-4 py-3">
                        <p className="text-sm text-primary-700">
                          {concern.raised_by.full_name}
                        </p>
                      </td>

                      {/* Date raised */}
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="text-sm text-primary-700">
                          {formatDate(concern.created_at)}
                        </p>
                      </td>

                      {/* Status badge */}
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            concern.status === 'open'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {concern.status === 'open' ? 'Open' : 'Resolved'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        {loadingActionId === concern.id ? (
                          <span className="flex items-center gap-1.5 text-primary-400">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-100 border-t-primary-500" />
                            Processing…
                          </span>
                        ) : concern.status === 'open' && resolveFormId !== concern.id ? (
                          <button
                            onClick={() => openResolveForm(concern.id)}
                            className="rounded-xl border border-primary-200 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50"
                          >
                            Resolve
                          </button>
                        ) : (
                          <span className="text-primary-300">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Per-row error */}
                    {rowError?.id === concern.id && (
                      <tr>
                        <td
                          colSpan={COL_SPAN}
                          className="bg-red-50 px-4 py-2 text-xs text-red-700"
                        >
                          {rowError.message}
                        </td>
                      </tr>
                    )}

                    {/* Inline resolve form */}
                    {resolveFormId === concern.id && (
                      <tr>
                        <td
                          colSpan={COL_SPAN}
                          className="bg-red-50 px-4 py-3"
                        >
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-red-800">
                              Resolve concern for {concern.target_senior.full_name}:
                            </p>
                            <div className="rounded-xl border border-red-200 bg-red-100 px-3 py-2">
                              <p className="text-xs font-medium text-red-800">Concern reported:</p>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-primary-900">
                                {concern.description}
                              </p>
                            </div>
                            <textarea
                              value={resolutionNote}
                              onChange={(e) => setResolutionNote(e.target.value)}
                              rows={2}
                              placeholder="Resolution note (optional)"
                              className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => void handleResolve(concern.id)}
                                className="rounded-xl bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600"
                              >
                                Mark resolved
                              </button>
                              <button
                                onClick={() => {
                                  setResolveFormId(null);
                                  setResolutionNote('');
                                }}
                                className="rounded-xl border border-primary-200 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50"
                              >
                                Close
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
      )}
    </div>
  );
}
