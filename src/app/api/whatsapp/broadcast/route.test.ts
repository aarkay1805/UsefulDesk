import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOperationalAccess: vi.fn(),
  sendTemplateMessage: vi.fn(),
  rpc: vi.fn(),
  accountFilters: [] as Array<[string, unknown]>,
  templateRow: null as Record<string, unknown> | null,
}));

function makeSupabase() {
  return {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn((column: string, value: unknown) => {
        if (column === 'account_id') {
          mocks.accountFilters.push([column, value]);
        }
        return builder;
      });
      builder.single = vi.fn(async () => {
        if (table !== 'whatsapp_config') {
          throw new Error(`Unexpected single() table: ${table}`);
        }
        return {
          data: {
            account_id: 'account-1',
            phone_number_id: 'phone-number-1',
            access_token: 'encrypted-token',
          },
          error: null,
        };
      });
      builder.maybeSingle = vi.fn(async () => {
        if (table !== 'message_templates') {
          throw new Error(`Unexpected maybeSingle() table: ${table}`);
        }
        return { data: mocks.templateRow, error: null };
      });
      return builder;
    }),
    rpc: mocks.rpc,
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireOperationalAccess: mocks.requireOperationalAccess,
  toErrorResponse: (error: { status?: number; message?: string }) =>
    Response.json(
      { error: error.message ?? 'Unauthorized' },
      { status: error.status ?? 500 }
    ),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: mocks.sendTemplateMessage,
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plain-token'),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({
    success: true,
    limit: 60,
    remaining: 59,
    reset: Date.now() + 60_000,
  })),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { broadcast: { limit: 60, windowMs: 60_000 } },
}));

import { POST } from './route';

function request(templateName = 'order_update') {
  return new Request('https://example.com/api/whatsapp/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipients: [{ phone: '+919779208861', params: ['Rajat', '#1234'] }],
      template_name: templateName,
      template_language: 'en_US',
    }),
  });
}

describe('POST /api/whatsapp/broadcast outbound policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountFilters.length = 0;
    mocks.templateRow = {
      id: 'template-1',
      account_id: 'account-1',
      user_id: 'user-1',
      name: 'order_update',
      language: 'en_US',
      status: 'APPROVED',
      category: 'Utility',
      parameter_format: 'POSITIONAL',
      body_text: 'Hi {{1}}, order {{2}} has an update.',
      created_at: '2026-08-22T00:00:00.000Z',
    };
    mocks.requireOperationalAccess.mockResolvedValue({
      accountId: 'account-1',
      userId: 'user-1',
      supabase: makeSupabase(),
    });
    mocks.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid-1' });
    mocks.rpc.mockRejectedValue(new Error('unexpected consent RPC'));
  });

  it('sends an account-scoped template without a consent RPC', async () => {
    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sent).toBe(1);
    expect(mocks.accountFilters).toContainEqual(['account_id', 'account-1']);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendTemplateMessage).toHaveBeenCalledOnce();
  });

  it('keeps exact template policy enforcement before Meta', async () => {
    mocks.templateRow = {
      id: 'template-renewal',
      account_id: 'account-1',
      user_id: 'user-1',
      name: 'gym_membership_renewal',
      language: 'en_US',
      status: 'APPROVED',
      category: 'Utility',
      parameter_format: 'POSITIONAL',
      body_text:
        'Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price of {{4}} will continue your membership. Use the buttons below to respond.',
      footer_text: 'Tap Unsubscribe to stop promotional messages.',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Renew membership' },
        { type: 'QUICK_REPLY', text: 'Unsubscribe' },
      ],
      created_at: '2026-08-22T00:00:00.000Z',
    };

    const response = await POST(request('gym_membership_renewal'));

    expect(response.status).toBe(409);
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('keeps operational authorization in front of Meta', async () => {
    mocks.requireOperationalAccess.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { status: 403 })
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });
});
