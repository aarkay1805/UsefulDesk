import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import {
  liveBillingConfig,
  liveQuotesEnabled,
} from '@/lib/subscriptions/live-provider';

export const runtime = 'nodejs';

/** Copies an already approved offer after the owner confirms its exact amount. */
export async function POST(request: Request) {
  if (!liveQuotesEnabled())
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let config;
  try {
    config = liveBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    requireSameOriginRequest(request);
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Review the amount again' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 6 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.accountId) ||
      !isBranchAccountId(fields.requestId) ||
      !isBranchAccountId(fields.approvalId) ||
      !['starter', 'growth', 'ultimate'].includes(String(fields.tier)) ||
      !Number.isSafeInteger(fields.seenAmountMinor) ||
      (fields.seenAmountMinor as number) < 1 ||
      fields.organizationId !== config.pilotOrganizationId
    )
      return NextResponse.json(
        { error: 'Review the amount again' },
        { status: 400 }
      );
    const { userId } = await requireSubscriptionOwner(
      fields.organizationId,
      fields.accountId
    );
    const limit = checkRateLimit(
      `subscription:live-quote:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await supabaseAdmin().rpc(
      'subscription_create_live_quote',
      {
        p_request_id: fields.requestId,
        p_organization_id: fields.organizationId,
        p_billing_account_id: fields.accountId,
        p_actor_user_id: userId,
        p_approval_id: fields.approvalId,
        p_seen_amount_minor: fields.seenAmountMinor,
        p_tier: fields.tier,
        p_provider_merchant_id: config.merchantId,
      }
    );
    if (error) {
      if (error.code === '42501')
        return NextResponse.json(
          { error: 'Only the gym owner can review this amount' },
          { status: 403 }
        );
      if (['22023', '23505', '55000'].includes(error.code ?? ''))
        return NextResponse.json(
          { error: 'This amount needs a new review' },
          { status: 409 }
        );
      throw error;
    }
    if (
      !data ||
      data.request_id !== fields.requestId ||
      data.organization_id !== fields.organizationId ||
      data.approval_id !== fields.approvalId ||
      data.tier !== fields.tier ||
      data.amount_minor !== fields.seenAmountMinor ||
      data.currency !== 'INR' ||
      typeof data.expires_at !== 'string'
    )
      throw new Error('Live quote did not match the reviewed amount');
    return NextResponse.json(
      { quote: data },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
