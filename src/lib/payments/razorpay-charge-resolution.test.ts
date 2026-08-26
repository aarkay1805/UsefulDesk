import { describe, expect, it, vi } from 'vitest';

import * as chargeResolution from './razorpay-charge-resolution';

const exception = {
  id: 'exception_1',
  account_id: 'account_1',
  gateway_subscription_id: 'sub_1',
  gateway_payment_id: 'pay_1',
  gateway_invoice_id: 'inv_1',
  provider_paid_count: 1,
  amount: 1250,
  currency: 'INR',
  status: 'open',
  reason_code: 'provider_charge_missing_webhook',
};

function providerDependencies(overrides?: Record<string, unknown>) {
  return {
    loadException: vi.fn().mockResolvedValue(exception),
    getConnection: vi.fn().mockResolvedValue({
      accountId: 'account_1',
      authentication: { mode: 'oauth', accessToken: 'test_token' },
    }),
    fetchSubscription: vi.fn().mockResolvedValue({
      id: 'sub_1',
      paid_count: 1,
      status: 'active',
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
        },
      ],
    }),
    fetchPayment: vi.fn().mockResolvedValue({
      id: 'pay_1',
      amount: 125000,
      currency: 'INR',
      status: 'captured',
      captured: true,
      amount_refunded: 0,
      refund_status: null,
    }),
    ...overrides,
  };
}

describe('Razorpay provider charge resolution', () => {
  it('revalidates subscription, invoice, and unrefunded payment before applying', async () => {
    const resolveProviderChargeException = (
      chargeResolution as unknown as {
        resolveProviderChargeException?: (input: unknown) => Promise<unknown>;
      }
    ).resolveProviderChargeException;
    expect(resolveProviderChargeException).toBeTypeOf('function');
    if (!resolveProviderChargeException) return;

    const admin = {
      rpc: vi.fn().mockResolvedValue({
        data: { outcome: 'applied', payment_id: 'local_payment_1' },
        error: null,
      }),
    };
    const dependencies = providerDependencies();

    await expect(
      resolveProviderChargeException({
        admin,
        accountId: 'account_1',
        userId: 'user_1',
        exceptionId: 'exception_1',
        action: 'apply',
        reason: 'Verified and applied by the owner',
        dependencies,
      })
    ).resolves.toEqual({
      outcome: 'applied',
      payment_id: 'local_payment_1',
    });
    expect(dependencies.fetchSubscription).toHaveBeenCalled();
    expect(dependencies.fetchInvoices).toHaveBeenCalled();
    expect(dependencies.fetchPayment).toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith(
      'resolve_razorpay_provider_charge_exception',
      {
        p_account_id: 'account_1',
        p_exception_id: 'exception_1',
        p_actor: 'user_1',
        p_note: 'Verified and applied by the owner',
      }
    );
  });

  it('refuses to apply a provider payment that has since been refunded', async () => {
    const admin = { rpc: vi.fn() };
    const dependencies = providerDependencies({
      fetchPayment: vi.fn().mockResolvedValue({
        id: 'pay_1',
        amount: 125000,
        currency: 'INR',
        status: 'captured',
        captured: true,
        amount_refunded: 50000,
        refund_status: 'partial',
      }),
    });

    await expect(
      chargeResolution.resolveProviderChargeException({
        admin: admin as never,
        accountId: 'account_1',
        userId: 'user_1',
        exceptionId: 'exception_1',
        action: 'apply',
        reason: 'Apply charge',
        dependencies,
      })
    ).rejects.toThrow('refunded');
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('refuses an invoice that no longer matches the preserved charge', async () => {
    const admin = { rpc: vi.fn() };
    const dependencies = providerDependencies({
      fetchInvoices: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'inv_1',
            subscription_id: 'sub_1',
            payment_id: 'pay_other',
            status: 'paid',
            amount_paid: 125000,
            currency: 'INR',
          },
        ],
      }),
    });

    await expect(
      chargeResolution.resolveProviderChargeException({
        admin: admin as never,
        accountId: 'account_1',
        userId: 'user_1',
        exceptionId: 'exception_1',
        action: 'apply',
        reason: 'Apply charge',
        dependencies,
      })
    ).rejects.toThrow('invoice no longer matches');
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('marks an externally handled charge without calling Razorpay', async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({
        data: { outcome: 'ignored' },
        error: null,
      }),
    };
    const dependencies = providerDependencies();

    await expect(
      chargeResolution.resolveProviderChargeException({
        admin: admin as never,
        accountId: 'account_1',
        userId: 'user_1',
        exceptionId: 'exception_1',
        action: 'ignore',
        reason: 'Already handled in the offline ledger',
        dependencies,
      })
    ).resolves.toEqual({ outcome: 'ignored' });
    expect(dependencies.getConnection).not.toHaveBeenCalled();
    expect(dependencies.fetchPayment).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith(
      'ignore_razorpay_provider_charge_exception',
      {
        p_account_id: 'account_1',
        p_exception_id: 'exception_1',
        p_actor: 'user_1',
        p_note: 'Already handled in the offline ledger',
      }
    );
  });
});
