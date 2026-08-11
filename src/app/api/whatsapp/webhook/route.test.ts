import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  reopenClosedConversation: vi.fn(),
  state: {
    messageUpsertResult: [{ id: 'message-1' }] as { id: string }[],
    priorCustomerMsgCount: 0,
    conversationLookupResults: [
      {
        id: 'conversation-1',
        status: 'open',
        unread_count: 0,
        account_id: 'account-1',
      },
    ] as Record<string, unknown>[][] | Record<string, unknown>[],
    conversationLookupCall: 0,
    conversationInsertError: null as { code?: string } | null,
    conversationInsertResult: null as Record<string, unknown> | null,
    messageUpserts: [] as {
      row: Record<string, unknown>;
      options: Record<string, unknown>;
    }[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    afterCallbacks: [] as (() => Promise<void> | void)[],
    automationStarted: 0,
    automationCompleted: 0,
  },
}));

vi.mock('next/server', () => ({
  after: (callback: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(callback);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      switch (table) {
        case 'whatsapp_config':
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    {
                      account_id: 'account-1',
                      user_id: 'user-1',
                      access_token: 'encrypted',
                    },
                  ],
                  error: null,
                }),
            }),
          };
        case 'conversations':
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => {
                      const scripted = h.state.conversationLookupResults[
                        h.state.conversationLookupCall
                      ] as
                        | Record<string, unknown>
                        | Record<string, unknown>[]
                        | undefined;
                      h.state.conversationLookupCall++;
                      const data = Array.isArray(scripted)
                        ? scripted
                        : scripted
                          ? [scripted]
                          : [];
                      return Promise.resolve({ data, error: null });
                    },
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: h.state.conversationInsertResult,
                    error: h.state.conversationInsertError,
                  }),
              }),
            }),
          };
        case 'messages':
          return {
            select: (_columns: string, options?: { head?: boolean }) => {
              if (!options?.head) {
                throw new Error('unexpected non-count message lookup');
              }
              return {
                eq: () => ({
                  eq: () =>
                    Promise.resolve({
                      count: h.state.priorCustomerMsgCount,
                      error: null,
                    }),
                }),
              };
            },
            upsert: (
              row: Record<string, unknown>,
              options: Record<string, unknown>
            ) => {
              h.state.messageUpserts.push({ row, options });
              return {
                select: () =>
                  Promise.resolve({
                    data: h.state.messageUpsertResult,
                    error: null,
                  }),
              };
            },
          };
        case 'broadcast_recipients':
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: () => Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (value: string) => value,
  isLegacyFormat: () => false,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async () => ({
    id: 'contact-1',
    name: 'Ada',
    phone: '15551230000',
    source: null,
  })),
  isUniqueViolation: (error: { code?: string } | null) =>
    error?.code === '23505',
}));
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}));
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}));
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}));
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}));
vi.mock('@/lib/consent/whatsapp-opt-out', () => ({
  isWhatsAppOptOut: () => false,
}));
vi.mock('@/lib/whatsapp/referral', () => ({
  parseWhatsAppReferral: () => null,
  contactSourceFromReferral: () => null,
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: h.reopenClosedConversation,
}));

import { POST } from './route';

const TEXT_MESSAGE = {
  id: 'wamid.TEXT1',
  from: '15551230000',
  timestamp: '1700000000',
  type: 'text',
  text: { body: 'hello' },
};

function inboundRequest(message: Record<string, unknown> = TEXT_MESSAGE) {
  return {
    text: async () =>
      JSON.stringify({
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'phone-number-1' },
                  contacts: [
                    { wa_id: '15551230000', profile: { name: 'Ada' } },
                  ],
                  messages: [message],
                },
              },
            ],
          },
        ],
      }),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request;
}

