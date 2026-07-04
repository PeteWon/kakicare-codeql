// SECURITY NOTE: Log out must destroy the server session, not just clear
// client state. api.logout() calls POST /api/auth/logout which invalidates
// the HttpOnly session cookie server-side. The redirect to '/' then removes
// the volunteer from any protected route (UX). The backend remains
// authoritative — a client-side-only "logout" would leave the session alive.

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { SkipLink } from '@/components';

const NAV_ITEMS: { to: string; label: string; end: boolean }[] = [
  { to: '/volunteer', label: 'Dashboard', end: true },
  { to: '/volunteer/matches', label: 'My Matches', end: false },
  { to: '/volunteer/sessions', label: 'My Sessions', end: false },
  { to: '/volunteer/profile', label: 'Profile', end: false },
  { to: '/volunteer/account', label: 'Account', end: false },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-2 text-sm ${
    isActive
      ? 'bg-primary-50 text-primary-800'
      : 'text-primary-600 hover:bg-primary-50'
  }`;

const tabLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-1 py-3 text-xs ${
    isActive ? 'text-primary-700' : 'text-primary-400'
  }`;

/**
 * Layout for the volunteer area. Mobile-first: a bottom tab bar on small
 * screens (volunteers use phones in the field), promoted to a top nav on
 * wider screens. Sign out is in the header on all screen sizes.
 */
export function VolunteerLayout() {
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // Best-effort — redirect regardless. An unreachable server still means
      // the user wants to leave; any subsequent authenticated request will 401.
    }
    navigate('/');
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <SkipLink />
      <header className="border-b border-cream-300 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="font-serif text-lg font-semibold text-primary-700">
            KakiCare
          </span>

          <div className="flex items-center gap-1">
            {/* Top nav — hidden on mobile (use bottom tab bar instead). */}
            <nav className="hidden gap-1 sm:flex">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <button
              onClick={() => void handleLogout()}
              className="rounded-xl px-3 py-2 text-sm text-primary-600 hover:bg-primary-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Extra bottom padding on mobile so content clears the fixed tab bar. */}
      <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 pb-24 sm:pb-6">
        <Outlet />
      </main>

      {/* Bottom tab bar — phones only (sm:hidden). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-cream-300 bg-white sm:hidden"
        aria-label="Main navigation"
      >
        <div className="mx-auto flex max-w-3xl">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={tabLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
