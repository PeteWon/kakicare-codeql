import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/staff', label: 'Dashboard', end: true },
  { to: '/staff/volunteers', label: 'Volunteers' },
  { to: '/staff/seniors', label: 'Seniors' },
  { to: '/staff/matches', label: 'Matches' },
  { to: '/staff/audit', label: 'Audit log' },
];

/**
 * Layout for the staff area. Desktop-oriented with a persistent sidebar — staff
 * manage volunteers, seniors, matches and review the audit log.
 */
export function StaffLayout() {
  return (
    <div className="flex min-h-screen bg-cream">
      <aside className="hidden w-60 shrink-0 border-r border-cream-300 bg-white md:block">
        <div className="px-5 py-5 font-serif text-xl font-semibold text-primary-700">
          KakiCare
          <span className="ml-1 align-top text-xs font-sans text-primary-400">
            Staff
          </span>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-xl px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-primary-50 font-medium text-primary-800'
                    : 'text-primary-600 hover:bg-primary-50'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Compact top nav for narrow screens. */}
        <header className="border-b border-cream-300 bg-white md:hidden">
          <div className="flex items-center gap-3 overflow-x-auto px-4 py-3">
            <span className="font-serif font-semibold text-primary-700">KakiCare</span>
            {navItems.map((item) => (
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
          </div>
        </header>

        <main className="flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
