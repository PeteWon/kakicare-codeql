import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

// Catches render-time errors anywhere in the child tree and shows a calm
// fallback instead of a blank white screen. Error boundaries must be class
// components — there is no hook equivalent.

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface during development. A real error-reporting hook (e.g. Sentry)
    // can be wired in here later. Do not log sensitive data.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-cream px-4 text-center">
        <h1 className="font-serif text-3xl font-semibold text-primary-900">
          Something went wrong
        </h1>
        <p className="mt-2 max-w-md text-primary-600">
          We hit an unexpected problem. Reloading the page usually fixes it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-primary-500 px-6 text-lg font-medium text-white transition-colors hover:bg-primary-600"
        >
          Reload page
        </button>
      </div>
    );
  }
}
