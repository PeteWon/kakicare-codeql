import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/volunteer', label: 'Home', end: true },
  { to: '/volunteer/matches', label: 'Matches' },
  { to: '/volunteer/profile', label: 'Profile' },
];
// 'Visits/Sessions' tab will replace or extend 'Matches' when the session
// booking and check-in screens are built in a later sprint.

/**
 * Layout for the volunteer area. Mobile-first: a bottom tab bar on small
 * screens (volunteers use phones in the field), promoted to a top bar on wider
 * screens.
 */
export function VolunteerLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <header className="border-b border-cream-300 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="font-serif text-lg font-semibold text-primary-700">
            KakiCare
          </span>
          {/* Top nav appears from sm upward. */}
          <nav className="hidden gap-2 sm:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-xl px-3 py-2 text-sm ${
                    isActive
                      ? 'bg-primary-50 text-primary-800'
                      : 'text-primary-600 hover:bg-primary-50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 pb-24 sm:pb-6">
        <Outlet />
      </main>

      {/* Bottom tab bar for phones. */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-cream-300 bg-white sm:hidden">
        <div className="mx-auto flex max-w-3xl">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 text-xs ${
                  isActive ? 'text-primary-700' : 'text-primary-400'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
