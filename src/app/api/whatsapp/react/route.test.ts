import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOperationalAccess: vi.fn(),
  requireSendOperationalAccess: vi.fn(),
  sendReactionMessage: vi.fn(),
  checkRateLimit: vi.fn(),
}));

function makeSupabase() {
  return {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(async () => {
        if (table === 'messages') {
          return {
            data: {
              id: '94c45d67-692f-4654-8806-668858e84c6b',
              message_id: 'wamid.test',
              conversation_id: '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141',
            },
            error: null,
          };
        }
        if (table === 'conversations') {
          return {
            data: {
              id: '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141',
              account_id: 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497',
              contact: { phone: '+919876543210' },
            },
            error: null,
          };
        }
        throw new Error(`Unexpected maybeSingle table: ${table}`);
      });
      builder.single = vi.fn(async () => {
        if (table !== 'whatsapp_config') {
          throw new Error(`Unexpected single table: ${table}`);
        }
        return {
          data: { phone_number_id: 'phone-1', access_token: 'encrypted-token' },
          error: null,
        };
      });
      builder.upsert = vi.fn(async () => ({ error: null }));
      builder.delete = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ error: null });
      return builder;
    }),
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireOperationalAccess: mocks.requireOperationalAccess,
  toErrorResponse: (error: { status?: number; message?: string }) =>
    Response.json(
      { error: error.message ?? 'Internal server error' },
      { status: error.status ?? 500 }
    ),
}));

vi.mock('@/lib/auth/mobile-operational-access', () => ({
  requireSendOperationalAccess: mocks.requireSendOperationalAccess,
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendReactionMessage: mocks.sendReactionMessage,
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plain-token'),
}));

vi.mock('@/lib/whatsapp/phone-utils', () => ({
  sanitizePhoneForMeta: vi.fn(() => '919876543210'),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { react: { limit: 30, windowMs: 60_000 } },
}));

import { POST } from './route';

function reactionRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/whatsapp/react', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      message_id: '94c45d67-692f-4654-8806-668858e84c6b',
      emoji: '👍',
    }),
  });
}

describe('POST /api/whatsapp/react authorization', () => {
  beforeEach(() => {
    const context = {
      supabase: makeSupabase(),
      userId: '11111111-1111-4111-8111-111111111111',
      accountId: 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497',
    };
    mocks.requireOperationalAccess.mockResolvedValue(context);
    mocks.requireSendOperationalAccess.mockResolvedValue(context);
    mocks.sendReactionMessage.mockResolvedValue({ messageId: 'wamid.react' });
    mocks.checkRateLimit.mockReturnValue({ success: true });
  });

  it('routes a bearer reaction through strict mobile operational access', async () => {
    const request = reactionRequest({
      Authorization: 'Bearer mobile-access-token',
      'x-usefuldesk-account-id': 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497',
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireSendOperationalAccess).toHaveBeenCalledWith(request);
    expect(mocks.requireOperationalAccess).not.toHaveBeenCalled();
    expect(mocks.sendReactionMessage).toHaveBeenCalledOnce();
  });

  it('keeps cookie callers on the shared compatibility resolver', async () => {
    const request = reactionRequest();

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireSendOperationalAccess).toHaveBeenCalledWith(request);
    expect(mocks.requireOperationalAccess).not.toHaveBeenCalled();
  });
});
