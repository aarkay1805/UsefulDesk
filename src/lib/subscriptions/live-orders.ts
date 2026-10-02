import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  createLiveOrder,
  fetchLiveOrder,
  liveBillingConfig,
  liveOrdersEnabled,
  liveCustomerCheckoutEnabled,
  liveCustomerRenewalsEnabled,
  liveSettlementsEnabled,
  recoverLiveOrder,
  type LiveBillingConfig,
} from './live-provider';

import { resolveLiveProviderAuthority } from './live-scope';

export class LiveOrderReviewRequired extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires a durable, immutable, owner-reviewed quote in the Live schema. */
export async function prepareLiveCheckout(
  input: { requestId: string; organizationId: string; actorUserId: string },
  dependencies: {
    admin?: SupabaseClient;
    config?: LiveBillingConfig;
    env?: NodeJS.ProcessEnv;
    createOrder?: typeof createLiveOrder;
    recoverOrder?: typeof recoverLiveOrder;
    fetchOrder?: typeof fetchLiveOrder;
  } = {}
) {
  const env = dependencies.env ?? process.env;
  if (
    (!liveOrdersEnabled(env) && !liveCustomerCheckoutEnabled(env)) ||
    !liveSettlementsEnabled(env)
  )
    throw new Error('Live orders are disabled');
  const config = dependencies.config ?? liveBillingConfig(env);
  const customer = input.organizationId !== config.pilotOrganizationId;
  if (customer ? !liveCustomerCheckoutEnabled(env) : !liveOrdersEnabled(env))
    throw new Error('Live checkout scope is disabled');
  const admin = dependencies.admin ?? supabaseAdmin();
  const authority = customer
    ? await resolveLiveProviderAuthority(
        { requestId: input.requestId },
        config,
        admin
      )
    : undefined;
  if (authority && authority.organizationId !== input.organizationId)
    throw new Error('Live checkout authority changed organization');
  // Check runtime containment before reserving the one provider POST.
  if (authority?.renewalOfRequestId && !liveCustomerRenewalsEnabled(env))
    throw new Error('Customer renewal is disabled');
  const { data, error } = await admin.rpc('subscription_claim_live_order', {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_provider_merchant_id: config.merchantId,
  });
  if (
    error ||
    !record(data) ||
    data.request_id !== input.requestId ||
    data.organization_id !== input.organizationId ||
    typeof data.amount_minor !== 'number' ||
    !Number.isSafeInteger(data.amount_minor) ||
    data.amount_minor < 1 ||
    data.currency !== 'INR'
  )
    throw new Error('Live order claim did not match the reviewed quote');
  if (
    customer &&
    data.renewal_of_request_id &&
    !liveCustomerRenewalsEnabled(env)
  )
    throw new Error('Customer renewal is disabled');
  const facts = {
    requestId: input.requestId,
    organizationId: input.organizationId,
    amountMinor: data.amount_minor,
    ...(authority ? { authority } : {}),
  };
  if (
    facts.authority &&
    facts.authority.organizationId !== input.organizationId
  )
    throw new Error('Live checkout authority changed organization');
  let orderId: string;
  if (data.action === 'bound' && typeof data.provider_order_id === 'string') {
    const order = await (dependencies.fetchOrder ?? fetchLiveOrder)(config, {
      ...facts,
      orderId: data.provider_order_id,
    });
    orderId = order.id;
  } else if (data.action === 'create' || data.action === 'recovery') {
    const order =
      data.action === 'create'
        ? await (dependencies.createOrder ?? createLiveOrder)(
            config,
            facts,
            fetch,
            env
          )
        : await (dependencies.recoverOrder ?? recoverLiveOrder)(config, facts);
    if (!order)
      throw new LiveOrderReviewRequired('Live order recovery needs review');
    orderId = order.id;
    const bound = await admin.rpc('subscription_bind_live_order', {
      p_request_id: input.requestId,
      p_provider_order_id: orderId,
      p_provider_merchant_id: config.merchantId,
      p_pilot_organization_id: input.organizationId,
    });
    if (
      bound.error ||
      !record(bound.data) ||
      bound.data.request_id !== input.requestId ||
      bound.data.organization_id !== input.organizationId ||
      bound.data.provider_order_id !== orderId
    )
      throw new LiveOrderReviewRequired('Live order binding needs review');
  } else {
    throw new LiveOrderReviewRequired('Live order needs review');
  }
  // A cancellation, refund review, expiry, or rollout change can happen
  // during provider I/O. Recheck before returning a payable Checkout order.
  const recheck = await admin.rpc('subscription_claim_live_order', {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_provider_merchant_id: config.merchantId,
  });
  if (
    recheck.error ||
    !record(recheck.data) ||
    recheck.data.action !== 'bound' ||
    recheck.data.request_id !== input.requestId ||
    recheck.data.organization_id !== input.organizationId ||
    recheck.data.provider_order_id !== orderId ||
    recheck.data.amount_minor !== data.amount_minor ||
    recheck.data.currency !== 'INR'
  )
    throw new LiveOrderReviewRequired(
      'Live order changed during payment setup'
    );
  return {
    requestId: input.requestId,
    organizationId: input.organizationId,
    orderId,
    amountMinor: data.amount_minor,
    currency: 'INR' as const,
    keyId: config.keyId,
  };
}
