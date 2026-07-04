import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Card, TextField } from '@/components';
import { api } from '@/lib/api';
import { email as emailRule, minLength, required, validate } from '@/lib/validation';
import { usePageTitle } from '@/lib/usePageTitle';

const CONTACT_EMAIL = 'kakicare18@gmail.com';

type PageState = 'form' | 'sent';

export function Contact() {
  usePageTitle('Contact us');
  const [pageState, setPageState] = useState<PageState>('form');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const nameErr = validate(name, [required('Name')]);
    const emailErr = validate(email, [required('Email'), emailRule()]);
    const messageErr = validate(message, [required('Message'), minLength(10, 'Message')]);

    setNameError(nameErr);
    setEmailError(emailErr);
    setMessageError(messageErr);
    if (nameErr || emailErr || messageErr) return;

    setSubmitting(true);
    try {
      await api.sendContactMessage(name, email, message);
      setPageState('sent');
    } catch {
      setFormError('Something went wrong sending your message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (pageState === 'sent') {
    return (
      <section className="mx-auto max-w-md py-8 my-auto">
        <Card className="space-y-4 text-center">
          <h1 className="font-serif text-2xl font-semibold text-primary-900">
            Message sent
          </h1>
          <p className="text-primary-600">
            Thanks, {name} — we've received your message and will get back to
            you at <strong>{email}</strong> soon.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md py-8">
      <h1 className="font-serif text-3xl font-semibold text-primary-900">
        Contact us
      </h1>
      <p className="mt-2 text-primary-600">
        Know a senior who could benefit from the KakiCare befriending
        programme? Have a question about volunteering? Send us a message and
        we'll get back to you as soon as we can.
      </p>

      <Card className="mt-6">
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {formError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {formError}
            </div>
          ) : null}

          <TextField
            label="Name"
            name="name"
            autoComplete="name"
            autoFocus
            value={name}
            error={nameError}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />

          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            error={emailError}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
          />

          <div>
            <label htmlFor="contact-message" className="block text-sm font-medium text-primary-800">
              Message
            </label>
            <textarea
              id="contact-message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setMessageError(null);
              }}
              maxLength={5000}
              rows={5}
              placeholder="How can we help?"
              disabled={submitting}
              aria-invalid={messageError ? true : undefined}
              className={`mt-1 block w-full resize-none rounded-xl border bg-white px-3 py-2.5 text-base text-primary-950 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                messageError ? 'border-red-400' : 'border-cream-300'
              }`}
            />
            {messageError ? (
              <p className="mt-1 text-sm text-red-600">{messageError}</p>
            ) : null}
          </div>

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Sending…' : 'Send message'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-primary-600">
        Prefer email? Reach us directly at{' '}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="font-medium text-primary-700 hover:text-primary-900"
        >
          {CONTACT_EMAIL}
        </a>
      </p>
    </section>
  );
}
