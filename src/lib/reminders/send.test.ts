import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@/lib/automations/meta-send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/automations/meta-send')>()),
  engineSendTemplate: h.send,
}));

import { MetaAcceptedPersistenceError } from '@/lib/automations/meta-send';

import { sendReminderTemplate } from './send';

const args = {
  accountId: 'account-1',
  userId: 'owner-1',
  conversationId: 'conversation-1',
  contactId: 'contact-1',
  templateName: 'gym_invoice_due',
  params: ['Asha'],
};

describe('sendReminderTemplate', () => {
  it('returns the provider message id of an ordinary accepted send', async () => {
    h.send.mockResolvedValueOnce({ whatsapp_message_id: 'wamid-1' });
    await expect(sendReminderTemplate(args)).resolves.toEqual({
      whatsapp_message_id: 'wamid-1',
    });
    expect(h.send).toHaveBeenCalledWith(args);
  });

  it('keeps Meta’s id as accepted evidence when only the inbox copy failed', async () => {
    h.send.mockRejectedValueOnce(
      new MetaAcceptedPersistenceError('wamid-2', 'insert failed')
    );
    await expect(sendReminderTemplate(args)).resolves.toEqual({
      whatsapp_message_id: 'wamid-2',
      reason: { code: 'local_message_persistence_failed' },
    });
  });

  it('rethrows every other failure so the worker can classify it', async () => {
    const failure = new Error('network down');
    h.send.mockRejectedValueOnce(failure);
    await expect(sendReminderTemplate(args)).rejects.toBe(failure);
  });
});
