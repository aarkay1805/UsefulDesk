import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { toRupees, type RazorpayRefund } from './razorpay';
import { finalizeOrImportVerifiedRefund } from './razorpay-refunds';
import {
  settleVerifiedPaymentLink,
  verifyPaymentLinkTerminal,
} from './razorpay-payment-links';
import type {
  RazorpayWebhookDeliveryIdentity,
  RazorpayWebhookIngress,
} from './razorpay-webhook-delivery';
import type { RazorpayProviderMode } from './razorpay-config';
import {
  processClaimedWebhookDelivery,
  processWebhookDelivery,
  type WebhookClaimResult,
  type WebhookEventStore,
  type WebhookProcessingResult,
} from './webhook-processing';

export interface RazorpayEvent {
  event: string;
  account_id?: string;
  payload: {
    subscription?: { entity: RazorpaySubEntity };
    payment?: { entity: RazorpayPaymentEntity };
    payment_link?: { entity: RazorpayPaymentLinkEntity };
    refund?: { entity: RazorpayRefund };
  };
}

interface RazorpayPaymentLinkEntity {
  id: string;
  status: string;
  reference_id?: string;
}

interface RazorpaySubEntity {
  id: string;
  status: string;
  token_id?: string;
  paid_count?: number;
  current_start?: number;
  current_end?: number;
  notes?: {
    account_id?: string;
    membership_id?: string;
    contact_id?: string;
    mandate_id?: string;
    pricing_option_id?: string;
  };
}

interface RazorpayPaymentEntity {
  id: string;
  amount: number;
  method?: string;
  status?: string;
  currency?: string;
  invoice_id?: string;
}

export function parseRazorpayEvent(rawBody: string): RazorpayEvent {
  const parsed = JSON.parse(rawBody) as Partial<RazorpayEvent> | null;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.event !== 'string' ||
    !parsed.event ||
    !parsed.payload ||
    typeof parsed.payload !== 'object'
  ) {
    throw new SyntaxError('Malformed Razorpay event');
  }
  return parsed as RazorpayEvent;
}

export function createRazorpayWebhookEventStore(input: {
  admin: SupabaseClient;
  accountId: string | null;
  externalAccountId: string;
  providerMode: RazorpayProviderMode;
  identity: RazorpayWebhookDeliveryIdentity;
  event: RazorpayEvent;
  processingOwner?: string;
}): { store: WebhookEventStore; processingOwner: string } {
  const processingOwner = input.processingOwner ?? randomUUID();
  const params = {
    p_event_id: input.identity.providerEventId,
    p_account_id: input.accountId,
    p_processing_owner: processingOwner,
  };
  return {
    processingOwner,
    store: {
      async claim() {
        const { data, error } = await input.admin.rpc(
          'claim_razorpay_canonical_webhook_event',
          {
            ...params,
            p_type: input.event.event,
            p_payload: input.event,
            p_provider_mode: input.providerMode,
            p_external_account_id: input.externalAccountId,
            p_event_identity_source: input.identity.eventIdentitySource,
            p_payload_sha256: input.identity.observation.payloadSha256,
            p_lease_seconds: 300,
          }
        );
        if (error) throw new Error(`claim webhook event: ${error.message}`);
        if (
          data !== 'claimed' &&
          data !== 'processed' &&
          data !== 'busy' &&
          data !== 'conflict'
        ) {
          throw new Error(
            `claim webhook event returned invalid state: ${data}`
          );
        }
        return data as WebhookClaimResult;
      },
      async complete() {
        const { data, error } = await input.admin.rpc(
          'complete_razorpay_canonical_webhook_event',
          params
        );
        if (error || data !== true) {
          throw new Error(
            `complete webhook event: ${error?.message ?? 'event lease was not updated'}`
          );
        }
      },
      async fail(message) {
        const { data, error } = await input.admin.rpc(
          'fail_razorpay_canonical_webhook_event',
          { ...params, p_error: message }
        );
        if (error || data !== true) {
          throw new Error(
            `fail webhook event: ${error?.message ?? 'event lease was not updated'}`
          );
        }
      },
    },
  };
}

export async function processCanonicalRazorpayWebhook(input: {
  admin: SupabaseClient;
  accountId: string | null;
  externalAccountId: string;
  providerMode: RazorpayProviderMode;
  identity: RazorpayWebhookDeliveryIdentity;
  ingress: RazorpayWebhookIngress;
  event: RazorpayEvent;
}): Promise<WebhookProcessingResult> {
  const { store } = createRazorpayWebhookEventStore(input);
  return processWebhookDelivery(store, () =>
    handleRazorpayEvent(
      input.admin,
      input.accountId,
      input.identity.providerEventId,
      input.event,
      input.ingress
    )
  );
}

export async function processClaimedRazorpayWebhook(input: {
  admin: SupabaseClient;
  accountId: string | null;
  eventId: string;
  processingOwner: string;
  event: RazorpayEvent;
  ingress: RazorpayWebhookIngress;
}): Promise<WebhookProcessingResult> {
  const params = {
    p_event_id: input.eventId,
    p_account_id: input.accountId,
    p_processing_owner: input.processingOwner,
  };
  const store: WebhookEventStore = {
    async claim() {
      return 'claimed';
    },
    async complete() {
      const { data, error } = await input.admin.rpc(
        'complete_razorpay_canonical_webhook_event',
        params
      );
      if (error || data !== true) {
        throw new Error(
          `complete webhook event: ${error?.message ?? 'event lease was not updated'}`
        );
      }
    },
    async fail(message) {
      const { data, error } = await input.admin.rpc(
        'fail_razorpay_canonical_webhook_event',
        { ...params, p_error: message }
      );
      if (error || data !== true) {
        throw new Error(
          `fail webhook event: ${error?.message ?? 'event lease was not updated'}`
        );
      }
    },
  };
  return processClaimedWebhookDelivery(store, () =>
    handleRazorpayEvent(
      input.admin,
      input.accountId,
      input.eventId,
      input.event,
      input.ingress
    )
  );
}

