import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const provider = vi.hoisted(() => ({
  fetchRefund: vi.fn(),
  fetchPayment: vi.fn(),
}));
vi.mock('./credentials', () => ({
  getRazorpayConnection: vi.fn(async () => ({ mode: 'oauth' })),
  runRazorpayOperation: vi.fn(async (_admin, _connection, operation) =>
    operation({ mode: 'oauth', accessToken: 'test' })
  ),
}));
vi.mock('./razorpay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./razorpay')>()),
  fetchRefund: provider.fetchRefund,
  fetchPayment: provider.fetchPayment,
}));

import { finalizeOrImportVerifiedRefund } from './razorpay-refunds';

describe('shared merchant gym refund boundary', () => {
  it('does not import a verified SaaS refund without a local gym payment', async () => {
    const refund = {
      id: 'rfnd_Saas123',
      payment_id: 'pay_Saas123',
      amount: 79900,
      currency: 'INR',
      status: 'processed',
      receipt: '33333333-3333-4333-8333-333333333333',
      notes: {
        usefuldesk_organization_id: '11111111-1111-4111-8111-111111111111',
        usefuldesk_request_id: '33333333-3333-4333-8333-333333333333',
      },
    };
    provider.fetchRefund.mockResolvedValue(refund);
    provider.fetchPayment.mockResolvedValue({
      id: refund.payment_id,
      amount: refund.amount,
      currency: refund.currency,
    });
    const selected: string[] = [];
    const admin = {
      from: vi.fn((table: string) => {
        selected.push(table);
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return query;
      }),
      rpc: vi.fn(),
    };

    await expect(
      finalizeOrImportVerifiedRefund({
        admin: admin as never,
        accountId: 'gym-account',
        remoteRefund: refund as never,
      })
    ).resolves.toEqual({ outcome: 'unrelated' });
    expect(selected).toEqual([
      'payment_refunds',
      'payment_refunds',
      'payments',
    ]);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
