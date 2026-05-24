// Core domain types for KakiCare.
//
// These interfaces MIRROR THE BACKEND MODELS. They are the shape the frontend
// expects to receive from / send to the API. Keep them in sync with the backend
// schema — when a backend model changes, update the matching interface here.
//
// Seniors are NOT users: they never authenticate. They are records managed by
// staff. Only volunteers and staff are `User`s.

export type UserRole = 'volunteer' | 'staff';

export type ISODateString = string; // e.g. "2026-05-22T08:30:00Z"

// --- Authentication results --------------------------------------------------
// Outcomes the backend can return from a login attempt. The frontend does not
// know in advance whether an email is a volunteer or staff account — the flow
// is driven entirely by these responses.
//
// SECURITY: 'invalid' is intentionally a single, reason-less outcome. The
// backend MUST return the same generic failure whether the email is unknown,
// the password is wrong, or the account is inactive (prevents account
// enumeration — SR-AUTH-06).

export type LoginResult =
  | { status: 'success'; role: UserRole } // logged in — session cookie set
  | { status: 'mfa_required'; mfa_enrolled: boolean } // TOTP step required
  | { status: 'invalid' }; // generic failure — never reveal the reason

export type MfaResult =
  | { status: 'success'; role: UserRole } // verified — session cookie set
  | { status: 'enrolled' } // new TOTP device confirmed (post-login enrolment)
  | { status: 'invalid' }; // wrong/expired code — generic failure

export interface MfaSetupResult {
  config_url: string;  // otpauth:// URI for authenticator apps
  secret_key: string;  // base32 secret for manual entry
  backup_codes: string[]; // raw codes — shown exactly once, never stored
}

// Result of clicking an email-verification link.
//
// SECURITY: 'invalid' is a single, reason-less outcome. The backend MUST return
// the same failure whether the token is unknown, already used, or expired —
// never reveal token state (consistent with our anti-enumeration stance).
export type VerifyEmailResult =
  | { status: 'success' } // token accepted, account activated
  | { status: 'invalid' }; // invalid / used / expired — generic failure

// --- Volunteer profile completion --------------------------------------------

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type TimeBlock = 'Morning' | 'Afternoon' | 'Evening';
export type Region = 'North' | 'South' | 'East' | 'West' | 'Central';

/** Profile data a volunteer submits for staff vetting (excludes the files). */
export interface ProfileSubmission {
  phone: string;
  languages: string[];
  areas: Region[];
  availabilityDays: Weekday[];
  availabilityBlocks: TimeBlock[];
  about: string; // optional free text, max 500 chars
}

/** The two documents a volunteer must upload alongside their profile. */
export interface ProfileDocuments {
  identityDocument: File;
  declarationForm: File;
}

export type ProfileSubmissionResult =
  | { status: 'success' } // application now pending staff review
  | { status: 'error' }; // generic failure — surface a retry, no detail

/** An authenticated account. Either a volunteer or a staff member. */
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /** Set once the user has confirmed their email address. */
  emailVerifiedAt: ISODateString | null;
  createdAt: ISODateString;
}

/** Lifecycle of a volunteer application/account, vetted by staff. */
export type VolunteerStatus =
  | 'pending' // applied, awaiting review
  | 'approved' // vetted and active
  | 'rejected'
  | 'suspended';

/** Extended profile for a volunteer. Linked 1:1 with a `User` of role 'volunteer'. */
export interface VolunteerProfile {
  id: string;
  userId: string;
  phone: string;
  status: VolunteerStatus;
  /** Languages/dialects the volunteer can converse in (important locally). */
  languages: string[];
  /** Neighbourhoods / regions the volunteer can serve. */
  preferredAreas: string[];
  bio: string;
  /** Staff member who last reviewed this volunteer, if any. */
  reviewedByStaffId: string | null;
  reviewedAt: ISODateString | null;
  createdAt: ISODateString;
}

/** A senior in the befriending programme. Managed by staff; never logs in. */
export interface Senior {
  id: string;
  fullName: string;
  /** Approximate or exact age, depending on what staff recorded. */
  age: number | null;
  languages: string[];
  /** General area only; full address is sensitive and access-controlled. */
  area: string;
  /** Free-text notes on needs, mobility, preferences. */
  careNotes: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdByStaffId: string;
  createdAt: ISODateString;
}

