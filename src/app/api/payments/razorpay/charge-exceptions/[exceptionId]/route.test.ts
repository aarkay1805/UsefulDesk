import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/account', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/account')>();
  return {
    ...actual,
    requirePaymentGatewayAccess: mocks.requireAccess,
  };
});
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ serviceRole: true }),
}));
vi.mock('@/lib/payments/razorpay-charge-resolution', () => ({
  RazorpayChargeResolutionConflictError: class extends Error {},
  resolveProviderChargeException: mocks.resolve,
}));

import { POST } from './route';

function request(body: unknown, origin = 'https://desk.example') {
  return new Request(
    'https://desk.example/api/payments/razorpay/charge-exceptions/exception_1',
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

describe('Razorpay charge-exception resolution route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue({
      accountId: 'account_1',
      userId: 'user_1',
      role: 'owner',
    });
    mocks.resolve.mockResolvedValue({ outcome: 'applied' });
  });

  it('rejects cross-site mutations before loading the caller', async () => {
    const response = await POST(
      request(
        { action: 'apply', reason: 'Verified provider charge' },
        'https://evil.example'
      ),
      { params: Promise.resolve({ exceptionId: 'exception_1' }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('passes only the authenticated tenant and actor to resolution', async () => {
    const response = await POST(
      request({ action: 'apply', reason: 'Verified provider charge' }),
      { params: Promise.resolve({ exceptionId: 'exception_1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account_1',
        userId: 'user_1',
        exceptionId: 'exception_1',
        action: 'apply',
        reason: 'Verified provider charge',
      })
    );
  });

  it('requires a reason for an externally handled charge', async () => {
    const response = await POST(request({ action: 'ignore', reason: '  ' }), {
      params: Promise.resolve({ exceptionId: 'exception_1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
