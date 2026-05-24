// SECURITY NOTE: Route protection here is UX only. The backend enforces real
// authorisation on every API endpoint. Sensitive senior info (address, phone,
// next-of-kin) is withheld by the backend at this level — the frontend renders
// only what the API returns (SR-AUTHZ-02/03).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button, Card, CardTitle } from '@/components';
import type {
  ApplicationStatus,
  User,
  VolunteerMatch,
  VolunteerProfileData,
  VolunteerSession,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <span
        role="status"
        aria-label="Loading…"
        className="h-10 w-10 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500"
      />
    </div>
  );
}

const statusConfig: Record<
  ApplicationStatus,
  {
    title: string;
    body: string;
    cta?: { label: string; to: string };
    bgClass: string;
  } | null
> = {
  approved: null,
  incomplete: {
    title: 'Complete your profile to get started',
    body: "We need a few more details before your application can be reviewed by our team.",
    cta: { label: 'Complete profile', to: '/volunteer/profile' },
    bgClass: 'bg-primary-50 border-primary-200',
  },
  pending_review: {
    title: 'Your application is under review',
    body: "Our team is reviewing your profile and documents. We'll be in touch as soon as possible.",
    bgClass: 'bg-amber-50 border-amber-200',
  },
  rejected: {
    title: 'Application not approved',
    body: 'Unfortunately your application was not approved at this time. Please contact us if you have any questions.',
    bgClass: 'bg-red-50 border-red-200',
  },
  changes_requested: {
    title: 'Changes requested',
    body: 'Our team has reviewed your application and requested some changes. Please update your profile.',
    cta: { label: 'Update profile', to: '/volunteer/profile' },
    bgClass: 'bg-amber-50 border-amber-200',
  },
};

function ApplicationStatusBanner({ status }: { status: ApplicationStatus }) {
  const cfg = statusConfig[status];
  if (!cfg) return null;
  return (
    <div className={`rounded-2xl border p-5 ${cfg.bgClass}`}>
      <p className="font-semibold text-primary-900">{cfg.title}</p>
      <p className="mt-1 text-sm text-primary-700">{cfg.body}</p>
      {cfg.cta && (
        <div className="mt-3">
          <Link to={cfg.cta.to}>
            <Button variant="primary" size="sm">{cfg.cta.label}</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function MatchesSummary({ matches }: { matches: VolunteerMatch[] }) {
  return (
    <section aria-labelledby="matches-heading">
      <div className="mb-3 flex items-center justify-between">
        <CardTitle id="matches-heading">Your matches</CardTitle>
        <Link
          to="/volunteer/matches"
          className="text-sm font-medium text-primary-600 hover:text-primary-800"
        >
          See all
        </Link>
      </div>

      {matches.length === 0 ? (
        <Card>
          <p className="text-sm text-primary-600">
            No active matches yet. We'll let you know when a befriending match is proposed for you.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {matches.map((m) => (
            <Card key={m.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-primary-900">{m.senior.first_name}</p>
                  <p className="mt-0.5 text-sm text-primary-600">
                    {[m.senior.preferred_language, m.senior.locality]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800">
                  Active
                </span>
              </div>
            </Card>
          ))}
          {matches.length >= 3 && (
            <Link
              to="/volunteer/matches"
              className="block text-center text-sm font-medium text-primary-600 hover:text-primary-800"
            >
              View all matches
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function SessionsSummary({ sessions }: { sessions: VolunteerSession[] }) {
  const sessionTypeLabel = (type: 'visit' | 'call') =>
    type === 'visit' ? 'Visit' : 'Call';

  const statusLabel: Record<string, string> = {
    pending_confirmation: 'Awaiting confirmation',
    confirmed: 'Confirmed',
  };

  return (
    <section aria-labelledby="sessions-heading">
      <div className="mb-3">
        <CardTitle id="sessions-heading">Upcoming sessions</CardTitle>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <p className="text-sm text-primary-600">
            No upcoming sessions. Once a session is booked, it will appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-primary-900">
                    {sessionTypeLabel(s.session_type)} with {s.senior.first_name ?? s.senior.full_name}
                  </p>
                  <p className="mt-0.5 text-sm text-primary-600">
                    {formatDateTime(s.scheduled_start)}
                  </p>
                  {s.senior.locality && (
                    <p className="text-sm text-primary-500">{s.senior.locality}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-cream-200 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                  {statusLabel[s.status] ?? s.status}
                </span>
              </div>
              <div className="mt-3">
                <Link
                  to={`/volunteer/sessions/${s.id}`}
                  className="text-sm font-medium text-primary-600 hover:text-primary-800"
                >
                  View details →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Dashboard() {
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<VolunteerProfileData | null>(null);
  const [activeMatches, setActiveMatches] = useState<VolunteerMatch[]>([]);
  const [upcomingSessions, setUpcomingSessions] = useState<VolunteerSession[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const [currentUser, profileData] = await Promise.all([
          api.getCurrentUser(),
          api.getVolunteerProfile(),
        ]);
        setUser(currentUser);
        setProfile(profileData);

        if (profileData.application_status === 'approved') {
          const now = new Date();
          const [matchesData, sessionsData] = await Promise.all([
            api.getVolunteerMatches(),
            api.getVolunteerSessions(),
          ]);

          setActiveMatches(matchesData.results.filter((m) => m.status === 'active'));

          setUpcomingSessions(
            sessionsData.results
              .filter(
                (s) =>
                  (s.status === 'pending_confirmation' || s.status === 'confirmed') &&
                  new Date(s.scheduled_start) > now,
              )
              .sort(
                (a, b) =>
                  new Date(a.scheduled_start).getTime() -
                  new Date(b.scheduled_start).getTime(),
              ),
          );
        }
      } catch {
        setPageError('Something went wrong loading your dashboard. Please refresh the page.');
      } finally {
        setPageLoading(false);
      }
    }
    void load();
  }, []);

  if (pageLoading) return <Spinner />;

  if (pageError) {
    return (
      <Card className="mt-4">
        <p className="text-sm text-red-600">{pageError}</p>
      </Card>
    );
  }

  const firstName = user?.fullName.split(' ')[0] ?? 'there';
  const isApproved = profile?.application_status === 'approved';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-primary-900">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-primary-500">KakiCare befriending volunteer</p>
      </div>

      {profile && !isApproved && (
        <ApplicationStatusBanner status={profile.application_status} />
      )}

      {isApproved && (
        <>
          <MatchesSummary matches={activeMatches} />
          <SessionsSummary sessions={upcomingSessions} />
        </>
      )}
    </div>
  );
}
