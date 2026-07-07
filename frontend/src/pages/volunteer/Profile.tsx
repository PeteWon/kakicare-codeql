import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardTitle, FileUpload, MultiSelect, TextField } from '@/components';
import {
  ChangePasswordSection,
  DeactivationRequestSection,
  MfaSection,
} from '@/pages/shared/AccountSettings';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import { phoneSG, required, validate } from '@/lib/validation';
import type {
  ApplicationStatus,
  Region,
  TimeBlock,
  VolunteerProfileData,
  Weekday,
} from '@/lib/types';

// Volunteer Profile + Account page.
//
// This single page combines what used to be two separate tabs ("Profile" and
// "Account"): it shows the volunteer's own application details (or the
// completion form while their profile is still incomplete) AND their account
// settings (password, MFA, deactivation) plus sign out.
//
// SECURITY NOTES (see security report):
// - All form validation here is USABILITY ONLY and must be re-enforced server-side.
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
// Read-only application details (shown once the profile has been submitted)
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<
  Exclude<ApplicationStatus, 'incomplete' | 'changes_requested'>,
  { label: string; className: string }
> = {
  pending_review: {
    label: 'Under review',
    className: 'bg-amber-100 text-amber-800',
  },
  approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-800',
  },
  rejected: {
    label: 'Not approved',
    className: 'bg-red-100 text-red-800',
  },
};

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <span className="text-primary-400">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-cream-100 px-3 py-1 text-sm text-primary-800"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-primary-500">{label}</dt>
      <dd className="text-sm text-primary-900 sm:col-span-2">{children}</dd>
    </div>
  );
}

/** Human-readable availability, e.g. "Mon: Morning, Afternoon". */
function availabilitySummary(availability: Record<string, string[]>): string[] {
  return WEEKDAYS.filter((day) => availability[day]?.length).map(
    (day) => `${day}: ${availability[day].join(', ')}`,
  );
}

