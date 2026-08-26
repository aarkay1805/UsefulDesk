import { describe, expect, it, vi } from 'vitest';

import * as reconciliation from './razorpay-subscription-reconciliation';

describe('Razorpay subscription source reconciliation', () => {
  it('preserves captured provider invoices that are ahead of the local ledger', async () => {
    const reconcileClaimedSubscriptionSource = (
      reconciliation as unknown as {
        reconcileClaimedSubscriptionSource?: (input: unknown) => Promise<{
          providerPaidCount: number;
          localPaidCount: number;
          observed: number;
        }>;
      }
    ).reconcileClaimedSubscriptionSource;
    expect(reconcileClaimedSubscriptionSource).toBeTypeOf('function');
    if (!reconcileClaimedSubscriptionSource) return;

    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: 'exception_id', error: null }),
    };
    const result = await reconcileClaimedSubscriptionSource({
      admin,
      mandate: {
        id: 'mandate_1',
        account_id: 'account_1',
        membership_id: 'membership_1',
        gateway_subscription_id: 'sub_1',
        last_applied_paid_count: 1,
      },
      dependencies: {
        getConnection: vi.fn().mockResolvedValue({
          accountId: 'account_1',
          gateway: 'razorpay',
          authenticationMode: 'oauth',
          authentication: { mode: 'oauth', accessToken: 'test_token' },
        }),
        fetchSubscription: vi.fn().mockResolvedValue({
          id: 'sub_1',
          entity: 'subscription',
          plan_id: 'plan_1',
          status: 'active',
          paid_count: 3,
        }),
        fetchInvoices: vi.fn().mockResolvedValue({
          entity: 'collection',
          count: 3,
          items: [
            {
              id: 'inv_3',
              entity: 'invoice',
              subscription_id: 'sub_1',
              payment_id: 'pay_3',
              status: 'paid',
              amount: 125000,
              amount_paid: 125000,
              currency: 'INR',
              paid_at: 1787693000,
              billing_start: 1790358400,
              billing_end: 1793036800,
            },
            {
              id: 'inv_1',
              entity: 'invoice',
              subscription_id: 'sub_1',
              payment_id: 'pay_1',
              status: 'paid',
              amount: 125000,
              amount_paid: 125000,
              currency: 'INR',
              paid_at: 1787691000,
              billing_start: 1785001600,
              billing_end: 1787680000,
            },
            {
              id: 'inv_2',
              entity: 'invoice',
              subscription_id: 'sub_1',
              payment_id: 'pay_2',
              status: 'paid',
              amount: 125000,
              amount_paid: 125000,
              currency: 'INR',
              paid_at: 1787692000,
              billing_start: 1787680000,
              billing_end: 1790358400,
            },
          ],
        }),
        fetchPayment: vi.fn(async (_authentication, paymentId: string) => ({
          id: paymentId,
          entity: 'payment',
          amount: 125000,
          currency: 'INR',
          status: 'captured',
          captured: true,
          method: 'upi',
          created_at: paymentId === 'pay_2' ? 1787692000 : 1787693000,
        })),
      },
    });

    expect(result).toEqual({
      providerPaidCount: 3,
      localPaidCount: 1,
      observed: 2,
    });
    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(admin.rpc).toHaveBeenNthCalledWith(
      1,
      'preserve_razorpay_provider_charge_observation',
      expect.objectContaining({
        p_gateway_invoice_id: 'inv_2',
        p_gateway_payment_id: 'pay_2',
        p_provider_paid_count: 2,
        p_amount: 1250,
      })
    );
    expect(admin.rpc).toHaveBeenNthCalledWith(
      2,
      'preserve_razorpay_provider_charge_observation',
      expect.objectContaining({
        p_gateway_invoice_id: 'inv_3',
        p_gateway_payment_id: 'pay_3',
        p_provider_paid_count: 3,
        p_amount: 1250,
      })
    );
  });

  it('refuses to derive charge sequence from incomplete provider invoice history', async () => {
    const reconcileClaimedSubscriptionSource = (
      reconciliation as unknown as {
        reconcileClaimedSubscriptionSource: (
          input: unknown
        ) => Promise<unknown>;
      }
    ).reconcileClaimedSubscriptionSource;
    const admin = { rpc: vi.fn() };

    await expect(
      reconcileClaimedSubscriptionSource({
        admin,
        mandate: {
          id: 'mandate_1',
          account_id: 'account_1',
          membership_id: 'membership_1',
          gateway_subscription_id: 'sub_1',
          last_applied_paid_count: 0,
        },
        dependencies: {
          getConnection: vi.fn().mockResolvedValue({
            accountId: 'account_1',
            authentication: { mode: 'oauth', accessToken: 'test_token' },
          }),
          fetchSubscription: vi.fn().mockResolvedValue({
            id: 'sub_1',
            paid_count: 2,
          }),
          fetchInvoices: vi.fn().mockResolvedValue({
            items: [
              {
                subscription_id: 'sub_1',
                payment_id: 'pay_1',
                status: 'paid',
                amount_paid: 125000,
                paid_at: 1787691000,
              },
            ],
          }),
          fetchPayment: vi.fn(),
        },
      })
    ).rejects.toThrow(
      'Razorpay invoice history does not match subscription paid_count'
    );
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('does not preserve an observation when the provider payment disagrees with its invoice', async () => {
    const reconcileClaimedSubscriptionSource = (
      reconciliation as unknown as {
        reconcileClaimedSubscriptionSource: (
          input: unknown
        ) => Promise<unknown>;
      }
    ).reconcileClaimedSubscriptionSource;
    const admin = { rpc: vi.fn() };

    await expect(
      reconcileClaimedSubscriptionSource({
        admin,
        mandate: {
          id: 'mandate_1',
          account_id: 'account_1',
          membership_id: 'membership_1',
          gateway_subscription_id: 'sub_1',
          last_applied_paid_count: 0,
        },
        dependencies: {
          getConnection: vi.fn().mockResolvedValue({
            accountId: 'account_1',
            authentication: { mode: 'oauth', accessToken: 'test_token' },
          }),
          fetchSubscription: vi.fn().mockResolvedValue({
            id: 'sub_1',
            paid_count: 1,
          }),
          fetchInvoices: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'inv_1',
                subscription_id: 'sub_1',
                payment_id: 'pay_1',
                status: 'paid',
                amount_paid: 125000,
                currency: 'INR',
                paid_at: 1787691000,
              },
            ],
          }),
          fetchPayment: vi.fn().mockResolvedValue({
            id: 'pay_1',
            amount: 124900,
            currency: 'INR',
            status: 'captured',
            captured: true,
          }),
        },
      })
    ).rejects.toThrow('Razorpay payment pay_1 does not match its paid invoice');
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('raises a disagreement when the local ledger is ahead of Razorpay', async () => {
    const reconcileClaimedSubscriptionSource = (
      reconciliation as unknown as {
        reconcileClaimedSubscriptionSource: (
          input: unknown
        ) => Promise<unknown>;
      }
    ).reconcileClaimedSubscriptionSource;

    await expect(
      reconcileClaimedSubscriptionSource({
        admin: { rpc: vi.fn() },
        mandate: {
          id: 'mandate_1',
          account_id: 'account_1',
          membership_id: 'membership_1',
          gateway_subscription_id: 'sub_1',
          last_applied_paid_count: 2,
        },
        dependencies: {
          getConnection: vi.fn().mockResolvedValue({
            accountId: 'account_1',
            authentication: { mode: 'oauth', accessToken: 'test_token' },
          }),
          fetchSubscription: vi.fn().mockResolvedValue({
            id: 'sub_1',
            paid_count: 1,
          }),
          fetchInvoices: vi.fn().mockResolvedValue({
            items: [
              {
                subscription_id: 'sub_1',
                payment_id: 'pay_1',
                status: 'paid',
                amount_paid: 125000,
                paid_at: 1787691000,
              },
            ],
          }),
          fetchPayment: vi.fn(),
        },
      })
    ).rejects.toThrow('UsefulDesk is ahead of Razorpay paid_count');
  });
});
