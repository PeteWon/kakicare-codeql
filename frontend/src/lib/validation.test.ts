import { describe, it, expect } from 'vitest';
import { email, matches, maxLength, minLength, phoneSG, required, validate } from './validation';

describe('required', () => {
  it('rejects an empty string', () => {
    expect(required('Email')('')).toBe('Email is required.');
  });

  it('rejects whitespace only', () => {
    expect(required('Email')('   ')).toBe('Email is required.');
  });

  it('accepts a non-empty value', () => {
    expect(required('Email')('a@b.com')).toBeNull();
  });
});

describe('email', () => {
  it('accepts a well-formed address', () => {
    expect(email()('volunteer@example.com')).toBeNull();
  });

  it('rejects a value with no @', () => {
    expect(email()('not-an-email')).not.toBeNull();
  });

  it('rejects a value with no domain', () => {
    expect(email()('a@')).not.toBeNull();
  });
});

describe('minLength', () => {
  it('rejects a value shorter than the minimum', () => {
    expect(minLength(12, 'Password')('short')).toBe('Password must be at least 12 characters.');
  });

  it('accepts a value at exactly the minimum', () => {
    expect(minLength(12, 'Password')('123456789012')).toBeNull();
  });
});

describe('maxLength', () => {
  it('rejects a value longer than the maximum', () => {
    expect(maxLength(5, 'Code')('123456')).toBe('Code must be at most 5 characters.');
  });

  it('accepts a value at exactly the maximum', () => {
    expect(maxLength(5, 'Code')('12345')).toBeNull();
  });
});

describe('matches', () => {
  it('rejects when the values differ', () => {
    expect(matches('secret123456', 'Passwords')('different123')).toBe('Passwords do not match.');
  });

  it('accepts when the values are identical', () => {
    expect(matches('secret123456', 'Passwords')('secret123456')).toBeNull();
  });
});

describe('phoneSG', () => {
  it('accepts a bare 8-digit number starting with a valid prefix', () => {
    expect(phoneSG()('91234567')).toBeNull();
  });

  it('accepts a number with a +65 prefix and spacing', () => {
    expect(phoneSG()('+65 9123 4567')).toBeNull();
  });

  it('rejects a number with an invalid leading digit', () => {
    expect(phoneSG()('12345678')).not.toBeNull();
  });

  it('rejects a number that is too short', () => {
    expect(phoneSG()('9123456')).not.toBeNull();
  });
});

describe('validate', () => {
  it('returns the first failing validator message', () => {
    const result = validate('', [required('Email'), email()]);
    expect(result).toBe('Email is required.');
  });

  it('returns null when all validators pass', () => {
    const result = validate('a@b.com', [required('Email'), email()]);
    expect(result).toBeNull();
  });
});
