import { describe, expect, it } from 'vitest';

import { paymentLinkButtonParam } from './payment-link-template';

describe('paymentLinkButtonParam', () => {
  it('turns a Razorpay short URL into the dynamic template URL suffix', () => {
    expect(paymentLinkButtonParam('https://rzp.io/i/abc123')).toBe('i/abc123');
    expect(paymentLinkButtonParam('https://rzp.io/rzp/abc123')).toBe(
      'rzp/abc123'
    );
  });

  it('rejects links outside the fixed Razorpay template origin', () => {
    expect(() =>
      paymentLinkButtonParam('https://example.test/pay/abc')
    ).toThrow(
      'Razorpay payment link URL is not supported by the WhatsApp template'
    );
  });
});
