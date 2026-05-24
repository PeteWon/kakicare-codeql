// API layer for the KakiCare backend.
//
// Auth functions talk to the real Django backend. Non-auth functions (volunteers,
// seniors, matches, sessions, audit log) are still MOCK and will be replaced when
// those backend endpoints are built.
//
// CSRF HANDLING
// Django's CSRF middleware is bypassed by DRF's @csrf_exempt on all APIViews.
// CSRF is re-enforced *manually* by SessionAuthentication for authenticated requests
// only. `apiFetch` reads the `csrftoken` cookie (set by the backend on first login)
// and forwards it as `X-CSRFToken` on every non-GET request. For unauthenticated
// requests (register, login, verify-email) the header is ignored; for authenticated
// ones (logout, MFA setup/verify by logged-in users) it satisfies the CSRF check.
//
// SECURITY: auth state lives entirely in the HttpOnly session cookie. No token is
// ever stored in localStorage or sessionStorage.

import type {
  AuditLogEntry,
  LoginResult,
  Match,
  MfaResult,
  MfaSetupResult,
  Paginated,
  ProfileDocuments,
  ProfileSubmission,
  ProfileSubmissionResult,
  Senior,
  Session,
  StaffApplicationDetail,
  StaffApplicationSummary,
  StaffSession,
  User,
  UserRole,
  VerifyEmailResult,
  VolunteerMatch,
  VolunteerProfile,
  VolunteerProfileData,
  VolunteerSession,
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
  body?: unknown;
}

/** Read the CSRF token Django sets in the `csrftoken` cookie (not HttpOnly). */
function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Core fetch wrapper. Prefixes the base URL, sends/parses JSON, sends cookies
 * (`credentials: 'include'`) so the backend session cookie travels with each
 * request, injects `X-CSRFToken` on state-changing requests, and throws
 * `ApiError` on non-2xx responses.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers, ...rest } = options;
  const method = (rest.method ?? 'GET').toUpperCase();

  // Include CSRF token on all state-changing requests.
  const csrfHeaders: Record<string, string> =
    method !== 'GET' && method !== 'HEAD'
      ? { 'X-CSRFToken': getCsrfToken() }
      : {};

  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders,
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
      (data && (data.detail as string)) || response.statusText,
      data,
    );
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// MOCK data store (non-auth — remove as backend endpoints are built)
// ---------------------------------------------------------------------------

function delay<T>(value: T, ms = 300): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

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
// Backend response shape for /api/auth/me (snake_case, Django conventions)
// ---------------------------------------------------------------------------

