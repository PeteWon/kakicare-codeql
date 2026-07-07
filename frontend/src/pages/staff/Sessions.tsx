// SECURITY NOTES:
// - Staff-only page. ProtectedRoute is a UX guard only — backend enforces
//   authorisation on every request. Handle 401/403 defensively.
//
// AC-04 (check-in code — single-use, never persisted client-side):
//   When a staff member confirms a session, the backend generates a 6-digit
//   code and returns it ONCE in the response body. Only the SHA-256 hash is
//   stored server-side — the raw code is gone after that response. This page
//   holds the code in React state ONLY for the duration of the modal; it is
//   NEVER written to localStorage, sessionStorage, a ref, or any store that
//   outlives the modal. Dismissing the modal sets the state to null — the
//   code is gone and CANNOT be retrieved from the UI or re-fetched.
//
//   Relay path: staff (this UI) → senior (phone call) → volunteer (in person).
//   The volunteer does NOT see the code in advance; they receive it from the
//   senior when they arrive. This out-of-band relay is what makes check-in a
//   proof-of-presence control.
//
// WELFARE CONCERN (missed sessions):
//   A missed session means a vulnerable senior was not visited or contacted
//   as expected. Every missed session requires a follow-up outcome to be
//   recorded (senior_well | rescheduled | escalated). This page highlights
//   missed sessions with a red visual treatment and surfaces the follow-up
//   action prominently so welfare concerns are not overlooked.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  FollowUpOutcome,
  Paginated,
  SessionStatus,
  StaffSession,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STATUS_FILTERS: {
  value: SessionStatus | '';
  label: string;
  urgent?: boolean;
}[] = [
  { value: 'pending_confirmation', label: 'Needs confirmation' },
  { value: 'missed', label: 'Missed', urgent: true },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: '', label: 'All' },
];

const STATUS_BADGE: Record<string, string> = {
  pending_confirmation: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-green-100 text-green-800',
  completed: 'bg-primary-100 text-primary-700',
  missed: 'bg-red-100 text-red-800',
  cancelled: 'bg-cream-200 text-primary-500',
};

const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: 'Needs confirmation',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

const FOLLOWUP_OPTIONS: { value: FollowUpOutcome; label: string }[] = [
  { value: 'senior_well', label: 'Senior is well' },
  { value: 'rescheduled', label: 'Session rescheduled' },
  { value: 'escalated', label: 'Welfare concern escalated' },
];

const TABLE_COLS = [
  'Type',
  'Volunteer',
  'Senior',
  'Scheduled',
  'Status',
  'Follow-up',
  'Actions',
] as const;

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

function canCancel(s: SessionStatus): boolean {
  return s === 'pending_confirmation' || s === 'confirmed';
}

// ---------------------------------------------------------------------------
// Check-in code modal (AC-04)
//
// The raw code lives ONLY in this component's props for the duration it is
// mounted. No copy is made elsewhere. onDismiss sets the parent state to null,
// dropping the last reference to the code. There is no "show again" path.
// ---------------------------------------------------------------------------

