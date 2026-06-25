// SECURITY NOTE: Route protection here is UX only. The backend enforces real
// authorisation on every API endpoint. The backend also rejects bookings for
// non-active matches and rejects time ranges that overlap any of the same
// volunteer's existing sessions (SR-AUTHZ-02). Overlap errors come back as a
// 400 with non_field_errors; the handler below surfaces them to the user.
// Client-side validation below is for usability only.

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import { Button, Card } from '@/components';
import type { VolunteerMatch } from '@/lib/types';

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

/** Convert a date string (YYYY-MM-DD) and time string (HH:MM) to an ISO-8601
 *  UTC string, using the browser's local timezone — appropriate since the
 *  volunteer's phone will typically be in SGT (UTC+8). */
function localToISO(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BookSession() {
  usePageTitle('Book a session');
  const { matchId } = useParams<{ matchId: string }>();
  const numericMatchId = Number(matchId);

  // Match context (loaded to show senior name)
  const [match, setMatch] = useState<VolunteerMatch | null>(null);
  const [matchLoading, setMatchLoading] = useState(true);
  const [matchError, setMatchError] = useState<string | null>(null);

  // Form fields
  const [sessionType, setSessionType] = useState<'visit' | 'call'>('visit');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // Submission state
  const [fieldErrors, setFieldErrors] = useState<{
    date?: string;
    startTime?: string;
    endTime?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    if (isNaN(numericMatchId)) {
      setMatchError('Invalid match.');
      setMatchLoading(false);
      return;
    }
    async function loadMatch() {
      try {
        const data = await api.getVolunteerMatches();
        const found = data.results.find(
          (m) => m.id === numericMatchId && m.status === 'active',
        );
        if (!found) {
          setMatchError('Match not found or is no longer active.');
        } else {
          setMatch(found);
        }
      } catch {
        setMatchError('Could not load match details. Please go back and try again.');
      } finally {
        setMatchLoading(false);
      }
    }
    void loadMatch();
  }, [numericMatchId]);

  // Client-side validation — usability only. The backend is authoritative:
  // it also rejects past starts, end-before-start, session overlaps, and
  // non-active matches (SR-AUTHZ-02).
  function validate(): boolean {
    const errors: typeof fieldErrors = {};

    if (!date) errors.date = 'Please choose a date.';
    if (!startTime) errors.startTime = 'Please choose a start time.';
    if (!endTime) errors.endTime = 'Please choose an end time.';

    if (date && startTime && new Date(`${date}T${startTime}`) <= new Date()) {
      errors.startTime = 'Start time must be in the future.';
    }
    if (date && startTime && endTime) {
      if (new Date(`${date}T${endTime}`) <= new Date(`${date}T${startTime}`)) {
        errors.endTime = 'End time must be after start time.';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api.bookSession(
        numericMatchId,
        sessionType,
        localToISO(date, startTime),
        localToISO(date, endTime),
      );
      setBooked(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setSubmitError(
            'This match is not active. Please contact KakiCare staff if you believe this is a mistake.',
          );
        } else if (err.status === 400 && err.body && typeof err.body === 'object') {
          const body = err.body as Record<string, unknown>;
          const detail = body.detail as string | undefined;
          const nonField = body.non_field_errors as string[] | undefined;
          if (detail) setSubmitError(detail);
          else if (nonField?.length) setSubmitError(nonField[0]);
          else setSubmitError('Please check the times you entered and try again.');
        } else {
          setSubmitError('Something went wrong. Please try again.');
        }
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (matchLoading) return <Spinner />;

  if (matchError || !match) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Book a session</h1>
        <Card>
          <p className="text-sm text-red-600">{matchError ?? 'Match not found.'}</p>
          <div className="mt-3">
            <Link to="/volunteer/matches">
              <Button variant="secondary" size="sm">Back to matches</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (booked) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Session requested</h1>
        <Card className="border-primary-200 bg-primary-50">
          <p className="font-semibold text-primary-900">
            Session requested — pending confirmation by KakiCare staff
          </p>
          <p className="mt-2 text-sm text-primary-700">
            Our team will review your request and contact{' '}
            <span className="font-medium">{match.senior.first_name}</span> to confirm
            the session. You'll see it on your dashboard once it's confirmed.
          </p>
          <p className="mt-2 text-sm text-primary-600">
            The senior's full address and contact details will become available about
            2 hours before your session.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/volunteer">
              <Button variant="primary" size="sm">Go to dashboard</Button>
            </Link>
            <Link to="/volunteer/matches">
              <Button variant="secondary" size="sm">Back to matches</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const inputBase =
    'mt-1 block w-full h-11 rounded-xl border bg-white px-3 text-base text-primary-950 ' +
    'focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/volunteer/matches"
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary-500 hover:text-primary-700"
        >
          ← Back to matches
        </Link>
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Book a session</h1>
        <p className="mt-1 text-sm text-primary-600">
          With{' '}
          <span className="font-medium text-primary-800">{match.senior.first_name}</span>
          {match.senior.locality ? ` · ${match.senior.locality}` : ''}
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Session type */}
          <fieldset>
            <legend className="text-sm font-medium text-primary-800">Session type</legend>
            <div className="mt-2 flex gap-6">
              {(['visit', 'call'] as const).map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="session_type"
                    value={t}
                    checked={sessionType === t}
                    onChange={() => setSessionType(t)}
                    className="h-4 w-4 accent-primary-500"
                  />
                  <span className="text-sm capitalize text-primary-800">{t}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Date */}
          <div>
            <label
              htmlFor="session-date"
              className="block text-sm font-medium text-primary-800"
            >
              Date
            </label>
            <input
              id="session-date"
              type="date"
              value={date}
              min={todayISO()}
              onChange={(e) => {
                setDate(e.target.value);
                setFieldErrors((p) => ({ ...p, date: undefined }));
              }}
              className={`${inputBase} ${
                fieldErrors.date ? 'border-red-400' : 'border-cream-300'
              }`}
              aria-invalid={fieldErrors.date ? true : undefined}
              aria-describedby={fieldErrors.date ? 'date-error' : undefined}
            />
            {fieldErrors.date && (
              <p id="date-error" className="mt-1 text-sm text-red-600">
                {fieldErrors.date}
              </p>
            )}
          </div>

          {/* Start + end time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="start-time"
                className="block text-sm font-medium text-primary-800"
              >
                Start time
              </label>
              <input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setFieldErrors((p) => ({ ...p, startTime: undefined }));
                }}
                className={`${inputBase} ${
                  fieldErrors.startTime ? 'border-red-400' : 'border-cream-300'
                }`}
                aria-invalid={fieldErrors.startTime ? true : undefined}
                aria-describedby={fieldErrors.startTime ? 'start-error' : undefined}
              />
              {fieldErrors.startTime && (
                <p id="start-error" className="mt-1 text-sm text-red-600">
                  {fieldErrors.startTime}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="end-time"
                className="block text-sm font-medium text-primary-800"
              >
                End time
              </label>
              <input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  setFieldErrors((p) => ({ ...p, endTime: undefined }));
                }}
                className={`${inputBase} ${
                  fieldErrors.endTime ? 'border-red-400' : 'border-cream-300'
                }`}
                aria-invalid={fieldErrors.endTime ? true : undefined}
                aria-describedby={fieldErrors.endTime ? 'end-error' : undefined}
              />
              {fieldErrors.endTime && (
                <p id="end-error" className="mt-1 text-sm text-red-600">
                  {fieldErrors.endTime}
                </p>
              )}
            </div>
          </div>

          {submitError && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <Button type="submit" variant="primary" fullWidth disabled={submitting}>
            {submitting ? 'Requesting…' : 'Request session'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
