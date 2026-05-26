// SECURITY NOTES (SR-AUD-01, SR-AUD-02, AC-06):
// - Staff-only oversight view. The backend enforces auth on every request;
//   ProtectedRoute is a UX guard only.
// - The audit log is APPEND-ONLY. This page is intentionally read-only — there
//   is no "edit", "delete", or "purge" action anywhere here, and no such API
//   endpoint exists. Surfaced filters narrow the view; they never mutate data.
// - Entries reference only target_type + target_id — never the contents of a
//   Senior or other sensitive record (SR-AUD-03). The frontend must not attempt
//   to enrich entries with senior PII; if you want a target's detail, navigate
//   to the relevant detail page (which is itself audit-logged).

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { Paginated, StaffAuditLogEntry } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Known action verbs that warrant a coloured chip. Anything else falls back to
// neutral styling — we deliberately do not hardcode every possible action.
function actionTone(action: string): string {
  if (action.includes('fail') || action.includes('cancel') || action.includes('decline')) {
    return 'bg-red-100 text-red-700';
  }
  if (action.includes('list') || action.includes('view') || action.includes('read')) {
    return 'bg-cream-200 text-primary-700';
  }
  if (action.includes('create') || action.includes('approve') || action.includes('confirm')) {
    return 'bg-green-100 text-green-800';
  }
  return 'bg-primary-100 text-primary-700';
}

const TARGET_OPTIONS = [
  { value: '', label: 'All targets' },
  { value: 'Senior', label: 'Senior' },
  { value: 'Match', label: 'Match' },
  { value: 'Session', label: 'Session' },
] as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AuditLog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const targetTypeFilter = searchParams.get('target_type') ?? '';
  const actionFilter = searchParams.get('action') ?? '';
  const currentPage = Number(searchParams.get('page') ?? '1');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Paginated<StaffAuditLogEntry> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAuditLog({
        target_type: targetTypeFilter || undefined,
        action: actionFilter || undefined,
        page: currentPage > 1 ? currentPage : undefined,
      });
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError("You don't have permission to view the audit log.");
      } else {
        setError('Could not load the audit log. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [targetTypeFilter, actionFilter, currentPage]);

  useEffect(() => {
    void load();
  }, [load]);

  function setTargetType(t: string) {
    const next: Record<string, string> = {};
    if (t) next.target_type = t;
    if (actionFilter) next.action = actionFilter;
    setSearchParams(next);
  }

  function setActionFilter(a: string) {
    const next: Record<string, string> = {};
    if (a) next.action = a;
    if (targetTypeFilter) next.target_type = targetTypeFilter;
    setSearchParams(next);
  }

  function setPage(p: number) {
    const next: Record<string, string> = { page: String(p) };
    if (targetTypeFilter) next.target_type = targetTypeFilter;
    if (actionFilter) next.action = actionFilter;
    setSearchParams(next);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Audit log</h1>
        <p className="mt-1 text-sm text-primary-500">
          Append-only record of security-relevant actions. Read-only.
        </p>
      </div>

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="audit-target-type"
            className="block text-xs font-medium uppercase tracking-wide text-primary-500"
          >
            Target
          </label>
          <select
            id="audit-target-type"
            value={targetTypeFilter}
            onChange={(e) => setTargetType(e.target.value)}
            className="mt-1 rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {TARGET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[200px]">
          <label
            htmlFor="audit-action"
            className="block text-xs font-medium uppercase tracking-wide text-primary-500"
          >
            Action
          </label>
          <input
            id="audit-action"
            type="search"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="e.g. senior.read"
            className="mt-1 w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-primary-800 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
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
          <div className="overflow-x-auto rounded-2xl border border-cream-300 bg-white shadow-sm">
            {result.results.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-primary-500">
                No audit entries match these filters.
              </p>
            ) : (
              <table className="min-w-full divide-y divide-cream-200">
                <thead className="bg-cream-50">
                  <tr>
                    {['Time', 'Actor', 'Role', 'Action', 'Target', 'IP'].map((h) => (
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
                  {result.results.map((entry) => (
                    <tr key={entry.id} className="hover:bg-cream-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-primary-500 tabular-nums">
                        {formatTimestamp(entry.timestamp)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {entry.user_email ? (
                          <span className="text-primary-800">{entry.user_email}</span>
                        ) : (
                          <span className="italic text-primary-300">system</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-primary-500 capitalize">
                        {entry.user_role || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${actionTone(entry.action)}`}
                        >
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-primary-600">
                        {entry.target_type ? (
                          <>
                            <span className="font-medium text-primary-800">
                              {entry.target_type}
                            </span>
                            {entry.target_id ? (
                              <span className="ml-1 text-primary-400">
                                #{entry.target_id}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-primary-300">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-primary-400 font-mono">
                        {entry.request_ip ?? '—'}
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
                {result.count} entr{result.count === 1 ? 'y' : 'ies'}
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
