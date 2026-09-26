import {
  engineSendTemplate,
  MetaAcceptedPersistenceError,
} from '@/lib/automations/meta-send';

/**
 * Sends a reminder template and returns Meta's message id as the outcome.
 * When Meta accepted the message but its inbox copy failed to save, that id is
 * still accepted evidence: return it with a reason instead of letting the
 * worker record an unknown provider outcome and drop the id.
 */
export async function sendReminderTemplate(
  args: Parameters<typeof engineSendTemplate>[0]
): Promise<{ whatsapp_message_id: string; reason?: Record<string, string> }> {
  try {
    return await engineSendTemplate(args);
  } catch (error) {
    if (!(error instanceof MetaAcceptedPersistenceError)) throw error;
    return {
      whatsapp_message_id: error.whatsappMessageId,
      reason: { code: 'local_message_persistence_failed' },
    };
  }
}
