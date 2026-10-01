import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  fetchLiveRefund,
  fetchSettledLiveFullRefund,
  liveBillingConfig,
  liveRefundReconciliationEnabled,
  liveSettlementsEnabled,
  recoverLiveFullRefund,
  recoverLiveOrder,
  type LiveBillingConfig,
  type LiveRefundFacts,
} from './live-provider';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH_LIMIT = 5;

export function liveFinancialRecoveryEnabled(
  env: NodeJS.ProcessEnv = process.env
) {
  return (
    env.USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED === 'true' &&
    liveSettlementsEnabled(env) &&
    liveRefundReconciliationEnabled(env)
  );
}

type Outcome = 'recovered' | 'pending' | 'failed' | 'review_required' | 'retry';
type Reason =
  | 'order_bound_signed_event_required'
  | 'lookup_not_unique'
  | 'provider_lookup_unverified'
  | 'binding_rejected'
  | 'refund_pending'
  | 'refund_failed'
  | 'refund_review_required'
  | 'refund_parent_unverified'
  | 'refund_commit_rejected'
  | 'refund_confirmed'
  | 'invalid_claim'
  | 'lease_completion_rejected';
interface Observation {
  outcome: Outcome;
  reason: Reason;
}
interface RecoveryItem {
  item_type: 'order' | 'refund';
  item_id: string;
  lease_token: string;
  request_id: string;
  organization_id: string;
  provider_merchant_id: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  provider_refund_id: string | null;
  amount_minor: number;
  currency: 'INR';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validItem(
  value: unknown,
  config: LiveBillingConfig,
  leaseToken: string
): value is RecoveryItem {
  if (
    !record(value) ||
    !['order', 'refund'].includes(String(value.item_type)) ||
    typeof value.item_id !== 'string' ||
    !UUID.test(value.item_id) ||
    value.lease_token !== leaseToken ||
    typeof value.request_id !== 'string' ||
    !UUID.test(value.request_id) ||
    value.organization_id !== config.pilotOrganizationId ||
    value.provider_merchant_id !== config.merchantId ||
    value.amount_minor !== 79900 ||
    value.currency !== 'INR'
  )
    return false;
  return value.item_type === 'order'
    ? value.item_id === value.request_id &&
        value.provider_order_id === null &&
        value.provider_payment_id === null &&
        value.provider_refund_id === null
    : typeof value.provider_order_id === 'string' &&
        /^order_[A-Za-z0-9]+$/.test(value.provider_order_id) &&
        typeof value.provider_payment_id === 'string' &&
        /^pay_[A-Za-z0-9]+$/.test(value.provider_payment_id) &&
        (value.provider_refund_id === null ||
          (typeof value.provider_refund_id === 'string' &&
            /^rfnd_[A-Za-z0-9]+$/.test(value.provider_refund_id)));
}

interface Dependencies {
  admin?: SupabaseClient;
  config?: LiveBillingConfig;
  env?: NodeJS.ProcessEnv;
  leaseToken?: string;
  fetchImpl?: typeof fetch;
  batchLimit?: 1 | 5;
}

async function recoverItem(
  item: RecoveryItem,
  config: LiveBillingConfig,
  admin: SupabaseClient,
  fetchImpl: typeof fetch
): Promise<Observation> {
  let failure: Reason = 'provider_lookup_unverified';
  try {
    const facts = {
      requestId: item.request_id,
      organizationId: item.organization_id,
      amountMinor: item.amount_minor,
    };
    if (item.item_type === 'order') {
      const order = await recoverLiveOrder(config, facts, fetchImpl);
      if (!order)
        return { outcome: 'review_required', reason: 'lookup_not_unique' };
      failure = 'binding_rejected';
      const bound = await admin.rpc('subscription_bind_live_order', {
        p_request_id: item.request_id,
        p_provider_order_id: order.id,
        p_provider_merchant_id: config.merchantId,
        p_pilot_organization_id: config.pilotOrganizationId,
      });
      if (
        bound.error ||
        !record(bound.data) ||
        bound.data.request_id !== item.request_id ||
        bound.data.organization_id !== config.pilotOrganizationId ||
        bound.data.provider_order_id !== order.id
      )
        return { outcome: 'retry', reason: failure };
      // GET may discover a paid order, but cannot supply signed capture time or grant access.
      return {
        outcome: 'recovered',
        reason: 'order_bound_signed_event_required',
      };
    }
    const refundFacts: LiveRefundFacts = {
      ...facts,
      refundRequestId: item.item_id,
      orderId: item.provider_order_id!,
      paymentId: item.provider_payment_id!,
    };
    const refund = item.provider_refund_id
      ? await fetchLiveRefund(
          config,
          refundFacts,
          item.provider_refund_id,
          fetchImpl
        )
      : await recoverLiveFullRefund(config, refundFacts, fetchImpl);
    if (!refund)
      return { outcome: 'review_required', reason: 'lookup_not_unique' };
    failure = 'binding_rejected';
    const observed = await admin.rpc('subscription_observe_live_refund', {
      p_refund_request_id: item.item_id,
      p_provider_payment_id: refundFacts.paymentId,
      p_provider_refund_id: refund.id,
      p_provider_merchant_id: config.merchantId,
      p_amount_minor: item.amount_minor,
      p_currency: 'INR',
      p_status: refund.status,
    });
    if (
      observed.error ||
      !record(observed.data) ||
      observed.data.refund_request_id !== item.item_id ||
      observed.data.provider_refund_id !== refund.id
    )
      return { outcome: 'retry', reason: failure };
    if (observed.data.state === 'review_required')
      return { outcome: 'review_required', reason: 'refund_review_required' };
    if (refund.status !== 'processed')
      return {
        outcome: refund.status,
        reason:
          refund.status === 'pending' ? 'refund_pending' : 'refund_failed',
      };
    failure = 'refund_parent_unverified';
    await fetchSettledLiveFullRefund(config, refundFacts, refund.id, fetchImpl);
    failure = 'refund_commit_rejected';
    const committed = await admin.rpc('subscription_commit_live_full_refund', {
      p_refund_request_id: item.item_id,
      p_provider_payment_id: refundFacts.paymentId,
      p_provider_refund_id: refund.id,
      p_provider_merchant_id: config.merchantId,
      p_amount_minor: item.amount_minor,
      p_currency: 'INR',
    });
    if (
      committed.error ||
      !record(committed.data) ||
      committed.data.refund_request_id !== item.item_id ||
      committed.data.provider_refund_id !== refund.id ||
      (typeof committed.data.confirmed_at !== 'string' &&
        typeof committed.data.review_reason !== 'string')
    )
      return { outcome: 'retry', reason: failure };
    return committed.data.review_reason
      ? { outcome: 'review_required', reason: 'refund_review_required' }
      : { outcome: 'recovered', reason: 'refund_confirmed' };
  } catch {
    // Provider bodies, database diagnostics and credentials must never enter the exception register.
    return { outcome: 'retry', reason: failure };
  }
}

/** Recover original durable obligations using provider GET only; initiation may remain closed. */
export async function recoverLiveFinancialObligations(
  dependencies: Dependencies = {}
) {
  const env = dependencies.env ?? process.env;
  if (!liveFinancialRecoveryEnabled(env))
    throw new Error('Live financial recovery is disabled');
  const configured = liveBillingConfig(env);
  const config = dependencies.config ?? configured;
  if (
    Object.keys(configured).some(
      (key) =>
        config[key as keyof LiveBillingConfig] !==
        configured[key as keyof LiveBillingConfig]
    )
  )
    throw new Error('Live financial recovery configuration changed');
  const admin = dependencies.admin ?? supabaseAdmin();
  const batchLimit = dependencies.batchLimit ?? BATCH_LIMIT;
  if (batchLimit !== 1 && batchLimit !== BATCH_LIMIT)
    throw new Error('Invalid recovery batch limit');
  const leaseToken = dependencies.leaseToken ?? randomUUID();
  if (!UUID.test(leaseToken)) throw new Error('Invalid recovery lease');
  const claimed = await admin.rpc('subscription_claim_live_recovery_items', {
    p_provider_merchant_id: config.merchantId,
    p_pilot_organization_id: config.pilotOrganizationId,
    p_limit: batchLimit,
    p_lease_token: leaseToken,
  });
  if (
    claimed.error ||
    !Array.isArray(claimed.data) ||
    claimed.data.length > batchLimit
  )
    throw new Error('Live financial recovery scan failed');
  // Fail the changed contract before touching provider or financial RPCs.
  if (
    claimed.data.some((item) => !validItem(item, config, leaseToken)) ||
    new Set(
      claimed.data.map(
        (item: RecoveryItem) => `${item.item_type}:${item.item_id}`
      )
    ).size !== claimed.data.length
  )
    throw new Error('Live financial recovery claim changed identity');
  const items: Array<{
    itemType: 'order' | 'refund';
    itemId: string;
    outcome: Outcome;
    reason: Reason;
    recorded: boolean;
  }> = [];
  for (const item of claimed.data as RecoveryItem[]) {
    let observation = await recoverItem(
      item,
      config,
      admin,
      dependencies.fetchImpl ?? fetch
    );
    let recorded = false;
    try {
      const finished = await admin.rpc(
        'subscription_finish_live_recovery_item',
        {
          p_item_type: item.item_type,
          p_item_id: item.item_id,
          p_lease_token: leaseToken,
          p_provider_merchant_id: config.merchantId,
          p_pilot_organization_id: config.pilotOrganizationId,
          p_outcome: observation.outcome,
          p_reason: observation.reason,
        }
      );
      const recoveredReason =
        item.item_type === 'order'
          ? 'order_bound_signed_event_required'
          : 'refund_confirmed';
      const canonicalCompletion =
        record(finished.data) &&
        finished.data.outcome === 'recovered' &&
        finished.data.reason === recoveredReason &&
        finished.data.completed === true;
      const canonicalHold =
        item.item_type === 'refund' &&
        record(finished.data) &&
        finished.data.outcome === 'review_required' &&
        finished.data.reason === 'refund_review_required' &&
        finished.data.completed === true;
      recorded =
        !finished.error &&
        record(finished.data) &&
        finished.data.item_id === item.item_id &&
        finished.data.item_type === item.item_type &&
        ((finished.data.outcome === observation.outcome &&
          finished.data.reason === observation.reason &&
          finished.data.completed === (observation.outcome === 'recovered')) ||
          canonicalCompletion ||
          canonicalHold);
      // Genuine webhook/reconciliation can complete the same obligation during our GET.
      if (recorded && canonicalCompletion)
        observation = { outcome: 'recovered', reason: recoveredReason };
      else if (recorded && canonicalHold)
        observation = {
          outcome: 'review_required',
          reason: 'refund_review_required',
        };
    } catch {
      /* The durable lease expires; a later scan can replay idempotent binding/commit. */
    }
    items.push({
      itemType: item.item_type,
      itemId: item.item_id,
      ...(recorded
        ? observation
        : {
            outcome: 'retry' as const,
            reason: 'lease_completion_rejected' as const,
          }),
      recorded,
    });
  }
  return {
    inspected: items.length,
    recovered: items.filter((item) => item.outcome === 'recovered').length,
    exceptions: items.filter((item) => item.outcome !== 'recovered').length,
    failed: items.filter((item) => item.outcome === 'retry').length,
    items,
  };
}