async function handleRazorpayEvent(
  admin: SupabaseClient,
  accountId: string | null,
  webhookEventId: string,
  event: RazorpayEvent,
  ingress: RazorpayWebhookIngress
) {
  if (!accountId) {
    console.error(
      `[razorpay webhook] signed ${ingress} event ${webhookEventId} has no UsefulDesk account mapping`
    );
    return;
  }

  const sub = event.payload.subscription?.entity;
  const payment = event.payload.payment?.entity;
  const paymentLink = event.payload.payment_link?.entity;
  const refund = event.payload.refund?.entity;
  const notesAccount = sub?.notes?.account_id;
  if (notesAccount && notesAccount !== accountId) {
    throw new Error(
      `account mismatch: resolved account is ${accountId} but the subscription belongs to ${notesAccount}`
    );
  }

  switch (event.event) {
    case 'refund.processed':
    case 'refund.failed': {
      if (!refund?.id || !refund.payment_id) {
        throw new Error('Refund event is missing refund or payment identity');
      }
      await finalizeOrImportVerifiedRefund({
        admin,
        accountId,
        remoteRefund: refund,
      });
      return;
    }

    case 'payment_link.paid':
    case 'payment_link.partially_paid': {
      if (!paymentLink?.id || !payment?.id) {
        throw new Error(
          'Payment Link event is missing link or payment identity'
        );
      }
      const result = await settleVerifiedPaymentLink({
        admin,
        accountId,
        gatewayLinkId: paymentLink.id,
        gatewayPaymentId: payment.id,
        webhookEventId,
        partial: event.event === 'payment_link.partially_paid',
      });
      if (result.outcome === 'exception') {
        console.warn(
          `[razorpay webhook] Payment Link payment ${payment.id} preserved as an exception`
        );
      }
      return;
    }

    case 'payment_link.cancelled':
    case 'payment_link.expired': {
      if (!paymentLink?.id) {
        throw new Error('Payment Link terminal event is missing link identity');
      }
      await verifyPaymentLinkTerminal({
        admin,
        accountId,
        gatewayLinkId: paymentLink.id,
        expectedStatus:
          event.event === 'payment_link.cancelled' ? 'cancelled' : 'expired',
      });
      return;
    }

    case 'subscription.authenticated':
    case 'subscription.activated': {
      if (!sub) return;
      const mandateId = await mandateIdForSubscription(
        admin,
        accountId,
        sub.id
      );
      if (!mandateId)
        throw new Error(`no mandate found for subscription ${sub.id}`);
      const { error } = await admin.rpc('activate_mandate', {
        p_mandate_id: mandateId,
        p_token_id: sub.token_id ?? null,
        p_subscription_id: sub.id,
      });
      if (error) throw new Error(`activate_mandate: ${error.message}`);
      return;
    }

    case 'subscription.charged': {
      if (!sub || !payment) return;
      const membershipId = sub.notes?.membership_id ?? null;
      const mandateId =
        (await mandateIdForSubscription(admin, accountId, sub.id)) ??
        sub.notes?.mandate_id ??
        null;
      const { data, error } = await admin.rpc('record_gateway_charge', {
        p_account_id: accountId,
        p_membership_id: membershipId,
        p_mandate_id: mandateId,
        p_webhook_event_id: webhookEventId,
        p_gateway_subscription_id: sub.id,
        p_gateway_payment_id: payment.id,
        p_gateway_invoice_id: payment.invoice_id ?? null,
        p_provider_paid_count: sub.paid_count ?? null,
        p_amount: toRupees(payment.amount),
        p_currency: payment.currency ?? null,
        p_method: payment.method === 'card' ? 'card' : 'upi',
        p_payment_status: payment.status ?? null,
        p_gateway_current_start: epochSecondsToIso(sub.current_start),
        p_gateway_current_end: epochSecondsToIso(sub.current_end),
      });
      if (error) throw new Error(`record_gateway_charge: ${error.message}`);
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.outcome === 'exception') {
        console.warn(
          `[razorpay webhook] charge ${payment.id} preserved as exception ${result.exception_id}`
        );
      }
      return;
    }

    case 'subscription.pending':
    case 'subscription.halted': {
      if (!sub) return;
      const mandateId = await mandateIdForSubscription(
        admin,
        accountId,
        sub.id
      );
      if (!mandateId) return;
      const { error } = await admin.rpc('revoke_mandate', {
        p_mandate_id: mandateId,
        p_status: 'failed',
      });
      if (error) throw new Error(`revoke_mandate(failed): ${error.message}`);
      return;
    }

    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.expired': {
      if (!sub) return;
      const mandateId = await mandateIdForSubscription(
        admin,
        accountId,
        sub.id
      );
      if (!mandateId) return;
      const status =
        event.event === 'subscription.cancelled' ? 'revoked' : 'expired';
      const { error } = await admin.rpc('revoke_mandate', {
        p_mandate_id: mandateId,
        p_status: status,
      });
      if (error) throw new Error(`revoke_mandate(${status}): ${error.message}`);
      return;
    }

    default:
      return;
  }
}

async function mandateIdForSubscription(
  admin: SupabaseClient,
  accountId: string,
  subscriptionId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from('payment_mandates')
    .select('id')
    .eq('account_id', accountId)
    .eq('gateway_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) throw new Error(`load mandate for subscription: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

function epochSecondsToIso(value: number | undefined): string | null {
  if (!Number.isFinite(value) || !value || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}
