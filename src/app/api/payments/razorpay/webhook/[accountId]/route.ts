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
//   3. Dedupe on Razorpay's event id (webhook_events) — a retry is a
//      200 no-op.
//   4. Route the event to our SECURITY DEFINER RPCs (record_gateway_payment
//      / activate_mandate / revoke_mandate).
//   5. Return 200 on every handled event so Razorpay doesn't retry-storm.
//
// Runs as the service role (no session), so the gateway RPCs — which set
// the `app.system_payment` GUC — are the only sanctioned insert path.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getWebhookSecret } from "@/lib/payments/credentials";
import { toRupees, verifyWebhookSignature } from "@/lib/payments/razorpay";

export const runtime = "nodejs";

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
  notes?: { account_id?: string; membership_id?: string; contact_id?: string };
}
interface RazorpayPaymentEntity {
  id: string;
  amount: number;
  method?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  const admin = supabaseAdmin();

  // 1. Raw body + signature.
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const eventId = request.headers.get("x-razorpay-event-id");

  // 2. Verify against THIS gym's secret.
  const secret = await getWebhookSecret(admin, accountId);
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook not configured for this account" },
      { status: 400 },
    );
  }
  if (!verifyWebhookSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(raw) as RazorpayEvent;
  } catch {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  // 3. Idempotency. Razorpay's event id is unique per event; on a retry
  // the insert conflicts and we short-circuit. Fall back to a synthetic
  // key if the header is somehow absent.
  const dedupeId = eventId ?? `${accountId}:${signature}`;
  const { data: claimed, error: claimErr } = await admin
    .from("webhook_events")
    .upsert(
      {
        id: dedupeId,
        account_id: accountId,
        gateway: "razorpay",
        type: event.event,
        payload: event as unknown as Record<string, unknown>,
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (claimErr) {
    // Couldn't even record the event — let Razorpay retry.
    return NextResponse.json({ error: "Could not persist event" }, { status: 500 });
  }
  if (!claimed) {
    // Already processed — no-op success.
    return NextResponse.json({ ok: true, deduped: true });
  }

  // 4. Route.
  try {
    await handleEvent(admin, accountId, event);
  } catch (err) {
    // Record the failure on the event row for audit, but still 200 —
    // a poison event shouldn't wedge Razorpay's retry queue forever.
    // (A dunning/reconcile pass surfaces unprocessed rows.)
    await admin
      .from("webhook_events")
      .update({
        processed_at: null,
        payload: {
          ...(event as unknown as Record<string, unknown>),
          _error: err instanceof Error ? err.message : String(err),
        },
      })
      .eq("id", dedupeId);
    return NextResponse.json({ ok: true, handled: false });
  }

  await admin
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", dedupeId);

  return NextResponse.json({ ok: true });
}

type Admin = ReturnType<typeof supabaseAdmin>;

async function handleEvent(
  admin: Admin,
  accountId: string,
  event: RazorpayEvent,
) {
  const sub = event.payload.subscription?.entity;
  const payment = event.payload.payment?.entity;

  switch (event.event) {
    case "subscription.authenticated":
    case "subscription.activated": {
      if (!sub) return;
      const mandateId = await mandateIdForSubscription(admin, accountId, sub.id);
      if (!mandateId) return;
      const { error } = await admin.rpc("activate_mandate", {
        p_mandate_id: mandateId,
        p_token_id: sub.token_id ?? null,
        p_subscription_id: sub.id,
      });
      if (error) throw new Error(`activate_mandate: ${error.message}`);
      return;
    }

    case "subscription.charged": {
      if (!sub || !payment) return;
      const membershipId = sub.notes?.membership_id;
      if (!membershipId) throw new Error("charge missing membership_id in notes");
      const mandateId = await mandateIdForSubscription(admin, accountId, sub.id);
      const { error } = await admin.rpc("record_gateway_payment", {
        p_account_id: accountId,
        p_membership_id: membershipId,
        p_gateway_payment_id: payment.id,
        p_amount: toRupees(payment.amount),
        p_method: payment.method === "card" ? "card" : "upi",
        // Settle the membership's current open period. NOTE (MVP gap):
        // this records the collection but does not yet EXTEND the
        // membership to the next cycle — auto-renew on charge is the next
        // build (call renew_membership_transaction here). Tracked in the
        // UPI AutoPay PRD.
        p_period_end: null,
        p_mandate_id: mandateId,
      });
      if (error) throw new Error(`record_gateway_payment: ${error.message}`);
      return;
    }

    case "subscription.pending":
    case "subscription.halted": {
      // A charge failed / the mandate is stalling → fall back to manual
      // chase (renewal cron + WhatsApp remind).
      if (!sub) return;
      const mandateId = await mandateIdForSubscription(admin, accountId, sub.id);
      if (!mandateId) return;
      const { error } = await admin.rpc("revoke_mandate", {
        p_mandate_id: mandateId,
        p_status: "failed",
      });
      if (error) throw new Error(`revoke_mandate(failed): ${error.message}`);
      return;
    }

    case "subscription.cancelled":
    case "subscription.completed":
    case "subscription.expired": {
      if (!sub) return;
      const mandateId = await mandateIdForSubscription(admin, accountId, sub.id);
      if (!mandateId) return;
      const status =
        event.event === "subscription.cancelled" ? "revoked" : "expired";
      const { error } = await admin.rpc("revoke_mandate", {
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
  subscriptionId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("payment_mandates")
    .select("id")
    .eq("account_id", accountId)
    .eq("gateway_subscription_id", subscriptionId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
