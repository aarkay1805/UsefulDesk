import 'server-only';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

export type PaymentSecretStorageVersion = 0 | 1;

export function encryptPaymentSecret(value: string): string {
  if (!value) throw new Error('Payment secret cannot be empty');
  return encrypt(value);
}

export function decryptPaymentSecret(
  value: string,
  version: number,
  options: { allowVersionZero: boolean }
): string {
  if (!value) throw new Error('Stored payment secret is empty');
  if (version === 1) {
    if (value.split(':').length !== 3) {
      throw new Error('Payment secret version 1 must use AES-GCM ciphertext');
    }
    return decrypt(value);
  }
  if (version === 0 && options.allowVersionZero) return value;
  if (version === 0) {
    throw new Error('Plaintext payment credentials are not enabled');
  }
  throw new Error(`Unsupported payment secret storage version ${version}`);
}
