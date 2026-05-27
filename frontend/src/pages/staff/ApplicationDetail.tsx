// SECURITY NOTES — read before touching this file:
//
// STAFF-ONLY PAGE: All data fetched here (including internal_review_note) is
// staff-only. Never route a volunteer to this page or include this data in any
// volunteer-facing context. The backend enforces this via distinct serializer
// classes; the frontend must not create any path that leaks internal_review_note
// to the volunteer's own profile view or notification flow.
//
// SR-DATA-03 (Document access): Uploaded documents are served only via the
// authenticated endpoint /api/volunteer/documents/<id>/download. They must
// NEVER be embedded as public <img src> or bare <a href> without credentials.
// The document preview below fetches a blob with session-cookie credentials,
// creates a temporary object URL, and revokes it on cleanup to prevent memory
// leaks and to avoid caching the document in any persistent browser store.
//
// SR-AUTHZ-01: Staff-only access is enforced server-side on every endpoint.
// The ProtectedRoute here is a UX convenience only.

import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { ApplicationStatus, DocumentInfo, StaffApplicationDetail } from '@/lib/types';

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

const STATUS_BADGE: Record<ApplicationStatus, string> = {
  pending_review:    'bg-amber-100 text-amber-800',
  approved:         'bg-green-100 text-green-800',
  rejected:         'bg-red-100 text-red-700',
  changes_requested:'bg-orange-100 text-orange-800',
  incomplete:       'bg-cream-200 text-primary-600',
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending_review:    'Pending review',
  approved:         'Approved',
  rejected:         'Rejected',
  changes_requested:'Changes requested',
  incomplete:       'Incomplete',
};

// ---------------------------------------------------------------------------
// Document card — handles auth fetch + optional image preview
// ---------------------------------------------------------------------------

