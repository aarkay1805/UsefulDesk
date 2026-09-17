import { describe, expect, it, vi } from 'vitest';

import { MetaAcceptedPersistenceError } from '@/lib/automations/meta-send';
import {
  runLegacyReminderDelivery,
  type LegacyReminderDeliveryStore,
} from './legacy-delivery';

type State = 'available' | 'claimed' | 'attempting' | 'accepted' | 'ambiguous';

function memoryStore() {
  let state: State = 'available';
  let providerMessageId: string | null = null;
  const store: LegacyReminderDeliveryStore<{ id: string }> = {
    async claim() {
      if (state !== 'available') return null;
      state = 'claimed';
      return { id: 'claim-1' };
    },
    async markProviderAttempt() {
      state = 'attempting';
    },
    async accept(_claim, messageId) {
      state = 'accepted';
      providerMessageId = messageId;
    },
    async retainAmbiguous(_claim, details) {
      state = details.providerMessageId ? 'accepted' : 'ambiguous';
      providerMessageId = details.providerMessageId;
    },
    async releasePreProvider() {
      state = 'available';
    },
  };
  return {
    store,
    snapshot: () => ({ state, providerMessageId }),
  };
}

describe('runLegacyReminderDelivery', () => {
  it('keeps known provider acceptance durable when local persistence fails, so a second run does not resend', async () => {
    const memory = memoryStore();
    const send = vi.fn(async (beforeSend: () => Promise<void>) => {
      await beforeSend();
      throw new MetaAcceptedPersistenceError(
        'wamid.accepted',
        'messages insert unavailable'
      );
    });

    const first = await runLegacyReminderDelivery(memory.store, send);
    const second = await runLegacyReminderDelivery(memory.store, send);

    expect(first).toMatchObject({
      outcome: 'accepted',
      providerMessageId: 'wamid.accepted',
    });
    expect(second).toEqual({ outcome: 'duplicate' });
    expect(send).toHaveBeenCalledOnce();
    expect(memory.snapshot()).toEqual({
      state: 'accepted',
      providerMessageId: 'wamid.accepted',
    });
  });

  it('keeps an uncertain provider attempt ambiguous, so a second run does not resend', async () => {
    const memory = memoryStore();
    const send = vi.fn(async (beforeSend: () => Promise<void>) => {
      await beforeSend();
      throw new Error('socket closed before response');
    });

    const first = await runLegacyReminderDelivery(memory.store, send);
    const second = await runLegacyReminderDelivery(memory.store, send);

    expect(first).toMatchObject({ outcome: 'ambiguous' });
    expect(second).toEqual({ outcome: 'duplicate' });
    expect(send).toHaveBeenCalledOnce();
    expect(memory.snapshot()).toEqual({
      state: 'ambiguous',
      providerMessageId: null,
    });
  });

  it('does not release a claim when an eligibility error is raised after the provider boundary', async () => {
    const memory = memoryStore();
    const send = vi.fn(async (beforeSend: () => Promise<void>) => {
      await beforeSend();
      throw new Error('membership cycle is no longer reminder-eligible');
    });

    const first = await runLegacyReminderDelivery(memory.store, send);
    const second = await runLegacyReminderDelivery(memory.store, send);

    expect(first).toMatchObject({ outcome: 'ambiguous' });
    expect(second).toEqual({ outcome: 'duplicate' });
    expect(send).toHaveBeenCalledOnce();
    expect(memory.snapshot().state).toBe('ambiguous');
  });

  it('releases a failure before the provider boundary so the next run can retry safely', async () => {
    const memory = memoryStore();
    const send = vi
      .fn<
        (
          beforeSend: () => Promise<void>
        ) => Promise<{ whatsapp_message_id: string }>
      >()
      .mockRejectedValueOnce(new Error('conversation lookup failed'))
      .mockImplementationOnce(async (beforeSend) => {
        await beforeSend();
        return { whatsapp_message_id: 'wamid.retry' };
      });

    const first = await runLegacyReminderDelivery(memory.store, send);
    const second = await runLegacyReminderDelivery(memory.store, send);

    expect(first).toMatchObject({ outcome: 'retryable_failure' });
    expect(second).toEqual({
      outcome: 'accepted',
      providerMessageId: 'wamid.retry',
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(memory.snapshot()).toEqual({
      state: 'accepted',
      providerMessageId: 'wamid.retry',
    });
  });
});
