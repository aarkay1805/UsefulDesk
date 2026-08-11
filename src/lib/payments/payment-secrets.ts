import 'server-only';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

export function encryptPaymentSecret(value: string): string {
  if (!value) throw new Error('Payment secret cannot be empty');
  return encrypt(value);
}

export function decryptPaymentSecret(value: string): string {
  if (!value) throw new Error('Stored payment secret is empty');
  if (value.split(':').length !== 3) {
    throw new Error('Payment secrets must use AES-GCM ciphertext');
  }
  return decrypt(value);
}
