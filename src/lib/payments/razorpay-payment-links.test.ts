import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelPaymentLink,
  createPaymentLink,
  listPaymentLinksByReference,
  type RazorpayApiKeyAuthentication,
} from './razorpay';

const auth: RazorpayApiKeyAuthentication = {
  mode: 'api_key',
  keyId: 'rzp_test_key',
  keySecret: 'test-secret',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Razorpay Payment Link REST contract', () => {
  it('creates an exact non-partial link with no provider notifications', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'plink_1',
          entity: 'payment_link',
          amount: 100,
          amount_paid: 0,
          currency: 'INR',
          accept_partial: false,
          reference_id: 'udpl_reference',
          short_url: 'https://rzp.io/i/test',
          status: 'created',
          expire_by: 1_786_300_000,
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await createPaymentLink(auth, {
      amountSubunits: 100,
      currency: 'INR',
      expireBy: 1_786_300_000,
      referenceId: 'udpl_reference',
      description: 'UsefulDesk invoice test',
      customer: { name: 'Synthetic Member', contact: '+919999999999' },
      notes: {
        usefuldesk_account_id: 'account',
        usefuldesk_invoice_id: 'invoice',
        usefuldesk_payment_link_id: 'link',
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/payment_links');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 100,
      currency: 'INR',
      accept_partial: false,
      expire_by: 1_786_300_000,
      reference_id: 'udpl_reference',
      description: 'UsefulDesk invoice test',
      customer: { name: 'Synthetic Member', contact: '+919999999999' },
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: {
        usefuldesk_account_id: 'account',
        usefuldesk_invoice_id: 'invoice',
        usefuldesk_payment_link_id: 'link',
      },
    });
  });

  it('looks up an ambiguous create by unique reference and can cancel it', async () => {
    const entity = {
      id: 'plink_1',
      entity: 'payment_link',
      amount: 100,
      amount_paid: 0,
      currency: 'INR',
      accept_partial: false,
      reference_id: 'udpl_reference',
      short_url: 'https://rzp.io/i/test',
      status: 'created',
      expire_by: 1_786_300_000,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payment_links: [entity] }))
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...entity, status: 'cancelled' }))
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listPaymentLinksByReference(auth, 'udpl_reference')
    ).resolves.toEqual([entity]);
    await expect(cancelPaymentLink(auth, 'plink_1')).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.razorpay.com/v1/payment_links?reference_id=udpl_reference&count=10'
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.razorpay.com/v1/payment_links/plink_1/cancel'
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
  });
});