function CheckinCodeModal({
  session,
  code,
  onDismiss,
}: {
  session: StaffSession;
  code: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkin-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="border-b border-cream-200 px-6 py-4">
          <h2
            id="checkin-modal-title"
            className="font-serif text-xl font-semibold text-primary-900"
          >
            Session confirmed — check-in code
          </h2>
          <p className="mt-0.5 text-sm text-primary-500">
            {session.senior.full_name}
            {' · '}
            {session.volunteer.full_name}
          </p>
        </div>

        {/* Code */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-primary-700">
            Call the senior at{' '}
            <strong>{session.senior.phone_number}</strong> and read them this
            code. They will give it to the volunteer in person when the volunteer
            arrives — do not share it with the volunteer directly.
          </p>

          <div className="rounded-xl bg-primary-50 py-5 text-center">
            <p
              aria-label={`Check-in code: ${code.split('').join(' ')}`}
              className="font-mono text-5xl font-bold tracking-[0.4em] text-primary-900 select-all"
            >
              {code}
            </p>
          </div>

          {/* One-time warning */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">
              This code will not be shown again.
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Note it down before dismissing. The raw code is not stored
              anywhere — only its hash is kept server-side (AC-04). Once this
              modal is closed the code cannot be retrieved.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-cream-200 px-6 py-4">
          <button
            onClick={onDismiss}
            className="w-full rounded-xl bg-primary-500 py-2.5 text-sm font-medium text-white hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            I have noted the code — dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status filter tabs (presentational)
// ---------------------------------------------------------------------------

function StatusFilterTabs({
  value,
  onSelect,
}: {
  value: SessionStatus | '';
  onSelect: (s: SessionStatus | '') => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_FILTERS.map((f) => {
        const active = value === f.value;
        return (
          <button
            key={f.value}
            onClick={() => onSelect(f.value as SessionStatus | '')}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-colors ${
              active
                ? f.urgent
                  ? 'bg-red-600 text-white'
                  : 'bg-primary-500 text-white'
                : f.urgent
                  ? 'border border-red-200 bg-white text-red-600 hover:bg-red-50'
                  : 'border border-cream-300 bg-white text-primary-600 hover:bg-primary-50'
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded-row forms (presentational; all state lives in the parent)
// ---------------------------------------------------------------------------

function ConfirmDialogRow({
  session,
  colSpan,
  onConfirm,
  onBack,
}: {
  session: StaffSession;
  colSpan: number;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-primary-50 px-4 py-3">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-primary-900">
              Confirm this session?
            </p>
            <p className="mt-1 text-xs text-primary-600">
              Confirming will generate a single-use 6-digit check-in code. You
              must call the senior (<strong>{session.senior.phone_number}</strong>
              ) and give them this code — they will pass it to the volunteer in
              person at the session. The code is shown once and cannot be
              retrieved again (AC-04).
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onConfirm}
              className="rounded-xl bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600"
            >
              Yes, confirm &amp; get code
            </button>
            <button
              onClick={onBack}
              className="rounded-xl border border-primary-200 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50"
            >
              Back
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function CancelFormRow({
  colSpan,
  reason,
  fieldError,
  onReasonChange,
  onSubmit,
  onClose,
}: {
  colSpan: number;
  reason: string;
  fieldError: string;
  onReasonChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-red-50 px-4 py-3">
        <div className="space-y-2">
          <p className="text-sm font-medium text-red-800">
            Cancel this session — enter a reason:
          </p>
          <textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={2}
            placeholder="Reason for cancellation (required)"
            className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 ${
              fieldError ? 'border-red-400' : 'border-red-200'
            }`}
          />
          {fieldError && <p className="text-xs text-red-700">{fieldError}</p>}
          <div className="flex gap-2">
            <button
              onClick={onSubmit}
              className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Cancel session
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function FollowupFormRow({
  session,
  colSpan,
  outcome,
  note,
  fieldError,
  onOutcomeChange,
  onNoteChange,
  onSubmit,
  onClose,
}: {
  session: StaffSession;
  colSpan: number;
  outcome: FollowUpOutcome | '';
  note: string;
  fieldError: string;
  onOutcomeChange: (v: FollowUpOutcome | '') => void;
  onNoteChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-red-50 px-4 py-3">
        {/* WELFARE NOTE: record what happened after a missed session
            involving a vulnerable senior (AC-WF). */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-red-800">
            Record welfare follow-up for {session.senior.full_name}:
          </p>
          <select
            value={outcome}
            onChange={(e) => onOutcomeChange(e.target.value as FollowUpOutcome | '')}
            className={`rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 ${
              fieldError ? 'border-red-400' : 'border-red-200'
            }`}
          >
            <option value="">Select outcome…</option>
            {FOLLOWUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldError && <p className="text-xs text-red-700">{fieldError}</p>}
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={2}
            placeholder="Additional notes (optional)"
            className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <div className="flex gap-2">
            <button
              onClick={onSubmit}
              className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Save follow-up
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Sessions() {
  usePageTitle('Sessions');
  const [searchParams, setSearchParams] = useSearchParams();
  // "All" is represented in the URL by an explicit `status=all` sentinel, NOT by
  // an absent param. An absent param means "no choice made yet" and falls back
  // to the default view (pending_confirmation). Without the sentinel, clicking
  // "All" would clear the param and immediately snap back to the default.
  const rawStatus = searchParams.get('status');
  const statusFilter: SessionStatus | '' =
    rawStatus === null
      ? 'pending_confirmation'
      : rawStatus === 'all'
        ? ''
        : (rawStatus as SessionStatus);
  const currentPage = Number(searchParams.get('page') ?? '1');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Paginated<StaffSession> | null>(null);

  // Per-row expand/action state — at most one row open at a time.
  const [confirmDialogId, setConfirmDialogId] = useState<number | null>(null);
  const [cancelFormId, setCancelFormId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelFieldError, setCancelFieldError] = useState('');
  const [followupFormId, setFollowupFormId] = useState<number | null>(null);
  const [followupOutcome, setFollowupOutcome] = useState<FollowUpOutcome | ''>('');
  const [followupNote, setFollowupNote] = useState('');
  const [followupFieldError, setFollowupFieldError] = useState('');
  const [loadingActionId, setLoadingActionId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  // AC-04: the check-in code lives ONLY in this state, ONLY while the modal is
  // open. Setting this to null (on dismiss) is the only code path — there is no
  // "retrieve again" action anywhere in this component.
  const [checkinModal, setCheckinModal] = useState<{
    session: StaffSession;
    code: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getStaffSessions({
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
        setError('Could not load sessions. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, currentPage]);

  useEffect(() => {
    void load();
  }, [load]);

  function setStatus(s: SessionStatus | '') {
    // Empty string is the "All" tab → persist it as the `all` sentinel so it
    // survives a re-render (see rawStatus handling above).
    setSearchParams(s ? { status: s } : { status: 'all' });
    setConfirmDialogId(null);
    setCancelFormId(null);
    setFollowupFormId(null);
    setRowError(null);
  }

  function setPage(p: number) {
    const params: Record<string, string> = { page: String(p) };
    // Preserve the current tab across pagination, including "All".
    params.status = statusFilter || 'all';
    setSearchParams(params);
  }

  function openCancelForm(id: number) {
    setConfirmDialogId(null);
    setFollowupFormId(null);
    setCancelFormId(id);
    setCancelReason('');
    setCancelFieldError('');
  }

  function openFollowupForm(id: number) {
    setConfirmDialogId(null);
    setCancelFormId(null);
    setFollowupFormId(id);
    setFollowupOutcome('');
    setFollowupNote('');
    setFollowupFieldError('');
  }

  function openConfirmDialog(id: number) {
    setCancelFormId(null);
    setFollowupFormId(null);
    setConfirmDialogId(id);
  }

  // ---- Action handlers ----

  async function handleConfirm(session: StaffSession) {
    setLoadingActionId(session.id);
    setRowError(null);
    setConfirmDialogId(null);
    try {
      const data = await api.confirmSession(session.id);
      // AC-04: data.checkin_code is the raw code — show it in the modal now.
      // This is the only place this value ever lands; no copy is made.
      setCheckinModal({ session, code: data.checkin_code });
      void load();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 400
          ? ((err.body as { detail?: string })?.detail ?? 'Cannot confirm this session.')
          : 'Confirmation failed. Please try again.';
      setRowError({ id: session.id, message: msg });
    } finally {
      setLoadingActionId(null);
    }
  }

  async function handleCancel(sessionId: number) {
    if (!cancelReason.trim()) {
      setCancelFieldError('A reason is required.');
      return;
    }
    setLoadingActionId(sessionId);
    setCancelFieldError('');
    setRowError(null);
    try {
      await api.cancelSession(sessionId, cancelReason.trim());
      setCancelFormId(null);
      setCancelReason('');
      void load();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 400
          ? ((err.body as { detail?: string })?.detail ?? 'Cannot cancel this session.')
          : 'Cancellation failed. Please try again.';
      setRowError({ id: sessionId, message: msg });
      setCancelFormId(null);
    } finally {
      setLoadingActionId(null);
    }
  }

  async function handleFollowup(sessionId: number) {
    if (!followupOutcome) {
      setFollowupFieldError('Please select an outcome.');
      return;
    }
    setLoadingActionId(sessionId);
    setFollowupFieldError('');
    setRowError(null);
    try {
      await api.recordSessionFollowup(
        sessionId,
        followupOutcome as FollowUpOutcome,
        followupNote.trim(),
      );
      setFollowupFormId(null);
      setFollowupOutcome('');
      setFollowupNote('');
      void load();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 400
          ? ((err.body as { detail?: string })?.detail ?? 'Cannot record follow-up.')
          : 'Follow-up failed. Please try again.';
      setRowError({ id: sessionId, message: msg });
      setFollowupFormId(null);
    } finally {
      setLoadingActionId(null);
    }
  }

  // ---- Inline action buttons (no JSX return type annotation needed) ----

  function renderActions(session: StaffSession) {
    if (loadingActionId === session.id) {
      return (
        <span className="flex items-center gap-1.5 text-primary-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-100 border-t-primary-500" />
          Processing…
        </span>
      );
    }

    const visible: boolean =
      session.status === 'pending_confirmation' ||
      canCancel(session.status) ||
      (session.status === 'missed' && !session.followup_outcome);

    if (!visible) return <span className="text-primary-300">—</span>;

    return (
      <div className="flex flex-wrap gap-2">
        {session.status === 'pending_confirmation' &&
          confirmDialogId !== session.id && (
            <button
              onClick={() => openConfirmDialog(session.id)}
              className="rounded-xl bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600"
            >
              Confirm
            </button>
          )}

        {canCancel(session.status) && cancelFormId !== session.id && (
          <button
            onClick={() => openCancelForm(session.id)}
            className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Cancel
          </button>
        )}

        {session.status === 'missed' &&
          !session.followup_outcome &&
          followupFormId !== session.id && (
            <button
              onClick={() => openFollowupForm(session.id)}
              className="rounded-xl border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              Record follow-up
            </button>
          )}
      </div>
    );
  }

  const COL_SPAN = TABLE_COLS.length;

  // ---- Render ----

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-primary-900">
        Sessions
      </h1>

      {/* ---- Status filter tabs ---- */}
      <StatusFilterTabs value={statusFilter} onSelect={setStatus} />

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
          {/* Missed-sessions banner — welfare alert */}
          {statusFilter !== 'missed' &&
            result.results.some((s) => s.status === 'missed') && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3">
                <p className="text-sm font-medium text-red-800">
                  This list includes missed sessions — welfare follow-up is
                  required for each one.
                </p>
              </div>
            )}

          <div className="overflow-x-auto rounded-2xl border border-cream-300 bg-white shadow-sm">
            {result.results.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-primary-500">
                No{' '}
                {statusFilter
                  ? STATUS_LABEL[statusFilter]?.toLowerCase() + ' '
                  : ''}
                sessions found.
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
                  {result.results.map((session) => (
                    <Fragment key={session.id}>
                      {/* Main data row */}
                      <tr
                        className={
                          session.status === 'missed'
                            ? 'bg-red-50 hover:bg-red-100'
                            : 'hover:bg-cream-50'
                        }
                      >
                        {/* Type */}
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="capitalize text-sm text-primary-700">
                            {session.session_type}
                          </span>
                        </td>

                        {/* Volunteer */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-primary-900">
                            {session.volunteer.full_name}
                          </p>
                          <p className="text-xs text-primary-400">
                            {session.volunteer.email}
                          </p>
                        </td>

                        {/* Senior */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-primary-900">
                            {session.senior.full_name}
                          </p>
                          <p className="text-xs text-primary-400">
                            {session.senior.preferred_language}
                          </p>
                        </td>

                        {/* Scheduled */}
                        <td className="whitespace-nowrap px-4 py-3">
                          <p className="text-sm text-primary-700">
                            {formatDate(session.scheduled_start)}
                          </p>
                          <p className="text-xs text-primary-400">
                            {formatTime(session.scheduled_start)} –{' '}
                            {formatTime(session.scheduled_end)}
                          </p>
                        </td>

                        {/* Status */}
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              STATUS_BADGE[session.status] ??
                              'bg-cream-100 text-primary-600'
                            }`}
                          >
                            {STATUS_LABEL[session.status] ?? session.status}
                          </span>
                        </td>

                        {/* Follow-up outcome */}
                        <td className="px-4 py-3 text-xs">
                          {session.followup_outcome ? (
                            <span className="text-primary-700">
                              {FOLLOWUP_OPTIONS.find(
                                (o) => o.value === session.followup_outcome,
                              )?.label ?? session.followup_outcome}
                            </span>
                          ) : session.status === 'missed' ? (
                            <span className="font-medium text-red-600">
                              Pending
                            </span>
                          ) : (
                            <span className="text-primary-300">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          {renderActions(session)}
                        </td>
                      </tr>

                      {/* Per-row error */}
                      {rowError?.id === session.id && (
                        <tr>
                          <td
                            colSpan={COL_SPAN}
                            className="bg-red-50 px-4 py-2 text-xs text-red-700"
                          >
                            {rowError.message}
                          </td>
                        </tr>
                      )}

                      {/* Confirm dialog */}
                      {confirmDialogId === session.id && (
                        <ConfirmDialogRow
                          session={session}
                          colSpan={COL_SPAN}
                          onConfirm={() => void handleConfirm(session)}
                          onBack={() => setConfirmDialogId(null)}
                        />
                      )}

                      {/* Cancel form */}
                      {cancelFormId === session.id && (
                        <CancelFormRow
                          colSpan={COL_SPAN}
                          reason={cancelReason}
                          fieldError={cancelFieldError}
                          onReasonChange={setCancelReason}
                          onSubmit={() => void handleCancel(session.id)}
                          onClose={() => {
                            setCancelFormId(null);
                            setCancelReason('');
                            setCancelFieldError('');
                          }}
                        />
                      )}

                      {/* Follow-up form (welfare concern — missed session) */}
                      {followupFormId === session.id && (
                        <FollowupFormRow
                          session={session}
                          colSpan={COL_SPAN}
                          outcome={followupOutcome}
                          note={followupNote}
                          fieldError={followupFieldError}
                          onOutcomeChange={setFollowupOutcome}
                          onNoteChange={setFollowupNote}
                          onSubmit={() => void handleFollowup(session.id)}
                          onClose={() => {
                            setFollowupFormId(null);
                            setFollowupOutcome('');
                            setFollowupNote('');
                            setFollowupFieldError('');
                          }}
                        />
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {(result.previous || result.next) && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-primary-500">
                {result.count} session{result.count !== 1 ? 's' : ''}
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

      {/* AC-04: Check-in code modal.
          The code is held ONLY in checkinModal state while the modal is rendered.
          onDismiss sets checkinModal to null — no other reference exists.
          There is no "re-show" or "copy to clipboard" action that persists the value. */}
      {checkinModal && (
        <CheckinCodeModal
          session={checkinModal.session}
          code={checkinModal.code}
          onDismiss={() => setCheckinModal(null)}
        />
      )}
    </div>
  );
}
