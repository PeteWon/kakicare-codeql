import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section className="py-16 text-center">
      <h1 className="text-3xl font-semibold text-primary-900">Page not found</h1>
      <p className="mt-2 text-primary-600">
        We couldn't find the page you were looking for.
      </p>
      <Link to="/" className="mt-4 inline-block text-primary-700 underline">
        Back to home
      </Link>
    </section>
  );
}
