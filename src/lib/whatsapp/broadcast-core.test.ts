import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createBroadcast,
  drainPublicBroadcastRecipients,
  BroadcastError,
} from './broadcast-core';

const { sendTemplateMessageMock } = vi.hoisted(() => ({
  sendTemplateMessageMock: vi.fn(),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: sendTemplateMessageMock,
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'decrypted-access-token'),
}));

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe('createBroadcast validation', () => {
  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('public broadcast recovery', () => {
  it('resumes a persisted pending recipient without the original after() plan', async () => {
    sendTemplateMessageMock.mockResolvedValueOnce({ messageId: 'wamid.123' });

    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_public_broadcast_recipients') {
        return {
          data: [
            {
              recipient_id: 'recipient-1',
              broadcast_id: 'broadcast-1',
              account_id: 'account-1',
              template_name: 'renewal_reminder',
              template_language: 'en_US',
              destination_phone: '+919876543210',
              template_params: ['Riya', 'Gold'],
              attempt_count: 2,
              created_at: '2026-08-14T00:00:00.000Z',
            },
          ],
          error: null,
        };
      }
      if (name === 'complete_public_broadcast_recipient') {
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}: ${JSON.stringify(args)}`);
    });

    const from = vi.fn((table: string) => {
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  phone_number_id: 'phone-number-id',
                  access_token: 'encrypted-access-token',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'message_templates') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({
            data: {
              id: 'template-1',
              user_id: 'user-1',
              name: 'renewal_reminder',
              category: 'Utility',
              language: 'en_US',
              body_text: 'Hi {{1}}, your {{2}} membership is due.',
              status: 'APPROVED',
              parameter_format: 'POSITIONAL',
              created_at: '2026-08-14T00:00:00.000Z',
            },
            error: null,
          }),
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await drainPublicBroadcastRecipients(
      { rpc, from } as unknown as SupabaseClient,
      { limit: 25 }
    );

    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(sendTemplateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        templateName: 'renewal_reminder',
        params: ['Riya', 'Gold'],
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'complete_public_broadcast_recipient',
      expect.objectContaining({
        p_recipient_id: 'recipient-1',
        p_whatsapp_message_id: 'wamid.123',
      })
    );
  });
});
