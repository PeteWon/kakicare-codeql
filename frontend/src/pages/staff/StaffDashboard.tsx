// SECURITY NOTE: Staff-only access is enforced by the BACKEND on every
// endpoint. The ProtectedRoute here is a UX convenience only, not a security
// boundary. Do not skip the backend auth check on any of these API calls.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { StaffSession } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function isLocalToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isFutureDay(iso: string): boolean {
  const d = new Date(iso);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return d >= tomorrow;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
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

function StatCard({
  label,
  value,
  linkTo,
  linkLabel,
  urgent = false,
}: {
  label: string;
  value: number;
  linkTo: string;
  linkLabel: string;
  urgent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${
        urgent
          ? 'border-red-200 bg-red-50'
          : 'border-cream-300 bg-white'
      }`}
    >
      <p className={`text-sm font-medium ${urgent ? 'text-red-600' : 'text-primary-500'}`}>
        {label}
      </p>
      <p className={`mt-1 text-4xl font-semibold tabular-nums ${urgent ? 'text-red-700' : 'text-primary-900'}`}>
        {value}
      </p>
      <Link
        to={linkTo}
        className={`mt-3 block text-sm font-medium hover:underline ${
          urgent ? 'text-red-700' : 'text-primary-600 hover:text-primary-900'
        }`}
      >
        {linkLabel} →
      </Link>
    </div>
  );
}

function SessionRow({ session }: { session: StaffSession }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-cream-200 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-primary-900">
          {session.senior.full_name}{' '}
          <span className="font-normal text-primary-500">with</span>{' '}
          {session.volunteer.full_name}
        </p>
        <p className="text-xs text-primary-400">
          {formatTime(session.scheduled_start)} – {formatTime(session.scheduled_end)}
          {' · '}
          <span className="capitalize">{session.session_type}</span>
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          session.status === 'in_progress'
            ? 'bg-green-100 text-green-800'
            : 'bg-primary-100 text-primary-700'
        }`}
      >
        {session.status === 'in_progress' ? 'In progress' : 'Confirmed'}
      </span>
    </div>
  );
}

function MissedSessionRow({ session }: { session: StaffSession }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-red-100 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-red-900">
          {session.senior.full_name}
          {' '}
          <span className="font-normal text-red-500">—</span>
          {' '}
          {session.volunteer.full_name}
        </p>
        <p className="text-xs text-red-400">
          {formatDate(session.scheduled_start)} · {formatTime(session.scheduled_start)}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
        Missed
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface DashboardData {
  pendingCount: number;
  todaySessions: StaffSession[];
  upcomingSessions: StaffSession[];
  missedSessions: StaffSession[];
}

export function StaffDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Fetch in parallel: pending applications count, sessions by status.
        const [pendingApps, missed, inProgress, confirmed] = await Promise.all([
          api.getStaffApplications('pending_review'),
          api.getStaffSessions({ status: 'missed', page_size: 50 }),
          api.getStaffSessions({ status: 'in_progress', page_size: 50 }),
          api.getStaffSessions({ status: 'confirmed', page_size: 100 }),
        ]);

        // Split confirmed sessions into today vs upcoming (client-side by date).
        const todaySessions: StaffSession[] = [
          ...inProgress.results,
          ...confirmed.results.filter((s) => isLocalToday(s.scheduled_start)),
        ].sort(
          (a, b) =>
            new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime(),
        );

        const upcomingSessions = confirmed.results
          .filter((s) => isFutureDay(s.scheduled_start))
          .sort(
            (a, b) =>
              new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime(),
          )
          .slice(0, 10);

        setData({
          pendingCount: pendingApps.count,
          todaySessions,
          upcomingSessions,
          missedSessions: missed.results,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setError('Your session has expired. Please log in again.');
        } else if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view this page.");
        } else {
          setError('Could not load dashboard. Please refresh the page.');
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) return <Spinner />;

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm text-red-700">{error ?? 'Something went wrong.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-2xl font-semibold text-primary-900">Dashboard</h1>

      {/* ---- Stat cards ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Pending applications"
          value={data.pendingCount}
          linkTo="/staff/applications"
          linkLabel="Review applications"
        />
        <StatCard
          label="Today's sessions"
          value={data.todaySessions.length}
          linkTo="/staff"
          linkLabel="See below"
        />
        <StatCard
          label="Missed sessions"
          value={data.missedSessions.length}
          linkTo="/staff"
          linkLabel="Welfare follow-up needed"
          urgent={data.missedSessions.length > 0}
        />
      </div>

      {/* ---- Missed sessions — welfare concern ---- */}
      {data.missedSessions.length > 0 && (
        <section aria-labelledby="missed-heading">
          <div className="mb-3 flex items-center gap-2">
            <h2
              id="missed-heading"
              className="text-base font-semibold text-red-800"
            >
              Missed sessions — follow-up required
            </h2>
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
              {data.missedSessions.length}
            </span>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-1">
            {data.missedSessions.map((s) => (
              <MissedSessionRow key={s.id} session={s} />
            ))}
          </div>
        </section>
      )}

      {/* ---- Today's sessions ---- */}
      <section aria-labelledby="today-heading">
        <h2
          id="today-heading"
          className="mb-3 text-base font-semibold text-primary-900"
        >
          Today's sessions
        </h2>
        {data.todaySessions.length === 0 ? (
          <div className="rounded-2xl border border-cream-300 bg-white px-5 py-4">
            <p className="text-sm text-primary-500">No sessions scheduled for today.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-cream-300 bg-white px-5 py-1">
            {data.todaySessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </section>

      {/* ---- Upcoming sessions ---- */}
      <section aria-labelledby="upcoming-heading">
        <h2
          id="upcoming-heading"
          className="mb-3 text-base font-semibold text-primary-900"
        >
          Upcoming sessions
        </h2>
        {data.upcomingSessions.length === 0 ? (
          <div className="rounded-2xl border border-cream-300 bg-white px-5 py-4">
            <p className="text-sm text-primary-500">No upcoming sessions.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-cream-300 bg-white px-5 py-1">
            {data.upcomingSessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-4 border-b border-cream-200 py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-primary-900">
                    {session_label(s)}
                  </p>
                  <p className="text-xs text-primary-400">
                    {formatDate(s.scheduled_start)} · {formatTime(s.scheduled_start)} –{' '}
                    {formatTime(s.scheduled_end)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                  Confirmed
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function session_label(s: StaffSession): string {
  return `${s.senior.full_name} with ${s.volunteer.full_name}`;
}
