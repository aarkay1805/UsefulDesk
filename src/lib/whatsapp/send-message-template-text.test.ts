import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const { sendMessageToConversation } = await import('./send-message');

const TEMPLATE: MessageTemplate = {
  id: 'template-1',
  account_id: 'account-1',
  user_id: 'user-1',
  name: 'gym_class_schedule',
  category: 'Utility',
  language: 'en_US',
  body_text:
    'Hi {{1}}, your {{2}} membership expires on {{3}}. Renew for {{4}}.',
  status: 'APPROVED',
  parameter_format: 'POSITIONAL',
  created_at: '2026-08-22T00:00:00.000Z',
};

const PARAMS = ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'];
const RENDERED =
  'Hi Rahul, your Quarterly membership expires on 20 Sep 2026. Renew for ₹3,999.';

interface Captured {
  message: Record<string, unknown> | null;
  conversation: Record<string, unknown> | null;
}

function dbCapturingWrites(
  captured: Captured,
  row: MessageTemplate = TEMPLATE
): SupabaseClient {
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
            update: (payload: Record<string, unknown>) => {
              captured.conversation = payload;
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        case 'message_templates':
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: row, error: null }),
                  }),
                }),
              }),
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
                      phone_number_id: 'phone-1',
                      access_token: 'encrypted',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        case 'messages':
          return {
            insert: (payload: Record<string, unknown>) => {
              captured.message = payload;
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({ data: { id: 'message-1' }, error: null }),
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

beforeEach(() => {
  h.sendTemplateMessage.mockReset().mockResolvedValue({ messageId: 'wamid.1' });
});

describe('template sends persist the delivered text', () => {
  it('renders the body from the template row when the caller sends only params', async () => {
    const captured: Captured = { message: null, conversation: null };
    await sendMessageToConversation(dbCapturingWrites(captured), 'account-1', {
      conversationId: 'conversation-1',
      messageType: 'template',
      templateName: 'gym_class_schedule',
      templateLanguage: 'en_US',
      templateMessageParams: { body: PARAMS },
    });

    // Without this the inbox rendered a bare "Template" tag: every send
    // path except the inbox composer passes no content_text at all.
    expect(captured.message?.content_text).toBe(RENDERED);
    expect(captured.conversation?.last_message_text).toBe(RENDERED);
  });

  it('renders from legacy positional params too', async () => {
    const captured: Captured = { message: null, conversation: null };
    await sendMessageToConversation(dbCapturingWrites(captured), 'account-1', {
      conversationId: 'conversation-1',
      messageType: 'template',
      templateName: 'gym_class_schedule',
      templateLanguage: 'en_US',
      templateParams: PARAMS,
    });

    expect(captured.message?.content_text).toBe(RENDERED);
  });

  it('stacks a text header above the body and fills its variable', async () => {
    const captured: Captured = { message: null, conversation: null };
    await sendMessageToConversation(
      dbCapturingWrites(captured, {
        ...TEMPLATE,
        header_type: 'text',
        header_content: '{{1}} renewal',
      }),
      'account-1',
      {
        conversationId: 'conversation-1',
        messageType: 'template',
        templateName: 'gym_class_schedule',
        templateLanguage: 'en_US',
        templateMessageParams: { body: PARAMS, headerText: 'Quarterly' },
      }
    );

    expect(captured.message?.content_text).toBe(
      `Quarterly renewal\n\n${RENDERED}`
    );
  });

  it('keeps a media header on the row so the bubble can render it', async () => {
    const captured: Captured = { message: null, conversation: null };
    await sendMessageToConversation(
      dbCapturingWrites(captured, {
        ...TEMPLATE,
        header_type: 'image',
        header_media_url: 'https://cdn.example/offer.png',
      }),
      'account-1',
      {
        conversationId: 'conversation-1',
        messageType: 'template',
        templateName: 'gym_class_schedule',
        templateLanguage: 'en_US',
        templateMessageParams: { body: PARAMS },
      }
    );

    expect(captured.message?.media_url).toBe('https://cdn.example/offer.png');
    // The image is not narrated in the text — content_type stays `template`.
    expect(captured.message?.content_text).toBe(RENDERED);
  });

  it('keeps an explicit content_text from the inbox composer', async () => {
    const captured: Captured = { message: null, conversation: null };
    await sendMessageToConversation(dbCapturingWrites(captured), 'account-1', {
      conversationId: 'conversation-1',
      messageType: 'template',
      templateName: 'gym_class_schedule',
      templateLanguage: 'en_US',
      templateMessageParams: { body: PARAMS },
      contentText: 'Composer-rendered body',
    });

    expect(captured.message?.content_text).toBe('Composer-rendered body');
  });
});
