import { Navigate, Outlet } from 'react-router-dom';
import { getCurrentUser } from '@/lib/auth';
import type { UserRole } from '@/lib/types';

// Guards a route group by required role.
//
// SECURITY NOTE: client-side route protection is a UX CONVENIENCE ONLY. It
// keeps honest users from landing on pages meant for another role, but it is
// NOT a security control — anyone can bypass it (edit the bundle, hit the API
// directly, etc.). Every protected API endpoint MUST independently enforce
// authentication and authorisation on the backend. Hiding a page here does not
// protect the data behind it.

interface ProtectedRouteProps {
  role: UserRole;
}

export function ProtectedRoute({ role }: ProtectedRouteProps) {
  // MOCK: reads a hardcoded user from auth.ts. Will become an async check
  // against GET /api/auth/me once the backend exists (and gain a loading state).
  const user = getCurrentUser();

  if (!user) {
    // Not logged in → send to login.
    return <Navigate to="/login" replace />;
  }

  if (user.role !== role) {
    // Logged in but wrong role for this area.
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
