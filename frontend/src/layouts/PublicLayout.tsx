import { Link, Outlet } from 'react-router-dom';

/** Layout for shared public pages (landing, login, register, verify email). */
export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <header className="border-b border-cream-300">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="font-serif text-xl font-semibold text-primary-700">
            KakiCare
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/login" className="text-primary-700 hover:text-primary-900">
              Log in
            </Link>
            <Link
              to="/register"
              className="rounded-xl bg-primary-500 px-4 py-2 text-white hover:bg-primary-600"
            >
              Volunteer with us
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 flex flex-col">
        <Outlet />
      </main>

      <footer className="border-t border-cream-300">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-primary-400">
          KakiCare — Connecting Hearts, Supporting Seniors.{' '}
          <Link to="/contact" className="hover:text-primary-600">
            Contact us
          </Link>
        </div>
      </footer>
    </div>
  );
}
