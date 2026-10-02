import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  liveBillingConfig,
  liveCustomerCheckoutEnabled,
} from '@/lib/subscriptions/live-provider';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';

export const runtime = 'nodejs';

/** Owner authors the review; the separate server transaction consumes operator opening authority. */
export async function POST(request: Request) {
  if (!liveCustomerCheckoutEnabled())
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let config;
  try {
    config = liveBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    requireSameOriginRequest(request);
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).length !== 5 ||
      !isBranchAccountId(body.organizationId) ||
      !isBranchAccountId(body.accountId) ||
      !isBranchAccountId(body.preparationId) ||
      body.seenAmountMinor !== 79900 ||
      body.termsAccepted !== true ||
      body.organizationId === config.pilotOrganizationId
    )
      return NextResponse.json(
        { error: 'Review the Starter offer again' },
        { status: 400 }
      );
    const { userId, supabase } = await requireSubscriptionOwner(
      body.organizationId,
      body.accountId
    );
    const limit = checkRateLimit(
      `subscription:customer-review:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    // The authenticated transaction uses auth.uid(), never a supplied actor ID.
    const reviewed = await supabase.rpc(
      'subscription_approve_customer_review',
      {
        p_preparation_id: body.preparationId,
        p_seen_amount_minor: body.seenAmountMinor,
        p_terms_accepted: true,
      }
    );
    if (reviewed.error) {
      if (['42501', '55000'].includes(reviewed.error.code ?? ''))
        return NextResponse.json(
          { error: 'This offer needs a new review. Contact support.' },
          { status: 409 }
        );
      throw reviewed.error;
    }
    if (
      reviewed.data?.review_id !== body.preparationId ||
      reviewed.data?.organization_id !== body.organizationId ||
      reviewed.data?.billing_account_id !== body.accountId
    )
      throw new Error('Customer review did not match the selected gym');
    // Scope creation has committed closed before this independent opening transaction.
    const opened = await supabaseAdmin().rpc(
      'subscription_open_reviewed_customer_scope',
      {
        p_review_id: body.preparationId,
        p_organization_id: body.organizationId,
        p_actor_user_id: userId,
      }
    );
    if (opened.error) {
      if (['42501', '55000'].includes(opened.error.code ?? ''))
        return NextResponse.json(
          { error: 'Your review was saved. Contact support to open payment.' },
          { status: 409 }
        );
      throw opened.error;
    }
    if (
      opened.data?.review_id !== body.preparationId ||
      opened.data?.organization_id !== body.organizationId ||
      opened.data?.checkout_open !== true
    )
      throw new Error('Customer opening did not match the owner review');
    return NextResponse.json(
      { reviewed: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
