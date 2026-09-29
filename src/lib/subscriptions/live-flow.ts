import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  fetchCapturedLivePayment,
  liveBillingConfig,
  liveSettlementsEnabled,
  type LiveBillingConfig,
} from './live-provider';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Signed delivery plus fresh Live GET precede the separate service-only commit. */
export async function settleCapturedLivePayment(
  input: { orderId: string; paymentId: string; captureEventAt: string },
  dependencies: {
    admin?: SupabaseClient;
    config?: LiveBillingConfig;
    fetchPayment?: typeof fetchCapturedLivePayment;
    env?: NodeJS.ProcessEnv;
  } = {}
) {
  const env = dependencies.env ?? process.env;
  if (!liveSettlementsEnabled(env))
    throw new Error('Live settlement is disabled');
  if (!Number.isFinite(Date.parse(input.captureEventAt)))
    throw new Error('Signed Live capture event time required');
  const config = dependencies.config ?? liveBillingConfig(env);
  const admin = dependencies.admin ?? supabaseAdmin();
  const { data, error } = await admin.rpc(
    'subscription_live_order_for_capture',
    {
      p_provider_order_id: input.orderId,
      p_provider_merchant_id: config.merchantId,
      p_pilot_organization_id: config.pilotOrganizationId,
    }
  );
  if (
    error ||
    !record(data) ||
    data.provider_order_id !== input.orderId ||
    data.provider_merchant_id !== config.merchantId ||
    data.organization_id !== config.pilotOrganizationId ||
    typeof data.request_id !== 'string' ||
    typeof data.amount_minor !== 'number' ||
    !Number.isSafeInteger(data.amount_minor) ||
    data.amount_minor < 1 ||
    data.currency !== 'INR'
  )
    throw new Error('Live order is not a bound pilot quote');
  const replay = await admin.rpc('subscription_live_payment_replay_status', {
    p_provider_order_id: input.orderId,
    p_provider_payment_id: input.paymentId,
    p_provider_merchant_id: config.merchantId,
    p_pilot_organization_id: config.pilotOrganizationId,
  });
  if (replay.error) throw new Error('Live payment replay lookup failed');
  if (replay.data !== null) {
    if (
      !record(replay.data) ||
      !['verified', 'review_required'].includes(String(replay.data.status)) ||
      replay.data.request_id !== data.request_id ||
      replay.data.organization_id !== config.pilotOrganizationId ||
      replay.data.provider_payment_id !== input.paymentId
    )
      throw new Error('Live payment replay changed identity');
    return {
      status: replay.data.status as 'verified' | 'review_required',
      organizationId: config.pilotOrganizationId,
      requestId: data.request_id,
      paymentId: input.paymentId,
    };
  }
  await (dependencies.fetchPayment ?? fetchCapturedLivePayment)(config, {
    requestId: data.request_id,
    organizationId: config.pilotOrganizationId,
    orderId: input.orderId,
    paymentId: input.paymentId,
    amountMinor: data.amount_minor,
  });
  const { data: result, error: commitError } = await admin.rpc(
    'subscription_commit_live_initial_payment',
    {
      p_request_id: data.request_id,
      p_provider_order_id: input.orderId,
      p_provider_payment_id: input.paymentId,
      p_provider_merchant_id: config.merchantId,
      p_amount_minor: data.amount_minor,
      p_currency: 'INR',
      p_capture_event_at: input.captureEventAt,
    }
  );
  if (
    commitError ||
    !record(result) ||
    !['verified', 'review_required'].includes(String(result.status)) ||
    result.organization_id !== config.pilotOrganizationId ||
    result.request_id !== data.request_id ||
    result.provider_payment_id !== input.paymentId
  )
    throw new Error('Live payment was not committed or held');
  return {
    status: result.status as 'verified' | 'review_required',
    organizationId: config.pilotOrganizationId,
    requestId: data.request_id,
    paymentId: input.paymentId,
  };
}
