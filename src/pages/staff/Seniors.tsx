// SECURITY NOTES:
// - Staff-only access is enforced by the BACKEND. ProtectedRoute is UX only.
// - Senior data is the most sensitive in the system. Do not cache it in any
//   browser storage; keep in component state only, fetched live.
// - Every access is audit-logged server-side (AC-06, SR-AUD-01).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { Paginated, StaffSeniorSummary } from '@/lib/types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

type ActiveFilter = 'all' | 'active' | 'inactive';

const ACTIVE_OPTIONS: { value: ActiveFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

export function Seniors() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchQ = searchParams.get('search') ?? '';
  const activeFilter = (searchParams.get('active') ?? 'active') as ActiveFilter;
  const currentPage = Number(searchParams.get('page') ?? '1');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Paginated<StaffSeniorSummary> | null>(null);
  const [searchInput, setSearchInput] = useState(searchQ);
  // Keep a ref so the submit handler always sees the latest input without
  // being added as a dependency of the load callback.
  const searchInputRef = useRef(searchInput);
  searchInputRef.current = searchInput;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { search?: string; is_active?: boolean; page?: number } = {};
      if (searchQ) params.search = searchQ;
      if (activeFilter === 'active') params.is_active = true;
      else if (activeFilter === 'inactive') params.is_active = false;
      if (currentPage > 1) params.page = currentPage;
      const data = await api.getSeniors(params);
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setError('Session expired. Please log in again.');
      } else {
        setError('Could not load seniors. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [searchQ, activeFilter, currentPage]);

  useEffect(() => { void load(); }, [load]);

  // Sync the search input when the URL param changes (e.g. browser back nav).
  useEffect(() => { setSearchInput(searchQ); }, [searchQ]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams({ search: searchInputRef.current, active: activeFilter });
  }

  function setActive(v: ActiveFilter) {
    setSearchParams({ search: searchQ, active: v });
  }

  function setPage(p: number) {
    setSearchParams({ search: searchQ, active: activeFilter, page: String(p) });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Seniors</h1>
        <Link
          to="/staff/seniors/new"
          className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
        >
          + Add senior
        </Link>
      </div>

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {ACTIVE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setActive(opt.value)}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                activeFilter === opt.value
                  ? 'bg-primary-500 text-white'
                  : 'border border-cream-300 bg-white text-primary-600 hover:bg-primary-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or area…"
            className="w-52 rounded-xl border border-cream-300 bg-white px-3 py-1.5 text-sm text-primary-900 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <button
            type="submit"
            className="rounded-xl border border-cream-300 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-cream-50"
          >
            Search
          </button>
          {searchQ && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearchParams({ active: activeFilter });
              }}
              className="rounded-xl border border-cream-300 bg-white px-3 py-1.5 text-sm text-primary-500 hover:bg-cream-50"
            >
              Clear
            </button>
          )}
        </form>
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
                {searchQ ? `No seniors matching "${searchQ}".` : 'No seniors found.'}
              </p>
            ) : (
              <table className="min-w-full divide-y divide-cream-200">
                <thead className="bg-cream-50">
                  <tr>
                    {['Name', 'Language', 'Address / area', 'Status', 'Added', ''].map((h) => (
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
                  {result.results.map((senior) => (
                    <tr key={senior.id} className="hover:bg-cream-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-primary-900">
                        {senior.full_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-primary-600">
                        {senior.preferred_language || '—'}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-sm text-primary-600">
                        {senior.address || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            senior.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-cream-200 text-primary-500'
                          }`}
                        >
                          {senior.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-primary-400">
                        {formatDate(senior.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                        <Link
                          to={`/staff/seniors/${senior.id}`}
                          className="font-medium text-primary-600 hover:text-primary-900 hover:underline"
                        >
                          View →
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
                {result.count} senior{result.count !== 1 ? 's' : ''}
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