interface MeResponse {
  id: number | string;
  email: string;
  full_name: string;
  role: UserRole;
  is_email_verified: boolean;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const api = {
  // --- Authentication -------------------------------------------------------

  async register(email: string, fullName: string, password: string): Promise<void> {
    // Backend always returns 200 with a generic message (anti-enumeration);
    // 400 is thrown as ApiError with field-level errors in .body.
    await apiFetch('/api/auth/register', {
      method: 'POST',
      body: { email, full_name: fullName, password },
    });
  },

  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    try {
      await apiFetch('/api/auth/verify-email', {
        method: 'POST',
        body: { token },
      });
      return { status: 'success' };
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        return { status: 'invalid' };
      }
      throw err;
    }
  },

  async login(email: string, password: string): Promise<LoginResult> {
    // Backend always returns 200 (anti-enumeration). Status field drives the UI.
    return apiFetch<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },

  async verifyMfa(
    payload: { code: string } | { backup_code: string },
  ): Promise<MfaResult> {
    try {
      return await apiFetch<MfaResult>('/api/auth/mfa/verify', {
        method: 'POST',
        body: payload,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        return { status: 'invalid' };
      }
      throw err;
    }
  },

  async setupMfa(): Promise<MfaSetupResult> {
    return apiFetch<MfaSetupResult>('/api/auth/mfa/setup', { method: 'POST' });
  },

  async logout(): Promise<void> {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  },

  async getCurrentUser(): Promise<User> {
    const raw = await apiFetch<MeResponse>('/api/auth/me');
    return {
      id: String(raw.id),
      email: raw.email,
      fullName: raw.full_name,
      role: raw.role,
      // Backend returns is_email_verified (bool), not a timestamp.
      // emailVerifiedAt and createdAt are not yet exposed by /api/auth/me.
      emailVerifiedAt: raw.is_email_verified ? 'verified' : null,
      createdAt: '',
    };
  },

  async requestPasswordReset(email: string): Promise<void> {
    // Backend always returns 200 with a generic message (anti-enumeration).
    await apiFetch('/api/auth/password-reset/request', {
      method: 'POST',
      body: { email },
    });
  },

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    await apiFetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, new_password: newPassword },
    });
  },

  // --- Volunteer profile completion -----------------------------------------
  // SECURITY: file-type/size checks in FileUpload are USABILITY ONLY — the
  // backend must independently validate content type, enforce size limits, and
  // store files outside the web root (SR-DATA-03/04).
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
    //   headers: { 'X-CSRFToken': getCsrfToken() },
    //   body: form,
    // });
    // return (await res.json()) as ProfileSubmissionResult;
    void data;
    void files;
    return delay({ status: 'success' }); // MOCK
  },

  // --- Volunteers (MOCK) ---------------------------------------------------
  async listVolunteers(): Promise<VolunteerProfile[]> {
    // return apiFetch<VolunteerProfile[]>('/api/volunteers');
    return delay(mockVolunteers); // MOCK
  },

  async getVolunteer(id: string): Promise<VolunteerProfile> {
    // return apiFetch<VolunteerProfile>(`/api/volunteers/${id}`);
    return delay(mockVolunteers.find((v) => v.id === id) ?? mockVolunteers[0]); // MOCK
  },

  // --- Seniors (MOCK) -------------------------------------------------------
  async listSeniors(): Promise<Senior[]> {
    // return apiFetch<Senior[]>('/api/seniors');
    return delay(mockSeniors); // MOCK
  },

  async getSenior(id: string): Promise<Senior> {
    // return apiFetch<Senior>(`/api/seniors/${id}`);
    return delay(mockSeniors.find((s) => s.id === id) ?? mockSeniors[0]); // MOCK
  },

  // --- Matches (MOCK — staff/non-volunteer facing) --------------------------
  async listMatches(): Promise<Match[]> {
    // return apiFetch<Match[]>('/api/matches');
    return delay(mockMatches); // MOCK
  },

  // --- Sessions (MOCK — legacy stub) ----------------------------------------
  async listSessions(matchId: string): Promise<Session[]> {
    // return apiFetch<Session[]>(`/api/matches/${matchId}/sessions`);
    return delay(mockSessions.filter((s) => s.matchId === matchId)); // MOCK
  },

  // --- Audit log (MOCK) -----------------------------------------------------
  async listAuditLog(): Promise<AuditLogEntry[]> {
    // return apiFetch<AuditLogEntry[]>('/api/audit-log');
    return delay(mockAuditLog); // MOCK
  },

  // --- Volunteer profile (real) ----------------------------------------------

  async getVolunteerProfile(): Promise<VolunteerProfileData> {
    return apiFetch<VolunteerProfileData>('/api/volunteer/profile/');
  },

  // --- Volunteer matches (real) ----------------------------------------------

  async getVolunteerMatches(): Promise<Paginated<VolunteerMatch>> {
    return apiFetch<Paginated<VolunteerMatch>>('/api/volunteer/matches/');
  },

  async acceptMatch(id: number): Promise<VolunteerMatch> {
    return apiFetch<VolunteerMatch>(`/api/volunteer/matches/${id}/accept/`, {
      method: 'POST',
    });
  },

  async declineMatch(id: number): Promise<VolunteerMatch> {
    return apiFetch<VolunteerMatch>(`/api/volunteer/matches/${id}/decline/`, {
      method: 'POST',
    });
  },

  // --- Volunteer sessions (real) --------------------------------------------

  async getVolunteerSessions(): Promise<Paginated<VolunteerSession>> {
    return apiFetch<Paginated<VolunteerSession>>('/api/volunteer/sessions/');
  },

  async bookSession(
    matchId: number,
    sessionType: 'visit' | 'call',
    scheduledStart: string,
    scheduledEnd: string,
  ): Promise<VolunteerSession> {
    // Backend also validates: start in future, end after start, no overlaps,
    // match must be active and belong to this volunteer (SR-AUTHZ-02).
    return apiFetch<VolunteerSession>('/api/volunteer/sessions/', {
      method: 'POST',
      body: {
        match_id: matchId,
        session_type: sessionType,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
      },
    });
  },

  async getSession(id: number): Promise<VolunteerSession> {
    return apiFetch<VolunteerSession>(`/api/volunteer/sessions/${id}/`);
  },

  async checkInSession(id: number, code: string): Promise<VolunteerSession> {
    // SECURITY: code is validated server-side against a SHA-256 hash (AC-04).
    // Do not store or log the code anywhere in the frontend.
    // Attempts are rate-limited server-side (5 per 15 min per IP).
    return apiFetch<VolunteerSession>(`/api/volunteer/sessions/${id}/checkin/`, {
      method: 'POST',
      body: { code },
    });
  },

  async checkOutSession(id: number, volunteerNote?: string): Promise<VolunteerSession> {
    return apiFetch<VolunteerSession>(`/api/volunteer/sessions/${id}/checkout/`, {
      method: 'POST',
      body: { volunteer_note: volunteerNote ?? '' },
    });
  },

  // --- Staff applications (real) -------------------------------------------

  async getStaffApplications(
    statusFilter = 'pending_review',
    page?: number,
  ): Promise<Paginated<StaffApplicationSummary>> {
    const qs = new URLSearchParams({ status: statusFilter });
    if (page && page > 1) qs.set('page', String(page));
    return apiFetch<Paginated<StaffApplicationSummary>>(`/api/staff/applications/?${qs}`);
  },

  async getStaffApplication(id: number): Promise<StaffApplicationDetail> {
    return apiFetch<StaffApplicationDetail>(`/api/staff/applications/${id}/`);
  },

  async submitApplicationDecision(
    id: number,
    decision: 'approve' | 'reject' | 'request_changes',
    internalReviewNote: string,
  ): Promise<StaffApplicationDetail> {
    // SECURITY: internal_review_note is staff-only — never forwarded to the
    // volunteer. The backend enforces this via separate serializer classes.
    return apiFetch<StaffApplicationDetail>(`/api/staff/applications/${id}/decision/`, {
      method: 'POST',
      body: { decision, internal_review_note: internalReviewNote },
    });
  },

  // --- Staff sessions (real) -----------------------------------------------

  async getStaffSessions(
    statusFilter?: string,
    pageSize = 20,
  ): Promise<Paginated<StaffSession>> {
    const qs = new URLSearchParams({ page_size: String(pageSize) });
    if (statusFilter) qs.set('status', statusFilter);
    return apiFetch<Paginated<StaffSession>>(`/api/staff/sessions/?${qs}`);
  },

  // --- Authenticated document download -------------------------------------

  // SECURITY (SR-DATA-03): Documents are stored outside the web root and served
  // ONLY via the authenticated download endpoint. Never use the download_url as
  // a public <img src> or bare <a href> — the endpoint requires a valid session
  // cookie. Always fetch with credentials and create a temporary object URL.
  async downloadDocumentBlob(downloadPath: string): Promise<Blob> {
    const response = await fetch(`${BASE_URL}${downloadPath}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText);
    }
    return response.blob();
  },
};
