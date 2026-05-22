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
  | { status: 'success' } // logged in (e.g. volunteer, no MFA) — session cookie set
  | { status: 'mfa_required' } // credentials OK, TOTP step required (e.g. staff)
  | { status: 'invalid' }; // generic failure — never reveal the reason

export type MfaResult =
  | { status: 'success' } // TOTP verified — session cookie set
  | { status: 'invalid' }; // wrong/expired code — generic failure

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
