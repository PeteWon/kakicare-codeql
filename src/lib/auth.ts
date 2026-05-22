// Auth helpers for KakiCare.
//
// We implement authentication OURSELVES (no OAuth, no third-party auth library).
// The real session is expected to live in an httpOnly cookie set by the backend,
// which JS cannot read — that is intentional and is the secure approach. This
// module therefore only deals with the *client-side view* of who is logged in
// (fetched from the server), plus small role helpers. It holds no tokens.

import type { User, UserRole } from './types';
import { api } from './api';

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
