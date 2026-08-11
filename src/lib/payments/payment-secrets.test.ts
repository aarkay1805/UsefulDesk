import { describe, expect, it } from 'vitest';

import { decryptPaymentSecret, encryptPaymentSecret } from './payment-secrets';

describe('payment secret storage', () => {
  it('writes authenticated ciphertext and decrypts it', () => {
    const encrypted = encryptPaymentSecret('rzp-secret');
    expect(encrypted).not.toContain('rzp-secret');
    expect(encrypted.split(':')).toHaveLength(3);
    expect(decryptPaymentSecret(encrypted)).toBe('rzp-secret');
  });

  it('rejects plaintext', () => {
    expect(() => decryptPaymentSecret('legacy-plaintext')).toThrow(
      /must use AES-GCM/
    );
  });

  it('fails closed for malformed or tampered ciphertext', () => {
    const encrypted = encryptPaymentSecret('token');
    expect(() => decryptPaymentSecret(`${encrypted}00`)).toThrow();
    expect(() => decryptPaymentSecret(`${'00'.repeat(16)}:00`)).toThrow(
      /AES-GCM/
    );
  });
});
