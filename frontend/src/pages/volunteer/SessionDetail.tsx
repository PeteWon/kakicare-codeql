// SECURITY NOTES — read before touching this file:
//
// SR-AUTHZ-03 (JIT disclosure): The decision whether to expose the senior's
// full address and contact details is made SERVER-SIDE, computed from the
// server clock on every request — it is never a stored flag and cannot be
// influenced by any client-supplied value. The frontend must NEVER attempt to
// derive or cache full contact details, and must display whatever the backend
// returns for the current request. Do NOT add client-side time comparisons or
// any logic that guesses whether contact data should be shown.
//
// Check-in code (AC-04): The 6-digit code entered by the volunteer is
// validated server-side against a SHA-256 hash. Do not store it, log it, or
// retain it in state after a successful or failed attempt. Attempts are
// rate-limited server-side (5 per 15 minutes per IP).
//
// Do not cache full senior contact details in any client storage (localStorage,
// sessionStorage, cookies). They are visible ONLY during the server-computed
// disclosure window and ONLY via a live, authenticated backend response.
//
// Route protection here is UX only. The backend enforces real authorisation on
// every endpoint. 404 (not 403) is returned for sessions that don't belong to
// the requesting volunteer (SR-AUTHZ-02 — 403 would leak that the record exists).

