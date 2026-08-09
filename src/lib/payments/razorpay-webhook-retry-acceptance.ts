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
  const refundId =
    input.event.payload.refund?.entity.notes?.usefuldesk_refund_id ?? null;
  if (!subscriptionId && !isUsefulDeskRefundIdentity(refundId)) {
    return { action: 'pass', acceptanceId: null };
  }

  const rpc = subscriptionId
    ? 'consume_razorpay_webhook_retry_acceptance'
    : 'consume_razorpay_refund_retry_acceptance';
  const target = subscriptionId
    ? { p_subscription_id: subscriptionId }
    : { p_refund_id: refundId };
  const { data, error } = await input.admin.rpc(rpc, {
    p_account_id: input.accountId,
    p_provider_mode: 'test',
    p_event_type: input.event.event,
    p_provider_event_id: input.providerEventId,
    p_event_identity_source: input.eventIdentitySource,
    p_payload_sha256: input.payloadSha256,
    p_signature_generation: input.signatureGeneration,
    ...target,
  });
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

function isUsefulDeskRefundIdentity(value: string | null): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
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