// SR-DATA-03: The blob is fetched via authenticated credentials.
// The object URL is revoked on cleanup — it is never persisted in localStorage,
// sessionStorage, or any other long-lived store.
function DocumentCard({ doc }: { doc: DocumentInfo }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // For images only: auto-fetch a preview blob on mount.
  // SR-DATA-03: never use doc.download_url as a plain <img src> — it requires auth.
  useEffect(() => {
    if (!doc.content_type.startsWith('image/')) return;
    let cancelled = false;
    setPreviewLoading(true);
    api
      .downloadDocumentBlob(doc.download_url)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      // Revoke the object URL on cleanup to release memory and prevent caching.
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [doc.download_url, doc.content_type]);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await api.downloadDocumentBlob(doc.download_url);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_filename || `document_${doc.id}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke immediately — this is a download trigger, not a persistent URL.
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  const docTypeLabel =
    doc.document_type === 'identity' ? 'Identity document' : 'Declaration form';

  return (
    <div className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-sm">
      {/* Image preview (only for JPEG / PNG) */}
      {doc.content_type.startsWith('image/') && (
        <div className="border-b border-cream-200 bg-cream-50 flex items-center justify-center min-h-[160px]">
          {previewLoading && (
            <span
              role="status"
              aria-label="Loading preview…"
              className="h-8 w-8 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
            />
          )}
          {previewError && (
            <p className="text-xs text-primary-400 px-4 py-6">Preview unavailable.</p>
          )}
          {previewUrl && !previewLoading && (
            <img
              src={previewUrl}
              alt={`Preview of ${doc.original_filename}`}
              className="max-h-64 w-full object-contain"
            />
          )}
        </div>
      )}

      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-400">
          {docTypeLabel}
        </p>
        <p className="mt-0.5 text-sm font-medium text-primary-900 truncate">
          {doc.original_filename || `document_${doc.id}`}
        </p>
        <p className="text-xs text-primary-400">
          {doc.content_type} · Uploaded {formatDateTime(doc.uploaded_at)}
        </p>

        {downloadError && (
          <p className="mt-2 text-xs text-red-600">{downloadError}</p>
        )}

        <button
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="mt-3 inline-flex items-center gap-1 rounded-xl border border-cream-300 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-cream-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {downloading ? 'Downloading…' : 'Download'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decision panel
// ---------------------------------------------------------------------------

const DECISION_OPTIONS: {
  value: 'approve' | 'reject' | 'request_changes';
  label: string;
  description: string;
}[] = [
  {
    value: 'approve',
    label: 'Approve',
    description: 'Activate the volunteer account and notify the applicant.',
  },
  {
    value: 'request_changes',
    label: 'Request changes',
    description: 'Ask the volunteer to update their profile or documents.',
  },
  {
    value: 'reject',
    label: 'Reject',
    description: 'Decline the application and notify the applicant.',
  },
];

function DecisionPanel({
  applicationId,
  currentStatus,
  onDecision,
}: {
  applicationId: number;
  currentStatus: ApplicationStatus;
  onDecision: (updated: StaffApplicationDetail) => void;
}) {
  const [decision, setDecision] = useState<
    'approve' | 'reject' | 'request_changes' | null
  >(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Terminal statuses — no further decision possible.
  if (currentStatus === 'approved') {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
        <p className="text-sm font-medium text-green-800">Application approved</p>
        <p className="mt-1 text-sm text-green-700">
          This volunteer has been approved and notified.
        </p>
      </div>
    );
  }
  if (currentStatus === 'rejected') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-medium text-red-800">Application rejected</p>
        <p className="mt-1 text-sm text-red-700">
          This application was rejected. The volunteer was notified.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!decision) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const updated = await api.submitApplicationDecision(applicationId, decision, note);
      onDecision(updated);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? 'Application not found.'
          : 'Something went wrong. Please try again.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-primary-200 bg-primary-50 p-5">
      <h2 className="text-base font-semibold text-primary-900">Record a decision</h2>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
        {/* Decision radio group */}
        <fieldset>
          <legend className="sr-only">Decision</legend>
          <div className="space-y-2">
            {DECISION_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                  decision === opt.value
                    ? 'border-primary-400 bg-white'
                    : 'border-cream-300 bg-white hover:border-primary-300'
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value={opt.value}
                  checked={decision === opt.value}
                  onChange={() => setDecision(opt.value)}
                  className="mt-0.5 h-4 w-4 accent-primary-500"
                />
                <div>
                  <p className="text-sm font-medium text-primary-900">{opt.label}</p>
                  <p className="text-xs text-primary-500">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Internal review note
            SECURITY: this note is stored as internal_review_note on the profile
            and must NEVER appear in volunteer-facing responses or notifications.
            The backend enforces this; we surface it here for staff reference only. */}
        <div>
          <label
            htmlFor="review-note"
            className="block text-sm font-medium text-primary-800"
          >
            Internal review note{' '}
            <span className="font-normal text-primary-400">(staff only — not sent to applicant)</span>
          </label>
          <textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Reasoning, concerns, or context for this decision…"
            className="mt-1 block w-full resize-none rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-sm text-primary-950 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
            disabled={submitting}
          />
          <p className="mt-1 text-right text-xs text-primary-400">{note.length}/2000</p>
        </div>

        {submitError && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={!decision || submitting}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary-500 px-5 text-base font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Saving…' : `Record decision${decision ? ` — ${decision.replace('_', ' ')}` : ''}`}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Availability display
// ---------------------------------------------------------------------------

function AvailabilityGrid({ availability }: { availability: Record<string, string[]> }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const blocks = ['Morning', 'Afternoon', 'Evening'];
  if (Object.keys(availability).length === 0) {
    return <p className="text-sm text-primary-400">Not specified</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th className="pr-3 text-left text-xs font-medium text-primary-400" />
            {blocks.map((b) => (
              <th key={b} className="px-3 text-center text-xs font-medium text-primary-400">
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day}>
              <td className="pr-3 py-1 text-xs font-medium text-primary-600">{day}</td>
              {blocks.map((block) => (
                <td key={block} className="px-3 py-1 text-center">
                  {availability[day]?.includes(block) ? (
                    <span className="inline-block h-4 w-4 rounded-sm bg-primary-400" aria-label="Available" />
                  ) : (
                    <span className="inline-block h-4 w-4 rounded-sm bg-cream-200" aria-label="Unavailable" />
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

export function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const numericId = Number(id);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<StaffApplicationDetail | null>(null);
  const [decided, setDecided] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getStaffApplication(numericId);
      setApplication(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError('Could not load application. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [numericId]);

  useEffect(() => {
    if (isNaN(numericId)) { setNotFound(true); setLoading(false); return; }
    void load();
  }, [numericId, load]);

  function handleDecision(updated: StaffApplicationDetail) {
    setApplication(updated);
    setDecided(true);
    // Auto-redirect to the list after a short moment so staff sees the success.
    setTimeout(() => navigate('/staff/applications'), 1800);
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
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Application not found</h1>
        <div className="rounded-2xl border border-cream-300 bg-white p-5">
          <p className="text-sm text-primary-600">
            This application doesn't exist or you don't have access to it.
          </p>
          <Link to="/staff/applications" className="mt-3 block text-sm font-medium text-primary-600 hover:underline">
            ← Back to applications
          </Link>
        </div>
      </div>
    );
  }

  if (error || !application) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Application</h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-700">{error ?? 'Something went wrong.'}</p>
          <button onClick={() => void load()} className="mt-3 text-sm font-medium text-red-700 underline">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const app = application;

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div>
        <Link
          to="/staff/applications"
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary-500 hover:text-primary-700"
        >
          ← Back to applications
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-primary-900">
              {app.user_full_name}
            </h1>
            <p className="mt-0.5 text-sm text-primary-500">{app.user_email}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_BADGE[app.application_status]}`}
          >
            {STATUS_LABEL[app.application_status]}
          </span>
        </div>
      </div>

      {/* ---- Decision success banner ---- */}
      {decided && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4">
          <p className="text-sm font-medium text-green-800">
            Decision recorded. Redirecting to the applications list…
          </p>
        </div>
      )}

      {/* ---- Two-column layout on md+ ---- */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">

        {/* Left: profile details (2/3 width) */}
        <div className="space-y-5 md:col-span-2">

          {/* Profile info */}
          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-primary-900">Profile</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Contact</dt>
                <dd className="mt-0.5 text-primary-800">{app.contact_number || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Applied</dt>
                <dd className="mt-0.5 text-primary-800">{formatDateTime(app.created_at)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Languages</dt>
                <dd className="mt-0.5 text-primary-800">{app.languages.join(', ') || '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">Travel areas</dt>
                <dd className="mt-0.5 text-primary-800">{app.travel_areas.join(', ') || '—'}</dd>
              </div>
              {app.about_text && (
                <div className="col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-primary-400">About</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-primary-800">{app.about_text}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Availability */}
          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-primary-900">Availability</h2>
            <div className="mt-3">
              <AvailabilityGrid availability={app.availability} />
            </div>
          </div>

          {/* Documents
              SR-DATA-03: DocumentCard fetches each document with credentials
              and never exposes the download_url as a public src or href. */}
          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-primary-900">Documents</h2>
            {app.documents.length === 0 ? (
              <p className="mt-3 text-sm text-primary-400">No documents uploaded.</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {app.documents.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} />
                ))}
              </div>
            )}
          </div>

          {/* Internal review note — staff-only display
              SECURITY: internal_review_note is staff-only. This section is only
              rendered on the staff application detail page. It must never appear
              in any volunteer-facing component, route, or API response. */}
          {app.internal_review_note && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-sm font-semibold text-amber-800">
                Internal review note{' '}
                <span className="font-normal">(staff only — not visible to applicant)</span>
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">
                {app.internal_review_note}
              </p>
              {app.reviewed_by_email && (
                <p className="mt-2 text-xs text-amber-600">
                  Recorded by {app.reviewed_by_email}
                  {app.reviewed_at ? ` on ${formatDateTime(app.reviewed_at)}` : ''}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: decision panel (1/3 width) */}
        <div className="md:col-span-1">
          <div className="sticky top-6">
            <DecisionPanel
              applicationId={app.id}
              currentStatus={app.application_status}
              onDecision={handleDecision}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
