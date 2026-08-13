import { describe, expect, it } from 'vitest';

import { validatePasswordChange } from './password-change';

describe('validatePasswordChange', () => {
  it.each([
    ['', 'new-password', 'new-password', 'Enter your current password.'],
    ['current', '', '', 'Enter a new password.'],
    ['current', 'short', 'short', 'Use at least 8 characters'],
    ['current', 'new-password', '', 'Confirm your new password.'],
    ['current', 'new-password', 'different', 'New passwords do not match.'],
  ])(
    'returns the first actionable error',
    (current, next, confirm, message) => {
      expect(
        validatePasswordChange(current, next, confirm, 8)?.message
      ).toContain(message);
    }
  );

  it('accepts a complete matching change', () => {
    expect(
      validatePasswordChange('current', 'new-password', 'new-password', 8)
    ).toBeNull();
  });
});