async function runWebhook(message?: Record<string, unknown>) {
  const response = await POST(inboundRequest(message));
  for (const callback of h.state.afterCallbacks) await callback();
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.messageUpsertResult = [{ id: 'message-1' }];
  h.state.priorCustomerMsgCount = 0;
  h.state.conversationLookupResults = [
    {
      id: 'conversation-1',
      status: 'open',
      unread_count: 0,
      account_id: 'account-1',
    },
  ];
  h.state.conversationLookupCall = 0;
  h.state.conversationInsertError = null;
  h.state.conversationInsertResult = null;
  h.state.messageUpserts = [];
  h.state.rpcCalls = [];
  h.state.afterCallbacks = [];
  h.state.automationStarted = 0;
  h.state.automationCompleted = 0;
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false });
  h.dispatchInboundToAiReply.mockResolvedValue(undefined);
  h.dispatchWebhookEvent.mockResolvedValue(undefined);
  h.reopenClosedConversation.mockResolvedValue(false);
  h.runAutomationsForTrigger.mockImplementation(() => {
    h.state.automationStarted++;
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        h.state.automationCompleted++;
        resolve();
      }, 0);
    });
  });
});

describe('inbound message integrity', () => {
  it('persists a genuine delivery with the full conflict key', async () => {
    await runWebhook();

    expect(h.state.messageUpserts).toHaveLength(1);
    expect(h.state.messageUpserts[0].options).toEqual({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    });
    expect(h.dispatchInboundToFlows).toHaveBeenCalledOnce();
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      'message.received',
      expect.anything()
    );
  });

  it('stops a replay before unread and every downstream dispatch', async () => {
    h.state.messageUpsertResult = [];

    await runWebhook();

    expect(h.state.rpcCalls).toEqual([]);
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled();
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled();
    expect(h.reopenClosedConversation).not.toHaveBeenCalled();
  });

  it('atomically increments unread state through the service-only RPC', async () => {
    await runWebhook();

    expect(h.state.rpcCalls).toContainEqual({
      name: 'bump_conversation_on_inbound',
      args: {
        p_conversation_id: 'conversation-1',
        p_last_message_text: 'hello',
      },
    });
  });

  it('awaits every automation before the after callback completes', async () => {
    await runWebhook();

    expect(h.state.automationStarted).toBe(3);
    expect(h.state.automationCompleted).toBe(3);
  });

  it('recovers the canonical conversation after a concurrent insert wins', async () => {
    h.state.conversationLookupResults = [
      [],
      [
        {
          id: 'conversation-raced',
          status: 'open',
          unread_count: 0,
          account_id: 'account-1',
        },
      ],
    ];
    h.state.conversationInsertError = { code: '23505' };

    await runWebhook();

    expect(h.state.messageUpserts[0].row.conversation_id).toBe(
      'conversation-raced'
    );
  });

  it('does not lose conversation.created when another delivery wins the message race', async () => {
    h.state.conversationLookupResults = [[]];
    h.state.conversationInsertResult = {
      id: 'conversation-created',
      status: 'open',
      unread_count: 0,
      account_id: 'account-1',
    };
    h.state.messageUpsertResult = [];

    await runWebhook();

    expect(h.dispatchWebhookEvent).toHaveBeenCalledOnce();
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      'conversation.created',
      {
        conversation_id: 'conversation-created',
        contact_id: 'contact-1',
      }
    );
    expect(h.state.rpcCalls).toEqual([]);
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();
  });
});

describe('template quick-reply normalization', () => {
  const templateButton = {
    id: 'wamid.BUTTON1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'button',
    button: { text: 'Yes, interested', payload: 'YES_INTERESTED' },
  };

  it('persists and routes a template button through the interactive Flow path', async () => {
    await runWebhook(templateButton);

    expect(h.state.messageUpserts[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Yes, interested',
      interactive_reply_id: 'YES_INTERESTED',
    });
    expect(h.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          kind: 'interactive_reply',
          reply_id: 'YES_INTERESTED',
          reply_title: 'Yes, interested',
          meta_message_id: 'wamid.BUTTON1',
        },
      })
    );
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });

  it('uses the visible label when Meta omits a payload', async () => {
    await runWebhook({
      ...templateButton,
      button: { text: 'Track my order' },
    });

    expect(h.state.messageUpserts[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Track my order',
      interactive_reply_id: 'Track my order',
    });
  });
});
