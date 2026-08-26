import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class DisconnectBlockedError extends Error {}
  return {
    DisconnectBlockedError,
    requireAccess: vi.fn(),
    disconnect: vi.fn(),
  };
});

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
vi.mock('@/lib/payments/credentials', () => ({
  RazorpayDisconnectBlockedError: mocks.DisconnectBlockedError,
  disconnectRazorpayOAuthConnection: mocks.disconnect,
  getRazorpayConnectionStatus: vi.fn(),
}));

import { POST } from './route';

describe('Razorpay disconnect boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue({ accountId: 'account-id' });
    mocks.disconnect.mockRejectedValue(
      new mocks.DisconnectBlockedError(
        'Disconnect is blocked while an active auto-pay mandate needs Razorpay'
      )
    );
  });

  it('returns an actionable conflict when provider work is still active', async () => {
    const response = await POST(
      new Request(
        'https://desk.example/api/payments/razorpay/oauth/disconnect',
        {
          method: 'POST',
          headers: {
            origin: 'https://desk.example',
            'sec-fetch-site': 'same-origin',
          },
        }
      )
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        'Disconnect is blocked while an active auto-pay mandate needs Razorpay',
    });
  });
});
