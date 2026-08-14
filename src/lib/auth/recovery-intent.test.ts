import { describe, expect, it } from 'vitest';

import {
  issueRecoveryIntent,
  RECOVERY_INTENT_MAX_AGE_SECONDS,
  readRecoveryIntent,
  verifyRecoveryIntent,
} from './recovery-intent';

const SECRET = 'test-recovery-signing-secret';
const NOW = Date.parse('2026-08-14T12:00:00Z');
const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const SECURITY_PATH = '/settings?tab=security';

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

  it('signs an invitation continuation into the recovery grant', () => {
    const continueTo = `/join/${INVITE_TOKEN}`;
    const token = issueRecoveryIntent('user-1', SECRET, NOW, continueTo);

    expect(readRecoveryIntent(token, 'user-1', SECRET, NOW + 1_000)).toEqual({
      continueTo,
    });
  });

  it('signs the Login & security continuation used by Add password', () => {
    const token = issueRecoveryIntent('user-1', SECRET, NOW, SECURITY_PATH);

    expect(readRecoveryIntent(token, 'user-1', SECRET, NOW + 1_000)).toEqual({
      continueTo: SECURITY_PATH,
    });
  });

  it('does not sign an arbitrary return-to into a recovery grant', () => {
    const token = issueRecoveryIntent(
      'user-1',
      SECRET,
      NOW,
      '//evil.example/steal'
    );

    expect(readRecoveryIntent(token, 'user-1', SECRET, NOW + 1_000)).toEqual({
      continueTo: null,
    });
  });
});
