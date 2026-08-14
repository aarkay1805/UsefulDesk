import { describe, expect, it } from 'vitest';

import {
  issueRecoveryIntent,
  RECOVERY_INTENT_MAX_AGE_SECONDS,
  verifyRecoveryIntent,
} from './recovery-intent';

const SECRET = 'test-recovery-signing-secret';
const NOW = Date.parse('2026-08-14T12:00:00Z');

describe('recovery intent', () => {
  it('accepts an unexpired grant for the user it was issued to', () => {
    const token = issueRecoveryIntent('user-1', SECRET, NOW);

    expect(verifyRecoveryIntent(token, 'user-1', SECRET, NOW + 1_000)).toBe(
      true
    );
  });

  it('rejects another user, tampering, and another signing secret', () => {
    const token = issueRecoveryIntent('user-1', SECRET, NOW);
    const [payload, signature] = token.split('.');

    expect(verifyRecoveryIntent(token, 'user-2', SECRET, NOW)).toBe(false);
    expect(
      verifyRecoveryIntent(`${payload}x.${signature}`, 'user-1', SECRET, NOW)
    ).toBe(false);
    expect(verifyRecoveryIntent(token, 'user-1', 'wrong-secret', NOW)).toBe(
      false
    );
  });

  it('rejects an expired grant', () => {
    const token = issueRecoveryIntent('user-1', SECRET, NOW);
    const afterExpiry = NOW + RECOVERY_INTENT_MAX_AGE_SECONDS * 1000 + 1;

    expect(verifyRecoveryIntent(token, 'user-1', SECRET, afterExpiry)).toBe(
      false
    );
  });
});
