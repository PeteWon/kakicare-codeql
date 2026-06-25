import { Link } from 'react-router-dom';
import { Button } from '@/components';
import { usePageTitle } from '@/lib/usePageTitle';

export function Landing() {
  usePageTitle('Connecting Hearts, Supporting Seniors');
  return (
    <div className="space-y-14 py-8">
      {/* ---- Hero ---- */}
      <section>
        <h1 className="max-w-2xl font-serif text-4xl font-semibold leading-tight text-primary-900 sm:text-5xl">
          A friendly visit can change someone's day.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-primary-700">
          KakiCare connects vetted community volunteers with seniors in our
          befriending programme — coordinated safely by our staff.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/register">
            <Button size="lg">Become a volunteer</Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="secondary">
              Sign in
            </Button>
          </Link>
        </div>
      </section>

      {/* ---- About ---- */}
      <section className="max-w-2xl space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-primary-900">
          What is KakiCare?
        </h2>
        <p className="text-primary-700">
          Many seniors in Singapore live alone. Regular visits and calls from a
          familiar face reduce isolation, support mental wellbeing, and give
          families peace of mind. KakiCare makes this connection structured and
          safe — volunteers are vetted by our team, matches are made thoughtfully,
          and every session is tracked.
        </p>
        <p className="rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-primary-600">
          Seniors are enrolled by KakiCare staff — they do not self-register. If
          you know a senior who could benefit from the programme, please contact
          us directly.
        </p>
      </section>

      {/* ---- How it works ---- */}
      <section className="max-w-2xl">
        <h2 className="mb-6 font-serif text-2xl font-semibold text-primary-900">
          How it works
        </h2>
        <div className="space-y-4">
          {[
            {
              step: '1',
              title: 'Register and get vetted',
              body: 'Create a volunteer account, complete your profile, and upload the required documents. Our team reviews every application.',
            },
            {
              step: '2',
              title: 'Get matched',
              body: "Once approved, our staff will propose a befriending match based on your language, location, and availability — and the senior's needs.",
            },
            {
              step: '3',
              title: 'Start visiting',
              body: 'Schedule visits or calls through the app. Check in securely when you arrive, and leave a brief note after each session.',
            },
          ].map(({ step, title, body }) => (
            <div
              key={step}
              className="flex gap-4 rounded-2xl border border-cream-300 bg-white p-5 shadow-sm"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-500 font-semibold text-white">
                {step}
              </div>
              <div>
                <p className="font-semibold text-primary-900">{title}</p>
                <p className="mt-1 text-sm text-primary-600">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <Link to="/register">
            <Button size="lg">Join as a volunteer</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
