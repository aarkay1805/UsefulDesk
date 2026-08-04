// ============================================================
// POST /api/payments/razorpay/webhook/[accountId]
//
// The money path (migration 059). Each gym configures its Razorpay
// webhook to point at THIS url with its own account id in the path, so we
// know which gym's signing secret to verify against before trusting a
// byte of the body.
//
// Order is load-bearing:
//   1. Read the RAW body (signature is over raw bytes).
//   2. Look up this account's webhook secret; verify HMAC. Bad sig → 400,
//      no DB write.
//   3. Atomically claim Razorpay's event id. Completed events are a 200 no-op;
//      failed/stale attempts are safely claimable again.
//   4. Route the event to our SECURITY DEFINER RPCs (record_gateway_payment
//      / activate_mandate / revoke_mandate).
//   5. Return 500 after a recorded processing failure so Razorpay can redeliver.
//
// Runs as the service role (no session), so the gateway RPCs — which set
// the `app.system_payment` GUC — are the only sanctioned insert path.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getWebhookSecret } from '@/lib/payments/credentials';
import { toRupees, verifyWebhookSignature } from '@/lib/payments/razorpay';
import {
  processWebhookDelivery,
  type WebhookClaimResult,
  type WebhookEventStore,
} from '@/lib/payments/webhook-processing';

export const runtime = 'nodejs';

interface RazorpayEvent {
  event: string;
  payload: {
    subscription?: { entity: RazorpaySubEntity };
    payment?: { entity: RazorpayPaymentEntity };
  };
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params;
  const admin = supabaseAdmin();

  // 1. Raw body + signature.
  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  const eventId = request.headers.get('x-razorpay-event-id');

  // 2. Verify against THIS gym's secret.
  const secret = await getWebhookSecret(admin, accountId);
  if (!secret) {
    return NextResponse.json(
      { error: 'Webhook not configured for this account' },
      { status: 400 }
    );
  }
  if (!verifyWebhookSignature(raw, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(raw) as RazorpayEvent;
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  // 3. Idempotency + recovery. Fall back to a stable synthetic key if the
  // event-id header is absent; signature verification has already succeeded.
  const dedupeId = eventId ?? `${accountId}:${signature}`;
  const store = razorpayEventStore(admin, accountId, dedupeId, event);
  let result;
  try {
    result = await processWebhookDelivery(store, () =>
      handleEvent(admin, accountId, dedupeId, event)
    );
  } catch (err) {
    console.error('[razorpay webhook] event state persistence failed:', err);
    return NextResponse.json(
      { error: 'Could not persist event state' },
      { status: 500 }
    );
  }

  switch (result.outcome) {
    case 'processed':
      return NextResponse.json({ ok: true });
    case 'duplicate':
      return NextResponse.json({ ok: true, deduped: true });
    case 'busy':
      return NextResponse.json({ ok: true, processing: true });
    case 'conflict':
      return NextResponse.json(
        { error: 'Event id conflicts with another account or gateway' },
        { status: 409 }
      );
    case 'failed':
      console.error('[razorpay webhook] handler failed:', result.error);
      return NextResponse.json(
        { error: 'Event processing failed; retry is safe' },
        { status: 500 }
      );
  }
}

type Admin = ReturnType<typeof supabaseAdmin>;

function razorpayEventStore(
  admin: Admin,
  accountId: string,
  eventId: string,
  event: RazorpayEvent
): WebhookEventStore {
  return {
    async claim() {
      const { data, error } = await admin.rpc('claim_razorpay_webhook_event', {
        p_event_id: eventId,
        p_account_id: accountId,
        p_type: event.event,
        p_payload: event,
        p_lease_seconds: 300,
      });
      if (error) throw new Error(`claim webhook event: ${error.message}`);
      if (
        data !== 'claimed' &&
        data !== 'processed' &&
        data !== 'busy' &&
        data !== 'conflict'
      ) {
        throw new Error(`claim webhook event returned invalid state: ${data}`);
      }
      return data as WebhookClaimResult;
    },
    async complete() {
      const { data, error } = await admin.rpc(
        'complete_razorpay_webhook_event',
        {
          p_event_id: eventId,
          p_account_id: accountId,
        }
      );
      if (error || data !== true) {
        throw new Error(
          `complete webhook event: ${error?.message ?? 'event was not updated'}`
        );
      }
    },
    async fail(message) {
      const { data, error } = await admin.rpc('fail_razorpay_webhook_event', {
        p_event_id: eventId,
        p_account_id: accountId,
        p_error: message,
      });
      if (error || data !== true) {
        throw new Error(
          `fail webhook event: ${error?.message ?? 'event was not updated'}`
        );
      }
    },
  };
}

async function handleEvent(
  admin: Admin,
  accountId: string,
  webhookEventId: string,
  event: RazorpayEvent
) {
  const sub = event.payload.subscription?.entity;
  const payment = event.payload.payment?.entity;

  // The subscription's notes carry the account that created the mandate.
  // A mismatch means the gym pasted a DIFFERENT UsefulDesk account's
  // webhook URL into Razorpay (both accounts sharing one Razorpay secret
  // makes the signature pass) — every lookup below would silently miss,
  // so fail loud and land the reason in the event row's _error.
  const notesAccount = sub?.notes?.account_id;
  if (notesAccount && notesAccount !== accountId) {
    throw new Error(
      `account mismatch: webhook URL is for account ${accountId} but the subscription belongs to ${notesAccount} — update the webhook URL in the Razorpay dashboard to this gym's URL from Settings → Payments & currency`
    );
  }

  switch (event.event) {
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
      // paid_count is Razorpay's monotonic subscription charge sequence.
      // The RPC combines it with the mandate's frozen initial period; it
      // never infers "next cycle" from whichever local period is paid.
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
      // A charge failed / the mandate is stalling → fall back to manual
      // chase (renewal cron + WhatsApp remind).
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
      // Unhandled event type — recorded in webhook_events, no action.
      return;
  }
}

/** Resolve our mandate id from a Razorpay subscription id, scoped to the
 *  account so a spoofed id from another tenant can't match. */
async function mandateIdForSubscription(
  admin: Admin,
  accountId: string,
  subscriptionId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from('payment_mandates')
    .select('id')
    .eq('account_id', accountId)
    .eq('gateway_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) {
    throw new Error(`load mandate for subscription: ${error.message}`);
  }
  return (data?.id as string | undefined) ?? null;
}

function epochSecondsToIso(value: number | undefined): string | null {
  if (!Number.isFinite(value) || !value || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}
