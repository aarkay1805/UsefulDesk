// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openUsefulmadeLiveCheckout } from './live-checkout-client';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Live Checkout client gate', () => {
  it('does not load Checkout outside the gated Production pilot', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI', 'true');
    const existingScripts = document.querySelectorAll('script').length;
    await expect(
      openUsefulmadeLiveCheckout({
        keyId: 'rzp_live_Usefulmade',
        orderId: 'order_Live123',
        amountMinor: 149900,
        planLabel: 'Growth',
        onPayment: () => {},
      })
    ).rejects.toThrow('unavailable');
    expect(document.querySelectorAll('script')).toHaveLength(existingScripts);
  });

  it('opens the bound Live order with the reviewed INR amount', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI', 'true');
    const open = vi.fn();
    const create = vi.fn();
    vi.stubGlobal(
      'Razorpay',
      class {
        constructor(options: unknown) {
          create(options);
        }
        open = open;
      }
    );
    const onPayment = vi.fn();
    await openUsefulmadeLiveCheckout({
      keyId: 'rzp_live_Usefulmade',
      orderId: 'order_Live123',
      amountMinor: 149900,
      planLabel: 'Growth',
      onPayment,
    });
    expect(create).toHaveBeenCalledWith({
      key: 'rzp_live_Usefulmade',
      amount: 149900,
      currency: 'INR',
      order_id: 'order_Live123',
      name: 'UsefulDesk',
      description: 'Growth monthly plan · Usefulmade Live pilot',
      handler: onPayment,
    });
    expect(open).toHaveBeenCalledOnce();
  });
});
