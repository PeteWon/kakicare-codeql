// SECURITY NOTES:
// - Staff-only page; enforced by backend on every request. ProtectedRoute is UX only.
// - Client-side validation is for usability only (SR-INPUT-01). The backend is
//   authoritative for all input validation, sanitisation, and field constraints.
// - Do not cache senior data in localStorage or sessionStorage.

import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import type { ConsentStatus, SeniorWritePayload } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const TIME_BLOCKS = ['Morning', 'Afternoon', 'Evening'] as const;
const SG_LANGUAGES = [
  'English', 'Mandarin', 'Malay', 'Tamil',
  'Hokkien', 'Teochew', 'Cantonese', 'Hakka',
];

const CONSENT_LABELS: Record<ConsentStatus, string> = {
  not_recorded: 'Not Recorded',
  given: 'Given',
  withdrawn: 'Withdrawn',
};

const BLANK: SeniorWritePayload = {
  full_name: '',
  address: '',
  phone_number: '',
  preferred_language: '',
  accessibility_needs: '',
  availability: {},
  notes: '',
  next_of_kin_name: '',
  next_of_kin_contact: '',
  consent_status: 'not_recorded',
  is_active: true,
};

// ---------------------------------------------------------------------------
// Availability picker — interactive grid of day × time-block toggles
// ---------------------------------------------------------------------------

function AvailabilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: Record<string, string[]>;
  onChange: (v: Record<string, string[]>) => void;
  disabled?: boolean;
}) {
  function toggle(day: string, block: string) {
    const current = value[day] ?? [];
    const next = current.includes(block)
      ? current.filter((b) => b !== block)
      : [...current, block];
    const updated = { ...value };
    if (next.length === 0) delete updated[day];
    else updated[day] = next;
    onChange(updated);
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr>
            <th className="w-10 pr-3" />
            {TIME_BLOCKS.map((b) => (
              <th key={b} className="w-24 px-3 text-center text-xs font-medium text-primary-400">
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => (
            <tr key={day}>
              <td className="py-1 pr-3 text-xs font-medium text-primary-600">{day}</td>
              {TIME_BLOCKS.map((block) => {
                const active = value[day]?.includes(block) ?? false;
                return (
                  <td key={block} className="px-3 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => toggle(day, block)}
                      disabled={disabled}
                      aria-label={`${day} ${block}`}
                      aria-pressed={active}
                      className={`h-6 w-6 rounded-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-50 ${
                        active ? 'bg-primary-500' : 'bg-cream-200 hover:bg-primary-200'
                      }`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared input styles & field wrapper
// ---------------------------------------------------------------------------

const inputCls =
  'block w-full rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-sm text-primary-950 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60';
const textareaCls = `${inputCls} resize-none`;

function Field({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-primary-800">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation — usability only; backend is authoritative (SR-INPUT-01)
// ---------------------------------------------------------------------------

type FormErrors = Partial<Record<keyof SeniorWritePayload, string>>;

function validate(v: SeniorWritePayload): FormErrors {
  const errors: FormErrors = {};
  if (!v.full_name.trim()) errors.full_name = 'Full name is required.';
  else if (v.full_name.length > 200) errors.full_name = 'Max 200 characters.';
  if (!v.address.trim()) errors.address = 'Address is required.';
  if (!v.phone_number.trim()) errors.phone_number = 'Phone number is required.';
  else if (!/^[+\d\s\-()]{7,25}$/.test(v.phone_number))
    errors.phone_number = 'Enter a valid phone number (digits, spaces, +, -, parentheses).';
  if (!v.preferred_language.trim()) errors.preferred_language = 'Preferred language is required.';
  return errors;
}

// ---------------------------------------------------------------------------
// Page — used for both /staff/seniors/new and /staff/seniors/:id/edit
// ---------------------------------------------------------------------------

export function SeniorForm() {
  // id is present only on the edit route (/staff/seniors/:id/edit).
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  usePageTitle(isEdit ? 'Edit senior' : 'New senior');
  const numericId = Number(id);
  const navigate = useNavigate();

  const [values, setValues] = useState<SeniorWritePayload>(BLANK);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadExisting = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getSenior(numericId);
      setValues({
        full_name: data.full_name,
        address: data.address,
        phone_number: data.phone_number,
        preferred_language: data.preferred_language,
        accessibility_needs: data.accessibility_needs,
        availability: data.availability ?? {},
        notes: data.notes,
        next_of_kin_name: data.next_of_kin_name ?? '',
        next_of_kin_contact: data.next_of_kin_contact ?? '',
        consent_status: data.consent_status ?? 'not_recorded',
        is_active: data.is_active,
      });
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? 'Senior record not found.'
          : 'Could not load senior. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [isEdit, numericId]);

  useEffect(() => { void loadExisting(); }, [loadExisting]);

  function set(field: keyof SeniorWritePayload, val: unknown) {
    setValues((prev) => ({ ...prev, [field]: val }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function onChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    set(e.target.name as keyof SeniorWritePayload, e.target.value);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate(values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const saved = isEdit
        ? await api.updateSenior(numericId, values)
        : await api.createSenior(values);
      navigate(`/staff/seniors/${saved.id}`, {
        state: {
          successMessage: isEdit ? 'Senior record updated.' : 'Senior record created.',
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        // Map backend field errors back to the form.
        const body = err.body as Record<string, string[]> | undefined;
        if (body && typeof body === 'object') {
          const fieldErrs: FormErrors = {};
          for (const [k, msgs] of Object.entries(body)) {
            if (Array.isArray(msgs) && msgs.length > 0) {
              fieldErrs[k as keyof SeniorWritePayload] = msgs[0];
            }
          }
          if (Object.keys(fieldErrs).length > 0) {
            setErrors(fieldErrs);
            return;
          }
        }
        setSubmitError(
          err.status === 401
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

  if (loadError) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-primary-900">Edit senior</h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-700">{loadError}</p>
          <Link
            to="/staff/seniors"
            className="mt-3 block text-sm font-medium text-red-700 underline"
          >
            ← Back to seniors
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div>
        <Link
          to={isEdit ? `/staff/seniors/${id}` : '/staff/seniors'}
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary-500 hover:text-primary-700"
        >
          ← {isEdit ? 'Back to senior' : 'Back to seniors'}
        </Link>
        <h1 className="font-serif text-2xl font-semibold text-primary-900">
          {isEdit ? 'Edit senior' : 'Add senior'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} noValidate className="max-w-2xl space-y-6">
        {/* ---- Personal details ---- */}
        <div className="space-y-4 rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-primary-900">Personal details</h2>

          <Field label="Full name" htmlFor="full_name" error={errors.full_name} required>
            <input
              id="full_name"
              name="full_name"
              type="text"
              value={values.full_name}
              onChange={onChange}
              maxLength={200}
              disabled={submitting}
              autoComplete="off"
              className={inputCls}
            />
          </Field>

          <Field
            label="Preferred language"
            htmlFor="preferred_language"
            error={errors.preferred_language}
            required
          >
            <input
              id="preferred_language"
              name="preferred_language"
              type="text"
              value={values.preferred_language}
              onChange={onChange}
              list="language-suggestions"
              disabled={submitting}
              className={inputCls}
            />
            <datalist id="language-suggestions">
              {SG_LANGUAGES.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>

          <Field
            label="Accessibility needs"
            htmlFor="accessibility_needs"
            error={errors.accessibility_needs}
          >
            <textarea
              id="accessibility_needs"
              name="accessibility_needs"
              value={values.accessibility_needs}
              onChange={onChange}
              rows={2}
              maxLength={500}
              disabled={submitting}
              placeholder="e.g. wheelchair user, hearing impaired…"
              className={textareaCls}
            />
          </Field>

          <Field label="Notes" htmlFor="notes" error={errors.notes}>
            <textarea
              id="notes"
              name="notes"
              value={values.notes}
              onChange={onChange}
              rows={3}
              maxLength={2000}
              disabled={submitting}
              placeholder="Care context, preferences, staff observations…"
              className={textareaCls}
            />
          </Field>
        </div>

        {/* ---- Contact & address ---- */}
        <div className="space-y-4 rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-primary-900">Contact &amp; address</h2>

          <Field
            label="Phone number"
            htmlFor="phone_number"
            error={errors.phone_number}
            required
          >
            <input
              id="phone_number"
              name="phone_number"
              type="tel"
              value={values.phone_number}
              onChange={onChange}
              disabled={submitting}
              className={inputCls}
            />
          </Field>

          <Field label="Address" htmlFor="address" error={errors.address} required>
            <textarea
              id="address"
              name="address"
              value={values.address}
              onChange={onChange}
              rows={2}
              maxLength={500}
              disabled={submitting}
              className={textareaCls}
            />
          </Field>
        </div>

        {/* ---- Next of kin ---- */}
        <div className="space-y-4 rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-primary-900">Next of kin</h2>

          <Field label="Name" htmlFor="next_of_kin_name" error={errors.next_of_kin_name}>
            <input
              id="next_of_kin_name"
              name="next_of_kin_name"
              type="text"
              value={values.next_of_kin_name}
              onChange={onChange}
              maxLength={200}
              disabled={submitting}
              className={inputCls}
            />
          </Field>

          <Field
            label="Contact"
            htmlFor="next_of_kin_contact"
            error={errors.next_of_kin_contact}
          >
            <input
              id="next_of_kin_contact"
              name="next_of_kin_contact"
              type="text"
              value={values.next_of_kin_contact}
              onChange={onChange}
              maxLength={100}
              disabled={submitting}
              className={inputCls}
            />
          </Field>
        </div>

        {/* ---- Availability ---- */}
        <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-primary-900">Availability</h2>
          <p className="mb-3 text-xs text-primary-400">
            Toggle cells to indicate when the senior is generally available for visits or calls.
          </p>
          <AvailabilityPicker
            value={values.availability}
            onChange={(v) => set('availability', v)}
            disabled={submitting}
          />
        </div>

        {/* ---- Consent ---- */}
        <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-primary-900">Consent</h2>
          <Field label="Consent status" htmlFor="consent_status" required>
            <select
              id="consent_status"
              name="consent_status"
              value={values.consent_status}
              onChange={onChange}
              disabled={submitting}
              className={inputCls}
            >
              {(Object.entries(CONSENT_LABELS) as [ConsentStatus, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </Field>
          <p className="mt-2 text-xs text-primary-400">
            Matching and session scheduling are blocked until consent is set to Given (FR-S-13).
          </p>
        </div>

        {/* ---- Status (edit only — toggle is_active) ---- */}
        {isEdit && (
          <div className="rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-primary-900">Status</h2>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                name="is_active"
                checked={values.is_active ?? true}
                onChange={(e) => set('is_active', e.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded accent-primary-500"
              />
              <span className="text-sm text-primary-800">Active</span>
            </label>
            <p className="ml-7 mt-1 text-xs text-primary-400">
              Uncheck to mark the senior as inactive. All history is preserved (soft-deactivate).
            </p>
          </div>
        )}

        {/* ---- Submit ---- */}
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
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create senior'}
          </button>
          <Link
            to={isEdit ? `/staff/seniors/${id}` : '/staff/seniors'}
            className="text-sm text-primary-500 hover:text-primary-700 hover:underline"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
