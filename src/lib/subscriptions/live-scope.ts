import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveBillingConfig, LiveOrderFacts } from './live-provider';
import { isMonthlyCatalogIdentity } from './monthly-contract';
import type { SubscriptionTier } from './plans';

const issued = new WeakSet<object>();
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Legacy SQL rows stay NULL; only the durable resolver projects starter_v1. */
export function validLiveContractIdentity(row: Record<string, unknown>) {
  if (row.offer_contract_version === 'starter_v1')
    return (
      row.catalog_version === null &&
      row.monthly_offer_id === null &&
      row.tier === 'starter' &&
      row.amount_minor === 79900 &&
      row.currency === 'INR' &&
      row.included_branches === 1 &&
      row.paid_extra_branch_slots === 0
    );
  return (
    typeof row.monthly_offer_id === 'string' &&
    UUID.test(row.monthly_offer_id) &&
    row.renewal_of_request_id == null &&
    isMonthlyCatalogIdentity({
      contractVersion: row.offer_contract_version,
      catalogVersion: row.catalog_version,
      tier: row.tier,
      amountMinor: row.amount_minor,
      currency: row.currency,
      includedBranches: row.included_branches,
      paidExtraBranchSlots: row.paid_extra_branch_slots,
    })
  );
}

/** Claim/capture/recovery projections may omit legacy identity, never new identity. */
export function matchesLiveContractAuthority(
  row: Record<string, unknown>,
  authority?: LiveProviderAuthority
) {
  if (
    row.amount_minor !== (authority?.amountMinor ?? 79900) ||
    row.currency !== 'INR'
  )
    return false;
  const keys = [
    'offer_contract_version',
    'catalog_version',
    'monthly_offer_id',
    'tier',
    'included_branches',
    'paid_extra_branch_slots',
  ];
  if (!authority || authority.contractVersion === 'starter_v1') {
    if (!keys.some((key) => Object.hasOwn(row, key))) return true;
    return (
      validLiveContractIdentity(row) &&
      row.offer_contract_version === 'starter_v1'
    );
  }
  return (
    issued.has(authority) &&
    validLiveContractIdentity(row) &&
    row.offer_contract_version === authority.contractVersion &&
    row.catalog_version === authority.catalogVersion &&
    row.tier === authority.catalogTier &&
    row.monthly_offer_id === authority.monthlyOfferId &&
    row.included_branches === authority.includedBranches &&
    row.paid_extra_branch_slots === 0
  );
}

/** Process-local authority issued only from the service-only durable identity RPC. */
export interface LiveProviderAuthority {
  readonly contractVersion: 'starter_v1' | 'monthly_first_v1';
  readonly catalogVersion: 'monthly_inr_2026_10_v1' | null;
  readonly catalogTier: SubscriptionTier;
  readonly monthlyOfferId: string | null;
  readonly includedBranches: number;
  readonly paidExtraBranchSlots: 0;
  readonly requestId: string;
  readonly organizationId: string;
  readonly merchantId: string;
  readonly amountMinor: number;
  readonly keyId: string;
  readonly renewalOfRequestId?: string | null;
}

export async function resolveLiveProviderAuthority(
  identity: { requestId: string } | { orderId: string },
  config: LiveBillingConfig,
  admin: SupabaseClient
): Promise<LiveProviderAuthority> {
  const result = await admin.rpc('subscription_resolve_live_scope', {
    p_provider_merchant_id: config.merchantId,
    ...('requestId' in identity
      ? { p_request_id: identity.requestId }
      : { p_provider_order_id: identity.orderId }),
  });
  const row = result.data as Record<string, unknown> | null;
  if (
    result.error ||
    !row ||
    typeof row.request_id !== 'string' ||
    !UUID.test(row.request_id) ||
    ('requestId' in identity && row.request_id !== identity.requestId) ||
    typeof row.organization_id !== 'string' ||
    !UUID.test(row.organization_id) ||
    row.merchant_id !== config.merchantId ||
    !validLiveContractIdentity(row) ||
    (row.renewal_of_request_id != null &&
      (typeof row.renewal_of_request_id !== 'string' ||
        !UUID.test(row.renewal_of_request_id))) ||
    !['internal_acceptance', 'customer_sale'].includes(String(row.scope)) ||
    (row.scope === 'internal_acceptance' &&
      (row.organization_id !== config.pilotOrganizationId ||
        row.offer_contract_version !== 'starter_v1')) ||
    (row.scope === 'customer_sale' &&
      row.organization_id === config.pilotOrganizationId)
  )
    throw new Error('Live scope is not a durable operator-authorized identity');
  const authority: LiveProviderAuthority = Object.freeze({
    contractVersion:
      row.offer_contract_version as LiveProviderAuthority['contractVersion'],
    catalogVersion:
      row.catalog_version as LiveProviderAuthority['catalogVersion'],
    catalogTier: row.tier as SubscriptionTier,
    monthlyOfferId: row.monthly_offer_id as string | null,
    includedBranches: row.included_branches as number,
    paidExtraBranchSlots: 0 as const,
    requestId: row.request_id,
    organizationId: row.organization_id,
    merchantId: config.merchantId,
    amountMinor: row.amount_minor as number,
    keyId: config.keyId,
    renewalOfRequestId: (row.renewal_of_request_id ?? null) as string | null,
  });
  issued.add(authority);
  return authority;
}

export function assertLiveProviderAuthority(
  config: LiveBillingConfig,
  facts: LiveOrderFacts
) {
  if (facts.organizationId === config.pilotOrganizationId && !facts.authority) {
    if (facts.amountMinor !== 79900)
      throw new Error('Invalid original Starter authority');
    return;
  }
  const authority = facts.authority;
  if (
    !authority ||
    !issued.has(authority) ||
    authority.requestId !== facts.requestId ||
    authority.organizationId !== facts.organizationId ||
    authority.merchantId !== config.merchantId ||
    authority.keyId !== config.keyId ||
    authority.amountMinor !== facts.amountMinor
  )
    throw new Error(
      'Organization is outside the Live pilot without durable customer authority'
    );
}

export async function liveRecoveryScopes(
  config: LiveBillingConfig,
  admin: SupabaseClient
) {
  const result = await admin.rpc('subscription_list_live_recovery_scopes', {
    p_provider_merchant_id: config.merchantId,
  });
  if (
    result.error ||
    !Array.isArray(result.data) ||
    result.data[0] !== config.pilotOrganizationId ||
    result.data.some(
      (id: unknown) => typeof id !== 'string' || !UUID.test(id)
    ) ||
    new Set(result.data).size !== result.data.length
  )
    throw new Error('Live recovery scope inventory changed identity');
  return result.data as string[];
}
