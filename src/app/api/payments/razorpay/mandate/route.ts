// ============================================================
// POST /api/payments/razorpay/mandate
//
// Start a UPI-AutoPay mandate for one member (migration 059, Model 1 —
// the gym's OWN Razorpay account). Agent+ only.
//
// Flow: load the membership + plan (RLS-scoped) → read the gym's Razorpay
// credentials (service role) → reserve the mandate identity locally → create
// a Razorpay plan and subscription carrying that identity in `notes` → move
// the reservation to `pending` → return the hosted approval link. Reserving
// first makes concurrent setup idempotent; a post-create persistence failure
// is compensated by cancelling the remote subscription or parked `orphaned`.
//
// The mandate only goes 'active' (and the membership flips to
// collection_mode='auto') when Razorpay fires `subscription.authenticated`
// to the webhook — never here.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { canManageMandates } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  getRazorpayConnection,
  runRazorpayOperation,
} from '@/lib/payments/credentials';
import {
  cancelSubscription,
  createPlan,
  createSubscription,
  RazorpayError,
  type RazorpayPlan,
} from '@/lib/payments/razorpay';
import { upiAvailableFor } from '@/lib/payments/upi';
import { isRenewalChaseable } from '@/lib/memberships/pricing';

type RazorpayCadence = {
  period: RazorpayPlan['period'];
  interval: number;
  frequency: 'monthly' | 'quarterly';
} | null;

/** Day-range snap — kept for legacy day-unit options (the 062 backfill
 *  mirrored duration_days as day-unit options) and un-optioned rows. */
function cadenceFromDays(durationDays: number): RazorpayCadence {
  // Snap common gym cadences. Razorpay bills quarterly as monthly×3.
  if (durationDays >= 28 && durationDays <= 31) {
    return { period: 'monthly', interval: 1, frequency: 'monthly' };
  }
  if (durationDays >= 88 && durationDays <= 92) {
    return { period: 'monthly', interval: 3, frequency: 'quarterly' };
  }
  // Auto-debit only makes sense for recurring cadences; yearly/one-off
  // plans stay manual for now.
  return null;
}

/** Map the membership's billing option (062) — or the plan's legacy
 *  duration_days — to a Razorpay cadence. */
function razorpayCadence(
  option: { duration_count: number; duration_unit: string } | null,
  legacyDurationDays: number
): RazorpayCadence {
  if (option) {
    const { duration_count: count, duration_unit: unit } = option;
    if (unit === 'month' && count === 1) {
      return { period: 'monthly', interval: 1, frequency: 'monthly' };
    }
    if (unit === 'month' && count === 3) {
      return { period: 'monthly', interval: 3, frequency: 'quarterly' };
    }
    if (unit === 'week' && count === 4) {
      return { period: 'monthly', interval: 1, frequency: 'monthly' };
    }
    if (unit === 'week' && (count === 12 || count === 13)) {
      return { period: 'monthly', interval: 3, frequency: 'quarterly' };
    }
    if (unit === 'day') return cadenceFromDays(count);
    return null;
  }
  return cadenceFromDays(legacyDurationDays);
}

