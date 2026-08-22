import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unauthorized } from '@/lib/api/v1/respond';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  resolveConversationByPhone: vi.fn(),
  sendMessageToConversation: vi.fn(),
  rpc: vi.fn(),
  accountFilters: [] as Array<[string, unknown]>,
  templateRow: null as Record<string, unknown> | null,
}));

function makeSupabase() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    if (column === 'account_id') mocks.accountFilters.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(async () => ({
    data: mocks.templateRow,
    error: null,
  }));

  return {
    from: vi.fn((table: string) => {
      if (table !== 'message_templates') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return builder;
    }),
    rpc: mocks.rpc,
  };
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: mocks.resolveConversationByPhone,
}));

vi.mock('@/lib/whatsapp/send-message', async (importActual) => {
  const actual =
    await importActual<typeof import('@/lib/whatsapp/send-message')>();
  return {
    ...actual,
    sendMessageToConversation: mocks.sendMessageToConversation,
  };
});

import { POST } from './route';

function request(body: Record<string, unknown>) {
  return new Request('https://example.com/api/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/messages outbound policy', () => {
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
    const supabase = makeSupabase();
    mocks.requireApiKey.mockResolvedValue({
      accountId: 'account-1',
      supabase,
    });
    mocks.resolveConversationByPhone.mockResolvedValue({
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    mocks.sendMessageToConversation.mockResolvedValue({
      messageId: 'message-1',
      whatsappMessageId: 'wamid-1',
    });
    mocks.rpc.mockRejectedValue(new Error('unexpected consent RPC'));
  });

  it('sends proactive text without consulting consent or suppression RPCs', async () => {
    const response = await POST(
      request({ to: '+919779208861', type: 'text', text: 'Hello' })
    );

    expect(response.status).toBe(201);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).toHaveBeenCalledOnce();
  });

  it('validates an account-scoped template, then sends without a consent RPC', async () => {
    const response = await POST(
      request({
        to: '+919779208861',
        type: 'template',
        template: {
          name: 'order_update',
          language: 'en_US',
          params: ['Rajat', '#1234'],
        },
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.accountFilters).toContainEqual(['account_id', 'account-1']);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).toHaveBeenCalledOnce();
  });

  it('keeps exact template policy enforcement before sending', async () => {
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

    const response = await POST(
      request({
        to: '+919779208861',
        type: 'template',
        template: {
          name: 'gym_membership_renewal',
          language: 'en_US',
          params: ['Rajat', 'Competition', '20 Sept 2026', '₹1,000'],
        },
      })
    );

    expect(response.status).toBe(409);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('keeps API-key authorization in front of the send boundary', async () => {
    mocks.requireApiKey.mockRejectedValueOnce(unauthorized());

    const response = await POST(
      request({ to: '+919779208861', type: 'text', text: 'Hello' })
    );

    expect(response.status).toBe(401);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });
});
