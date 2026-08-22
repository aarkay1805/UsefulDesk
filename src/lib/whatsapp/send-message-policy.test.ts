import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';
import { TEMPLATE_CONTRACTS } from './template-contracts';

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
  supabaseAdmin: () => ({ from: vi.fn() }),
}));

const { sendMessageToConversation } = await import('./send-message');

function membershipRow(
  overrides: Partial<MessageTemplate> = {}
): MessageTemplate {
  const payload = TEMPLATE_CONTRACTS.membership_renewal.payload;
  return {
    id: 'template-1',
    account_id: 'account-1',
    user_id: 'user-1',
    name: payload.name,
    category: payload.category,
    language: payload.language,
    body_text: payload.body_text,
    footer_text: payload.footer_text,
    buttons: payload.buttons,
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    created_at: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function dbForTemplate(row: MessageTemplate): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: 'conversation-1',
                      contact: {
                        id: 'contact-1',
                        phone: '+919999999999',
                      },
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === 'message_templates') {
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
      }
      if (table === 'whatsapp_config') {
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
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  h.sendTemplateMessage
    .mockReset()
    .mockRejectedValue(new Error('Meta must not be called'));
});

describe('sendMessageToConversation template policy', () => {
  it('stops an Approved wrong-category feature template before Meta', async () => {
    await expect(
      sendMessageToConversation(
        dbForTemplate(membershipRow({ category: 'Utility' })),
        'account-1',
        {
          conversationId: 'conversation-1',
          messageType: 'template',
          templateName: 'gym_membership_renewal',
          templateLanguage: 'en_US',
          templateParams: ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'],
        }
      )
    ).rejects.toMatchObject({
      code: 'wrong_category',
      status: 409,
    });
    expect(h.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('reaches Meta without consulting a consent RPC', async () => {
    h.sendTemplateMessage.mockRejectedValueOnce(new Error('Meta send reached'));
    await expect(
      sendMessageToConversation(dbForTemplate(membershipRow()), 'account-1', {
        conversationId: 'conversation-1',
        messageType: 'template',
        templateName: 'gym_membership_renewal',
        templateLanguage: 'en_US',
        templateParams: ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'],
      })
    ).rejects.toMatchObject({
      code: 'meta_error',
      message: 'Meta API error: Meta send reached',
      status: 502,
    });
    expect(h.sendTemplateMessage).toHaveBeenCalledOnce();
  });
});
