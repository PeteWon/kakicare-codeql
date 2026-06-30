import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Login } from './Login';
import { api } from '@/lib/api';

// `api` is mocked below, so every call is a vi.fn() we control per test.
vi.mock('@/lib/api', () => ({
  api: {
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    setupMfa: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

// Keep the real MemoryRouter/useSearchParams/Link, only replace useNavigate
// so we can assert on where the app tried to go.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockedApi = vi.mocked(api);

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>,
  );
}

async function fillAndSubmitCredentials(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Every render starts by checking for an existing session (GET /api/auth/me).
  // Reject it so the component treats the user as logged out and shows the form.
  mockedApi.getCurrentUser.mockRejectedValue(new Error('not authenticated'));
});

describe('Login', () => {
  it('shows a generic error on invalid credentials', async () => {
    mockedApi.login.mockResolvedValue({ status: 'invalid' });
    renderLogin();

    await screen.findByLabelText('Email');
    await fillAndSubmitCredentials('volunteer@example.com', 'wrong-password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to the volunteer home on success with no MFA enrolled', async () => {
    mockedApi.login.mockResolvedValue({ status: 'success', role: 'volunteer' });
    renderLogin();

    await screen.findByLabelText('Email');
    await fillAndSubmitCredentials('volunteer@example.com', 'correct-password');

    expect(mockNavigate).toHaveBeenCalledWith('/volunteer');
  });

  it('shows the TOTP prompt when MFA is required and already enrolled', async () => {
    mockedApi.login.mockResolvedValue({ status: 'mfa_required', mfa_enrolled: true });
    renderLogin();

    await screen.findByLabelText('Email');
    await fillAndSubmitCredentials('staff@example.com', 'correct-password');

    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
