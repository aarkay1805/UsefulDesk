import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/account', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/account')>();
  return { ...actual, requirePaymentGatewayAccess: mocks.requireAccess };
});
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}));

import { POST } from './route';

describe('Razorpay application webhook cutover route', () => {
  beforeEach(() => {
    vi.stubEnv('RAZORPAY_MODE', 'test');
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'true');
    mocks.requireAccess.mockResolvedValue({
      accountId: 'account-id',
      userId: 'user-id',
      role: 'owner',
    });
    mocks.rpc.mockResolvedValue({
      data: {
        cutover_id: 'cutover-id',
        canonical_webhook_ingress: 'application',
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('atomically invokes the service-only gate for the authenticated account', async () => {
    const response = await POST(buildRequest(['evt_a', 'evt_b', 'evt_c']));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'cutover_razorpay_application_webhook',
      {
        p_account_id: 'account-id',
        p_provider_mode: 'test',
        p_parity_event_ids: ['evt_a', 'evt_b', 'evt_c'],
        p_cutover_by: 'user-id',
      }
    );
  });

  it('is hidden outside the isolated Test acceptance deployment', async () => {
    vi.stubEnv('RAZORPAY_PROVIDER_ACCEPTANCE_ONLY', 'false');

    const response = await POST(buildRequest(['evt_a', 'evt_b', 'evt_c']));

    expect(response.status).toBe(404);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before authentication', async () => {
    const request = buildRequest(['evt_a', 'evt_b', 'evt_c']);
    request.headers.set('origin', 'https://attacker.test');

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('requires exactly three distinct parity event ids', async () => {
    const response = await POST(buildRequest(['evt_a', 'evt_a', 'evt_c']));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not switch when the database proof rejects the evidence', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'internal parity detail' },
    });

    const response = await POST(buildRequest(['evt_a', 'evt_b', 'evt_c']));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Razorpay cutover evidence did not pass',
    });
  });
});

function buildRequest(parityEventIds: string[]) {
  return new Request(
    'https://example.test/api/payments/razorpay/webhook/cutover',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.test',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ parityEventIds }),
    }
  );
}
