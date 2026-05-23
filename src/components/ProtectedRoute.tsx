import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { fetchCurrentUser } from '@/lib/auth';
import type { User, UserRole } from '@/lib/types';

// Guards a route group by required role.
//
// SECURITY NOTE: client-side route protection is a UX CONVENIENCE ONLY. It
// keeps honest users from landing on pages meant for another role, but it is
// NOT a security control — anyone can bypass it. Every protected API endpoint
// MUST independently enforce authentication and authorisation on the backend.

interface ProtectedRouteProps {
  role: UserRole;
}

type AuthState = 'loading' | User | null;

export function ProtectedRoute({ role }: ProtectedRouteProps) {
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    fetchCurrentUser().then((user) => setAuthState(user));
  }, []);

  if (authState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <span
          role="status"
          aria-label="Checking authentication…"
          className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
        />
      </div>
    );
  }

  if (!authState || authState.role !== role) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
