// Auth helpers for KakiCare.
//
// We implement authentication OURSELVES (no OAuth, no third-party auth library).
// The real session lives in an HttpOnly cookie set by the backend — JS cannot
// read the cookie value, which is intentional. Auth state is determined only by
// calling GET /api/auth/me and inspecting the response.
//
// There is no synchronous "get current user" — auth is always an async server
// check. ProtectedRoute handles the loading state while the check is in flight.

import type { User, UserRole } from './types';
import { api } from './api';

/**
 * Fetch the current user from the server.
 * Returns null if not authenticated or if the request fails (network error, 401).
 */
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
