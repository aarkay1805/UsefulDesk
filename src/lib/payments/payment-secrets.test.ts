import { describe, expect, it } from 'vitest';

import { decryptPaymentSecret, encryptPaymentSecret } from './payment-secrets';

describe('payment secret storage versions', () => {
  it('writes authenticated version-1 ciphertext and decrypts it', () => {
    const encrypted = encryptPaymentSecret('rzp-secret');
    expect(encrypted).not.toContain('rzp-secret');
    expect(encrypted.split(':')).toHaveLength(3);
    expect(
      decryptPaymentSecret(encrypted, 1, { allowVersionZero: false })
    ).toBe('rzp-secret');
  });

  it('reads version 0 only for an explicitly enabled rollback path', () => {
    expect(
      decryptPaymentSecret('legacy-plaintext', 0, { allowVersionZero: true })
    ).toBe('legacy-plaintext');
    expect(() =>
      decryptPaymentSecret('legacy-plaintext', 0, {
        allowVersionZero: false,
      })
    ).toThrow(/Plaintext payment credentials are not enabled/);
  });

  it('fails closed for unsupported versions and tampered ciphertext', () => {
    expect(() =>
      decryptPaymentSecret('anything', 2, { allowVersionZero: true })
    ).toThrow(/Unsupported/);
    const encrypted = encryptPaymentSecret('token');
    expect(() =>
      decryptPaymentSecret(`${encrypted}00`, 1, { allowVersionZero: false })
    ).toThrow();
    expect(() =>
      decryptPaymentSecret(`${'00'.repeat(16)}:00`, 1, {
        allowVersionZero: false,
      })
    ).toThrow(/AES-GCM/);
  });
});
