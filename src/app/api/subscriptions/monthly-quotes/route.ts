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
import { validLiveContractIdentity } from '@/lib/subscriptions/live-scope';
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
      return json({ error: 'Review the amount again' }, 400);
    const fields = body as Record<string, unknown>;
    if (
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.accountId) ||
      fields.organizationId === config.pilotOrganizationId ||
      Object.keys(fields).length !== 6 ||
      !isBranchAccountId(fields.requestId) ||
      !isBranchAccountId(fields.reviewId) ||
      !isBranchAccountId(fields.offerId) ||
      !Number.isSafeInteger(fields.seenAmountMinor) ||
      (fields.seenAmountMinor as number) < 1
    )
      return json({ error: 'Review the amount again' }, 400);
    const { userId } = await requireSubscriptionOwner(
      fields.organizationId,
      fields.accountId
    );
    const limit = checkRateLimit(
      `subscription:monthly-quotes:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    if (!initiationOpen()) return json({ error: reviewAgain }, 409);
    const { data, error } = await supabaseAdmin().rpc(
      'subscription_create_monthly_quote',
      {
        p_request_id: fields.requestId,
        p_organization_id: fields.organizationId,
        p_billing_account_id: fields.accountId,
        p_actor_user_id: userId,
        p_review_id: fields.reviewId,
        p_offer_id: fields.offerId,
        p_seen_amount_minor: fields.seenAmountMinor,
        p_provider_merchant_id: config.merchantId,
      }
    );
    if (error)
      return rpcError(error, 'Could not prepare payment. Contact support.');
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      Object.keys(data).length !== 12 ||
      data.request_id !== fields.requestId ||
      data.organization_id !== fields.organizationId ||
      !isBranchAccountId(data.approval_id) ||
      data.monthly_offer_id !== fields.offerId ||
      data.offer_contract_version !== 'monthly_first_v1' ||
      !validLiveContractIdentity(data) ||
      data.amount_minor !== fields.seenAmountMinor ||
      typeof data.expires_at !== 'string' ||
      !Number.isFinite(Date.parse(data.expires_at)) ||
      Date.parse(data.expires_at) <= Date.now()
    )
      return json(
        { error: 'Could not prepare payment. Contact support.' },
        500
      );
    // Do not return a payable quote after initiation closes during the RPC.
    if (!initiationOpen()) return json({ error: reviewAgain }, 409);
    return json({ quote: data }, 202);
  } catch (error) {
    const response = toErrorResponse(error);
    const safe = await response.json();
    return json(
      {
        error: getErrorMessage(
          { message: safe.error },
          'Could not prepare payment. Contact support.'
        ),
      },
      response.status
    );
  }
}
