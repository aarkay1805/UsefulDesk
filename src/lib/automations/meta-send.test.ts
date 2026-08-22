import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTemplate } from '@/types';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

const h = vi.hoisted(() => ({
  db: null as unknown,
  sendTemplateMessage: vi.fn(),
  sendTextMessage: vi.fn(),
}));

vi.mock('./admin-client', () => ({ supabaseAdmin: () => h.db }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: h.sendTemplateMessage,
  sendTextMessage: h.sendTextMessage,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }));

const { engineSendTemplate, engineSendText } = await import('./meta-send');

function membershipRow(): MessageTemplate {
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
  };
}

function automationDb(row: MessageTemplate) {
  return {
    from(table: string) {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'contact-1', phone: '+919999999999' },
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
  };
}

beforeEach(() => {
  h.db = automationDb(membershipRow());
  h.sendTemplateMessage.mockReset();
  h.sendTextMessage.mockReset();
});

describe('engineSendTemplate', () => {
  it('loads the synced row and reaches Meta without consulting consent', async () => {
    h.sendTemplateMessage.mockRejectedValueOnce(
      new Error('Meta template reached')
    );
    await expect(
      engineSendTemplate({
        accountId: 'account-1',
        userId: 'user-1',
        conversationId: 'conversation-1',
        contactId: 'contact-1',
        templateName: 'gym_membership_renewal',
        language: 'en_US',
        params: ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'],
      })
    ).rejects.toThrow('Meta template reached');
    expect(h.sendTemplateMessage).toHaveBeenCalledOnce();
  });

  it('reaches Meta for proactive text without consulting consent', async () => {
    h.sendTextMessage.mockRejectedValueOnce(new Error('Meta text reached'));
    await expect(
      engineSendText({
        accountId: 'account-1',
        userId: 'user-1',
        conversationId: 'conversation-1',
        contactId: 'contact-1',
        text: 'Your class starts soon.',
      })
    ).rejects.toThrow('Meta text reached');
    expect(h.sendTextMessage).toHaveBeenCalledOnce();
  });
});
