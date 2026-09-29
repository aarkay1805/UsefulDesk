import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';

/** Owner-reviewed Test quote. The private commercial gate defaults off. */
export async function POST(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Plan quote is unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Review the change and try again' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 3 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.accountId) ||
      !isBranchAccountId(fields.requestId)
    )
      return NextResponse.json(
        { error: 'Review the change and try again' },
        { status: 400 }
      );
    const { supabase, userId } = await requireSubscriptionOwner(
      fields.organizationId,
      fields.accountId
    );
    const limit = checkRateLimit(
      'subscription:advanced-quote:' + userId,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await supabase.rpc(
      'subscription_create_test_advanced_quote',
      {
        p_request_id: fields.requestId,
      }
    );
    if (error) {
      if (error.code === '42501')
        return NextResponse.json(
          { error: 'Only the gym owner can review this quote' },
          { status: 403 }
        );
      if (['22023', '23505', '55000'].includes(error.code ?? ''))
        return NextResponse.json(
          { error: 'This quote needs a new review' },
          { status: 409 }
        );
      throw error;
    }
    if (
      !data ||
      data.organization_id !== fields.organizationId ||
      data.request_id !== fields.requestId ||
      !['upgrade', 'addon_purchase', 'restart'].includes(data.kind) ||
      data.state !== 'pending' ||
      !Number.isSafeInteger(data.amount_minor) ||
      data.amount_minor < 1 ||
      data.currency !== 'INR' ||
      typeof data.quote_expires_at !== 'string'
    )
      throw new Error('Unexpected Test quote response');
    return NextResponse.json(
      {
        quote: {
          organizationId: data.organization_id,
          requestId: data.request_id,
          kind: data.kind,
          tier: data.tier,
          amountMinor: data.amount_minor,
          currency: 'INR',
          expiresAt: data.quote_expires_at,
          policyVersion: data.commercial_policy_version,
        },
      },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
