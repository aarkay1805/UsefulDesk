import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/account', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/account')>();
  return { ...actual, requirePaymentGatewayAccess: mocks.requireAccess };
});
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ serviceRole: true }),
}));
vi.mock('@/lib/payments/razorpay-mandates', () => ({
  MandateCancellationConflictError: class extends Error {},
  MandateCancellationUnavailableError: class extends Error {},
  cancelRazorpayMandate: mocks.cancel,
}));

import { POST } from './route';

function request(body: unknown, origin = 'https://desk.example') {
  return new Request(
    'https://desk.example/api/payments/razorpay/mandates/mandate_1/cancel',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        'sec-fetch-site':
          origin === 'https://desk.example' ? 'same-origin' : 'cross-site',
      },
      body: JSON.stringify(body),
    }
  );
}

describe('Razorpay mandate cancellation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue({
      accountId: 'account_1',
      userId: 'user_1',
      role: 'owner',
    });
    mocks.cancel.mockResolvedValue({ outcome: 'cancelled' });
  });

  it('rejects cross-site cancellation before loading the caller', async () => {
    const response = await POST(
      request(
        { reason: 'Member requested cancellation' },
        'https://evil.example'
      ),
      { params: Promise.resolve({ mandateId: 'mandate_1' }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('passes only the authenticated tenant and actor to cancellation', async () => {
    const response = await POST(
      request({ reason: '  Member requested cancellation  ' }),
      { params: Promise.resolve({ mandateId: 'mandate_1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith({
      admin: { serviceRole: true },
      accountId: 'account_1',
      userId: 'user_1',
      mandateId: 'mandate_1',
      reason: 'Member requested cancellation',
    });
  });

  it('requires an audited cancellation reason', async () => {
    const response = await POST(request({ reason: '  ' }), {
      params: Promise.resolve({ mandateId: 'mandate_1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
