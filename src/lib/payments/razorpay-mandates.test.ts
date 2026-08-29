import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  fetchSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('./credentials', () => ({
  getRazorpayConnection: mocks.getConnection,
  runRazorpayOperation: vi.fn(
    async (_admin, _connection, operation: (auth: object) => unknown) =>
      operation({ mode: 'oauth', accessToken: 'mock' })
  ),
}));
vi.mock('./razorpay', () => ({
  fetchSubscription: mocks.fetchSubscription,
  cancelSubscription: mocks.cancelSubscription,
}));

import {
  cancelRazorpayMandate,
  MandateCancellationUnavailableError,
} from './razorpay-mandates';

function subscription(status: string) {
  return {
    id: 'sub_1',
    entity: 'subscription',
    plan_id: 'plan_1',
    status,
  };
}

function admin(
  status = 'active',
  audit: {
    cancelled_at?: string | null;
    cancelled_by?: string | null;
    cancellation_reason?: string | null;
  } = {}
) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: {
        id: 'mandate_1',
        account_id: 'account_1',
        gateway: 'razorpay',
        status,
        gateway_subscription_id: 'sub_1',
        cancelled_at: audit.cancelled_at ?? null,
        cancelled_by: audit.cancelled_by ?? null,
        cancellation_reason: audit.cancellation_reason ?? null,
      },
      error: null,
    })),
  };
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  return { client: { from: vi.fn(() => query), rpc }, query, rpc };
}

const input = {
  accountId: 'account_1',
  userId: 'user_1',
  mandateId: 'mandate_1',
  reason: 'Member requested cancellation',
};

describe('Razorpay mandate cancellation convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue({ accountId: 'account_1' });
  });

  it('scopes the mandate locally, cancels immediately, and finalizes audited state', async () => {
    const memory = admin();
    mocks.fetchSubscription.mockResolvedValue(subscription('active'));
    mocks.cancelSubscription.mockResolvedValue(subscription('cancelled'));

    await expect(
      cancelRazorpayMandate({ admin: memory.client as never, ...input })
    ).resolves.toMatchObject({
      status: 'revoked',
      providerStatus: 'cancelled',
    });

    expect(memory.query.eq).toHaveBeenCalledWith('account_id', 'account_1');
    expect(mocks.cancelSubscription).toHaveBeenCalledWith(
      expect.anything(),
      'sub_1',
      false
    );
    expect(memory.rpc).toHaveBeenCalledWith(
      'finalize_razorpay_mandate_cancellation',
      expect.objectContaining({
        p_account_id: 'account_1',
        p_actor: 'user_1',
        p_reason: 'Member requested cancellation',
      })
    );
  });

  it('converges after an ambiguous cancel response by re-reading Razorpay', async () => {
    const memory = admin();
    mocks.fetchSubscription
      .mockResolvedValueOnce(subscription('active'))
      .mockResolvedValueOnce(subscription('cancelled'));
    mocks.cancelSubscription.mockRejectedValue(new Error('timeout'));

    await expect(
      cancelRazorpayMandate({ admin: memory.client as never, ...input })
    ).resolves.toMatchObject({ status: 'revoked' });

    expect(mocks.fetchSubscription).toHaveBeenCalledTimes(2);
    expect(memory.rpc).toHaveBeenCalledOnce();
  });

  it('backfills the owner audit when a cancellation webhook wins the race', async () => {
    const memory = admin('revoked');
    mocks.fetchSubscription.mockResolvedValue(subscription('cancelled'));

    await expect(
      cancelRazorpayMandate({ admin: memory.client as never, ...input })
    ).resolves.toMatchObject({
      status: 'revoked',
      providerStatus: 'cancelled',
    });

    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
    expect(mocks.fetchSubscription).toHaveBeenCalledOnce();
    expect(memory.rpc).toHaveBeenCalledWith(
      'finalize_razorpay_mandate_cancellation',
      expect.objectContaining({
        p_actor: 'user_1',
        p_reason: 'Member requested cancellation',
      })
    );
  });

  it('does not change local state when Razorpay remains non-terminal', async () => {
    const memory = admin();
    mocks.fetchSubscription.mockResolvedValue(subscription('active'));
    mocks.cancelSubscription.mockRejectedValue(new Error('timeout'));

    await expect(
      cancelRazorpayMandate({ admin: memory.client as never, ...input })
    ).rejects.toBeInstanceOf(MandateCancellationUnavailableError);

    expect(memory.rpc).not.toHaveBeenCalled();
  });

  it('does not change local state when the initial provider read fails', async () => {
    const memory = admin();
    mocks.fetchSubscription.mockRejectedValue(new Error('unavailable'));

    await expect(
      cancelRazorpayMandate({ admin: memory.client as never, ...input })
    ).rejects.toBeInstanceOf(MandateCancellationUnavailableError);

    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
    expect(memory.rpc).not.toHaveBeenCalled();
  });

  it('turns a missing or blocked deployment connection into an actionable error', async () => {
    const memory = admin();
    mocks.getConnection.mockRejectedValue(
      new Error('RAZORPAY_MODE must be set to test or live')
    );

    await expect(
      cancelRazorpayMandate({ admin: memory.client as never, ...input })
    ).rejects.toMatchObject({
      name: 'MandateCancellationUnavailableError',
      message:
        'Razorpay is unavailable for this account. Check Settings → Payments and the deployment configuration, then retry.',
    });

    expect(mocks.fetchSubscription).not.toHaveBeenCalled();
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
    expect(memory.rpc).not.toHaveBeenCalled();
  });
});
