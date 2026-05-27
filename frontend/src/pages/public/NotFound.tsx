import { Link } from 'react-router-dom';
import { Button } from '@/components';

export function NotFound() {
  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <p className="font-serif text-6xl font-semibold text-primary-300">404</p>
      <h1 className="mt-4 text-3xl font-semibold text-primary-900">
        We can't find that page
      </h1>
      <p className="mt-2 text-primary-600">
        The page you were looking for may have moved or no longer exists. Let's
        get you back on track.
      </p>
      <Link to="/" className="mt-6 inline-block">
        <Button size="lg">Back to home</Button>
      </Link>
    </section>
  );
}