export type MatchStatus = 'active' | 'paused' | 'ended';

/** A pairing between an approved volunteer and a senior, created by staff. */
export interface Match {
  id: string;
  volunteerId: string; // VolunteerProfile.id
  seniorId: string; // Senior.id
  status: MatchStatus;
  startedAt: ISODateString;
  endedAt: ISODateString | null;
  createdByStaffId: string;
}

export type SessionType = 'visit' | 'call';

/** A logged befriending interaction (visit or phone call) under a match. */
export interface Session {
  id: string;
  matchId: string;
  type: SessionType;
  occurredAt: ISODateString;
  /** Duration in minutes. */
  durationMinutes: number;
  /** Volunteer's notes about how the senior is doing. */
  notes: string;
  /** Optional flag the volunteer can raise for staff attention. */
  concernRaised: boolean;
  createdAt: ISODateString;
}

// ---------------------------------------------------------------------------
// Volunteer-facing backend types (real API shapes, snake_case from Django)
// ---------------------------------------------------------------------------

/** DRF paginated response wrapper. */
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * Limited senior info — the ONLY senior data the backend sends to volunteers
 * on the matches endpoint (SR-AUTHZ-02/03 data minimisation).
 *
 * SECURITY: Do NOT add address, phone, or next_of_kin fields here. The
 * backend deliberately omits them. Full contact details are disclosed
 * just-in-time at session time only (see VolunteerSession).
 */
export interface VolunteerMatchSenior {
  id: number;
  first_name: string;
  preferred_language: string;
  locality: string;
}

export type VolunteerMatchStatus = 'proposed' | 'active' | 'ended';

/** A match as returned by GET /api/volunteer/matches/ */
export interface VolunteerMatch {
  id: number;
  status: VolunteerMatchStatus;
  senior: VolunteerMatchSenior;
  volunteer_accepted_at: string | null;
  senior_confirmed_at: string | null;
  created_at: string;
}

export type SessionStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'missed'
  | 'cancelled';

/** Senior info embedded in a session response. May be limited or full
 *  depending on whether the JIT disclosure window is open. */
export interface SessionSenior {
  id: number;
  // Always present (limited view)
  first_name?: string;
  preferred_language: string;
  locality?: string;
  // Present only inside the JIT disclosure window
  full_name?: string;
  address?: string;
  phone_number?: string;
  next_of_kin_name?: string;
  next_of_kin_contact?: string;
}

/** A session as returned by GET /api/volunteer/sessions/ */
export interface VolunteerSession {
  id: number;
  session_type: 'visit' | 'call';
  scheduled_start: string;
  scheduled_end: string;
  status: SessionStatus;
  checkin_at: string | null;
  checkout_at: string | null;
  volunteer_note: string | null;
  /** Whether the JIT disclosure window is currently open (server-computed). */
  jit_disclosure_active: boolean;
  senior: SessionSenior;
  created_at: string;
}

export type ApplicationStatus =
  | 'incomplete'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'changes_requested';

