// SECURITY NOTES:
// - Staff-only page. Staff are authorised to view all senior fields including
//   address, phone, and next-of-kin. Backend enforces access; ProtectedRoute is UX only.
// - Every GET /api/staff/seniors/<id> is audit-logged server-side as senior.read
//   (AC-06, SR-AUD-01). The frontend does nothing special for audit — the backend
//   records it automatically. Do not attempt to suppress or duplicate this logging.
// - Do not cache senior data in localStorage or sessionStorage. Keep in component
//   state only, fetched live on each page load.

import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { StaffSeniorDetail } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-primary-800">{value || '—'}</dd>
    </div>
  );
}

function AvailabilityGrid({ availability }: { availability: Record<string, string[]> }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const blocks = ['Morning', 'Afternoon', 'Evening'];
  if (!availability || Object.keys(availability).length === 0) {
    return <p className="text-sm text-primary-400">Not specified</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th className="w-10 pr-3 text-left text-xs font-medium text-primary-400" />
            {blocks.map((b) => (
              <th key={b} className="w-24 px-3 text-center text-xs font-medium text-primary-400">
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day}>
              <td className="py-1 pr-3 text-xs font-medium text-primary-600">{day}</td>
              {blocks.map((block) => (
                <td key={block} className="px-3 py-1 text-center">
                  {availability[day]?.includes(block) ? (
                    <span
                      className="inline-block h-4 w-4 rounded-sm bg-primary-400"
                      aria-label="Available"
                    />
                  ) : (
                    <span
                      className="inline-block h-4 w-4 rounded-sm bg-cream-200"
                      aria-label="Unavailable"
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SeniorDetail() {
  const { id } = useParams<{ id: string }>();
  const numericId = Number(id);
  const location = useLocation();
  // Success message passed via navigate state from SeniorForm after create/edit.
  const successMessage = (location.state as { successMessage?: string } | null)
    ?.successMessage;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [senior, setSenior] = useState<StaffSeniorDetail | null>(null);

  // Deactivate confirmation state
  const [showConfirm, setShowConfirm] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSenior(numericId);
      setSenior(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else if (err instanceof ApiError && (err.status === 401 || err.status === 403))
        setError('Session expired. Please log in again.');
      else setError('Could not load senior. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [numericId]);

  useEffect(() => {
    if (isNaN(numericId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    void load();
  }, [numericId, load]);

  async function handleDeactivate() {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      const updated = await api.deactivateSenior(numericId);
      setSenior(updated);
      setShowConfirm(false);
    } catch {
      setDeactivateError('Deactivation failed. Please try again.');
    } finally {
      setDeactivating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <span
          role="status"
          aria-label="Loading…"
          className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
        />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Senior not found</h1>
        <div className="rounded-2xl border border-cream-300 bg-white p-5">
          <p className="text-sm text-primary-600">
            This senior record doesn't exist or you don't have access to it.
          </p>
          <Link
            to="/staff/seniors"
            className="mt-3 block text-sm font-medium text-primary-600 hover:underline"
          >
            ← Back to seniors
          </Link>
        </div>
      </div>
    );
  }

  if (error || !senior) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Senior</h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-700">{error ?? 'Something went wrong.'}</p>
          <button
            onClick={() => void load()}
            className="mt-3 text-sm font-medium text-red-700 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div>
        <Link
          to="/staff/seniors"
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary-500 hover:text-primary-700"
        >
          ← Back to seniors
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-primary-900">
              {senior.full_name}
            </h1>
            <p className="mt-0.5 text-sm text-primary-500">Senior #{senior.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                senior.is_active
                  ? 'bg-green-100 text-green-800'
                  : 'bg-cream-200 text-primary-500'
              }`}
            >
              {senior.is_active ? 'Active' : 'Inactive'}
            </span>
            <Link
              to={`/staff/seniors/${senior.id}/edit`}
              className="rounded-xl border border-cream-300 bg-white px-4 py-1.5 text-sm font-medium text-primary-700 hover:bg-cream-50"
            >
              Edit
            </Link>
          </div>
        </div>
      </div>

      {/* ---- Success banner (from create/edit redirect) ---- */}
      {successMessage && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4">
          <p className="text-sm font-medium text-green-800">{successMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ---- Left: details (2/3 width on large screens) ---- */}
        <div className="space-y-5 lg:col-span-2">
          {/* Personal */}
          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-primary-900">Personal</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <InfoRow label="Preferred language" value={senior.preferred_language} />
              <InfoRow label="Added" value={formatDateTime(senior.created_at)} />
              {senior.accessibility_needs && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">
                    Accessibility needs
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-primary-800">
                    {senior.accessibility_needs}
                  </dd>
                </div>
              )}
              {senior.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">
                    Notes
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-primary-800">
                    {senior.notes}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Contact & address — sensitive fields; staff-only screen */}
          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-primary-900">Contact &amp; address</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <InfoRow label="Phone" value={senior.phone_number} />
              <div className="sm:col-span-2">
                <InfoRow label="Address" value={senior.address} />
              </div>
            </dl>
          </div>

          {/* Next of kin */}
          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-primary-900">Next of kin</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <InfoRow label="Name" value={senior.next_of_kin_name} />
              <InfoRow label="Contact" value={senior.next_of_kin_contact} />
            </dl>
          </div>

          {/* Availability */}
          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-primary-900">Availability</h2>
            <div className="mt-3">
              <AvailabilityGrid availability={senior.availability ?? {}} />
            </div>
          </div>

          {/* Audit notice — every view is logged server-side */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3">
            <p className="text-xs text-amber-700">
              <span className="font-semibold">Audit notice:</span> Access to this record is
              logged server-side as <code>senior.read</code> (AC-06, SR-AUD-01). Do not share
              or export sensitive fields (address, phone, next-of-kin) outside the platform.
            </p>
          </div>
        </div>

        {/* ---- Right: actions panel (1/3 width) ---- */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 space-y-4">
            <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-primary-900">Actions</h2>
              <div className="mt-3 space-y-3">
                <Link
                  to={`/staff/seniors/${senior.id}/edit`}
                  className="block w-full rounded-xl border border-cream-300 bg-white px-4 py-2 text-center text-sm font-medium text-primary-700 hover:bg-cream-50"
                >
                  Edit record
                </Link>

                {senior.is_active && !showConfirm && (
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="block w-full rounded-xl border border-red-200 bg-white px-4 py-2 text-center text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </div>

            {/* ---- Deactivate confirmation — inline (no modal) ---- */}
            {showConfirm && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
                <p className="text-sm font-medium text-red-800">Deactivate this senior?</p>
                <p className="mt-1 text-sm text-red-700">
                  This is a soft-deactivate — all session history and matches are preserved.
                  The record can be reactivated by editing it.
                </p>
                {deactivateError && (
                  <p className="mt-2 text-xs text-red-700">{deactivateError}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => void handleDeactivate()}
                    disabled={deactivating}
                    className="flex-1 rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deactivating ? 'Deactivating…' : 'Yes, deactivate'}
                  </button>
                  <button
                    onClick={() => {
                      setShowConfirm(false);
                      setDeactivateError(null);
                    }}
                    disabled={deactivating}
                    className="flex-1 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!senior.is_active && (
              <div className="rounded-2xl border border-cream-300 bg-cream-50 p-4">
                <p className="text-sm text-primary-500">
                  This senior is inactive. To reactivate, edit the record and enable Active
                  status.
                </p>
              </div>
            )}

            {/* Metadata */}
            <div className="space-y-1 rounded-2xl border border-cream-300 bg-white p-5 text-xs text-primary-400 shadow-sm">
              <p>Created: {formatDateTime(senior.created_at)}</p>
              <p>Last updated: {formatDateTime(senior.updated_at)}</p>
              {senior.created_by_email && <p>Added by: {senior.created_by_email}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
