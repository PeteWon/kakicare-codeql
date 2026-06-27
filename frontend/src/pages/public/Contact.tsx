import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, TextField } from '@/components';
import { api, ApiError } from '@/lib/api';
import { email as emailRule, maxLength, required, validate } from '@/lib/validation';
import { usePageTitle } from '@/lib/usePageTitle';

type PageState = 'form' | 'sent';

export function Contact() {
  usePageTitle('Contact us');
  const [pageState, setPageState] = useState<PageState>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const nameErr = validate(name, [required('Name'), maxLength(100)]);
    const emailErr = validate(email, [required('Email'), emailRule()]);
    const msgErr = validate(message, [required('Message'), maxLength(2000)]);

    setNameError(nameErr);
    setEmailError(emailErr);
    setMessageError(msgErr);
    if (nameErr || emailErr || msgErr) return;

    setSubmitting(true);
    setServerError(null);
    try {
      await api.submitContact({ name, email, phone, message });
      setPageState('sent');
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as Record<string, string>;
        if (body.name) setNameError(body.name);
        if (body.email) setEmailError(body.email);
        if (body.message) setMessageError(body.message);
        if (body.detail) setServerError(body.detail);
      } else {
        setServerError('Could not send your message. Please try again later.');
      }
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
            Thank you for reaching out, <strong>{name}</strong>. Our team will
            get back to you at <strong>{email}</strong> as soon as possible.
          </p>
          <Link to="/" className="block">
            <Button fullWidth variant="secondary">
              Back to home
            </Button>
          </Link>
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
        Want to refer a senior to our programme, or have a question? Send us a
        message and we'll get back to you.
      </p>

      <Card className="mt-6">
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {serverError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {serverError}
            </p>
          )}

          <TextField
            label="Name"
            type="text"
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

          <TextField
            label="Phone (optional)"
            type="tel"
            name="phone"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <div>
            <label
              htmlFor="contact-message"
              className="block text-sm font-medium text-primary-800"
            >
              Message
            </label>
            <textarea
              id="contact-message"
              name="message"
              rows={5}
              className={[
                'mt-1 block w-full rounded-xl border px-3 py-2 text-base text-primary-950',
                'placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500',
                messageError
                  ? 'border-red-400 bg-red-50'
                  : 'border-cream-300 bg-white',
              ].join(' ')}
              placeholder="Tell us about the senior, or ask us anything…"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setMessageError(null);
              }}
            />
            {messageError && (
              <p className="mt-1 text-sm text-red-600">{messageError}</p>
            )}
          </div>

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Sending…' : 'Send message'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-primary-600">
        Looking to volunteer?{' '}
        <Link
          to="/register"
          className="font-medium text-primary-700 hover:text-primary-900"
        >
          Register here
        </Link>
      </p>
    </section>
  );
}
