import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  createLiveFullRefund,
  fetchLiveRefund,
  fetchSettledLiveFullRefund,
  liveBillingConfig,
  liveRefundsEnabled,
  recoverLiveFullRefund,
  type LiveBillingConfig,
  type LiveRefundFacts,
} from './live-provider';

export class LiveRefundReviewRequired extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A saved claim precedes the sole provider POST; uncertain responses use GET. */
export async function prepareLiveFullRefund(
  input: {
    refundRequestId: string;
    organizationId: string;
    actorUserId: string;
  },
  dependencies: {
    admin?: SupabaseClient;
    config?: LiveBillingConfig;
    env?: NodeJS.ProcessEnv;
    createRefund?: typeof createLiveFullRefund;
    recoverRefund?: typeof recoverLiveFullRefund;
    fetchRefund?: typeof fetchLiveRefund;
    fetchSettled?: typeof fetchSettledLiveFullRefund;
  } = {}
) {
  const env = dependencies.env ?? process.env;
  if (!liveRefundsEnabled(env)) throw new Error('Live refunds are disabled');
  const config = dependencies.config ?? liveBillingConfig(env);
  if (input.organizationId !== config.pilotOrganizationId)
    throw new Error('Organization is outside the Live pilot');
  const admin = dependencies.admin ?? supabaseAdmin();
  const { data, error } = await admin.rpc('subscription_claim_live_refund', {
    p_refund_request_id: input.refundRequestId,
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_provider_merchant_id: config.merchantId,
  });
  if (
    error ||
    !record(data) ||
    data.refund_request_id !== input.refundRequestId ||
    data.organization_id !== input.organizationId ||
    typeof data.request_id !== 'string' ||
    typeof data.provider_payment_id !== 'string' ||
    typeof data.provider_order_id !== 'string' ||
    typeof data.amount_minor !== 'number' ||
    !Number.isSafeInteger(data.amount_minor) ||
    data.amount_minor < 1 ||
    data.currency !== 'INR'
  )
    throw new Error('Live refund claim did not match the reviewed payment');
  const facts: LiveRefundFacts = {
    refundRequestId: input.refundRequestId,
    requestId: data.request_id,
    organizationId: input.organizationId,
    paymentId: data.provider_payment_id,
    orderId: data.provider_order_id,
    amountMinor: data.amount_minor,
  };
  if (data.action === 'confirmed' || data.action === 'review_required')
    return { status: data.action, refundId: data.provider_refund_id ?? null };
  let observed;
  if (data.action === 'create')
    observed = await (dependencies.createRefund ?? createLiveFullRefund)(
      config,
      facts,
      fetch,
      env
    );
  else if (data.action === 'recovery')
    observed = await (dependencies.recoverRefund ?? recoverLiveFullRefund)(
      config,
      facts
    );
  else if (
    data.action === 'bound' &&
    typeof data.provider_refund_id === 'string'
  )
    observed = await (dependencies.fetchRefund ?? fetchLiveRefund)(
      config,
      facts,
      data.provider_refund_id
    );
  else throw new LiveRefundReviewRequired('Live refund needs review');
  if (!observed)
    throw new LiveRefundReviewRequired('Live refund recovery needs review');
  const stored = await admin.rpc('subscription_observe_live_refund', {
    p_refund_request_id: input.refundRequestId,
    p_provider_payment_id: facts.paymentId,
    p_provider_refund_id: observed.id,
    p_provider_merchant_id: config.merchantId,
    p_amount_minor: facts.amountMinor,
    p_currency: 'INR',
    p_status: observed.status,
  });
  if (
    stored.error ||
    !record(stored.data) ||
    stored.data.refund_request_id !== input.refundRequestId ||
    stored.data.provider_refund_id !== observed.id
  )
    throw new LiveRefundReviewRequired('Live refund observation needs review');
  if (observed.status !== 'processed')
    return { status: observed.status, refundId: observed.id };
  await (dependencies.fetchSettled ?? fetchSettledLiveFullRefund)(
    config,
    facts,
    observed.id
  );
  const committed = await admin.rpc('subscription_commit_live_full_refund', {
    p_refund_request_id: input.refundRequestId,
    p_provider_payment_id: facts.paymentId,
    p_provider_refund_id: observed.id,
    p_provider_merchant_id: config.merchantId,
    p_amount_minor: facts.amountMinor,
    p_currency: 'INR',
  });
  if (
    committed.error ||
    !record(committed.data) ||
    committed.data.refund_request_id !== input.refundRequestId ||
    committed.data.provider_refund_id !== observed.id ||
    (typeof committed.data.confirmed_at !== 'string' &&
      typeof committed.data.review_reason !== 'string')
  )
    throw new LiveRefundReviewRequired('Live refund settlement needs review');
  return {
    status: committed.data.review_reason ? 'review_required' : 'confirmed',
    refundId: observed.id,
  };
}

