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
    configLookupError: null as { message: string } | null,
    messageUpserts: [] as {
      row: Record<string, unknown>;
      options: Record<string, unknown>;
    }[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    statusRpcResult: [] as {
      account_id: string;
      conversation_id: string;
    }[],
    recordReceiptError: null as { message: string } | null,
    receiptPayload: null as Record<string, unknown> | null,
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
                  data: h.state.configLookupError
                    ? null
                    : [
                        {
                          account_id: 'account-1',
                          user_id: 'user-1',
                          access_token: 'encrypted',
                        },
                      ],
                  error: h.state.configLookupError,
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
      if (name === 'record_whatsapp_webhook_receipt') {
        return Promise.resolve({
          data: h.state.recordReceiptError
            ? null
            : [{ receipt_id: 'receipt-1', receipt_status: 'pending' }],
          error: h.state.recordReceiptError,
        });
      }
      if (name === 'claim_whatsapp_webhook_receipts') {
        return Promise.resolve({
          data: h.state.receiptPayload
            ? [
                {
                  receipt_id: 'receipt-1',
                  payload: h.state.receiptPayload,
                  attempt_count: 1,
                  received_at: '2026-08-14T00:00:00.000Z',
                },
              ]
            : [],
          error: null,
        });
      }
      if (
        name === 'complete_whatsapp_webhook_receipt' ||
        name === 'fail_whatsapp_webhook_receipt'
      ) {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({
        data:
          name === 'apply_whatsapp_status_callback'
            ? h.state.statusRpcResult
            : null,
        error: null,
      });
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
vi.mock('@/lib/whatsapp/referral', () => ({
  parseWhatsAppReferral: () => null,
  contactSourceFromReferral: () => null,
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: h.reopenClosedConversation,
}));
vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => true,
  isAuthorizedCronRequest: () => true,
}));

import { GET, POST } from './route';

const TEXT_MESSAGE = {
  id: 'wamid.TEXT1',
  from: '15551230000',
  timestamp: '1700000000',
  type: 'text',
  text: { body: 'hello' },
};

function inboundRequest(message: Record<string, unknown> = TEXT_MESSAGE) {
  const payload = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'phone-number-1' },
              contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
  return {
    text: async () => {
      h.state.receiptPayload = payload;
      return JSON.stringify(payload);
    },
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
  h.state.configLookupError = null;
  h.state.messageUpserts = [];
  h.state.rpcCalls = [];
  h.state.statusRpcResult = [];
  h.state.recordReceiptError = null;
  h.state.receiptPayload = null;
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

function statusRequest(status = 'delivered', phoneNumberId = 'phone-number-1') {
  const payload = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: phoneNumberId },
              statuses: [
                {
                  id: 'wamid.STATUS1',
                  status,
                  timestamp: '1700000000',
                  recipient_id: '15551230000',
                },
              ],
            },
          },
        ],
      },
    ],
  };
  return {
    text: async () => {
      h.state.receiptPayload = payload;
      return JSON.stringify(payload);
    },
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request;
}

