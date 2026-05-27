import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Card, FileUpload, MultiSelect, TextField } from '@/components';
import { api } from '@/lib/api';
import { phoneSG, required, validate } from '@/lib/validation';
import type { ApplicationStatus, Region, TimeBlock, Weekday } from '@/lib/types';

// Volunteer profile completion.
//
// SECURITY NOTES (see security report):
// - All validation here is USABILITY ONLY and must be re-enforced server-side.
// - File-type/size limits are applied in FileUpload purely for fast feedback;
//   the backend independently validates content (magic bytes), size, and stores
//   files outside the web root (abuse case AC-10; SR-DATA-03, SR-DATA-04).
// - The accepted file types below MUST stay in sync with the backend allow-list.
// - Profile data and file contents are kept in component state ONLY — never
//   written to localStorage/sessionStorage.

const LANGUAGES = [
  'English',
  'Mandarin',
  'Malay',
  'Tamil',
  'Hokkien',
  'Cantonese',
  'Teochew',
  'Other',
] as const;

const REGIONS: readonly Region[] = ['North', 'South', 'East', 'West', 'Central'];
const WEEKDAYS: readonly Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME_BLOCKS: readonly TimeBlock[] = ['Morning', 'Afternoon', 'Evening'];

// Keep this allow-list in sync with the backend's accepted upload types.
const DOC_ACCEPT = 'image/jpeg,image/png,application/pdf';
const DOC_ACCEPT_LABEL = 'JPG, PNG or PDF';
const ABOUT_MAX = 500;

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

const STATUS_CONTENT: Record<
  Exclude<ApplicationStatus, 'incomplete' | 'changes_requested'>,
  { heading: string; body: string; colour: string }
> = {
  pending_review: {
    heading: 'Your application is under review',
    body: "Thanks for submitting your profile! Our team will review it shortly. We'll send you an email once a decision has been made. In the meantime there's nothing else you need to do.",
    colour: 'text-amber-700',
  },
  approved: {
    heading: 'Your application has been approved',
    body: "Congratulations! You're now a verified KakiCare volunteer. A staff member will propose a match when a suitable senior is available.",
    colour: 'text-green-700',
  },
  rejected: {
    heading: 'Your application was not approved',
    body: "Unfortunately we weren't able to approve your application at this time. If you have questions, please reach out to the KakiCare team.",
    colour: 'text-red-700',
  },
};

