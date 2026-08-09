import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { RazorpayWebhookSignatureGeneration } from './razorpay-webhook-delivery';
import type { RazorpayEvent } from './razorpay-webhook-processor';

type RetryAcceptanceAction = 'pass' | 'retry' | 'redelivery' | 'conflict';

export interface RazorpayRetryAcceptanceDecision {
  action: RetryAcceptanceAction;
  acceptanceId: string | null;
}

export async function consumeRazorpayRetryAcceptance(input: {
  admin: SupabaseClient;
  accountId: string;
  providerEventId: string;
  eventIdentitySource: 'header' | 'payload_hash_fallback';
  payloadSha256: string;
  signatureGeneration: RazorpayWebhookSignatureGeneration;
  event: RazorpayEvent;
}): Promise<RazorpayRetryAcceptanceDecision> {
  const subscriptionId = input.event.payload.subscription?.entity.id;
  if (!subscriptionId) return { action: 'pass', acceptanceId: null };

  const { data, error } = await input.admin.rpc(
    'consume_razorpay_webhook_retry_acceptance',
    {
      p_account_id: input.accountId,
      p_provider_mode: 'test',
      p_event_type: input.event.event,
      p_subscription_id: subscriptionId,
      p_provider_event_id: input.providerEventId,
      p_event_identity_source: input.eventIdentitySource,
      p_payload_sha256: input.payloadSha256,
      p_signature_generation: input.signatureGeneration,
    }
  );
  if (error) {
    throw new Error(`consume Razorpay retry acceptance: ${error.message}`);
  }
  const row = data as { action?: unknown; acceptance_id?: unknown } | null;
  if (
    !row ||
    (row.action !== 'pass' &&
      row.action !== 'retry' &&
      row.action !== 'redelivery' &&
      row.action !== 'conflict')
  ) {
    throw new Error('consume Razorpay retry acceptance returned invalid state');
  }
  return {
    action: row.action,
    acceptanceId:
      typeof row.acceptance_id === 'string' ? row.acceptance_id : null,
  };
}

export async function acknowledgeRazorpayRetryAcceptance(input: {
  admin: SupabaseClient;
  acceptanceId: string;
  accountId: string;
  providerEventId: string;
  payloadSha256: string;
  claimResult: 'claimed' | 'processed' | 'busy';
}): Promise<void> {
  const { data, error } = await input.admin.rpc(
    'acknowledge_razorpay_webhook_retry_acceptance',
    {
      p_acceptance_id: input.acceptanceId,
      p_account_id: input.accountId,
      p_provider_event_id: input.providerEventId,
      p_payload_sha256: input.payloadSha256,
      p_claim_result: input.claimResult,
    }
  );
  if (error || data !== true) {
    throw new Error(
      `acknowledge Razorpay retry acceptance: ${error?.message ?? 'acceptance row was not updated'}`
    );
  }
}