function ApplicationDetails({
  profile,
  name,
  email,
}: {
  profile: VolunteerProfileData;
  name: string;
  email: string;
}) {
  const status = profile.application_status as Exclude<
    ApplicationStatus,
    'incomplete' | 'changes_requested'
  >;
  const badge = STATUS_BADGE[status];
  const availability = availabilitySummary(profile.availability);

  return (
    <section aria-labelledby="application-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <CardTitle id="application-heading">Your application</CardTitle>
        {badge && (
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}>
            {badge.label}
          </span>
        )}
      </div>
      <Card>
        <dl className="divide-y divide-cream-200">
          <InfoRow label="Name">{name || '—'}</InfoRow>
          <InfoRow label="Email">{email || '—'}</InfoRow>
          <InfoRow label="Contact number">{profile.contact_number || '—'}</InfoRow>
          <InfoRow label="Languages">
            <Chips items={profile.languages} empty="None provided" />
          </InfoRow>
          <InfoRow label="Areas you can travel to">
            <Chips items={profile.travel_areas} empty="None provided" />
          </InfoRow>
          <InfoRow label="Availability">
            <Chips items={availability} empty="None provided" />
          </InfoRow>
          <InfoRow label="About me">
            {profile.about_text ? (
              <p className="whitespace-pre-line">{profile.about_text}</p>
            ) : (
              <span className="text-primary-400">Not provided</span>
            )}
          </InfoRow>
        </dl>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Profile completion form (incomplete / changes_requested)
// ---------------------------------------------------------------------------

interface ProfileFormProps {
  initial: VolunteerProfileData;
  changesRequested: boolean;
  onSubmitted: () => void;
}

function ProfileForm({ initial, changesRequested, onSubmitted }: ProfileFormProps) {
  const [phone, setPhone] = useState(initial.contact_number ?? '');
  const [languages, setLanguages] = useState<string[]>(initial.languages ?? []);
  const [areas, setAreas] = useState<Region[]>((initial.travel_areas as Region[]) ?? []);
  const [days, setDays] = useState<Weekday[]>([]);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [about, setAbout] = useState(initial.about_text ?? '');
  const [identityDoc, setIdentityDoc] = useState<File | null>(null);
  const [declarationDoc, setDeclarationDoc] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, bring the first invalid field into view so errors
  // above the fold (e.g. contact number) aren't missed when the user was
  // scrolled further down the form.
  useEffect(() => {
    if (!Object.values(errors).some(Boolean)) return;
    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[data-error="true"]');
    if (!firstInvalid) return;
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = firstInvalid.matches('input, textarea, select, button')
      ? firstInvalid
      : firstInvalid.querySelector<HTMLElement>('input, textarea, select, button');
    focusable?.focus({ preventScroll: true });
  }, [errors]);

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
        onSubmitted();
        return;
      }
      setFormError('We could not submit your profile. Please try again.');
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="complete-profile-heading">
      <h2 id="complete-profile-heading" className="text-xl font-semibold text-primary-900">
        Complete your profile
      </h2>
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

      <form ref={formRef} className="mt-6 space-y-6" onSubmit={handleSubmit} noValidate>
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Profile() {
  usePageTitle('Profile');
  const navigate = useNavigate();

  type PageState = 'loading' | 'form' | 'view' | 'submitted' | 'load_error';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [profile, setProfile] = useState<VolunteerProfileData | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    async function load() {
      try {
        // The current user (name/email) is nice-to-have for the details view;
        // don't fail the whole page if only that call errors.
        const [prof, user] = await Promise.all([
          api.getVolunteerProfile(),
          api.getCurrentUser().catch(() => null),
        ]);
        if (user) {
          setName(user.fullName);
          setEmail(user.email);
        }
        setProfile(prof);
        const s = prof.application_status;
        setPageState(s === 'incomplete' || s === 'changes_requested' ? 'form' : 'view');
      } catch {
        setPageState('load_error');
      }
    }
    void load();
  }, []);

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // Best-effort — redirect regardless (see VolunteerLayout security note).
    }
    navigate('/');
  }

  function renderProfileSection() {
    if (pageState === 'load_error') {
      return (
        <Card>
          <p className="text-sm text-red-600">
            Could not load your profile details. Please refresh the page.
          </p>
        </Card>
      );
    }

    if (pageState === 'submitted') {
      return (
        <Card className="border-primary-200 bg-primary-50">
          <h2 className="text-lg font-semibold text-primary-900">
            Profile submitted — pending review
          </h2>
          <p className="mt-2 text-sm text-primary-700">
            Thank you! Your application is now with our team for review. We'll
            email you once a staff member has reviewed it.
          </p>
          <p className="mt-1 text-sm text-primary-600">
            You won't be matched with a senior until your application is approved.
          </p>
        </Card>
      );
    }

    if (pageState === 'form' && profile) {
      return (
        <ProfileForm
          initial={profile}
          changesRequested={profile.application_status === 'changes_requested'}
          onSubmitted={() => setPageState('submitted')}
        />
      );
    }

    if (pageState === 'view' && profile) {
      return <ApplicationDetails profile={profile} name={name} email={email} />;
    }

    return null;
  }

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

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <h1 className="font-serif text-2xl font-semibold text-primary-900">Profile</h1>

      {renderProfileSection()}

      {/* Account settings — always available regardless of application status. */}
      <div className="space-y-8">
        <ChangePasswordSection />
        <MfaSection role="volunteer" />
        <DeactivationRequestSection />
      </div>

      {/* Sign out — mirrors the header action for a familiar bottom-of-profile
          placement on mobile. */}
      <section aria-labelledby="signout-heading">
        <CardTitle id="signout-heading" className="mb-3">
          Sign out
        </CardTitle>
        <Card>
          <Button variant="secondary" onClick={() => void handleLogout()}>
            Sign out
          </Button>
        </Card>
      </section>
    </div>
  );
}
