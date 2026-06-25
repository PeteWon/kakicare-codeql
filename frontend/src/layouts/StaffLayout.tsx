// SECURITY NOTE: Log out must destroy the server session, not just clear
// client state. api.logout() calls POST /api/auth/logout which invalidates
// the HttpOnly session cookie server-side.

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

const NAV_ITEMS = [
  { to: '/staff', label: 'Dashboard', end: true },
  { to: '/staff/applications', label: 'Applications' },
  { to: '/staff/seniors', label: 'Seniors' },
  { to: '/staff/matches', label: 'Matches' },
  { to: '/staff/sessions', label: 'Sessions' },
  { to: '/staff/mfa-resets', label: 'MFA resets' },
  { to: '/staff/audit-log', label: 'Audit log' },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-2 text-sm ${
    isActive
      ? 'bg-primary-50 font-medium text-primary-800'
      : 'text-primary-600 hover:bg-primary-50'
  }`;

/**
 * Layout for the staff area. Desktop-oriented with a persistent sidebar.
 * A compact horizontal nav is shown on narrow screens.
 */
export function StaffLayout() {
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // Best-effort — redirect regardless.
    }
    navigate('/');
  }

  return (
    <div className="flex min-h-screen bg-cream">
      {/* ---- Sidebar (md+) ---- */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-cream-300 bg-white md:flex">
        <div className="px-5 py-5 font-serif text-xl font-semibold text-primary-700">
          KakiCare
          <span className="ml-1 align-top font-sans text-xs text-primary-400">Staff</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-cream-200 px-3 py-3">
          <button
            onClick={() => void handleLogout()}
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-primary-600 hover:bg-primary-50"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* ---- Compact top nav (below md) ---- */}
        <header className="border-b border-cream-300 bg-white md:hidden">
          <div className="flex items-center gap-3 overflow-x-auto px-4 py-3">
            <span className="font-serif font-semibold text-primary-700">KakiCare</span>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `whitespace-nowrap text-sm ${
                    isActive ? 'text-primary-800' : 'text-primary-500'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <button
              onClick={() => void handleLogout()}
              className="ml-auto whitespace-nowrap text-sm text-primary-500 hover:text-primary-800"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
