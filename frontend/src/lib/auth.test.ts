import { describe, it, expect } from 'vitest';
import { hasRole, homePathForRole, isStaff, isVolunteer } from './auth';
import type { User } from './types';

function makeUser(role: User['role']): User {
  return {
    id: 'usr_1',
    email: 'test@example.com',
    fullName: 'Test User',
    role,
    emailVerifiedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('hasRole', () => {
  it('returns true when the user has the given role', () => {
    expect(hasRole(makeUser('volunteer'), 'volunteer')).toBe(true);
  });

  it('returns false when the user has a different role', () => {
    expect(hasRole(makeUser('staff'), 'volunteer')).toBe(false);
  });

  it('returns false for a null user', () => {
    expect(hasRole(null, 'volunteer')).toBe(false);
  });
});

describe('isVolunteer', () => {
  it('returns true for a volunteer', () => {
    expect(isVolunteer(makeUser('volunteer'))).toBe(true);
  });

  it('returns false for staff', () => {
    expect(isVolunteer(makeUser('staff'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isVolunteer(null)).toBe(false);
  });
});

describe('isStaff', () => {
  it('returns true for staff', () => {
    expect(isStaff(makeUser('staff'))).toBe(true);
  });

  it('returns false for a volunteer', () => {
    expect(isStaff(makeUser('volunteer'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isStaff(null)).toBe(false);
  });
});

describe('homePathForRole', () => {
  it('routes staff to /staff', () => {
    expect(homePathForRole('staff')).toBe('/staff');
  });

  it('routes volunteers to /volunteer', () => {
    expect(homePathForRole('volunteer')).toBe('/volunteer');
  });
});
