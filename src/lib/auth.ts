// Auth helpers for KakiCare.
//
// We implement authentication OURSELVES (no OAuth, no third-party auth library).
// The real session is expected to live in an httpOnly cookie set by the backend,
// which JS cannot read — that is intentional and is the secure approach. This
// module therefore only deals with the *client-side view* of who is logged in
// (fetched from the server), plus small role helpers. It holds no tokens.

import type { User, UserRole } from './types';
import { api } from './api';

// MOCK current user used by ProtectedRoute for client-side route gating.
//
// This is TEMPORARY. Once the backend exists this is replaced by a real check:
// a call to GET /api/auth/me that reads the HttpOnly session cookie (the cookie
// is sent automatically with credentials: 'include'; JS never sees the token).
// That call is async, so ProtectedRoute will gain a loading state at that point.
//
// To exercise the different route outcomes during development, change the
// returned value below: the volunteer user, a staff user (`role: 'staff'`), or
// `null` to simulate a logged-out visitor (which redirects to /login).
const MOCK_CURRENT_USER: User | null = {
  id: 'usr_1',
  email: 'volunteer@example.com',
  fullName: 'Aisha Rahman',
  role: 'volunteer',
  emailVerifiedAt: '2026-05-01T09:00:00Z',
  createdAt: '2026-04-20T09:00:00Z',
};

/** Synchronously return the current user (or null). */
export function getCurrentUser(): User | null {
  return MOCK_CURRENT_USER; // MOCK — replace with real session check (see above)
}

/** Fetch the current user from the server, or null if not authenticated. */
export async function fetchCurrentUser(): Promise<User | null> {
  try {
    return await api.getCurrentUser();
  } catch {
    return null;
  }
}

export function hasRole(user: User | null, role: UserRole): boolean {
  return user?.role === role;
}

export function isVolunteer(user: User | null): boolean {
  return hasRole(user, 'volunteer');
}

export function isStaff(user: User | null): boolean {
  return hasRole(user, 'staff');
}

/** Where a user should land after logging in, based on their role. */
export function homePathForRole(role: UserRole): string {
  return role === 'staff' ? '/staff' : '/volunteer';
}
