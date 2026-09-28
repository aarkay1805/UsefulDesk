import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { isSubscriptionTier } from '@/lib/subscriptions/plans';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';

type PendingIntent = {
  request_id: string;
  organization_id: string;
  tier: string;
  amount_minor: number;
  currency: string;
  state: string;
};

function isPendingIntent(value: unknown): value is PendingIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    isBranchAccountId(row.request_id) &&
    isBranchAccountId(row.organization_id) &&
    isSubscriptionTier(row.tier) &&
    typeof row.amount_minor === 'number' &&
    Number.isSafeInteger(row.amount_minor) &&
    row.amount_minor > 0 &&
    row.currency === 'INR' &&
    row.state === 'pending'
  );
}

/**
 * Local Test preparation only. This records a proposed base monthly plan;
 * it cannot create an order, accept money, or grant product access.
 */
export async function POST(request: Request) {
  if (!testBillingEnabled()) {
    return NextResponse.json(
      { error: 'Plan selection is unavailable' },
      { status: 404 }
    );
  }

  try {
    requireSameOriginRequest(request);
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Choose a plan and try again' },
        { status: 400 }
      );
    }
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 4 ||
      !isBranchAccountId(fields.accountId) ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId) ||
      !isSubscriptionTier(fields.tier)
    ) {
      return NextResponse.json(
        { error: 'Choose a plan and try again' },
        { status: 400 }
      );
    }

    // Identity-only RPC stays available after trial expiry. getCurrentAccount()
    // requires product access, so it cannot serve this recovery path.
    const { supabase, userId } = await requireSubscriptionOwner(
      fields.organizationId,
      fields.accountId
    );

    const limit = checkRateLimit(
      `subscription:intent:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data, error } = await supabase.rpc(
      'subscription_create_monthly_intent',
      {
        p_organization_id: fields.organizationId,
        p_request_id: fields.requestId,
        p_tier: fields.tier,
        p_billing_account_id: fields.accountId,
      }
    );
    if (error) {
      if (error.code === '42501') {
        return NextResponse.json(
          { error: 'Only the gym owner can choose a plan' },
          { status: 403 }
        );
      }
      if (error.code === '22023' || error.code === '23505') {
        return NextResponse.json(
          { error: 'This plan cannot be selected for your gym yet' },
          { status: 409 }
        );
      }
      if (error.code === '55000') {
        return NextResponse.json(
          { error: 'Plan selection is unavailable' },
          { status: 503 }
        );
      }
      console.error('[subscription intent] create failed:', {
        code: error.code ?? null,
      });
      throw error;
    }
    if (
      !isPendingIntent(data) ||
      data.organization_id !== fields.organizationId ||
      data.tier !== fields.tier
    ) {
      console.error('[subscription intent] unexpected RPC response');
      return NextResponse.json(
        { error: 'Could not save the plan. Try again.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ intent: data }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
