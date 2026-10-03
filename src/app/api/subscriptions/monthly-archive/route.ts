import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import type { MonthlyOfferSetPreview } from '@/lib/subscriptions/monthly-offer-preview';
import {
  MONTHLY_REVIEW_AGAIN as reviewAgain,
  monthlyInitiationOpen as initiationOpen,
  monthlyRouteJson as json,
  monthlyRpcError as rpcError,
  monthlyRoute,
} from '@/lib/subscriptions/monthly-route';

export const runtime = 'nodejs';

export const POST = monthlyRoute(
  'Could not archive branches. Contact support.',
  async (request, config) => {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Choose branches to archive' }, 400);
    const fields = body as Record<string, unknown>;
    if (
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.accountId) ||
      fields.organizationId === config.pilotOrganizationId ||
      Object.keys(fields).length !== 4 ||
      !isBranchAccountId(fields.offerSetId) ||
      !Array.isArray(fields.accountIds) ||
      fields.accountIds.length < 1 ||
      !fields.accountIds.every(isBranchAccountId) ||
      new Set(fields.accountIds.map((id) => id.toLowerCase())).size !==
        fields.accountIds.length ||
      fields.accountIds.some(
        (id) => id.toLowerCase() === (fields.accountId as string).toLowerCase()
      )
    )
      return json({ error: 'Choose branches to archive' }, 400);
    const { userId, supabase } = await requireSubscriptionOwner(
      fields.organizationId,
      fields.accountId
    );
    const limit = checkRateLimit(
      `subscription:monthly-archive:${userId}`,
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
        'Could not archive branches. Contact support.'
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
    const ids = fields.accountIds as string[];
    if (
      preview.selectedOfferId !== null ||
      !Array.isArray(preview.activeBranches) ||
      preview.activeBranches.some(
        (branch) => !branch || !isBranchAccountId(branch.accountId)
      ) ||
      new Set(preview.activeBranches.map((branch) => branch.accountId)).size !==
        preview.activeBranches.length ||
      !preview.activeBranches.some(
        (branch) => branch.accountId === fields.accountId
      ) ||
      ids.length >= preview.activeBranches.length ||
      !ids.every((id) =>
        preview.activeBranches.some((branch) => branch.accountId === id)
      )
    )
      return json({ error: reviewAgain }, 409);
    if (!initiationOpen()) return json({ error: reviewAgain }, 409);
    const { data, error } = await supabase.rpc(
      'subscription_archive_monthly_branches',
      { p_offer_set_id: fields.offerSetId, p_account_ids: ids }
    );
    if (error)
      return rpcError(error, 'Could not archive branches. Contact support.');
    if (
      !data ||
      Array.isArray(data) ||
      Object.keys(data).length !== 2 ||
      data.requires_new_preparation !== true ||
      !Array.isArray(data.archived_account_ids) ||
      data.archived_account_ids.length !== ids.length ||
      new Set(data.archived_account_ids).size !== ids.length ||
      !data.archived_account_ids.every(
        (id: unknown) => isBranchAccountId(id) && ids.includes(id)
      )
    )
      return json(
        { error: 'Could not archive branches. Contact support.' },
        500
      );
    return json({
      result: { archived_count: ids.length, preparation_stale: true },
    });
  }
);