import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Button, Card, CardTitle } from '@/components';
import type { SessionStatus, VolunteerSession } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<SessionStatus, { label: string; className: string }> = {
  pending_confirmation: { label: 'Awaiting confirmation', className: 'bg-amber-100 text-amber-800' },
  confirmed:           { label: 'Confirmed',              className: 'bg-primary-100 text-primary-800' },
  in_progress:         { label: 'In progress',            className: 'bg-green-100 text-green-800' },
  completed:           { label: 'Completed',              className: 'bg-cream-200 text-primary-700' },
  missed:              { label: 'Missed',                 className: 'bg-red-100 text-red-700' },
  cancelled:           { label: 'Cancelled',              className: 'bg-cream-200 text-primary-500' },
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    className: 'bg-cream-200 text-primary-700',
  };
  return (
    <span className={`inline-block shrink-0 rounded-full px-3 py-1 text-sm font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Senior info — SR-AUTHZ-03
// Renders whatever the backend returned. No client-side time logic here.
// ---------------------------------------------------------------------------

function SeniorInfoSection({ session }: { session: VolunteerSession }) {
  const { senior, jit_disclosure_active } = session;

  // Full contact is available only when the server says so AND the data is present.
  // The frontend reflects — it does not decide.
  const hasFullContact =
    jit_disclosure_active && (senior.address !== undefined || senior.phone_number !== undefined);

  if (hasFullContact) {
    const displayName = senior.full_name ?? senior.first_name ?? 'the senior';
    return (
      <div className="space-y-4">
        {/* Disclosure banner */}
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          Contact details are available because your session is starting soon.
        </div>

        <dl className="space-y-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Senior</dt>
            <dd className="mt-0.5 text-base font-semibold text-primary-900">{displayName}</dd>
          </div>

          {senior.preferred_language && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Language</dt>
              <dd className="mt-0.5 text-base text-primary-800">{senior.preferred_language}</dd>
            </div>
          )}

          {senior.address && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Address</dt>
              {/* Maps link only rendered when the backend actually provided the address. */}
              <dd className="mt-0.5">
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(senior.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base font-medium text-primary-900 underline decoration-primary-300 hover:decoration-primary-600"
                >
                  {senior.address}
                </a>
                <p className="mt-0.5 text-xs text-primary-400">Tap to open in maps</p>
              </dd>
            </div>
          )}

          {senior.phone_number && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Phone</dt>
              <dd className="mt-0.5">
                <a
                  href={`tel:${senior.phone_number}`}
                  className="text-base font-medium text-primary-900 underline decoration-primary-300 hover:decoration-primary-600"
                >
                  {senior.phone_number}
                </a>
              </dd>
            </div>
          )}

          {senior.next_of_kin_name && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Next of kin</dt>
              <dd className="mt-0.5 text-base text-primary-800">
                {senior.next_of_kin_name}
                {senior.next_of_kin_contact ? ` · ${senior.next_of_kin_contact}` : ''}
              </dd>
            </div>
          )}
        </dl>
      </div>
    );
  }

  // Outside disclosure window — limited view only.
  const displayName = senior.first_name ?? (senior.full_name?.split(' ')[0]) ?? 'the senior';
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-cream-300 bg-cream-100 px-4 py-3 text-sm text-primary-600">
        The senior's full address and contact details will become available about 2 hours before
        your session.
      </div>

      <dl className="space-y-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Senior</dt>
          <dd className="mt-0.5 text-base font-semibold text-primary-900">{displayName}</dd>
        </div>
        {senior.preferred_language && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Language</dt>
            <dd className="mt-0.5 text-base text-primary-800">{senior.preferred_language}</dd>
          </div>
        )}
        {senior.locality && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Area</dt>
            <dd className="mt-0.5 text-base text-primary-800">{senior.locality}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check-in form — shown when status === 'confirmed'
// ---------------------------------------------------------------------------

function CheckInForm({
  session,
  onSuccess,
}: {
  session: VolunteerSession;
  onSuccess: (updated: VolunteerSession) => void;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError('Please enter the full 6-digit code.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // SECURITY: code validated server-side against a hash (AC-04).
      // Do not store, log, or retain this value after this call.
      const updated = await api.checkInSession(session.id, code);
      // Clear the code from state immediately after a successful attempt.
      setCode('');
      onSuccess(updated);
    } catch (err) {
      // Always show a generic message — do not reveal whether the code was
      // wrong, expired, or the session state invalid (consistent with AC-04).
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Please wait a few minutes before trying again.');
      } else {
        setError("That code isn't valid. Please check with KakiCare staff.");
      }
      // Clear the code so the volunteer types it fresh each attempt.
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardTitle>Check in</CardTitle>
      <p className="mt-1 text-sm text-primary-600">
        Enter the 6-digit code provided by KakiCare staff to start your session.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        {/* Large, easy-to-tap input — this will typically be used on a phone
            at the senior's home. inputMode="numeric" shows the numeric keyboard
            on mobile without restricting the field to a number type. */}
        <div>
          <label htmlFor="checkin-code" className="sr-only">
            6-digit check-in code
          </label>
          <input
            id="checkin-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => {
              // Strip non-digits immediately; do not log or persist the value.
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              setError(null);
            }}
            placeholder="000000"
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'checkin-error' : undefined}
            className={`block w-full rounded-2xl border text-center font-mono text-5xl tracking-[0.4em] text-primary-950 placeholder:text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              error ? 'border-red-400 bg-red-50 py-5' : 'border-cream-300 bg-white py-5'
            }`}
          />
          {error && (
            <p id="checkin-error" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="primary"
          fullWidth
          size="lg"
          disabled={submitting || code.length !== 6}
        >
          {submitting ? 'Checking in…' : 'Check in'}
        </Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Check-out form — shown when status === 'in_progress'
// ---------------------------------------------------------------------------

function CheckOutForm({
  session,
  onSuccess,
}: {
  session: VolunteerSession;
  onSuccess: (updated: VolunteerSession) => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const updated = await api.checkOutSession(session.id, note.trim() || undefined);
      onSuccess(updated);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 400
          ? 'This session cannot be checked out right now. Please contact staff if this continues.'
          : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardTitle>Check out</CardTitle>
      <p className="mt-1 text-sm text-primary-600">
        End your session and optionally leave a note for KakiCare staff.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
        <div>
          <label htmlFor="checkout-note" className="block text-sm font-medium text-primary-800">
            Note <span className="font-normal text-primary-400">(optional)</span>
          </label>
          <textarea
            id="checkout-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="How did the visit go? Anything staff should know?"
            disabled={submitting}
            className="mt-1 block w-full resize-none rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-base text-primary-950 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p className="mt-1 text-right text-xs text-primary-400">{note.length}/500</p>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          size="lg"
          disabled={submitting}
        >
          {submitting ? 'Checking out…' : 'Complete session'}
        </Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const numericId = Number(id);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<VolunteerSession | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSession(numericId);
      setSession(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError('Could not load session details. Please try again.');
      }
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
    void loadSession();
  }, [numericId, loadSession]);

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading) return <Spinner />;

  if (notFound) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Session not found</h1>
        <Card>
          <p className="text-sm text-primary-600">
            We couldn't find that session. It may have been cancelled, or it might not belong to
            your account.
          </p>
          <div className="mt-3">
            <Link to="/volunteer">
              <Button variant="secondary" size="sm">Back to dashboard</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Session details</h1>
        <Card>
          <p className="text-sm text-red-600">{error ?? 'Something went wrong.'}</p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => void loadSession()}>
              Try again
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const seniorDisplayName =
    session.senior.first_name ??
    (session.senior.full_name?.split(' ')[0]) ??
    'Senior';

  const sessionTypeLabel = session.session_type === 'visit' ? 'Visit' : 'Call';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link
          to="/volunteer"
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary-500 hover:text-primary-700"
        >
          ← Back to dashboard
        </Link>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-serif text-2xl font-semibold text-primary-900">
            {sessionTypeLabel} with {seniorDisplayName}
          </h1>
          <StatusBadge status={session.status} />
        </div>
      </div>

      {/* Session time */}
      <Card>
        <CardTitle>Session time</CardTitle>
        <div className="mt-2 space-y-1">
          <p className="text-base text-primary-900">{formatDateTime(session.scheduled_start)}</p>
          <p className="text-sm text-primary-600">
            {formatTime(session.scheduled_start)} – {formatTime(session.scheduled_end)}
          </p>
        </div>
        {session.checkin_at && (
          <p className="mt-3 text-sm text-primary-500">
            Checked in at {formatTime(session.checkin_at)}
          </p>
        )}
        {session.checkout_at && (
          <p className="text-sm text-primary-500">
            Checked out at {formatTime(session.checkout_at)}
          </p>
        )}
      </Card>

      {/* Senior contact — SR-AUTHZ-03 (see file-level security note) */}
      <Card>
        <CardTitle>About {seniorDisplayName}</CardTitle>
        <div className="mt-3">
          <SeniorInfoSection session={session} />
        </div>
      </Card>

      {/* Volunteer note (completed sessions) */}
      {session.status === 'completed' && session.volunteer_note && (
        <Card>
          <CardTitle>Your note</CardTitle>
          <p className="mt-2 whitespace-pre-wrap text-sm text-primary-800">
            {session.volunteer_note}
          </p>
        </Card>
      )}

      {/* Pending confirmation */}
      {session.status === 'pending_confirmation' && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">Awaiting staff confirmation</p>
          <p className="mt-1 text-sm text-amber-700">
            KakiCare staff will review and confirm your session. You'll receive the check-in code
            once confirmed.
          </p>
        </Card>
      )}

      {/* Check-in (confirmed sessions) */}
      {session.status === 'confirmed' && (
        <CheckInForm session={session} onSuccess={(updated) => setSession(updated)} />
      )}

      {/* Check-out (in-progress sessions) */}
      {session.status === 'in_progress' && (
        <CheckOutForm session={session} onSuccess={(updated) => setSession(updated)} />
      )}

      {/* Missed session */}
      {session.status === 'missed' && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm font-medium text-red-800">Session marked as missed</p>
          <p className="mt-1 text-sm text-red-700">
            This session was not completed. KakiCare staff will follow up with the senior.
            Please contact us if you have any concerns.
          </p>
        </Card>
      )}

      {/* Cancelled session */}
      {session.status === 'cancelled' && (
        <Card className="border-cream-300 bg-cream-100">
          <p className="text-sm font-medium text-primary-700">Session cancelled</p>
          <p className="mt-1 text-sm text-primary-500">
            This session has been cancelled. Contact KakiCare staff for more details.
          </p>
        </Card>
      )}
    </div>
  );
}
