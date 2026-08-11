import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { RazorpayProviderMode } from './razorpay-config';
import {
  buildRazorpayWebhookObservation,
  type RazorpayWebhookObservation,
} from './razorpay-webhook-observation';

export type RazorpayWebhookIngress = 'legacy_account' | 'application';
export type RazorpayWebhookIdentitySource = 'header' | 'payload_hash_fallback';
export type RazorpayWebhookSignatureGeneration = 'current' | 'previous';

export interface RazorpayWebhookDeliveryIdentity {
  providerEventId: string;
  eventIdentitySource: RazorpayWebhookIdentitySource;
  observation: RazorpayWebhookObservation;
}

export function buildRazorpayWebhookDeliveryIdentity(input: {
  rawBody: string;
  headerEventId: string | null;
  providerMode: RazorpayProviderMode;
  externalAccountId: string;
  receivedAt?: Date;
}): RazorpayWebhookDeliveryIdentity {
  const observation = buildRazorpayWebhookObservation(
    input.rawBody,
    input.headerEventId,
    input.receivedAt
  );
  const headerEventId = input.headerEventId?.trim();
  if (headerEventId) {
    return {
      providerEventId: headerEventId,
      eventIdentitySource: 'header',
      observation,
    };
  }

  const digest = createHash('sha256')
    .update(input.providerMode)
    .update('\0')
    .update(input.externalAccountId)
    .update('\0')
    .update(input.rawBody)
    .digest('hex');
  return {
    providerEventId: `fallback:${digest}`,
    eventIdentitySource: 'payload_hash_fallback',
    observation,
  };
}

export async function recordRazorpayWebhookDelivery(
  admin: SupabaseClient,
  input: {
    providerMode: RazorpayProviderMode;
    identity: RazorpayWebhookDeliveryIdentity;
    ingress: RazorpayWebhookIngress;
    externalAccountId: string | null;
    accountId: string | null;
    signatureSecretGeneration: RazorpayWebhookSignatureGeneration;
    shadowOnly: boolean;
  }
): Promise<void> {
  const { error } = await admin.from('razorpay_webhook_deliveries').upsert(
    {
      provider_mode: input.providerMode,
      provider_event_id: input.identity.providerEventId,
      event_identity_source: input.identity.eventIdentitySource,
      ingress: input.ingress,
      external_account_id: input.externalAccountId,
      account_id: input.accountId,
      event_type: input.identity.observation.eventType,
      payload_sha256: input.identity.observation.payloadSha256,
      signature_secret_generation: input.signatureSecretGeneration,
      shadow_only: input.shadowOnly,
      canonical_mutation_attempted: false,
      received_at: input.identity.observation.receivedAt,
    },
    {
      onConflict: 'provider_mode,provider_event_id,ingress',
      ignoreDuplicates: true,
    }
  );
  if (error) {
    throw new Error(`record Razorpay webhook delivery: ${error.message}`);
  }
}

export async function resolveRazorpayApplicationAccount(
  admin: SupabaseClient,
  providerMode: RazorpayProviderMode,
  externalAccountId: string
): Promise<{
  accountId: string;
} | null> {
  const { data, error } = await admin
    .from('account_payment_credentials')
    .select('account_id')
    .eq('gateway', 'razorpay')
    .eq('provider_mode', providerMode)
    .eq('razorpay_account_id', externalAccountId)
    .eq('authentication_mode', 'oauth')
    .eq('secret_storage_version', 1)
    .eq('canonical_webhook_ingress', 'application')
    .maybeSingle();
  if (error) {
    throw new Error(`resolve Razorpay application account: ${error.message}`);
  }
  if (!data) return null;
  return {
    accountId: data.account_id as string,
  };
}
