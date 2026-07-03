import { Link } from 'react-router-dom';
import { Button } from './Button';
import type { ApplicationStatus } from '@/lib/types';

// Contextual messaging for a volunteer's application state. `approved` maps to
// null: an approved volunteer has full access, so no banner is shown. Every
// other state explains where the volunteer is in the review pipeline and — when
// the ball is in their court (incomplete / changes_requested) — offers a CTA to
// their profile. Pending review deliberately has no button: there is nothing to
// retry or do, only to wait.
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

/**
 * Banner explaining a volunteer's application status, with a contextual CTA
 * when action is needed. Shared by the volunteer Dashboard and the
 * Matches / Sessions pages, which show it in place of their data when the
 * backend returns 403 (not yet approved) — rather than a misleading "Try again".
 * Renders nothing for the `approved` state.
 */
export function ApplicationStatusBanner({ status }: { status: ApplicationStatus }) {
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
