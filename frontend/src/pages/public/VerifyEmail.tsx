import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card } from '@/components';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';

// SECURITY NOTES (KakiCare email verification — see security report):
//
// - The verification token is single-use and time-limited. That lifecycle is
//   enforced by the BACKEND, not the frontend. This page only forwards the
//   token and reflects the result.
//
// - The token is read from the query string and sent to the backend over
//   HTTPS. It must NEVER be logged to the console or stored in
//   localStorage/sessionStorage. Do not add such logging/persistence here.
//
// - The error message is identical whether the token is invalid, already used,
//   or expired — we do not leak token state (anti-enumeration stance).

const GENERIC_ERROR = 'This verification link is invalid or has expired.';

type Status = 'loading' | 'success' | 'error';

export function VerifyEmail() {
  usePageTitle('Verify your email');
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>('loading');
  // Guard against React StrictMode's double-invocation of effects in development.
  // StrictMode mounts → unmounts → remounts each component; without this, two
  // POST requests would fire for the same token, the first marking it used and
  // the second returning 400. useRef survives the StrictMode remount cycle.
  const hasVerified = useRef(false);

  useEffect(() => {
    const token = searchParams.get('token');

    // No token in the URL → straight to the error state, no backend call.
    if (!token) {
      setStatus('error');
      return;
    }

    if (hasVerified.current) return;
    hasVerified.current = true;

    api
      .verifyEmail(token)
      .then((result) => {
        setStatus(result.status === 'success' ? 'success' : 'error');
      })
      .catch(() => {
        setStatus('error');
      });
  }, [searchParams]);

  return (
    <section className="mx-auto max-w-md py-8">
      <Card className="text-center">
        {status === 'loading' ? (
          <div className="py-6">
            <span
              role="status"
              aria-live="polite"
              className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
            />
            <p className="mt-4 text-primary-700">Verifying your email…</p>
          </div>
        ) : status === 'success' ? (
          <div className="py-2">
            <h1 className="text-2xl font-semibold text-primary-900">
              Your email is verified
            </h1>
            <p className="mt-2 text-primary-600">
              Thank you! Your account is now active. Next, tell us a little about
              yourself so we can match you well.
            </p>
            <Link to="/volunteer/profile" className="mt-6 block">
              <Button fullWidth size="lg">
                Complete your volunteer profile
              </Button>
            </Link>
          </div>
        ) : (
          <div className="py-2">
            <h1 className="text-2xl font-semibold text-primary-900">
              Verification failed
            </h1>
            <p className="mt-2 text-primary-600">{GENERIC_ERROR}</p>
            {/* Placeholder action — wire to a "resend verification" flow later. */}
            <Link to="/register" className="mt-6 block">
              <Button fullWidth size="lg" variant="secondary">
                Request a new link
              </Button>
            </Link>
          </div>
        )}
      </Card>
    </section>
  );
}