/** Volunteer's own profile from GET /api/volunteer/profile/ */
export interface VolunteerProfileData {
  id: number;
  contact_number: string;
  languages: string[];
  travel_areas: string[];
  availability: Record<string, string[]>;
  about_text: string;
  application_status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Staff-facing types
// ---------------------------------------------------------------------------

/**
 * A document uploaded by a volunteer.
 *
 * SECURITY (SR-DATA-03): download_url points to /api/volunteer/documents/<id>/download,
 * which requires an authenticated session. Never embed it as a public <img src> or
 * plain <a href> — always fetch with credentials and create a local object URL.
 */
export interface DocumentInfo {
  id: number;
  document_type: 'identity' | 'declaration';
  original_filename: string;
  content_type: string; // server-detected MIME; never trust client-supplied value
  uploaded_at: ISODateString;
  download_url: string; // relative path, e.g. /api/volunteer/documents/3/download
}

/** Volunteer application summary — staff list view (no documents, no internal note). */
export interface StaffApplicationSummary {
  id: number;
  user_id: number;
  user_email: string;
  user_full_name: string;
  contact_number: string;
  languages: string[];
  travel_areas: string[];
  application_status: ApplicationStatus;
  reviewed_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Full application detail — staff only.
 *
 * SECURITY: internal_review_note is staff-only. It must NEVER be rendered in
 * any volunteer-facing page, included in a volunteer-facing API response, or
 * forwarded to the volunteer in any notification. The backend enforces this by
 * using separate serializer classes; displaying it on this staff-only page is
 * correct and intended.
 */
export interface StaffApplicationDetail extends StaffApplicationSummary {
  availability: Record<string, string[]>;
  about_text: string;
  internal_review_note: string;
  reviewed_by_id: number | null;
  reviewed_by_email: string | null;
  documents: DocumentInfo[];
}

/** Session as returned by the staff sessions endpoint — full senior & volunteer details. */
export interface StaffSession {
  id: number;
  match_id: number;
  session_type: 'visit' | 'call';
  scheduled_start: ISODateString;
  scheduled_end: ISODateString;
  status: SessionStatus;
  checkin_at: ISODateString | null;
  checkout_at: ISODateString | null;
  volunteer_note: string | null;
  confirmed_by_id: number | null;
  cancel_reason: string | null;
  followup_outcome: string | null;
  followup_note: string | null;
  senior: {
    id: number;
    full_name: string;
    address: string;
    phone_number: string;
    preferred_language: string;
    next_of_kin_name: string | null;
    next_of_kin_contact: string | null;
  };
  volunteer: {
    id: number;
    full_name: string;
    email: string;
  };
  created_at: ISODateString;
}

// ---------------------------------------------------------------------------
// Staff senior management types
// ---------------------------------------------------------------------------

/**
 * Senior record summary — staff list view.
 *
 * SECURITY: Senior data is the most sensitive in the system. Never cache in
 * localStorage or sessionStorage. Keep in component state only, fetched live.
 * Every access is audit-logged server-side (AC-06, SR-AUD-01).
 */
export interface StaffSeniorSummary {
  id: number;
  full_name: string;
  preferred_language: string;
  address: string;
  is_active: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Full senior record — staff only.
 *
 * Every GET /api/staff/seniors/<id> is audit-logged server-side as senior.read
 * (AC-06, SR-AUD-01). The frontend does nothing special; the backend records it.
 */
export interface StaffSeniorDetail extends StaffSeniorSummary {
  phone_number: string;
  accessibility_needs: string;
  availability: Record<string, string[]>;
  notes: string;
  next_of_kin_name: string | null;
  next_of_kin_contact: string | null;
  created_by_id: number | null;
  created_by_email: string | null;
}

/** Payload for POST /api/staff/seniors and PUT /api/staff/seniors/<id>. */
export interface SeniorWritePayload {
  full_name: string;
  address: string;
  phone_number: string;
  preferred_language: string;
  accessibility_needs: string;
  availability: Record<string, string[]>;
  notes: string;
  next_of_kin_name: string;
  next_of_kin_contact: string;
  is_active?: boolean;
}

// ---------------------------------------------------------------------------
// Staff match management types
// ---------------------------------------------------------------------------

export type StaffMatchStatus = 'proposed' | 'active' | 'ended';

/**
 * A match as returned by GET /api/staff/matches/.
 *
 * SECURITY: Display only what the backend returns. Do not add senior contact
 * fields here — governed by the backend's data-minimisation rules.
 * AC-05: Listing all pairings for a volunteer helps staff spot repeat targeting
 * that may indicate stalking-type behaviour.
 */
export interface StaffMatch {
  id: number;
  status: StaffMatchStatus;
  volunteer: {
    id: number;
    full_name: string;
    email: string;
  };
  senior: {
    id: number;
    full_name: string;
    preferred_language: string;
  };
  volunteer_accepted_at: ISODateString | null;
  senior_confirmed_at: ISODateString | null;
  ended_at: ISODateString | null;
  created_at: ISODateString;
  created_by_id: number | null;
  created_by_email: string | null;
}

// ---------------------------------------------------------------------------

/** Append-only audit record. Security-relevant actions are logged server-side. */
export interface AuditLogEntry {
  id: string;
  /** Actor who performed the action (a User id), or null for system events. */
  actorId: string | null;
  action: string; // e.g. "volunteer.approved", "senior.viewed"
  /** Type of entity acted upon, e.g. "Senior", "Match". */
  targetType: string;
  targetId: string | null;
  /** Optional structured context (IP, before/after, etc.). */
  metadata: Record<string, unknown> | null;
  createdAt: ISODateString;
}
