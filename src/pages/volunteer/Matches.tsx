// SECURITY NOTE: This page renders only the limited senior info the backend
// returns for /api/volunteer/matches/. The backend enforces data minimisation
// at SR-AUTHZ-02/03: no address, phone number, or next-of-kin is ever sent
// at this endpoint. Do NOT extend these types or add UI expecting those fields —
// full contact details are disclosed just-in-time at session time only.
// Route protection here is UX only; the backend enforces real authorisation.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Button, Card, CardTitle } from '@/components';
import type { VolunteerMatch } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Proposed match card — shows Accept / Decline with inline confirmation
// ---------------------------------------------------------------------------

type CardState =
  | 'idle'
  | 'confirming_accept'
  | 'confirming_decline'
  | 'loading';

function ProposedMatchCard({
  match,
  onAction,
}: {
  match: VolunteerMatch;
  onAction: () => void;
}) {
  const [state, setState] = useState<CardState>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAccept() {
    setState('loading');
    setActionError(null);
    try {
      await api.acceptMatch(match.id);
      onAction();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? 'This match is no longer available.'
          : 'Something went wrong. Please try again.';
      setActionError(message);
      setState('idle');
    }
  }

  async function handleDecline() {
    setState('loading');
    setActionError(null);
    try {
      await api.declineMatch(match.id);
      onAction();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? 'This match is no longer available.'
          : 'Something went wrong. Please try again.';
      setActionError(message);
      setState('idle');
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-primary-900">{match.senior.first_name}</p>
          <p className="mt-0.5 text-sm text-primary-600">
            {[match.senior.preferred_language, match.senior.locality]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-0.5 text-xs text-primary-400">
            Proposed {formatDate(match.created_at)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          Proposed
        </span>
      </div>

      {actionError && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {actionError}
        </p>
      )}

      <div className="mt-4">
        {state === 'idle' && (
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setState('confirming_accept')}
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setState('confirming_decline')}
            >
              Decline
            </Button>
          </div>
        )}

        {state === 'confirming_accept' && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary-800">
              Accept this befriending match?
            </p>
            <p className="text-xs text-primary-500">
              You'll be paired with {match.senior.first_name} once senior consent is
              also recorded by our team.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleAccept}>
                Yes, accept
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setState('idle')}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {state === 'confirming_decline' && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary-800">
              Decline this match?
            </p>
            <p className="text-xs text-primary-500">
              This cannot be undone. Our team will be notified.
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="border-red-200 text-red-700 hover:bg-red-50"
                onClick={handleDecline}
              >
                Yes, decline
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setState('idle')}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {state === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-primary-500">
            <span
              aria-hidden
              className="h-4 w-4 animate-spin rounded-full border-2 border-primary-100 border-t-primary-500"
            />
            Processing…
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Active match card — shows senior info (limited) and session booking link
// ---------------------------------------------------------------------------

function ActiveMatchCard({ match }: { match: VolunteerMatch }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-primary-900">{match.senior.first_name}</p>
          <p className="mt-0.5 text-sm text-primary-600">
            {[match.senior.preferred_language, match.senior.locality]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-0.5 text-xs text-primary-400">
            Matched since {formatDate(match.created_at)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800">
          Active
        </span>
      </div>

      <div className="mt-4">
        {/*
          Session booking screen is coming in a later sprint.
          Full senior contact details (address, phone, next-of-kin) are only
          disclosed just-in-time when a session is confirmed — NOT here.
        */}
        <Link
          to={`/volunteer/sessions/new?match_id=${match.id}`}
          aria-label={`Book a session with ${match.senior.first_name}`}
        >
          <Button variant="secondary" size="sm">
            Book a session
          </Button>
        </Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Matches() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<VolunteerMatch[]>([]);

  const loadMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getVolunteerMatches();
      setMatches(data.results);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(
          'Your application must be approved before you can view matches.',
        );
      } else {
        setError('Could not load matches. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  const proposedMatches = matches.filter((m) => m.status === 'proposed');
  const activeMatches = matches.filter((m) => m.status === 'active');

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-primary-900">
        Your matches
      </h1>

      {loading && (
        <div className="flex justify-center py-10">
          <span
            role="status"
            aria-label="Loading matches…"
            className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
          />
        </div>
      )}

      {!loading && error && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => void loadMatches()}>
              Try again
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && (
        <>
          {/* ---- Proposed matches — need a response ---- */}
          {proposedMatches.length > 0 && (
            <section aria-labelledby="proposed-heading">
              <div className="mb-3">
                <CardTitle id="proposed-heading">Waiting for your response</CardTitle>
                <p className="mt-1 text-sm text-primary-600">
                  These matches were proposed by our team. Let us know if you'd
                  like to accept.
                </p>
              </div>
              <div className="space-y-3">
                {proposedMatches.map((m) => (
                  <ProposedMatchCard
                    key={m.id}
                    match={m}
                    onAction={() => void loadMatches()}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ---- Active matches ---- */}
          <section aria-labelledby="active-heading">
            <div className="mb-3">
              <CardTitle id="active-heading">Active matches</CardTitle>
            </div>

            {activeMatches.length === 0 ? (
              <Card>
                <p className="text-sm text-primary-600">
                  {proposedMatches.length > 0
                    ? 'No active matches yet. Accept a proposed match above to get started.'
                    : 'No matches yet. Our team will propose a befriending match when one is ready for you.'}
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {activeMatches.map((m) => (
                  <ActiveMatchCard key={m.id} match={m} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
