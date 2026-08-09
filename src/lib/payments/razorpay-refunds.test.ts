import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createRefund,
  fetchRefund,
  listPaymentRefunds,
  listRefunds,
  type RazorpayOAuthAuthentication,
} from './razorpay';
import {
  isUsefulDeskRefundId,
  shouldSimulateAmbiguousRefundCreate,
} from './razorpay-refunds';

const auth: RazorpayOAuthAuthentication = {
  mode: 'oauth',
  accessToken: 'test-access-token',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Razorpay refund REST contract', () => {
  it('only treats UUID receipts as UsefulDesk refund identities', () => {
    expect(isUsefulDeskRefundId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      true
    );
    expect(isUsefulDeskRefundId('ud_s4_preflight_TNi3WGJgRRCase')).toBe(false);
    expect(isUsefulDeskRefundId(null)).toBe(false);
  });

  it('fault-injects one ambiguous create only in the isolated Test acceptance deployment', () => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'true');
    vi.stubEnv('RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE', 'true');
    expect(
      shouldSimulateAmbiguousRefundCreate({ reconcile_attempt_count: 0 })
    ).toBe(true);
    expect(
      shouldSimulateAmbiguousRefundCreate({ reconcile_attempt_count: 1 })
    ).toBe(false);

    vi.stubEnv('RAZORPAY_MODE', 'live');
    expect(
      shouldSimulateAmbiguousRefundCreate({ reconcile_attempt_count: 0 })
    ).toBe(false);
  });

  it('reuses exact canonical bytes and the stable provider idempotency key', async () => {
    const refund = {
      id: 'rfnd_test',
      entity: 'refund',
      amount: 100,
      currency: 'INR',
      payment_id: 'pay_test',
      receipt: '550e8400-e29b-41d4-a716-446655440000',
      notes: {},
      status: 'processed',
      created_at: 1_786_300_000,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(refund)))
      .mockResolvedValueOnce(new Response(JSON.stringify(refund)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [refund] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [refund] })));
    vi.stubGlobal('fetch', fetchMock);
    const canonicalBody =
      '{"amount":100,"receipt":"550e8400-e29b-41d4-a716-446655440000"}';

    await createRefund({
      creds: auth,
      paymentId: 'pay_test',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      canonicalBody,
    });
    await fetchRefund(auth, 'rfnd_test');
    await listRefunds({
      creds: auth,
      from: 1_786_200_000,
      to: 1_786_400_000,
      count: 25,
      skip: 50,
    });
    await listPaymentRefunds({
      creds: auth,
      paymentId: 'pay_test',
      count: 100,
      skip: 0,
    });

    const [, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createInit.body).toBe(canonicalBody);
    expect(createInit.headers).toMatchObject({
      Authorization: 'Bearer test-access-token',
      'X-Refund-Idempotency': '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.razorpay.com/v1/refunds/rfnd_test'
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.razorpay.com/v1/refunds?from=1786200000&count=25&skip=50&to=1786400000'
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      'https://api.razorpay.com/v1/payments/pay_test/refunds?count=100&skip=0'
    );
  });

  it('rejects an invalid idempotency key before the provider call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createRefund({
        creds: auth,
        paymentId: 'pay_test',
        idempotencyKey: 'too short',
        canonicalBody: '{}',
      })
    ).rejects.toThrow('idempotency key is invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
