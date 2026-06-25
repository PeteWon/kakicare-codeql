// SECURITY NOTES:
// - Staff-only page; enforced by backend. ProtectedRoute is UX only.
// - The "approved volunteer" filter on the dropdown is a USABILITY AID only —
//   the backend enforces the approved-volunteer rule and duplicate-pairing
//   constraints server-side. Frontend filtering does not constitute a security
//   control (SR-AUTHZ-01).
// - Do not display or store senior contact details (address, phone) here;
//   the approved-volunteer dropdown shows only limited info from the
//   applications endpoint.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';

// ---------------------------------------------------------------------------
// Searchable select — a text filter above a native <select> listbox.
// No external library required; avoids adding a dependency for a staff tool.
// ---------------------------------------------------------------------------

type SelectOption = { id: number; label: string };

function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  error,
}: {
  id: string;
  options: SelectOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  disabled?: boolean;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = options.find((o) => o.id === value) ?? null;
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );
  const visibleRows = Math.min(Math.max(filtered.length, 1), 7);

  // When an item is confirmed, collapse the picker.
  function pick(optId: number) {
    onChange(optId);
    setOpen(false);
    setSearch('');
  }

  // Show selected state when something is chosen and picker is closed.
  if (selected && !open) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-primary-200 bg-primary-50 px-3 py-2">
        <span className="text-sm font-medium text-primary-900">{selected.label}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="ml-3 shrink-0 text-xs text-primary-500 hover:text-primary-700 disabled:opacity-50"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${placeholder}…`}
        disabled={disabled}
        autoFocus={open}
        className="block w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-primary-900 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
      />
      {/* Native <select size={n}> acts as a visible listbox. */}
      <select
        id={id}
        size={visibleRows}
        value={value ?? ''}
        onChange={(e) => { if (e.target.value) pick(Number(e.target.value)); }}
        disabled={disabled}
        className="block w-full rounded-xl border border-cream-300 bg-white px-3 py-1 text-sm text-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
      >
        {filtered.length === 0 ? (
          <option value="" disabled>No results</option>
        ) : (
          filtered.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))
        )}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ProposeMatch() {
  usePageTitle('Propose a match');
  const navigate = useNavigate();

  // Dropdown data
  const [volunteers, setVolunteers] = useState<SelectOption[]>([]);
  const [seniors, setSeniors] = useState<SelectOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadOptionsError, setLoadOptionsError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // Form state
  const [volunteerId, setVolunteerId] = useState<number | null>(null);
  const [seniorId, setSeniorId] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    volunteer?: string;
    senior?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true);
    setLoadOptionsError(null);
    try {
      // Load up to 200 approved volunteers and active seniors for the dropdowns.
      // page_size=200 covers typical programme sizes in one request; if more exist
      // the truncation notice below will inform staff to search/filter instead.
      const [appRes, seniorRes] = await Promise.all([
        api.getStaffApplications('approved', undefined, 200),
        api.getSeniors({ is_active: true, page_size: 200 }),
      ]);

      setVolunteers(
        appRes.results.map((a) => ({
          id: a.user_id,   // backend expects User.id, not VolunteerProfile.id
          label: `${a.user_full_name} (${a.user_email})`,
        })),
      );
      setSeniors(
        seniorRes.results.map((s) => ({
          id: s.id,
          label: `${s.full_name}${s.preferred_language ? ` — ${s.preferred_language}` : ''}`,
        })),
      );
      // Warn if either list was truncated by the page size.
      if (appRes.next || seniorRes.next) setTruncated(true);
    } catch {
      setLoadOptionsError('Could not load volunteers or seniors. Please try again.');
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: { volunteer?: string; senior?: string } = {};
    if (!volunteerId) errs.volunteer = 'Please select a volunteer.';
    if (!seniorId) errs.senior = 'Please select a senior.';
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }

    setFieldErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.proposeMatch(volunteerId!, seniorId!);
      navigate('/staff/matches', {
        state: { successMessage: 'Match proposed. Waiting for volunteer and senior consent.' },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        // Surface backend rejection messages clearly (e.g. duplicate pairing,
        // unapproved volunteer). The backend is authoritative on these rules.
        const body = err.body as Record<string, unknown> | undefined;
        const detail =
          (body?.detail as string) ||
          (body?.non_field_errors as string[])?.join(' ') ||
          null;
        setSubmitError(
          err.status === 400 && detail
            ? detail
            : err.status === 401
              ? 'Your session has expired. Please log in again.'
              : err.status === 403
                ? "You don't have permission to do that."
                : 'Something went wrong. Please try again.',
        );
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/staff/matches"
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary-500 hover:text-primary-700"
        >
          ← Back to matches
        </Link>
        <h1 className="font-serif text-2xl font-semibold text-primary-900">
          Propose a match
        </h1>
      </div>

      {loadingOptions && (
        <div className="flex justify-center py-12">
          <span
            role="status"
            aria-label="Loading…"
            className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
          />
        </div>
      )}

      {!loadingOptions && loadOptionsError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-700">{loadOptionsError}</p>
          <button
            onClick={() => void loadOptions()}
            className="mt-3 text-sm font-medium text-red-700 underline"
          >
            Try again
          </button>
        </div>
      )}

      {!loadingOptions && !loadOptionsError && (
        <form onSubmit={handleSubmit} noValidate className="max-w-2xl space-y-6">
          {truncated && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3">
              <p className="text-xs text-amber-700">
                More than 200 records exist. Use the search box in each dropdown to find
                a specific volunteer or senior.
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm space-y-5">
            {/* Volunteer picker */}
            <div>
              <label
                htmlFor="volunteer-select"
                className="block text-sm font-medium text-primary-800"
              >
                Approved volunteer<span className="ml-0.5 text-red-500">*</span>
              </label>
              <p className="mt-0.5 mb-2 text-xs text-primary-400">
                Only approved applications are shown. The backend enforces this rule
                server-side — the frontend pre-filter is a usability aid only.
              </p>
              <SearchableSelect
                id="volunteer-select"
                options={volunteers}
                value={volunteerId}
                onChange={(id) => { setVolunteerId(id); setFieldErrors((e) => ({ ...e, volunteer: undefined })); }}
                placeholder="volunteer"
                disabled={submitting}
                error={fieldErrors.volunteer}
              />
              {volunteers.length === 0 && (
                <p className="mt-1 text-xs text-primary-400">
                  No approved volunteers found. Approve an application first.
                </p>
              )}
            </div>

            {/* Senior picker */}
            <div>
              <label
                htmlFor="senior-select"
                className="block text-sm font-medium text-primary-800"
              >
                Active senior<span className="ml-0.5 text-red-500">*</span>
              </label>
              <p className="mt-0.5 mb-2 text-xs text-primary-400">
                Only active seniors are shown.
              </p>
              <SearchableSelect
                id="senior-select"
                options={seniors}
                value={seniorId}
                onChange={(id) => { setSeniorId(id); setFieldErrors((e) => ({ ...e, senior: undefined })); }}
                placeholder="senior"
                disabled={submitting}
                error={fieldErrors.senior}
              />
              {seniors.length === 0 && (
                <p className="mt-1 text-xs text-primary-400">
                  No active seniors found. Add a senior first.
                </p>
              )}
            </div>
          </div>

          {/* How the double opt-in works */}
          <div className="rounded-2xl border border-primary-100 bg-primary-50 px-5 py-4 text-sm text-primary-700">
            <p className="font-medium">Double opt-in flow</p>
            <ol className="mt-2 list-decimal pl-4 space-y-1 text-xs text-primary-600">
              <li>Staff proposes the match (this form).</li>
              <li>The volunteer receives a notification and accepts or declines via their dashboard.</li>
              <li>Staff contacts the senior and records their consent here (Matches list → "Record senior confirmation").</li>
              <li>Once both sides have confirmed, the match becomes <strong>Active</strong>.</li>
            </ol>
          </div>

          {submitError && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary-500 px-6 text-base font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Proposing…' : 'Propose match'}
            </button>
            <Link
              to="/staff/matches"
              className="text-sm text-primary-500 hover:text-primary-700 hover:underline"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
