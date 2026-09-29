import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { settleCapturedLivePayment } from '@/lib/subscriptions/live-flow';
import {
  liveBillingConfig,
  liveRefundReconciliationEnabled,
  liveSettlementsEnabled,
} from '@/lib/subscriptions/live-provider';
import { reconcileLiveRefund } from '@/lib/subscriptions/live-refunds';

export const runtime = 'nodejs';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Manual/cron recovery of previously acknowledged, held Live deliveries. */
export async function POST(request: Request) {
  if (!liveSettlementsEnabled() && !liveRefundReconciliationEnabled())
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!cronSecretConfigured() || !isAuthorizedCronRequest(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let config;
  try {
    config = liveBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const admin = supabaseAdmin();
  const pending = await admin.rpc('subscription_list_live_held_events', {
    p_provider_merchant_id: config.merchantId,
    p_pilot_organization_id: config.pilotOrganizationId,
    p_limit: 5,
    p_capture_enabled: liveSettlementsEnabled(),
    p_refund_enabled: liveRefundReconciliationEnabled(),
  });
  if (pending.error || !Array.isArray(pending.data))
    return NextResponse.json({ error: 'Retry later' }, { status: 503 });
  let reconciled = 0;
  let failed = 0;
  for (const event of pending.data) {
    if (
      !record(event) ||
      typeof event.event_id !== 'string' ||
      typeof event.body_sha256 !== 'string' ||
      typeof event.provider_order_id !== 'string' ||
      typeof event.provider_payment_id !== 'string' ||
      event.organization_id !== config.pilotOrganizationId
    ) {
      failed += 1;
      continue;
    }
    try {
      if (event.event_type === 'payment.captured' && liveSettlementsEnabled()) {
        if (typeof event.provider_event_at !== 'string') {
          failed += 1;
          continue;
        }
        await settleCapturedLivePayment({
          orderId: event.provider_order_id,
          paymentId: event.provider_payment_id,
          captureEventAt: event.provider_event_at,
        });
      } else if (
        typeof event.event_type === 'string' &&
        event.event_type.startsWith('refund.') &&
        typeof event.provider_refund_id === 'string' &&
        liveRefundReconciliationEnabled()
      )
        await reconcileLiveRefund({
          paymentId: event.provider_payment_id,
          refundId: event.provider_refund_id,
        });
      else continue;
      const marked = await admin.rpc(
        'subscription_mark_live_event_reconciled',
        {
          p_provider_merchant_id: config.merchantId,
          p_pilot_organization_id: config.pilotOrganizationId,
          p_event_id: event.event_id,
          p_body_sha256: event.body_sha256,
        }
      );
      if (
        marked.error ||
        !record(marked.data) ||
        marked.data.state !== 'reconciled'
      )
        throw new Error('Live event was not marked reconciled');
      reconciled += 1;
    } catch {
      failed += 1;
    }
  }
  return NextResponse.json(
    { inspected: pending.data.length, reconciled, failed },
    { status: failed ? 503 : 200 }
  );
}
