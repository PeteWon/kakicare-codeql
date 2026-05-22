// Client-side validators for KakiCare forms.
//
// SECURITY NOTE: Client-side validation here is for USABILITY ONLY — it gives
// users fast, friendly feedback. It is NEVER a security control. Anything in
// this file can be bypassed by a malicious client (devtools, curl, a modified
// bundle). EVERY rule below MUST be re-enforced on the server, which is the
// only place validation can be trusted. Treat all incoming data server-side as
// untrusted regardless of what this file checks.

export type Validator = (value: string) => string | null;

/** Returns the first error message from the validators, or null if all pass. */
export function validate(value: string, validators: Validator[]): string | null {
  for (const v of validators) {
    const error = v(value);
    if (error) return error;
  }
  return null;
}

export const required =
  (label = 'This field'): Validator =>
  (value) =>
    value.trim().length === 0 ? `${label} is required.` : null;

// Pragmatic email shape check — usability only, not RFC-complete.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const email =
  (label = 'Email'): Validator =>
  (value) =>
    EMAIL_RE.test(value.trim()) ? null : `Please enter a valid ${label.toLowerCase()}.`;

export const minLength =
  (min: number, label = 'This field'): Validator =>
  (value) =>
    value.length < min ? `${label} must be at least ${min} characters.` : null;

export const maxLength =
  (max: number, label = 'This field'): Validator =>
  (value) =>
    value.length > max ? `${label} must be at most ${max} characters.` : null;

export const matches =
  (other: string, label = 'Values'): Validator =>
  (value) =>
    value === other ? null : `${label} do not match.`;

// Loose Singapore phone check (usability only). Accepts an optional +65 / 65
// prefix and 8 local digits commonly starting 3/6/8/9. Spacing/dashes ignored.
// Deliberately permissive — the backend is the authoritative validator.
const SG_PHONE_RE = /^(?:\+?65)?[3689]\d{7}$/;

export const phoneSG =
  (label = 'Contact number'): Validator =>
  (value) =>
    SG_PHONE_RE.test(value.replace(/[\s-]/g, ''))
      ? null
      : `Please enter a valid Singapore ${label.toLowerCase()}.`;
