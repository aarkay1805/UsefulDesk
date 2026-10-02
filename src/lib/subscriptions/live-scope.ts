import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveBillingConfig, LiveOrderFacts } from './live-provider';

const issued = new WeakSet<object>();
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Process-local authority issued only from the service-only durable identity RPC. */
export interface LiveProviderAuthority {
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
    row.amount_minor !== 79900 ||
    row.currency !== 'INR' ||
    (row.renewal_of_request_id != null &&
      (typeof row.renewal_of_request_id !== 'string' ||
        !UUID.test(row.renewal_of_request_id))) ||
    !['internal_acceptance', 'customer_sale'].includes(String(row.scope)) ||
    (row.scope === 'internal_acceptance' &&
      row.organization_id !== config.pilotOrganizationId) ||
    (row.scope === 'customer_sale' &&
      row.organization_id === config.pilotOrganizationId)
  )
    throw new Error('Live scope is not a durable operator-authorized identity');
  const authority = Object.freeze({
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
  if (facts.organizationId === config.pilotOrganizationId) return;
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
