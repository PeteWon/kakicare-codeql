// Typed fetch wrapper for the KakiCare backend.
//
// The functions below currently return MOCK data so the frontend runs before
// the backend exists. Each mock is clearly marked with `// MOCK`. To go live,
// replace the mock body with the commented `apiFetch(...)` call directly above
// it — the function signatures and return types stay identical, so swapping is
// a localised change.

import type {
  AuditLogEntry,
  LoginResult,
  Match,
  MfaResult,
  ProfileDocuments,
  ProfileSubmission,
  ProfileSubmissionResult,
  Senior,
  Session,
  User,
  VerifyEmailResult,
  VolunteerProfile,
} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialisable request body. */
  body?: unknown;
}

/**
 * Core fetch wrapper. Prefixes the base URL, sends/parses JSON, sends cookies
 * (credentials: 'include') so the backend can use httpOnly session cookies,
 * and throws `ApiError` on non-2xx responses.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers, ...rest } = options;

  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...rest,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (data && (data.message as string)) || response.statusText,
      data,
    );
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// MOCK data store
// ---------------------------------------------------------------------------
// Everything in this section is temporary scaffolding. Delete once the backend
// is wired up.

// MOCK: simulate network latency.
function delay<T>(value: T, ms = 300): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// MOCK: in-memory sample records.
const mockUser: User = {
  id: 'usr_1',
  email: 'volunteer@example.com',
  fullName: 'Aisha Rahman',
  role: 'volunteer',
  emailVerifiedAt: '2026-05-01T09:00:00Z',
  createdAt: '2026-04-20T09:00:00Z',
};

const mockVolunteers: VolunteerProfile[] = [
  {
    id: 'vol_1',
    userId: 'usr_1',
    phone: '+65 8123 4567',
    status: 'approved',
    languages: ['English', 'Malay'],
    preferredAreas: ['Tampines', 'Bedok'],
    bio: 'Retired teacher who enjoys listening to stories.',
    reviewedByStaffId: 'usr_staff_1',
    reviewedAt: '2026-04-25T10:00:00Z',
    createdAt: '2026-04-20T09:00:00Z',
  },
];

const mockSeniors: Senior[] = [
  {
    id: 'sen_1',
    fullName: 'Mdm Tan Bee Hoon',
    age: 78,
    languages: ['Mandarin', 'Hokkien'],
    area: 'Tampines',
    careNotes: 'Lives alone, enjoys gardening, mild mobility issues.',
    emergencyContactName: 'Tan Wei Ming (son)',
    emergencyContactPhone: '+65 9000 0000',
    createdByStaffId: 'usr_staff_1',
    createdAt: '2026-04-10T09:00:00Z',
  },
];

const mockMatches: Match[] = [
  {
    id: 'mat_1',
    volunteerId: 'vol_1',
    seniorId: 'sen_1',
    status: 'active',
    startedAt: '2026-05-01T09:00:00Z',
    endedAt: null,
    createdByStaffId: 'usr_staff_1',
  },
];

const mockSessions: Session[] = [
  {
    id: 'ses_1',
    matchId: 'mat_1',
    type: 'visit',
    occurredAt: '2026-05-10T03:00:00Z',
    durationMinutes: 60,
    notes: 'Had tea together, helped water the plants. In good spirits.',
    concernRaised: false,
    createdAt: '2026-05-10T05:00:00Z',
  },
];

const mockAuditLog: AuditLogEntry[] = [
  {
    id: 'aud_1',
    actorId: 'usr_staff_1',
    action: 'volunteer.approved',
    targetType: 'VolunteerProfile',
    targetId: 'vol_1',
    metadata: null,
    createdAt: '2026-04-25T10:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------
// Each function shows the real call (commented) and the mock it currently uses.

export const api = {
  // --- Authentication -----------------------------------------------------
  // On a real 'success'/'mfa_required', the backend sets a secure, HttpOnly
  // session cookie. The frontend NEVER receives or stores a token — it only
  // reads the status. Do not return tokens from these functions.
  //
  // SECURITY: the MFA gate is enforced server-side. A staff account can never
  // reach 'success' from `login` alone — the backend issues a fully-privileged
  // session only after `verifyMfa` succeeds. The two-step UI below is a
  // convenience, not the security boundary.
  async login(_email: string, _password: string): Promise<LoginResult> {
    // return apiFetch<LoginResult>('/api/auth/login', {
    //   method: 'POST',
    //   body: { email: _email, password: _password },
    // });

    // MOCK: outcome is driven by the email so we can exercise every UI state.
    // The password is never inspected here and is never logged or persisted.
    const normalized = _email.trim().toLowerCase();
    if (normalized.startsWith('staff')) return delay({ status: 'mfa_required' }); // MOCK
    if (normalized.startsWith('volunteer')) return delay({ status: 'success' }); // MOCK
    return delay({ status: 'invalid' }); // MOCK — generic failure for anything else
  },

  async verifyMfa(_code: string): Promise<MfaResult> {
    // return apiFetch<MfaResult>('/api/auth/mfa', {
    //   method: 'POST',
    //   body: { code: _code },
    // });

    // MOCK: accept the well-known code "123456", reject everything else.
    return delay(_code === '123456' ? { status: 'success' } : { status: 'invalid' }); // MOCK
  },

  // Verify an email-verification token from a /verify-email?token=... link.
  //
  // SECURITY: the token is single-use and time-limited — that is enforced by
  // the BACKEND, not here. The frontend only forwards the token (over HTTPS)
  // and reflects the result. The token must never be logged or persisted to
  // localStorage/sessionStorage. The failure outcome is generic regardless of
  // whether the token is invalid, already used, or expired.
  async verifyEmail(_token: string): Promise<VerifyEmailResult> {
    // return apiFetch<VerifyEmailResult>('/api/auth/verify-email', {
    //   method: 'POST',
    //   body: { token: _token },
    // });

    // MOCK: any token succeeds except the literal "expired".
    return delay(_token === 'expired' ? { status: 'invalid' } : { status: 'success' }); // MOCK
  },

  // --- Session / current user --------------------------------------------
  async getCurrentUser(): Promise<User> {
    // return apiFetch<User>('/api/me');
    return delay(mockUser); // MOCK
  },

  // --- Volunteer profile completion --------------------------------------
  // Submit the profile + identity/declaration documents for staff vetting.
  //
  // SECURITY: file-type/size checks done on the client (in FileUpload) are
  // USABILITY ONLY and trivially bypassable. The BACKEND must independently
  // validate the real content type by inspecting magic bytes (NOT the
  // extension or client-sent MIME type), enforce the size limit, store files
  // OUTSIDE the web root, and serve them only via an authenticated, authorised
  // endpoint (abuse case AC-10; SR-DATA-03, SR-DATA-04). The real request sends
  // multipart/form-data (FormData), NOT JSON, so it bypasses the JSON apiFetch
  // wrapper and uses fetch directly — letting the browser set the multipart
  // boundary itself.
  async submitProfile(
    data: ProfileSubmission,
    files: ProfileDocuments,
  ): Promise<ProfileSubmissionResult> {
    // const form = new FormData();
    // form.append('profile', JSON.stringify(data));
    // form.append('identityDocument', files.identityDocument);
    // form.append('declarationForm', files.declarationForm);
    // const res = await fetch(`${BASE_URL}/api/volunteer/profile`, {
    //   method: 'POST',
    //   credentials: 'include',
    //   body: form,
    // });
    // return (await res.json()) as ProfileSubmissionResult;

    // MOCK: accept anything and report the application as pending review.
    void data;
    void files;
    return delay({ status: 'success' }); // MOCK
  },

  // --- Volunteers ---------------------------------------------------------
  async listVolunteers(): Promise<VolunteerProfile[]> {
    // return apiFetch<VolunteerProfile[]>('/api/volunteers');
    return delay(mockVolunteers); // MOCK
  },

  async getVolunteer(id: string): Promise<VolunteerProfile> {
    // return apiFetch<VolunteerProfile>(`/api/volunteers/${id}`);
    return delay(mockVolunteers.find((v) => v.id === id) ?? mockVolunteers[0]); // MOCK
  },

  // --- Seniors (staff-managed) -------------------------------------------
  async listSeniors(): Promise<Senior[]> {
    // return apiFetch<Senior[]>('/api/seniors');
    return delay(mockSeniors); // MOCK
  },

  async getSenior(id: string): Promise<Senior> {
    // return apiFetch<Senior>(`/api/seniors/${id}`);
    return delay(mockSeniors.find((s) => s.id === id) ?? mockSeniors[0]); // MOCK
  },

  // --- Matches ------------------------------------------------------------
  async listMatches(): Promise<Match[]> {
    // return apiFetch<Match[]>('/api/matches');
    return delay(mockMatches); // MOCK
  },

  // --- Sessions -----------------------------------------------------------
  async listSessions(matchId: string): Promise<Session[]> {
    // return apiFetch<Session[]>(`/api/matches/${matchId}/sessions`);
    return delay(mockSessions.filter((s) => s.matchId === matchId)); // MOCK
  },

  // --- Audit log (staff only) --------------------------------------------
  async listAuditLog(): Promise<AuditLogEntry[]> {
    // return apiFetch<AuditLogEntry[]>('/api/audit-log');
    return delay(mockAuditLog); // MOCK
  },
};
