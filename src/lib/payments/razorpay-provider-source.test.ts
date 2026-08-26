import { afterEach, describe, expect, it, vi } from 'vitest';

import * as razorpay from './razorpay';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Razorpay provider-source boundary', () => {
  it('fetches the paid invoices for one subscription without caching credentials', async () => {
    const fetchSubscriptionInvoices = (
      razorpay as unknown as {
        fetchSubscriptionInvoices?: (
          authentication: { mode: 'oauth'; accessToken: string },
          subscriptionId: string
        ) => Promise<unknown>;
      }
    ).fetchSubscriptionInvoices;
    expect(fetchSubscriptionInvoices).toBeTypeOf('function');
    if (!fetchSubscriptionInvoices) return;

    const providerResponse = {
      entity: 'collection',
      count: 1,
      items: [
        {
          id: 'inv_test_1',
          entity: 'invoice',
          subscription_id: 'sub_test_1',
          payment_id: 'pay_test_1',
          status: 'paid',
          amount: 125000,
          amount_paid: 125000,
          currency: 'INR',
          paid_at: 1787691000,
          billing_start: 1787680000,
          billing_end: 1790358400,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(providerResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSubscriptionInvoices(
      { mode: 'oauth', accessToken: 'test_access_token' },
      'sub_test_1'
    );

    expect(result).toEqual(providerResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/invoices?subscription_id=sub_test_1',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({
          Authorization: 'Bearer test_access_token',
        }),
      })
    );
  });
});
