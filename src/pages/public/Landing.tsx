import { Link } from 'react-router-dom';
import { Button } from '@/components';

export function Landing() {
  return (
    <section className="py-8">
      <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-primary-900 sm:text-5xl">
        A friendly visit can change someone's day.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-primary-700">
        KakiCare connects vetted community volunteers with seniors in our
        befriending programme — coordinated safely by our staff.
      </p>
      <div className="mt-8 flex gap-3">
        <Link to="/register">
          <Button size="lg">Become a volunteer</Button>
        </Link>
        <Link to="/login">
          <Button size="lg" variant="secondary">
            Log in
          </Button>
        </Link>
      </div>
    </section>
  );
}
