import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { getErrorMessage } from '@/lib/errors';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  liveBillingConfig,
  liveMonthlyCheckoutEnabled,
  liveSettlementsEnabled,
} from '@/lib/subscriptions/live-provider';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { isMonthlyCatalogIdentity } from '@/lib/subscriptions/monthly-contract';
import type { MonthlyOfferSetPreview } from '@/lib/subscriptions/monthly-offer-preview';
export const runtime = 'nodejs';
const reviewAgain =
  'Your details changed. Review the offers again or contact support.';
function initiationOpen() {
  if (!liveMonthlyCheckoutEnabled() || !liveSettlementsEnabled()) return false;
  try {
    liveBillingConfig();
    return true;
  } catch {
    return false;
  }
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
function rpcError(error: { code?: string }, fallback: string) {
  if (error.code === '42501')
    return json({ error: 'Only the gym owner can do this' }, 403);
  if (['22023', '23505', '55000', '40001'].includes(error.code ?? ''))
    return json({ error: reviewAgain }, 409);
  // Database details never become customer copy.
  return json({ error: getErrorMessage({ code: error.code }, fallback) }, 500);
}
/** Owner-only writes keep initiation closed by default and every response uncached. */
export async function POST(request: Request) {
  const response = await handle(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
async function handle(request: Request) {
  if (!initiationOpen()) return json({ error: 'Not found' }, 404);
  const config = liveBillingConfig();
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Review the offer again' }, 400);
    const fields = body as Record<string, unknown>;
    if (
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.accountId) ||
      fields.organizationId === config.pilotOrganizationId ||
      Object.keys(fields).length !== 6 ||
      !isBranchAccountId(fields.offerSetId) ||
      !isBranchAccountId(fields.offerId) ||
      !Number.isSafeInteger(fields.seenAmountMinor) ||
      (fields.seenAmountMinor as number) < 1 ||
      fields.termsAccepted !== true
    )
      return json({ error: 'Review the offer again' }, 400);
    const { userId, supabase } = await requireSubscriptionOwner(
      fields.organizationId,
      fields.accountId
    );
    const limit = checkRateLimit(
      `subscription:monthly-review:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const prepared = await supabase.rpc('subscription_monthly_offer_preview', {
      p_organization_id: fields.organizationId,
      p_billing_account_id: fields.accountId,
    });
    if (prepared.error)
      return rpcError(
        prepared.error,
        'Could not save your review. Contact support.'
      );
    const preview = prepared.data as MonthlyOfferSetPreview | null;
    if (
      !preview ||
      Array.isArray(preview) ||
      preview.offerSetId !== fields.offerSetId ||
      preview.organizationId !== fields.organizationId ||
      preview.billingAccountId !== fields.accountId ||
      preview.contractVersion !== 'monthly_first_v1' ||
      preview.catalogVersion !== 'monthly_inr_2026_10_v1' ||
      preview.capabilitiesEnabled !== true
    )
      return json({ error: reviewAgain }, 409);
    const choice = Array.isArray(preview.choices)
      ? preview.choices.find(
          (choice) =>
            choice.available === true && choice.offerId === fields.offerId
        )
      : undefined;
    if (
      !choice?.available ||
      !isMonthlyCatalogIdentity(choice.identity) ||
      choice.identity.amountMinor !== fields.seenAmountMinor ||
      (preview.selectedOfferId !== null &&
        preview.selectedOfferId !== fields.offerId)
    )
      return json({ error: reviewAgain }, 409);
    if (!initiationOpen()) return json({ error: reviewAgain }, 409);
    // This authenticated write takes its author from auth.uid(), not the request.
    const reviewed = await supabase.rpc('subscription_approve_monthly_review', {
      p_offer_set_id: fields.offerSetId,
      p_offer_id: fields.offerId,
      p_seen_amount_minor: fields.seenAmountMinor,
      p_terms_accepted: true,
    });
    if (reviewed.error)
      return rpcError(
        reviewed.error,
        'Could not save your review. Contact support.'
      );
    const result = reviewed.data;
    if (
      !result ||
      Array.isArray(result) ||
      Object.keys(result).length !== 4 ||
      !isBranchAccountId(result.review_id) ||
      result.organization_id !== fields.organizationId ||
      result.billing_account_id !== fields.accountId ||
      result.monthly_offer_id !== fields.offerId
    )
      return json(
        { error: 'Could not save your review. Contact support.' },
        500
      );
    // Review has committed closed. Any opening failure must preserve that fact.
    const saved = () =>
      json(
        { error: 'Your review was saved. Contact support to open payment.' },
        409
      );
    if (!initiationOpen()) return saved();
    try {
      const opened = await supabaseAdmin().rpc(
        'subscription_open_reviewed_customer_scope',
        {
          p_review_id: result.review_id,
          p_organization_id: fields.organizationId,
          p_actor_user_id: userId,
        }
      );
      if (
        opened.error ||
        !opened.data ||
        Array.isArray(opened.data) ||
        Object.keys(opened.data).length !== 4 ||
        opened.data.review_id !== result.review_id ||
        opened.data.organization_id !== fields.organizationId ||
        opened.data.monthly_offer_id !== fields.offerId ||
        opened.data.checkout_open !== true ||
        !initiationOpen()
      )
        return saved();
    } catch {
      return saved();
    }
    return json({
      reviewed: true,
      reviewId: result.review_id,
      offerId: result.monthly_offer_id,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    const safe = await response.json();
    return json(
      {
        error: getErrorMessage(
          { message: safe.error },
          'Could not save your review. Contact support.'
        ),
      },
      response.status
    );
  }
}
