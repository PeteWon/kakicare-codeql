// API layer for the KakiCare backend.
//
// All functions talk to the real Django backend over the session-cookie auth flow.
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
  ConfirmSessionResult,
  FollowUpOutcome,
  LoginResult,
  MfaResult,
  MfaSetupResult,
  Paginated,
  ProfileDocuments,
  ProfileSubmission,
  ProfileSubmissionResult,
  SeniorWritePayload,
  StaffApplicationDetail,
  StaffApplicationSummary,
  StaffAuditLogEntry,
  StaffMatch,
  StaffMatchStatus,
  StaffSeniorDetail,
  StaffSeniorSummary,
  StaffSession,
  User,
  UserRole,
  VerifyEmailResult,
  VolunteerMatch,
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

  async acceptInvite(token: string, newPassword: string): Promise<void> {
    await apiFetch('/api/auth/accept-invite', {
      method: 'POST',
      body: { token, new_password: newPassword },
    });
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    });
  },

  async getMfaStatus(): Promise<{ enrolled: boolean }> {
    return apiFetch<{ enrolled: boolean }>('/api/auth/mfa/status');
  },

  async disableMfa(): Promise<void> {
    await apiFetch('/api/auth/mfa/disable', { method: 'POST' });
  },

  // --- Volunteer profile completion -----------------------------------------
  // SECURITY: file-type/size checks in FileUpload are USABILITY ONLY — the
  // backend must independently validate content type, enforce size limits, and
  // store files outside the web root (SR-DATA-03/04).
  async submitProfile(
    data: ProfileSubmission,
    files: ProfileDocuments,
  ): Promise<ProfileSubmissionResult> {
    // Convert separate days/blocks selections into the backend's availability
    // format: { "Mon": ["Morning", "Afternoon"], "Sat": ["Evening"], ... }
    const availability: Record<string, string[]> = {};
    for (const day of data.availabilityDays) {
      availability[day] = [...data.availabilityBlocks];
    }

    // 1. Save profile fields. The backend automatically transitions status from
    //    incomplete → pending_review once all required fields are present.
    await apiFetch('/api/volunteer/profile/', {
      method: 'PATCH',
      body: {
        contact_number: data.phone,
        languages: data.languages,
        travel_areas: data.areas,
        availability,
        about_text: data.about,
      },
    });

    // 2. Upload documents via multipart (FormData); must NOT set Content-Type
    //    manually — the browser adds the correct boundary automatically.
    async function uploadDoc(file: File, documentType: 'identity' | 'declaration') {
      const form = new FormData();
      form.append('document_type', documentType);
      form.append('file', file);
      const res = await fetch(`${BASE_URL}/api/volunteer/documents/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRFToken': getCsrfToken() },
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        throw new ApiError(res.status, (body?.detail as string) || res.statusText, body);
      }
    }

    await uploadDoc(files.identityDocument, 'identity');
    await uploadDoc(files.declarationForm, 'declaration');

    return { status: 'success' };
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
    pageSize?: number,
  ): Promise<Paginated<StaffApplicationSummary>> {
    const qs = new URLSearchParams({ status: statusFilter });
    if (page && page > 1) qs.set('page', String(page));
    if (pageSize) qs.set('page_size', String(pageSize));
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

  async getStaffSessions(params?: {
    status?: string;
    page?: number;
    page_size?: number;
  }): Promise<Paginated<StaffSession>> {
    const qs = new URLSearchParams({ page_size: String(params?.page_size ?? 20) });
    if (params?.status) qs.set('status', params.status);
    if (params?.page && params.page > 1) qs.set('page', String(params.page));
    return apiFetch<Paginated<StaffSession>>(`/api/staff/sessions/?${qs}`);
  },

  // AC-04: The confirmation endpoint returns the raw 6-digit check-in code
  // exactly ONCE. Only its SHA-256 hash is stored server-side — the raw code
  // cannot be retrieved after this response. Display it to the staff member
  // immediately; NEVER write it to localStorage, sessionStorage, or any store
  // that outlives the active modal. The code travels out-of-band:
  //   staff → senior (phone call) → volunteer (in person at session start).
  // The volunteer never sees the code in advance — this relay is what makes
  // check-in a proof-of-presence control (AC-04).
  async confirmSession(id: number): Promise<ConfirmSessionResult> {
    return apiFetch<ConfirmSessionResult>(`/api/staff/sessions/${id}/confirm/`, {
      method: 'POST',
    });
  },

  async cancelSession(id: number, cancelReason: string): Promise<StaffSession> {
    return apiFetch<StaffSession>(`/api/staff/sessions/${id}/cancel/`, {
      method: 'POST',
      body: { cancel_reason: cancelReason },
    });
  },

  // WELFARE NOTE: a missed session means a vulnerable senior was not visited or
  // called as expected. Recording the follow-up outcome closes the welfare concern.
  async recordSessionFollowup(
    id: number,
    followupOutcome: FollowUpOutcome,
    followupNote: string,
  ): Promise<StaffSession> {
    return apiFetch<StaffSession>(`/api/staff/sessions/${id}/followup/`, {
      method: 'POST',
      body: { followup_outcome: followupOutcome, followup_note: followupNote },
    });
  },

  // --- Staff senior management (real) --------------------------------------
  // SECURITY: Senior data is the most sensitive in the system. Do not cache
  // responses in localStorage/sessionStorage. Every read/write is audit-logged
  // server-side (AC-06, SR-AUD-01); the frontend does nothing special for audit.

  async getSeniors(params?: {
    search?: string;
    is_active?: boolean;
    page?: number;
    page_size?: number;
  }): Promise<Paginated<StaffSeniorSummary>> {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.is_active !== undefined) qs.set('is_active', String(params.is_active));
    if (params?.page && params.page > 1) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    return apiFetch<Paginated<StaffSeniorSummary>>(`/api/staff/seniors/?${qs}`);
  },

  async getSenior(id: number): Promise<StaffSeniorDetail> {
    return apiFetch<StaffSeniorDetail>(`/api/staff/seniors/${id}/`);
  },

  async createSenior(payload: SeniorWritePayload): Promise<StaffSeniorDetail> {
    return apiFetch<StaffSeniorDetail>('/api/staff/seniors/', {
      method: 'POST',
      body: payload,
    });
  },

  async updateSenior(id: number, payload: SeniorWritePayload): Promise<StaffSeniorDetail> {
    return apiFetch<StaffSeniorDetail>(`/api/staff/seniors/${id}/`, {
      method: 'PUT',
      body: payload,
    });
  },

  async deactivateSenior(id: number): Promise<StaffSeniorDetail> {
    // Soft-deactivate only — all session history and matches are preserved.
    return apiFetch<StaffSeniorDetail>(`/api/staff/seniors/${id}/deactivate/`, {
      method: 'POST',
    });
  },

  // --- Staff match management (real) ---------------------------------------
  // SECURITY: Staff-only. The backend enforces that only approved volunteers
  // can be matched and that non-ended duplicate pairings are rejected.
  // The "approved volunteer" filter in the dropdown is a usability aid only.
  // AC-05: Surfacing all pairings helps staff spot repeat targeting.

  async getMatches(params?: {
    status?: StaffMatchStatus | '';
    volunteer_id?: number;
    senior_id?: number;
    page?: number;
  }): Promise<Paginated<StaffMatch>> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.volunteer_id) qs.set('volunteer_id', String(params.volunteer_id));
    if (params?.senior_id) qs.set('senior_id', String(params.senior_id));
    if (params?.page && params.page > 1) qs.set('page', String(params.page));
    return apiFetch<Paginated<StaffMatch>>(`/api/staff/matches/?${qs}`);
  },

  async proposeMatch(volunteerId: number, seniorId: number): Promise<StaffMatch> {
    return apiFetch<StaffMatch>('/api/staff/matches/', {
      method: 'POST',
      body: { volunteer_id: volunteerId, senior_id: seniorId },
    });
  },

  async recordSeniorConfirmation(matchId: number): Promise<StaffMatch> {
    return apiFetch<StaffMatch>(
      `/api/staff/matches/${matchId}/record-senior-confirmation/`,
      { method: 'POST' },
    );
  },

  async endMatch(matchId: number): Promise<StaffMatch> {
    return apiFetch<StaffMatch>(`/api/staff/matches/${matchId}/end/`, {
      method: 'POST',
    });
  },

  // --- Audit log (real) ----------------------------------------------------
  // SECURITY (SR-AUD-02): The audit log is append-only — there is no
  // create/update/delete here intentionally. GET only.
  async getAuditLog(params?: {
    action?: string;
    target_type?: string;
    target_id?: string;
    user_id?: number;
    timestamp_after?: string;
    timestamp_before?: string;
    page?: number;
    page_size?: number;
  }): Promise<Paginated<StaffAuditLogEntry>> {
    const qs = new URLSearchParams();
    if (params?.action) qs.set('action', params.action);
    if (params?.target_type) qs.set('target_type', params.target_type);
    if (params?.target_id) qs.set('target_id', params.target_id);
    if (params?.user_id) qs.set('user_id', String(params.user_id));
    if (params?.timestamp_after) qs.set('timestamp_after', params.timestamp_after);
    if (params?.timestamp_before) qs.set('timestamp_before', params.timestamp_before);
    if (params?.page && params.page > 1) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    const query = qs.toString();
    return apiFetch<Paginated<StaffAuditLogEntry>>(
      `/api/staff/audit-log/${query ? `?${query}` : ''}`,
    );
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
