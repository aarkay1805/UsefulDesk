import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { canSellProductsServices } from '@/lib/auth/roles';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import type { CheckoutMode, MembershipCheckoutMode } from '@/types';

const MODES = new Set<CheckoutMode>([
  'join',
  'convert',
  'membership_renewal',
  'sale',
  'service_renewal',
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBERSHIP_MODES = new Set<MembershipCheckoutMode>([
  'join',
  'convert',
  'membership_renewal',
]);
const COLLECTION_TIMINGS = new Set(['full', 'installments']);
const PAYMENT_METHODS = new Set(['cash', 'upi', 'card', 'bank', 'other']);
const CALCULATED_MEMBERSHIP_FIELDS = [
  'fee_amount',
  'period_end',
  'list_price',
  'discount_amount',
  'standard_period_end',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function membershipIntentError(
  membership: Record<string, unknown>
): string | null {
  if (CALCULATED_MEMBERSHIP_FIELDS.some((field) => field in membership)) {
    return 'Membership totals and expiry are calculated by UsefulDesk';
  }
  if (
    typeof membership.plan_id !== 'string' ||
    !UUID.test(membership.plan_id)
  ) {
    return 'A valid membership plan is required';
  }
  if (
    typeof membership.pricing_option_id !== 'string' ||
    !UUID.test(membership.pricing_option_id)
  ) {
    return 'A valid billing option is required';
  }
  if (!isCalendarDate(membership.period_start)) {
    return 'A valid membership start date is required';
  }

  const discountType = membership.discount_type;
  const discountValue = membership.discount_value;
  if (
    discountType !== undefined &&
    discountType !== null &&
    discountType !== 'amount' &&
    discountType !== 'percentage'
  ) {
    return 'Discount type must be amount or percentage';
  }
  if (discountType === null || discountType === undefined) {
    if (discountValue !== null && discountValue !== undefined) {
      return 'Discount value requires a discount type';
    }
  } else if (
    typeof discountValue !== 'number' ||
    !Number.isFinite(discountValue) ||
    discountValue <= 0 ||
    (discountType === 'percentage' && discountValue > 100)
  ) {
    return 'Enter a valid discount value';
  }

  const bonusMonths = membership.bonus_months ?? 0;
  if (
    typeof bonusMonths !== 'number' ||
    !Number.isInteger(bonusMonths) ||
    bonusMonths < 0 ||
    bonusMonths > 120
  ) {
    return 'Bonus months must be a whole number from 0 to 120';
  }
  return null;
}

function collectionIntentError(
  collection: Record<string, unknown>
): string | null {
  if ('amount' in collection || 'installment' in collection) {
    return 'Collection amounts are calculated by UsefulDesk';
  }
  if (typeof collection.collect_now !== 'boolean') {
    return 'Collect now must be true or false';
  }
  if (
    typeof collection.timing !== 'string' ||
    !COLLECTION_TIMINGS.has(collection.timing)
  ) {
    return 'Collection timing must be full or installments';
  }
  if (
    typeof collection.method !== 'string' ||
    !PAYMENT_METHODS.has(collection.method)
  ) {
    return 'A valid payment method is required';
  }
  if (
    collection.paid_at !== undefined &&
    (typeof collection.paid_at !== 'string' ||
      !Number.isFinite(Date.parse(collection.paid_at)))
  ) {
    return 'A valid payment time is required';
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    if (!canSellProductsServices(ctx.role)) {
      return NextResponse.json(
        { error: 'Agent access is required' },
        { status: 403 }
      );
    }

    const limit = checkRateLimit(
      `member-checkout:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const mode = body?.mode;
    const contactId = body?.contact_id;
    const idempotencyKey = body?.idempotency_key;
    if (typeof mode !== 'string' || !MODES.has(mode as CheckoutMode)) {
      return NextResponse.json(
        { error: 'Invalid checkout mode' },
        { status: 400 }
      );
    }
    if (typeof contactId !== 'string' || !UUID.test(contactId)) {
      return NextResponse.json(
        { error: 'A valid member contact is required' },
        { status: 400 }
      );
    }
    if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)) {
      return NextResponse.json(
        { error: 'A valid idempotency key is required' },
        { status: 400 }
      );
    }
    if (!Array.isArray(body?.selections)) {
      return NextResponse.json(
        { error: 'Selections must be an array' },
        { status: 400 }
      );
    }

    if (MEMBERSHIP_MODES.has(mode as MembershipCheckoutMode)) {
      if (!isRecord(body?.membership)) {
        return NextResponse.json(
          { error: 'Membership checkout details are required' },
          { status: 400 }
        );
      }
      const membershipError = membershipIntentError(body.membership);
      if (membershipError) {
        return NextResponse.json({ error: membershipError }, { status: 400 });
      }
      if (!isRecord(body?.collection)) {
        return NextResponse.json(
          { error: 'Collection details are required' },
          { status: 400 }
        );
      }
      const collectionError = collectionIntentError(body.collection);
      if (collectionError) {
        return NextResponse.json({ error: collectionError }, { status: 400 });
      }

      const membershipId = body.membership_id;
      if (
        (membershipId !== undefined &&
          (typeof membershipId !== 'string' || !UUID.test(membershipId))) ||
        (mode === 'membership_renewal' && typeof membershipId !== 'string') ||
        (mode === 'join' && membershipId !== undefined)
      ) {
        return NextResponse.json(
          { error: 'A valid membership is required for this checkout' },
          { status: 400 }
        );
      }
    }

    // The selected branch is authoritative. Never trust account_id supplied by
    // a browser; the RPC repeats the membership and contact tenancy checks.
    const payload = { ...body, account_id: ctx.accountId };
    const joinsExistingContact =
      (mode === 'join' || mode === 'convert') &&
      typeof body?.membership_id !== 'string';
    const { data, error } = await ctx.supabase.rpc(
      joinsExistingContact
        ? 'perform_join_checkout'
        : 'perform_member_checkout',
      {
        p_payload: payload,
      }
    );
    if (error) {
      console.error('[POST /api/member-checkouts] checkout failed:', error);
      return NextResponse.json(
        { error: error.message || 'Checkout failed' },
        { status: error.code === '42501' ? 403 : 400 }
      );
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
