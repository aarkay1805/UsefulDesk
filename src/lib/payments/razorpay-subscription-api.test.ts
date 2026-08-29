import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { cancelSubscription } from './razorpay';

const authentication = {
  mode: 'oauth' as const,
  accessToken: 'access-token',
};

function providerResponse() {
  return new Response(
    JSON.stringify({
      id: 'sub_1',
      entity: 'subscription',
      plan_id: 'plan_1',
      status: 'cancelled',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('Razorpay subscription cancellation request', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Razorpay's body-less immediate-cancel contract", async () => {
    const fetch = vi.fn().mockResolvedValue(providerResponse());
    vi.stubGlobal('fetch', fetch);

    await cancelSubscription(authentication, 'sub_1');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/subscriptions/sub_1/cancel',
      expect.objectContaining({ method: 'POST', body: undefined })
    );
  });

  it('sends cancel_at_cycle_end only for a scheduled cancellation', async () => {
    const fetch = vi.fn().mockResolvedValue(providerResponse());
    vi.stubGlobal('fetch', fetch);

    await cancelSubscription(authentication, 'sub_1', true);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/subscriptions/sub_1/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      })
    );
  });
});
