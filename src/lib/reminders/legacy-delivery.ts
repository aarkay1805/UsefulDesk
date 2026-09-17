import { MetaAcceptedPersistenceError } from '@/lib/automations/meta-send';

export interface LegacyReminderDeliveryStore<TClaim> {
  claim(): Promise<TClaim | null>;
  markProviderAttempt(claim: TClaim): Promise<void>;
  accept(claim: TClaim, providerMessageId: string): Promise<void>;
  retainAmbiguous(
    claim: TClaim,
    details: { error: string; providerMessageId: string | null }
  ): Promise<void>;
  releasePreProvider(claim: TClaim, error: string): Promise<void>;
}

export type LegacyReminderDeliveryResult =
  | { outcome: 'duplicate' }
  | { outcome: 'accepted'; providerMessageId: string; warning?: string }
  | { outcome: 'ambiguous'; error: string; cause: unknown }
  | { outcome: 'retryable_failure'; error: string; cause: unknown };

export async function runLegacyReminderDelivery<TClaim>(
  store: LegacyReminderDeliveryStore<TClaim>,
  send: (
    beforeSend: () => Promise<void>
  ) => Promise<{ whatsapp_message_id: string }>
): Promise<LegacyReminderDeliveryResult> {
  const claim = await store.claim();
  if (!claim) return { outcome: 'duplicate' };

  let providerAttemptStarted = false;
  let providerMessageId: string | null = null;

  try {
    const result = await send(async () => {
      if (providerAttemptStarted) return;
      await store.markProviderAttempt(claim);
      providerAttemptStarted = true;
    });
    providerMessageId = result.whatsapp_message_id;
    await store.accept(claim, providerMessageId);
    return { outcome: 'accepted', providerMessageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof MetaAcceptedPersistenceError) {
      providerMessageId = error.whatsappMessageId;
    }

    if (providerAttemptStarted) {
      await store.retainAmbiguous(claim, {
        error: message,
        providerMessageId,
      });
      return providerMessageId
        ? {
            outcome: 'accepted',
            providerMessageId,
            warning: message,
          }
        : { outcome: 'ambiguous', error: message, cause: error };
    }

    await store.releasePreProvider(claim, message);
    return { outcome: 'retryable_failure', error: message, cause: error };
  }
}