describe('durable webhook receipt', () => {
  it('persists the verified payload before acknowledging Meta', async () => {
    const response = await POST(inboundRequest());

    expect(h.state.rpcCalls[0]).toEqual({
      name: 'record_whatsapp_webhook_receipt',
      args: {
        p_body_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_payload: h.state.receiptPayload,
      },
    });
    expect(response).toEqual({
      body: { status: 'received' },
      init: { status: 200 },
    });
    expect(h.state.afterCallbacks).toHaveLength(1);
  });

  it('returns a retryable failure when the durable receipt cannot be written', async () => {
    h.state.recordReceiptError = { message: 'database unavailable' };

    const response = await POST(inboundRequest());

    expect(response).toEqual({
      body: { error: 'Webhook receipt unavailable' },
      init: { status: 503 },
    });
    expect(h.state.afterCallbacks).toHaveLength(0);
  });

  it('recovers a durably claimed receipt through the cron-authenticated drain', async () => {
    await inboundRequest().text();

    const response = await GET({
      headers: new Headers({ 'x-cron-secret': 'test-secret' }),
    } as Request);

    expect(response).toEqual({
      body: expect.objectContaining({ claimed: 1, processed: 1, failed: 0 }),
      init: undefined,
    });
    expect(h.state.rpcCalls).toContainEqual({
      name: 'claim_whatsapp_webhook_receipts',
      args: {
        p_limit: 5,
        p_receipt_id: null,
        p_lease_seconds: 300,
      },
    });
    expect(h.state.rpcCalls).toContainEqual({
      name: 'complete_whatsapp_webhook_receipt',
      args: { p_body_sha256: 'receipt-1' },
    });
  });

  it('releases a failed claim for a later recovery attempt', async () => {
    await inboundRequest().text();
    h.state.configLookupError = { message: 'transient database failure' };

    const failedResponse = await GET({
      headers: new Headers({ 'x-cron-secret': 'test-secret' }),
    } as Request);

    expect(failedResponse).toEqual({
      body: expect.objectContaining({ claimed: 1, processed: 0, failed: 1 }),
      init: undefined,
    });
    expect(h.state.rpcCalls).toContainEqual({
      name: 'fail_whatsapp_webhook_receipt',
      args: {
        p_body_sha256: 'receipt-1',
        p_error:
          'Could not resolve whatsapp_config for phone-number-1: transient database failure',
      },
    });

    h.state.configLookupError = null;
    const recoveredResponse = await GET({
      headers: new Headers({ 'x-cron-secret': 'test-secret' }),
    } as Request);

    expect(recoveredResponse).toEqual({
      body: expect.objectContaining({ claimed: 1, processed: 1, failed: 0 }),
      init: undefined,
    });
    expect(h.state.messageUpserts).toHaveLength(1);
  });
});

async function runStatusWebhook(status?: string, phoneNumberId?: string) {
  const response = await POST(statusRequest(status, phoneNumberId));
  for (const callback of h.state.afterCallbacks) await callback();
  return response;
}

describe('outbound status integrity', () => {
  it('binds the callback to its signed phone-number tenant in one atomic RPC', async () => {
    h.state.statusRpcResult = [
      { account_id: 'account-1', conversation_id: 'conversation-1' },
    ];

    await runStatusWebhook('read', 'phone-number-1');

    expect(h.state.rpcCalls).toContainEqual({
      name: 'apply_whatsapp_status_callback',
      args: {
        p_phone_number_id: 'phone-number-1',
        p_message_id: 'wamid.STATUS1',
        p_status: 'read',
        p_status_at: '2023-11-14T22:13:20.000Z',
      },
    });
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      'message.status_updated',
      {
        whatsapp_message_id: 'wamid.STATUS1',
        conversation_id: 'conversation-1',
        status: 'read',
      }
    );
  });

  it('does not emit a public event when a duplicate or regressive callback changes no row', async () => {
    h.state.statusRpcResult = [];

    await runStatusWebhook('delivered');

    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled();
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

    expect(
      h.state.rpcCalls.filter(
        ({ name }) => !name.includes('whatsapp_webhook_receipt')
      )
    ).toEqual([]);
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
    expect(
      h.state.rpcCalls.filter(
        ({ name }) => !name.includes('whatsapp_webhook_receipt')
      )
    ).toEqual([]);
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

  it('records Unsubscribe before suppressing every downstream Flow, automation, and AI action', async () => {
    await runWebhook({
      ...templateButton,
      id: 'wamid.UNSUBSCRIBE1',
      button: { text: 'Unsubscribe', payload: 'Unsubscribe' },
    });

    expect(h.state.rpcCalls).toContainEqual({
      name: 'record_contact_consent',
      args: {
        p_account_id: 'account-1',
        p_contact_id: 'contact-1',
        p_purpose: 'business_initiated',
        p_action: 'opt_out',
        p_source: 'whatsapp_inbound_keyword',
        p_evidence: {
          meta_message_id: 'wamid.UNSUBSCRIBE1',
          keyword: 'unsubscribe',
        },
      },
    });
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });
});
