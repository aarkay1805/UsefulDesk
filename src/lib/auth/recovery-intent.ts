import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { recoveryDestinationOr } from './recovery-destination';

export const RECOVERY_INTENT_COOKIE = 'usefuldesk_recovery_intent';
export const RECOVERY_INTENT_MAX_AGE_SECONDS = 10 * 60;

export const RECOVERY_INTENT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/reset-password',
  maxAge: RECOVERY_INTENT_MAX_AGE_SECONDS,
} as const;

interface RecoveryIntentPayload {
  version: 1;
  userId: string;
  expiresAt: number;
  nonce: string;
  continueTo?: string;
}

export interface VerifiedRecoveryIntent {
  continueTo: string | null;
}

function sign(encodedPayload: string, secret: string): string {
  if (!secret) throw new Error('Recovery intent signing secret is unavailable');
  return createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

/** Issue a short-lived grant that only a verified recovery callback can mint. */
export function issueRecoveryIntent(
  userId: string,
  secret: string,
  now: number = Date.now(),
  continueTo: string | null = null
): string {
  const recoveryDestination = recoveryDestinationOr(continueTo, '');
  const payload: RecoveryIntentPayload = {
    version: 1,
    userId,
    expiresAt: now + RECOVERY_INTENT_MAX_AGE_SECONDS * 1000,
    nonce: randomBytes(18).toString('base64url'),
    ...(recoveryDestination ? { continueTo: recoveryDestination } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

/** Read the signed grant and its optional invitation-only continuation. */
export function readRecoveryIntent(
  token: string | undefined,
  expectedUserId: string,
  secret: string,
  now: number = Date.now()
): VerifiedRecoveryIntent | null {
  if (!token || !expectedUserId || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, suppliedSignature] = parts;
  const expectedSignature = sign(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as Partial<RecoveryIntentPayload>;
    if (
      payload.version !== 1 ||
      payload.userId !== expectedUserId ||
      typeof payload.nonce !== 'string' ||
      payload.nonce.length < 16 ||
      typeof payload.expiresAt !== 'number' ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= now ||
      payload.expiresAt > now + RECOVERY_INTENT_MAX_AGE_SECONDS * 1000
    ) {
      return null;
    }

    const continueTo = recoveryDestinationOr(payload.continueTo, '');
    if (payload.continueTo !== undefined && !continueTo) return null;
    return { continueTo: continueTo || null };
  } catch {
    return null;
  }
}

/** Bind the grant to the authenticated user and reject tampering or expiry. */
export function verifyRecoveryIntent(
  token: string | undefined,
  expectedUserId: string,
  secret: string,
  now: number = Date.now()
): boolean {
  return Boolean(readRecoveryIntent(token, expectedUserId, secret, now));
}
