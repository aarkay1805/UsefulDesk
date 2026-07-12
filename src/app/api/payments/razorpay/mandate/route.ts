// ============================================================
// POST /api/payments/razorpay/mandate
//
// Start a UPI-AutoPay mandate for one member (migration 059, Model 1 —
// the gym's OWN Razorpay account). Agent+ only.
//
// Flow: load the membership + plan (RLS-scoped) → read the gym's Razorpay
// credentials (service role) → create a Razorpay plan for the cadence and
// a subscription carrying our membership_id in `notes` → park a
// `payment_mandates` row (status 'pending') → return the subscription's
// `short_url` so the UI can show the member the UPI-mandate QR/link.
//
// The mandate only goes 'active' (and the membership flips to
// collection_mode='auto') when Razorpay fires `subscription.authenticated`
// to the webhook — never here.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { canManageMandates } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getRazorpayCredentials } from "@/lib/payments/credentials";
import {
  createPlan,
  createSubscription,
  RazorpayError,
  type RazorpayPlan,
} from "@/lib/payments/razorpay";
import { upiAvailableFor } from "@/lib/payments/upi";

/** Map a membership plan's duration to a Razorpay billing cadence. */
function razorpayCadence(durationDays: number): {
  period: RazorpayPlan["period"];
  interval: number;
  frequency: "monthly" | "quarterly";
} | null {
  // Snap common gym cadences. Razorpay bills quarterly as monthly×3.
  if (durationDays >= 28 && durationDays <= 31) {
    return { period: "monthly", interval: 1, frequency: "monthly" };
  }
  if (durationDays >= 88 && durationDays <= 92) {
    return { period: "monthly", interval: 3, frequency: "quarterly" };
  }
  // Auto-debit only makes sense for recurring cadences; yearly/one-off
  // plans stay manual for now.
  return null;
}

interface MembershipRow {
  id: string;
  account_id: string;
  contact_id: string;
  fee_amount: number;
  status: string;
  is_trial: boolean;
  plan: { name: string | null; duration_days: number | null } | null;
  contact: { name: string | null; phone: string | null } | null;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    if (!canManageMandates(ctx.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as { membership_id?: string };
    const membershipId = body.membership_id;
    if (!membershipId) {
      return NextResponse.json(
        { error: "membership_id is required" },
        { status: 400 },
      );
    }

    // RLS-scoped read: an agent can only see their own account's rows.
    const { data, error } = await ctx.supabase
      .from("memberships")
      .select(
        "id, account_id, contact_id, fee_amount, status, is_trial, plan:membership_plans(name, duration_days), contact:contacts(name, phone)",
      )
      .eq("id", membershipId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { error: "Membership not found" },
        { status: 404 },
      );
    }
    const membership = data as unknown as MembershipRow;

    if (membership.is_trial || membership.status === "cancelled") {
      return NextResponse.json(
        { error: "Auto-pay can't be set up for a trial or cancelled membership" },
        { status: 400 },
      );
    }

    // INR-only rail (a currency condition, not a geo one).
    const { data: account } = await ctx.supabase
      .from("accounts")
      .select("default_currency")
      .eq("id", ctx.accountId)
      .maybeSingle();
    const currency = (account?.default_currency as string) ?? "INR";
    if (!upiAvailableFor(currency)) {
      return NextResponse.json(
        { error: "UPI AutoPay is available only for INR accounts" },
        { status: 400 },
      );
    }

    const duration = membership.plan?.duration_days ?? 0;
    const cadence = razorpayCadence(duration);
    if (!cadence) {
      return NextResponse.json(
        {
          error:
            "Auto-pay supports monthly or quarterly plans only; this plan stays on manual collection",
        },
        { status: 400 },
      );
    }
    const fee = Number(membership.fee_amount);
    if (!(fee > 0)) {
      return NextResponse.json(
        { error: "This membership has no fee to auto-collect" },
        { status: 400 },
      );
    }

    // One live mandate per membership — the partial unique index enforces
    // it in the DB too, but fail early with a clean message.
    const { data: existing } = await ctx.supabase
      .from("payment_mandates")
      .select("id")
      .eq("membership_id", membershipId)
      .eq("status", "active")
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "This member already has an active auto-pay mandate" },
        { status: 409 },
      );
    }

    // Gym's own Razorpay keys (service role — the creds row is admin-only
    // under RLS, and the caller may be an agent).
    const admin = supabaseAdmin();
    const creds = await getRazorpayCredentials(admin, ctx.accountId);
    if (!creds) {
      return NextResponse.json(
        {
          error:
            "Connect your Razorpay account in Settings → Payments before setting up auto-pay",
        },
        { status: 400 },
      );
    }

    // Create the cadence plan, then a subscription the member authorises.
    // total_count bounds the mandate; we authorise a long horizon (the
    // gym can cancel any time) — 120 monthly / 40 quarterly ≈ 10 years.
    const plan = await createPlan(creds, {
      amountRupees: fee,
      currency,
      name: `${membership.plan?.name ?? "Membership"} (${cadence.frequency})`,
      period: cadence.period,
      interval: cadence.interval,
    });
    const totalCount = cadence.frequency === "monthly" ? 120 : 40;
    const subscription = await createSubscription(creds, {
      planId: plan.id,
      totalCount,
      // Echoed back on every webhook so we can map a charge to our record
      // without trusting anything else in the payload.
      notes: {
        account_id: ctx.accountId,
        membership_id: membership.id,
        contact_id: membership.contact_id,
      },
    });

    // Park the mandate (pending until the webhook confirms authentication).
    const { data: mandate, error: insErr } = await ctx.supabase
      .from("payment_mandates")
      .insert({
        account_id: ctx.accountId,
        membership_id: membership.id,
        contact_id: membership.contact_id,
        gateway: "razorpay",
        gateway_subscription_id: subscription.id,
        method: "upi",
        max_amount: fee,
        frequency: cadence.frequency,
        status: "pending",
      })
      .select("id")
      .single();

    if (insErr || !mandate) {
      // The Razorpay subscription exists but we couldn't record it — leave
      // it; a retry find-or-creates, and an unauthorised subscription
      // simply expires. Surface the failure.
      return NextResponse.json(
        { error: "Could not save the mandate. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      mandate_id: mandate.id,
      subscription_id: subscription.id,
      short_url: subscription.short_url,
      status: "pending",
    });
  } catch (err) {
    if (err instanceof RazorpayError) {
      // Surface the gateway's own message (e.g. product not enabled).
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
