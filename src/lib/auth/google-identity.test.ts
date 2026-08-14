import { describe, expect, it } from 'vitest';
import { generateGoogleNonce } from './google-identity';

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