function StatusDisplay({ status }: { status: Exclude<ApplicationStatus, 'incomplete' | 'changes_requested'> }) {
  const { heading, body, colour } = STATUS_CONTENT[status];
  return (
    <section className="mx-auto max-w-2xl">
      <Card className="text-center py-4">
        <h1 className={`text-2xl font-semibold ${colour}`}>{heading}</h1>
        <p className="mt-3 text-primary-600">{body}</p>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Profile form
// ---------------------------------------------------------------------------

export function CompleteProfile() {
  type PageState = 'loading' | 'form' | 'status' | 'load_error';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [appStatus, setAppStatus] = useState<ApplicationStatus>('incomplete');
  const [changesRequested, setChangesRequested] = useState(false);

  const [phone, setPhone] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [areas, setAreas] = useState<Region[]>([]);
  const [days, setDays] = useState<Weekday[]>([]);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [about, setAbout] = useState('');
  const [identityDoc, setIdentityDoc] = useState<File | null>(null);
  const [declarationDoc, setDeclarationDoc] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.getVolunteerProfile()
      .then((profile) => {
        const s = profile.application_status;
        if (s === 'incomplete' || s === 'changes_requested') {
          // Pre-populate from any previously saved data.
          if (profile.contact_number) setPhone(profile.contact_number);
          if (profile.languages?.length) setLanguages(profile.languages);
          if (profile.travel_areas?.length) setAreas(profile.travel_areas as Region[]);
          if (profile.about_text) setAbout(profile.about_text);
          setChangesRequested(s === 'changes_requested');
          setPageState('form');
        } else {
          setAppStatus(s);
          setPageState('status');
        }
      })
      .catch(() => {
        setPageState('load_error');
      });
  }, []);

  function buildErrors() {
    return {
      phone: validate(phone, [required('Contact number'), phoneSG()]),
      languages: languages.length === 0 ? 'Please select at least one language.' : null,
      areas: areas.length === 0 ? 'Please select at least one area.' : null,
      days: days.length === 0 ? 'Please select at least one day you are available.' : null,
      blocks: blocks.length === 0 ? 'Please select at least one time block.' : null,
      about: about.length > ABOUT_MAX ? `Please keep this under ${ABOUT_MAX} characters.` : null,
      identityDoc: identityDoc ? null : 'Please upload your identity document.',
      declarationDoc: declarationDoc ? null : 'Please upload your signed declaration form.',
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const next = buildErrors();
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    if (!identityDoc || !declarationDoc) return;

    setSubmitting(true);
    try {
      const result = await api.submitProfile(
        { phone, languages, areas, availabilityDays: days, availabilityBlocks: blocks, about },
        { identityDocument: identityDoc, declarationForm: declarationDoc },
      );
      if (result.status === 'success') {
        setSubmitted(true);
        return;
      }
      setFormError('We could not submit your profile. Please try again.');
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // --- Loading ---
  if (pageState === 'loading') {
    return (
      <div className="flex justify-center py-16">
        <span
          role="status"
          aria-label="Loading…"
          className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
        />
      </div>
    );
  }

  // --- Load error ---
  if (pageState === 'load_error') {
    return (
      <section className="mx-auto max-w-2xl">
        <Card>
          <p className="text-sm text-red-600">Could not load your profile. Please refresh the page.</p>
        </Card>
      </section>
    );
  }

  // --- Status-only display (pending / approved / rejected) ---
  if (pageState === 'status') {
    return (
      <StatusDisplay
        status={appStatus as Exclude<ApplicationStatus, 'incomplete' | 'changes_requested'>}
      />
    );
  }

  // --- Post-submit confirmation (within the same session) ---
  if (submitted) {
    return (
      <section className="mx-auto max-w-2xl">
        <Card className="text-center">
          <h1 className="text-2xl font-semibold text-primary-900">
            Profile submitted — pending review
          </h1>
          <p className="mt-3 text-primary-600">
            Thank you! Your application is now with our team for review. We'll
            email you once a staff member has reviewed it.
          </p>
          <p className="mt-2 text-sm text-primary-500">
            You won't be matched with a senior until your application is approved.
          </p>
        </Card>
      </section>
    );
  }

  // --- Form (incomplete or changes_requested) ---
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-primary-900">Complete your profile</h1>
      <p className="mt-2 text-primary-600">
        Tell us a little about yourself and upload your documents so our team can
        review your application.
      </p>

      {changesRequested && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          A staff member has requested changes to your profile. Please update the
          information below and resubmit.
        </div>
      )}

      <form className="mt-6 space-y-6" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {formError}
          </div>
        ) : null}

        <Card className="space-y-5">
          <TextField
            label="Contact number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="e.g. 9123 4567"
            value={phone}
            error={errors.phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <MultiSelect
            label="Languages spoken"
            options={LANGUAGES}
            value={languages}
            onChange={setLanguages}
            error={errors.languages}
          />

          <MultiSelect<Region>
            label="Areas you can travel to"
            options={REGIONS}
            value={areas}
            onChange={setAreas}
            error={errors.areas}
          />
        </Card>

        <Card className="space-y-5">
          <h2 className="text-lg font-semibold text-primary-900">Weekly availability</h2>
          <MultiSelect<Weekday>
            label="Days"
            options={WEEKDAYS}
            value={days}
            onChange={setDays}
            error={errors.days}
          />
          <MultiSelect<TimeBlock>
            label="Time of day"
            options={TIME_BLOCKS}
            value={blocks}
            onChange={setBlocks}
            error={errors.blocks}
          />
        </Card>

        <Card className="space-y-5">
          <h2 className="text-lg font-semibold text-primary-900">Documents</h2>
          <FileUpload
            label="Identity document"
            accept={DOC_ACCEPT}
            acceptedLabel={DOC_ACCEPT_LABEL}
            capture
            file={identityDoc}
            onChange={setIdentityDoc}
            error={errors.identityDoc}
          />
          <FileUpload
            label="Signed declaration form"
            accept={DOC_ACCEPT}
            acceptedLabel={DOC_ACCEPT_LABEL}
            file={declarationDoc}
            onChange={setDeclarationDoc}
            error={errors.declarationDoc}
          />
        </Card>

        <Card className="space-y-2">
          <label htmlFor="about" className="block text-sm font-medium text-primary-800">
            About me / why I want to volunteer{' '}
            <span className="font-normal text-primary-400">(optional)</span>
          </label>
          <textarea
            id="about"
            rows={4}
            maxLength={ABOUT_MAX}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            className="block w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-base text-primary-950 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="Share a little about yourself…"
          />
          <p className="text-right text-xs text-primary-400">
            {about.length}/{ABOUT_MAX}
          </p>
        </Card>

        <Button type="submit" size="lg" fullWidth disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit for review'}
        </Button>
      </form>
    </section>
  );
}
