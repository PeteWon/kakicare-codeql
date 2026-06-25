// SECURITY NOTE (SR-AUTHZ-03, JIT disclosure):
//   This list renders only the limited senior data the backend returns for
//   GET /api/volunteer/sessions/. The backend enforces data minimisation:
//   full address, phone number, and next-of-kin are withheld outside the
//   just-in-time disclosure window. The frontend must NOT attempt to show,
//   infer, or cache fields the backend withheld. Full contact details are
//   visible only on the SessionDetail page once the server opens the window.
//   Route protection here is UX only; the backend enforces real authorisation
//   and returns 404 (not 403) for sessions that don't belong to this volunteer.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import { Button, Card, CardTitle } from '@/components';
import type { SessionStatus, VolunteerSession } from '@/lib/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<SessionStatus, { label: string; className: string }> = {
  pending_confirmation: { label: 'Awaiting confirmation', className: 'bg-amber-100 text-amber-800' },
  confirmed:            { label: 'Confirmed',             className: 'bg-primary-100 text-primary-800' },
  in_progress:          { label: 'In progress',           className: 'bg-green-100 text-green-800' },
  completed:            { label: 'Completed',             className: 'bg-cream-200 text-primary-700' },
  missed:               { label: 'Missed',                className: 'bg-red-100 text-red-700' },
  cancelled:            { label: 'Cancelled',             className: 'bg-cream-200 text-primary-500' },
};

// Statuses that represent a live/upcoming session rather than a terminal one.
const UPCOMING_STATUSES = new Set<SessionStatus>([
  'pending_confirmation',
  'confirmed',
  'in_progress',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Session card
// ---------------------------------------------------------------------------

function SessionCard({ session }: { session: VolunteerSession }) {
  // SR-AUTHZ-03: display only what the backend sent — never attempt to show
  // address, phone, or next-of-kin from the SessionSenior type in this view.
  const seniorName =
    session.senior.first_name ??
    session.senior.full_name?.split(' ')[0] ??
    'Senior';

  const typeLabel = session.session_type === 'visit' ? 'Visit' : 'Call';
  const isPast = !UPCOMING_STATUSES.has(session.status);
  const cfg = STATUS_CONFIG[session.status] ?? {
    label: session.status,
    className: 'bg-cream-200 text-primary-700',
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-primary-900">
            {typeLabel} with {seniorName}
          </p>
          <p className="mt-0.5 text-sm text-primary-600">
            {formatDate(session.scheduled_start)}
          </p>
          <p className="text-xs text-primary-400">
            {formatTime(session.scheduled_start)} – {formatTime(session.scheduled_end)}
          </p>

          {/* Show a truncated note preview only for completed sessions. */}
          {isPast && session.volunteer_note && (
            <p className="mt-2 text-sm italic text-primary-600">
              &ldquo;
              {session.volunteer_note.length > 100
                ? `${session.volunteer_note.slice(0, 100)}…`
                : session.volunteer_note}
              &rdquo;
            </p>
          )}
        </div>

        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
        >
          {cfg.label}
        </span>
      </div>

      <div className="mt-3">
        <Link
          to={`/volunteer/sessions/${session.id}`}
          className="text-sm font-medium text-primary-600 hover:text-primary-800"
        >
          View details →
        </Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SessionHistory() {
  usePageTitle('Session history');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<VolunteerSession[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getVolunteerSessions();
      setSessions(data.results);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Sessions are available once your volunteer profile has been approved by staff.');
      } else {
        setError('Could not load your sessions. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upcoming = sessions
    .filter((s) => UPCOMING_STATUSES.has(s.status))
    .sort(
      (a, b) =>
        new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime(),
    );

  const past = sessions
    .filter((s) => !UPCOMING_STATUSES.has(s.status))
    .sort(
      (a, b) =>
        new Date(b.scheduled_start).getTime() - new Date(a.scheduled_start).getTime(),
    );

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-primary-900">My sessions</h1>

      {/* ---- Loading ---- */}
      {loading && (
        <div className="flex justify-center py-10">
          <span
            role="status"
            aria-label="Loading sessions…"
            className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
          />
        </div>
      )}

      {/* ---- Error ---- */}
      {!loading && error && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </Card>
      )}

      {/* ---- Results ---- */}
      {!loading && !error && (
        <>
          {/* Upcoming */}
          <section aria-labelledby="upcoming-heading">
            <div className="mb-3">
              <CardTitle id="upcoming-heading">Upcoming</CardTitle>
            </div>
            {upcoming.length === 0 ? (
              <Card>
                <p className="text-sm text-primary-600">
                  No upcoming sessions.{' '}
                  <Link
                    to="/volunteer/matches"
                    className="font-medium text-primary-700 hover:text-primary-900"
                  >
                    Book one from your matches.
                  </Link>
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {upcoming.map((s) => (
                  <SessionCard key={s.id} session={s} />
                ))}
              </div>
            )}
          </section>

          {/* Past */}
          <section aria-labelledby="past-heading">
            <div className="mb-3">
              <CardTitle id="past-heading">Past</CardTitle>
            </div>
            {past.length === 0 ? (
              <Card>
                <p className="text-sm text-primary-600">No past sessions yet.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {past.map((s) => (
                  <SessionCard key={s.id} session={s} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
