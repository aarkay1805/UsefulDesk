import { describe, expect, it } from 'vitest';
import {
  generateGoogleNonce,
  GOOGLE_AVATAR_SEED_METADATA_KEY,
  resolveInitialGoogleAvatar,
} from './google-identity';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

describe('generateGoogleNonce', () => {
  it('returns a fresh 32-byte raw nonce and its SHA-256 hex digest', async () => {
    const first = await generateGoogleNonce();
    const second = await generateGoogleNonce();
    const expectedDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(first.raw)
    );

    expect(first.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hashed).toBe(hex(new Uint8Array(expectedDigest)));
    expect(first.hashed).toMatch(/^[a-f0-9]{64}$/);
    expect(second.raw).not.toBe(first.raw);
  });
});

describe('resolveInitialGoogleAvatar', () => {
  const firstSignIn = {
    id: 'user-1',
    created_at: '2026-08-15T10:00:00.000Z',
    last_sign_in_at: '2026-08-15T10:00:01.000Z',
    user_metadata: { picture: 'https://images.example/avatar.png' },
  };

  it('accepts an HTTPS Google photo only on the first sign-in', () => {
    expect(resolveInitialGoogleAvatar(firstSignIn)).toEqual({
      userId: 'user-1',
      url: 'https://images.example/avatar.png',
    });
    expect(
      resolveInitialGoogleAvatar({
        ...firstSignIn,
        last_sign_in_at: '2026-08-15T10:02:00.000Z',
      })
    ).toBeNull();
  });

  it('rejects non-HTTPS provider metadata', () => {
    expect(
      resolveInitialGoogleAvatar({
        ...firstSignIn,
        user_metadata: { picture: 'http://images.example/avatar.png' },
      })
    ).toBeNull();
  });

  it('never offers another seed after the one-time attempt marker', () => {
    expect(
      resolveInitialGoogleAvatar({
        ...firstSignIn,
        user_metadata: {
          ...firstSignIn.user_metadata,
          [GOOGLE_AVATAR_SEED_METADATA_KEY]: true,
        },
      })
    ).toBeNull();
  });
});