/** Read-only provider recovery for a signed refund delivery or held event. */
export async function reconcileLiveRefund(
  input: { paymentId: string; refundId: string },
  dependencies: {
    admin?: SupabaseClient;
    config?: LiveBillingConfig;
    fetchRefund?: typeof fetchLiveRefund;
    fetchSettled?: typeof fetchSettledLiveFullRefund;
  } = {}
) {
  const config = dependencies.config ?? liveBillingConfig();
  const admin = dependencies.admin ?? supabaseAdmin();
  const lookup = await admin.rpc('subscription_live_refund_for_payment', {
    p_provider_payment_id: input.paymentId,
    p_provider_refund_id: input.refundId,
    p_provider_merchant_id: config.merchantId,
    p_pilot_organization_id: config.pilotOrganizationId,
  });
  const row = lookup.data;
  if (
    lookup.error ||
    !record(row) ||
    typeof row.refund_request_id !== 'string' ||
    typeof row.request_id !== 'string' ||
    row.organization_id !== config.pilotOrganizationId ||
    row.provider_payment_id !== input.paymentId ||
    row.provider_refund_id !== input.refundId ||
    typeof row.provider_order_id !== 'string' ||
    typeof row.amount_minor !== 'number' ||
    !Number.isSafeInteger(row.amount_minor) ||
    row.amount_minor < 1 ||
    row.currency !== 'INR'
  )
    throw new Error('Live refund is not bound to this merchant and pilot');
  if (row.confirmed_at || row.review_reason)
    return { status: row.review_reason ? 'review_required' : 'confirmed' };
  const facts: LiveRefundFacts = {
    refundRequestId: row.refund_request_id,
    requestId: row.request_id,
    organizationId: config.pilotOrganizationId,
    paymentId: input.paymentId,
    orderId: row.provider_order_id,
    amountMinor: row.amount_minor,
  };
  const observed = await (dependencies.fetchRefund ?? fetchLiveRefund)(
    config,
    facts,
    input.refundId
  );
  const saved = await admin.rpc('subscription_observe_live_refund', {
    p_refund_request_id: facts.refundRequestId,
    p_provider_payment_id: facts.paymentId,
    p_provider_refund_id: input.refundId,
    p_provider_merchant_id: config.merchantId,
    p_amount_minor: facts.amountMinor,
    p_currency: 'INR',
    p_status: observed.status,
  });
  if (
    saved.error ||
    !record(saved.data) ||
    saved.data.provider_refund_id !== input.refundId
  )
    throw new Error('Live refund observation was not saved');
  if (observed.status !== 'processed') return { status: observed.status };
  await (dependencies.fetchSettled ?? fetchSettledLiveFullRefund)(
    config,
    facts,
    input.refundId
  );
  const committed = await admin.rpc('subscription_commit_live_full_refund', {
    p_refund_request_id: facts.refundRequestId,
    p_provider_payment_id: facts.paymentId,
    p_provider_refund_id: input.refundId,
    p_provider_merchant_id: config.merchantId,
    p_amount_minor: facts.amountMinor,
    p_currency: 'INR',
  });
  if (
    committed.error ||
    !record(committed.data) ||
    committed.data.provider_refund_id !== input.refundId ||
    (typeof committed.data.confirmed_at !== 'string' &&
      typeof committed.data.review_reason !== 'string')
  )
    throw new Error('Live refund settlement was not committed or held');
  return {
    status: committed.data.review_reason ? 'review_required' : 'confirmed',
  };
}
