import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  processClaimedRazorpayWebhook,
  type RazorpayEvent,
} from './razorpay-webhook-processor';

function webhookAdmin() {
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: { id: 'mandate-id' },
      error: null,
    })),
  };
  return {
    admin: { rpc, from: vi.fn(() => query) } as unknown as SupabaseClient,
    rpc,
  };
}

function subscriptionEvent(event: string): RazorpayEvent {
  return {
    event,
    account_id: 'acc_test',
    payload: {
      subscription: {
        entity: {
          id: 'sub_test',
          status: event.split('.')[1] ?? 'pending',
        },
      },
    },
  };
}

async function process(event: RazorpayEvent) {
  const memory = webhookAdmin();
  await processClaimedRazorpayWebhook({
    admin: memory.admin,
    accountId: 'account-id',
    eventId: 'event-id',
    processingOwner: 'owner-id',
    event,
    ingress: 'application',
  });
  return memory;
}

describe('Razorpay subscription webhook lifecycle', () => {
  it('records pending as a provider retry without failing the mandate', async () => {
    const { rpc } = await process(subscriptionEvent('subscription.pending'));

    expect(rpc).toHaveBeenCalledWith(
      'record_razorpay_mandate_provider_status',
      expect.objectContaining({
        p_mandate_id: 'mandate-id',
        p_provider_status: 'pending',
      })
    );
    expect(rpc).not.toHaveBeenCalledWith('revoke_mandate', expect.anything());
  });

  it('marks a halted subscription failed after recording the provider state', async () => {
    const { rpc } = await process(subscriptionEvent('subscription.halted'));

    expect(rpc).toHaveBeenCalledWith(
      'record_razorpay_mandate_provider_status',
      expect.objectContaining({
        p_mandate_id: 'mandate-id',
        p_provider_status: 'halted',
      })
    );
    expect(rpc).toHaveBeenCalledWith('revoke_mandate', {
      p_mandate_id: 'mandate-id',
      p_status: 'failed',
    });
  });

  it('invalidates local OAuth material when Razorpay revokes authorization', async () => {
    const { rpc } = await process({
      event: 'account.app.authorization_revoked',
      account_id: 'acc_test',
      payload: {},
    });

    expect(rpc).toHaveBeenCalledWith(
      'mark_razorpay_oauth_authorization_revoked',
      { p_account_id: 'account-id' }
    );
  });
});
