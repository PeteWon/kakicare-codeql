import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { fetchCurrentUser, homePathForRole } from '@/lib/auth';
import type { User } from '@/lib/types';

/**
 * Checks the current session and redirects:
 *   - authenticated → homePathForRole (role-aware)
 *   - not authenticated → /login
 *
 * Used for vanity paths like /dashboard that have no canonical role.
 */
export function SmartRedirect() {
  const [user, setUser] = useState<User | null | 'loading'>('loading');

  useEffect(() => {
    fetchCurrentUser().then(setUser);
  }, []);

  if (user === 'loading') return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homePathForRole(user.role)} replace />;
}
