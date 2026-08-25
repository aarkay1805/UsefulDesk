import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';

const h = vi.hoisted(() => ({
  sendTemplateMessage: vi.fn(),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: h.sendTemplateMessage,
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'token',
  encrypt: (value: string) => value,
  isLegacyFormat: () => false,
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      }),
    }),
  }),
}));

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });

  it('rejects a persisted invoice route unless a provider media URL is supplied', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'template',
        templateName: 'gym_invoice_document',
        persistedMediaUrl:
          '/api/invoices/11111111-1111-4111-8111-111111111111/document',
      },
      400,
      /provider header media URL/
    );
  });

  it.each([
    '/api/invoices//document',
    '/api/invoices/111/document/extra/document',
    '/api/invoices/111/document?download=1',
    'https://example.com/api/invoices/111/document',
  ])('rejects an invalid persisted invoice media route: %s', async (url) => {
    await expectSendError(
      {
        ...base,
        messageType: 'template',
        templateName: 'gym_invoice_document',
        templateMessageParams: {
          headerMediaUrl: 'https://storage.example/signed.pdf?token=short',
        },
        persistedMediaUrl: url,
      },
      400,
      /valid invoice document route/
    );
  });
});

const invoiceTemplate: MessageTemplate = {
  id: 'template-1',
  account_id: 'account-1',
  user_id: 'user-1',
  name: 'gym_invoice_document',
  category: 'Utility',
  language: 'en_US',
  header_type: 'document',
  body_text:
    'Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.',
  status: 'APPROVED',
  parameter_format: 'POSITIONAL',
  created_at: '2026-08-24T00:00:00.000Z',
};

function invoiceSendDb(captured: { inserted: Record<string, unknown> | null }) {
  return {
    from(table: string) {
      switch (table) {
        case 'conversations':
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: 'conversation-1',
                        contact: { id: 'contact-1', phone: '+919999999999' },
                      },
                      error: null,
                    }),
                }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        case 'whatsapp_config':
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: 'config-1',
                      phone_number_id: 'phone-number-1',
                      access_token: 'encrypted',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        case 'message_templates':
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: invoiceTemplate, error: null }),
                  }),
                }),
              }),
            }),
          };
        case 'messages':
          return {
            insert: (payload: Record<string, unknown>) => {
              captured.inserted = payload;
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: 'message-1' },
                      error: null,
                    }),
                }),
              };
            },
          };
        default:
          throw new Error(`Unexpected table ${table}`);
      }
    },
  } as unknown as SupabaseClient;
}

describe('sendMessageToConversation — stable invoice history media', () => {
  it('sends the signed provider URL while persisting the stable authenticated route', async () => {
    h.sendTemplateMessage.mockResolvedValueOnce({ messageId: 'wamid.1' });
    const captured: { inserted: Record<string, unknown> | null } = {
      inserted: null,
    };
    const signedUrl =
      'https://storage.example/signed-invoice.pdf?token=short-lived';
    const persistedMediaUrl =
      '/api/invoices/11111111-1111-4111-8111-111111111111/document';

    await sendMessageToConversation(invoiceSendDb(captured), 'account-1', {
      conversationId: 'conversation-1',
      messageType: 'template',
      templateName: 'gym_invoice_document',
      templateLanguage: 'en_US',
      templateMessageParams: {
        headerMediaUrl: signedUrl,
        body: ['Asha', 'INV-000042', '₹2,500.00', 'FitZone Gym'],
      },
      persistedMediaUrl,
    });

    expect(h.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'gym_invoice_document',
        messageParams: {
          headerMediaUrl: signedUrl,
          body: ['Asha', 'INV-000042', '₹2,500.00', 'FitZone Gym'],
        },
      })
    );
    expect(captured.inserted?.media_url).toBe(persistedMediaUrl);
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});
