import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Sessions } from './Sessions';
import { api } from '@/lib/api';
import type { StaffSession } from '@/lib/types';

// `api` is mocked so each call is a vi.fn() we control per test. These tests
// exercise the extracted row components (ConfirmDialogRow / CancelFormRow /
// FollowupFormRow / StatusFilterTabs) through the real parent, verifying the
// decomposition preserved the interactive wiring.
vi.mock('@/lib/api', () => ({
  api: {
    getStaffSessions: vi.fn(),
    confirmSession: vi.fn(),
    cancelSession: vi.fn(),
    recordSessionFollowup: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

const mockedApi = vi.mocked(api);

function makeSession(overrides: Partial<StaffSession> = {}): StaffSession {
  return {
    id: 1,
    match_id: 10,
    session_type: 'visit',
    scheduled_start: '2026-08-01T09:00:00+08:00',
    scheduled_end: '2026-08-01T10:00:00+08:00',
    status: 'pending_confirmation',
    checkin_at: null,
    checkout_at: null,
    volunteer_note: null,
    confirmed_by_id: null,
    cancel_reason: null,
    followup_outcome: null,
    followup_note: null,
    senior: {
      id: 5,
      full_name: 'Tan Ah Kow',
      address: 'Blk 123',
      phone_number: '+65 9000 0001',
      preferred_language: 'Hokkien',
      next_of_kin_name: null,
      next_of_kin_contact: null,
    },
    volunteer: { id: 7, full_name: 'Jane Volunteer', email: 'jane@example.com' },
    created_at: '2026-07-01T09:00:00+08:00',
    ...overrides,
  };
}

function mockList(session: StaffSession) {
  mockedApi.getStaffSessions.mockResolvedValue({
    count: 1,
    next: null,
    previous: null,
    results: [session],
  });
}

function renderSessions() {
  return render(
    <MemoryRouter initialEntries={['/staff/sessions']}>
      <Sessions />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Sessions — confirm flow (ConfirmDialogRow)', () => {
  it('opens the confirm dialog and shows the one-time check-in code on success', async () => {
    const user = userEvent.setup();
    mockList(makeSession({ status: 'pending_confirmation' }));
    mockedApi.confirmSession.mockResolvedValue({
      ...makeSession({ status: 'confirmed' }),
      checkin_code: '135790',
    });

    renderSessions();

    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    // Extracted ConfirmDialogRow renders.
    expect(await screen.findByText('Confirm this session?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /yes, confirm/i }));

    expect(mockedApi.confirmSession).toHaveBeenCalledWith(1);
    // AC-04 check-in code modal (parent) receives the code from the confirm result.
    expect(await screen.findByText('135790')).toBeInTheDocument();
  });
});

describe('Sessions — cancel flow (CancelFormRow)', () => {
  it('requires a reason and cancels with the entered reason', async () => {
    const user = userEvent.setup();
    mockList(makeSession({ status: 'confirmed' }));
    mockedApi.cancelSession.mockResolvedValue(makeSession({ status: 'cancelled' }));

    renderSessions();

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    const submit = await screen.findByRole('button', { name: 'Cancel session' });

    // Empty reason is rejected client-side without calling the API.
    await user.click(submit);
    expect(await screen.findByText('A reason is required.')).toBeInTheDocument();
    expect(mockedApi.cancelSession).not.toHaveBeenCalled();

    await user.type(
      screen.getByPlaceholderText('Reason for cancellation (required)'),
      'Senior unavailable',
    );
    await user.click(submit);

    expect(mockedApi.cancelSession).toHaveBeenCalledWith(1, 'Senior unavailable');
  });
});

describe('Sessions — status filter', () => {
  it('selecting "All" loads every status instead of snapping back to the default', async () => {
    const user = userEvent.setup();
    mockList(makeSession({ status: 'confirmed' }));

    renderSessions();

    // Initial load uses the default (pending_confirmation) filter.
    await screen.findByRole('button', { name: 'All' });
    expect(mockedApi.getStaffSessions).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_confirmation' }),
    );

    // Clicking "All" must request with no status filter (regression: it used to
    // clear the URL param and revert to pending_confirmation).
    await user.click(screen.getByRole('button', { name: 'All' }));

    await waitFor(() =>
      expect(mockedApi.getStaffSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: undefined }),
      ),
    );
  });
});

describe('Sessions — follow-up flow (FollowupFormRow)', () => {
  it('records a welfare follow-up outcome for a missed session', async () => {
    const user = userEvent.setup();
    mockList(makeSession({ status: 'missed', followup_outcome: null }));
    mockedApi.recordSessionFollowup.mockResolvedValue(
      makeSession({ status: 'missed', followup_outcome: 'senior_well' }),
    );

    renderSessions();

    await user.click(await screen.findByRole('button', { name: 'Record follow-up' }));
    expect(await screen.findByText(/Record welfare follow-up for/)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox'), 'senior_well');
    await user.click(screen.getByRole('button', { name: 'Save follow-up' }));

    expect(mockedApi.recordSessionFollowup).toHaveBeenCalledWith(1, 'senior_well', '');
  });
});