interface MembershipRow {
  id: string;
  account_id: string;
  contact_id: string;
  end_date: string;
  fee_amount: number;
  status: string;
  is_trial: boolean;
  plan: {
    name: string | null;
    duration_days: number | null;
    plan_type: string | null;
  } | null;
  pricing_option: {
    id: string;
    duration_count: number;
    duration_unit: string;
    price: number;
  } | null;
  contact: { name: string | null; phone: string | null } | null;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    if (!canManageMandates(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as { membership_id?: string };
    const membershipId = body.membership_id;
    if (!membershipId) {
      return NextResponse.json(
        { error: 'membership_id is required' },
        { status: 400 }
      );
    }

    // RLS-scoped read: an agent can only see their own account's rows.
    const { data, error } = await ctx.supabase
      .from('memberships')
      .select(
        'id, account_id, contact_id, end_date, fee_amount, status, is_trial, plan:membership_plans(name, duration_days, plan_type), pricing_option:plan_pricing_options(id, duration_count, duration_unit, price), contact:contacts(name, phone)'
      )
      .eq('id', membershipId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Membership not found' },
        { status: 404 }
      );
    }
    const membership = data as unknown as MembershipRow;

    if (membership.is_trial || membership.status === 'cancelled') {
      return NextResponse.json(
        {
          error: "Auto-pay can't be set up for a trial or cancelled membership",
        },
        { status: 400 }
      );
    }

    // Only recurring plans auto-renew (062) — record_gateway_charge
    // enforces this in the DB too; fail early with a clean message.
    if (!isRenewalChaseable(membership.plan)) {
      return NextResponse.json(
        { error: 'Only recurring plans support auto-pay' },
        { status: 400 }
      );
    }

    // INR-only rail (a currency condition, not a geo one).
    const { data: account } = await ctx.supabase
      .from('accounts')
      .select('default_currency')
      .eq('id', ctx.accountId)
      .maybeSingle();
    const currency = (account?.default_currency as string) ?? 'INR';
    if (!upiAvailableFor(currency)) {
      return NextResponse.json(
        { error: 'UPI AutoPay is available only for INR accounts' },
        { status: 400 }
      );
    }

    const cadence = razorpayCadence(
      membership.pricing_option,
      membership.plan?.duration_days ?? 0
    );
    if (!cadence) {
      return NextResponse.json(
        {
          error:
            'Auto-pay supports monthly or quarterly plans only; this plan stays on manual collection',
        },
        { status: 400 }
      );
    }
    // The recurring amount is the OPTION price — the membership's
    // fee_amount may embed the one-time joining fee (first cycle, 062)
    // and must not recur. Legacy fallback: the stored fee.
    const fee = Number(
      membership.pricing_option?.price ?? membership.fee_amount
    );
    if (!(fee > 0)) {
      return NextResponse.json(
        { error: 'This membership has no fee to auto-collect' },
        { status: 400 }
      );
    }

    // Gym's own Razorpay keys (service role — the creds row is admin-only
    // under RLS, and the caller may be an agent).
    const admin = supabaseAdmin();
    const connection = await getRazorpayConnection(admin, ctx.accountId);
    if (!connection) {
      return NextResponse.json(
        {
          error:
            'Connect your Razorpay account in Settings → Payments before setting up auto-pay',
        },
        { status: 400 }
      );
    }

    // Migration-time duplicate pending rows are terminal locally but may
    // still reference a live remote subscription. Do not create another one
    // until an operator clears that explicit setup exception.
    const { data: historicalException } = await admin
      .from('payment_mandates')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('membership_id', membership.id)
      .eq('status', 'failed')
      .not('gateway_subscription_id', 'is', null)
      .not('setup_error', 'is', null)
      .limit(1)
      .maybeSingle();
    if (historicalException) {
      return NextResponse.json(
        {
          error:
            'A previous auto-pay setup needs payment reconciliation review before retrying.',
        },
        { status: 409 }
      );
    }

    // Reserve before the first remote mutation. The partial unique index on
    // blocking states is the concurrency boundary; duplicate POSTs either
    // reuse the stored pending URL or return a review/in-progress response.
    const reservationInput = {
      account_id: ctx.accountId,
      membership_id: membership.id,
      contact_id: membership.contact_id,
      gateway: 'razorpay',
      method: 'upi',
      max_amount: fee,
      frequency: cadence.frequency,
      status: 'creating',
      pricing_option_id: membership.pricing_option?.id ?? null,
      cycle_duration_count:
        membership.pricing_option?.duration_count ??
        membership.plan?.duration_days ??
        null,
      cycle_duration_unit:
        membership.pricing_option?.duration_unit ??
        (membership.plan?.duration_days ? 'day' : null),
      recurring_amount: fee,
      currency,
      initial_period_end: membership.end_date,
    };
    const { data: reservation, error: reservationError } = await admin
      .from('payment_mandates')
      .insert(reservationInput)
      .select('id')
      .single();

    if (reservationError || !reservation) {
      if (reservationError?.code !== '23505') {
        return NextResponse.json(
          { error: 'Could not reserve the auto-pay setup. Please try again.' },
          { status: 500 }
        );
      }

      const { data: existing, error: existingError } = await admin
        .from('payment_mandates')
        .select(
          'id, status, gateway_subscription_id, gateway_short_url, setup_error'
        )
        .eq('account_id', ctx.accountId)
        .eq('membership_id', membership.id)
        .in('status', ['creating', 'pending', 'active', 'paused', 'orphaned'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError || !existing) {
        return NextResponse.json(
          { error: 'Auto-pay setup is already reserved. Please refresh.' },
          { status: 409 }
        );
      }
      if (
        existing.status === 'pending' &&
        existing.gateway_subscription_id &&
        existing.gateway_short_url
      ) {
        return NextResponse.json({
          mandate_id: existing.id,
          subscription_id: existing.gateway_subscription_id,
          short_url: existing.gateway_short_url,
          status: 'pending',
          deduped: true,
        });
      }

      const message =
        existing.status === 'active'
          ? 'This member already has an active auto-pay mandate'
          : existing.status === 'orphaned'
            ? 'Auto-pay setup needs payment reconciliation review before it can be retried'
            : existing.status === 'paused'
              ? 'This member has a paused auto-pay mandate; resolve it before starting another'
              : 'Auto-pay setup is already in progress. Please refresh shortly.';
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const mandateId = reservation.id as string;

    // Create the cadence plan, then a subscription the member authorises.
    // total_count bounds the mandate; we authorise a long horizon (the
    // gym can cancel any time) — 120 monthly / 40 quarterly ≈ 10 years.
    let plan: RazorpayPlan;
    try {
      plan = await runRazorpayOperation(admin, connection, (authentication) =>
        createPlan(authentication, {
          amountRupees: fee,
          currency,
          name: `${membership.plan?.name ?? 'Membership'} (${cadence.frequency})`,
          period: cadence.period,
          interval: cadence.interval,
        })
      );
    } catch (error) {
      await admin
        .from('payment_mandates')
        .update({
          status: 'failed',
          setup_error: `Razorpay plan creation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        })
        .eq('id', mandateId)
        .eq('status', 'creating');
      throw error;
    }

    const { data: planSaved, error: planSaveError } = await admin
      .from('payment_mandates')
      .update({ gateway_plan_id: plan.id })
      .eq('id', mandateId)
      .eq('status', 'creating')
      .select('id')
      .maybeSingle();
    if (planSaveError || !planSaved) {
      await admin
        .from('payment_mandates')
        .update({
          status: 'failed',
          setup_error:
            'Razorpay plan was created, but its local reference could not be saved. No subscription was created.',
        })
        .eq('id', mandateId)
        .eq('status', 'creating');
      return NextResponse.json(
        { error: 'Could not save the auto-pay plan. Please try again.' },
        { status: 500 }
      );
    }

    const totalCount = cadence.frequency === 'monthly' ? 120 : 40;
    let subscription: Awaited<ReturnType<typeof createSubscription>>;
    try {
      subscription = await runRazorpayOperation(
        admin,
        connection,
        (authentication) =>
          createSubscription(authentication, {
            planId: plan.id,
            totalCount,
            notes: {
              account_id: ctx.accountId,
              membership_id: membership.id,
              contact_id: membership.contact_id,
              mandate_id: mandateId,
              pricing_option_id: membership.pricing_option?.id ?? '',
            },
          })
      );
    } catch (error) {
      // A gateway 4xx is a known rejection. A transport failure or 5xx is
      // ambiguous: Razorpay may have created the subscription even though no
      // response reached us, so keep the reservation blocking for review.
      const knownRejection =
        error instanceof RazorpayError &&
        error.status >= 400 &&
        error.status < 500;
      await admin
        .from('payment_mandates')
        .update({
          status: knownRejection ? 'failed' : 'orphaned',
          setup_error: `Razorpay subscription creation ${knownRejection ? 'failed' : 'had an uncertain outcome'}: ${error instanceof Error ? error.message : 'unknown error'}`,
        })
        .eq('id', mandateId)
        .eq('status', 'creating');
      throw error;
    }

    const { data: mandate, error: persistError } = await admin
      .from('payment_mandates')
      .update({
        gateway_subscription_id: subscription.id,
        gateway_short_url: subscription.short_url ?? null,
        status: 'pending',
        setup_error: null,
      })
      .eq('id', mandateId)
      .eq('status', 'creating')
      .select('id')
      .maybeSingle();

    if (persistError || !mandate) {
      let cancelled = false;
      let cancellationError = '';
      try {
        await runRazorpayOperation(admin, connection, (authentication) =>
          cancelSubscription(authentication, subscription.id, false)
        );
        cancelled = true;
      } catch (error) {
        cancellationError =
          error instanceof Error ? error.message : 'unknown cancellation error';
      }

      await admin
        .from('payment_mandates')
        .update({
          gateway_subscription_id: cancelled ? null : subscription.id,
          gateway_short_url: cancelled
            ? null
            : (subscription.short_url ?? null),
          status: cancelled ? 'failed' : 'orphaned',
          setup_error: cancelled
            ? `Remote subscription ${subscription.id} was cancelled after local persistence failed; setup can be retried.`
            : `Remote subscription ${subscription.id} may be live after local persistence failed, and cancellation failed: ${cancellationError}`,
        })
        .eq('id', mandateId)
        .eq('status', 'creating');

      return NextResponse.json(
        {
          error: cancelled
            ? 'Auto-pay setup could not be saved; the remote subscription was cancelled. Please retry.'
            : 'Auto-pay setup needs payment reconciliation review before retrying.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      mandate_id: mandateId,
      subscription_id: subscription.id,
      short_url: subscription.short_url,
      status: 'pending',
    });
  } catch (err) {
    if (err instanceof RazorpayError) {
      // Surface the gateway's own message (e.g. product not enabled).
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
