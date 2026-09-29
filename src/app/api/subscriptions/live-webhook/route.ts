import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { settleCapturedLivePayment } from '@/lib/subscriptions/live-flow';
import { reconcileLiveRefund } from '@/lib/subscriptions/live-refunds';
import {
  classifyLiveWebhookOrder,
  fetchLivePaymentOrderId,
  liveBillingConfig,
  liveRefundReconciliationEnabled,
  liveSettlementsEnabled,
  verifyLiveWebhookSignature,
} from '@/lib/subscriptions/live-provider';

export const runtime = 'nodejs';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Live SaaS deliveries are held durably; no delivery grants access or refunds. */
export async function POST(request: Request) {
  let config;
  try {
    config = liveBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > 1_000_000)
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  if (
    !verifyLiveWebhookSignature(
      raw,
      request.headers.get('x-razorpay-signature'),
      config
    )
  )
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });

  let event: unknown;
  try {
    event = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
  }
  if (!record(event) || event.account_id !== config.merchantId)
    return NextResponse.json({ error: 'Wrong merchant' }, { status: 403 });

  const type = event.event;
  if (
    ![
      'payment.captured',
      'payment.failed',
      'refund.created',
      'refund.processed',
      'refund.failed',
    ].includes(String(type))
  )
    return NextResponse.json({ received: true });

  const payload = record(event.payload) ? event.payload : null;
  const payment =
    payload && record(payload.payment) && record(payload.payment.entity)
      ? payload.payment.entity
      : null;
  const refund =
    payload && record(payload.refund) && record(payload.refund.entity)
      ? payload.refund.entity
      : null;
  const isRefund = typeof type === 'string' && type.startsWith('refund.');
  const eventAt =
    Number.isSafeInteger(event.created_at) &&
    (event.created_at as number) > 1_577_836_800 &&
    (event.created_at as number) * 1000 <= Date.now() + 300_000
      ? new Date((event.created_at as number) * 1000).toISOString()
      : null;
  const paymentId = isRefund ? refund?.payment_id : payment?.id;
  const refundId = isRefund ? refund?.id : null;
  if (
    typeof paymentId !== 'string' ||
    !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
    (isRefund &&
      (typeof refundId !== 'string' || !/^rfnd_[A-Za-z0-9]+$/.test(refundId)))
  )
    return NextResponse.json({ error: 'Invalid event' }, { status: 400 });

  const digest = createHash('sha256').update(raw).digest('hex');
  const eventId = request.headers.get('x-razorpay-event-id') ?? digest;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
    return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });

  try {
    const orderId =
      isRefund || payment?.order_id == null
        ? await fetchLivePaymentOrderId(config, paymentId)
        : payment?.order_id;
    // SaaS Checkout is always order-bound. Confirm a missing webhook order
    // against the provider before treating it as another merchant flow.
    if (orderId === null)
      return NextResponse.json({ received: true, unrelated: true });
    if (typeof orderId !== 'string' || !/^order_[A-Za-z0-9]+$/.test(orderId))
      return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
    if ((await classifyLiveWebhookOrder(config, orderId)) === 'unrelated')
      return NextResponse.json({ received: true, unrelated: true });
    const { data, error } = await supabaseAdmin().rpc(
      'subscription_record_live_webhook_event',
      {
        p_merchant_id: config.merchantId,
        p_pilot_organization_id: config.pilotOrganizationId,
        p_event_id: eventId,
        p_event_type: type,
        p_provider_order_id: orderId,
        p_provider_payment_id: paymentId,
        p_provider_refund_id: refundId,
        p_body_sha256: digest,
        p_provider_event_at: eventAt,
      }
    );
    if (
      error ||
      !record(data) ||
      !['held', 'duplicate'].includes(String(data.status))
    )
      throw new Error('Live webhook event was not saved');
    if (type === 'payment.failed') {
      const marked = await supabaseAdmin().rpc(
        'subscription_mark_live_event_reconciled',
        {
          p_provider_merchant_id: config.merchantId,
          p_pilot_organization_id: config.pilotOrganizationId,
          p_event_id: eventId,
          p_body_sha256: digest,
        }
      );
      if (
        marked.error ||
        !record(marked.data) ||
        marked.data.state !== 'reconciled'
      )
        throw new Error('Failed Live payment event was not marked');
    }
    if (type === 'payment.captured' && eventAt && liveSettlementsEnabled())
      await settleCapturedLivePayment({
        orderId,
        paymentId,
        captureEventAt: eventAt,
      });
    if (isRefund && liveRefundReconciliationEnabled())
      await reconcileLiveRefund({ paymentId, refundId: refundId as string });
    return NextResponse.json({ received: true });
  } catch {
    // A non-2xx response asks the provider to retry; no event is acknowledged
    // before its exact merchant/order/event identity is durable.
    return NextResponse.json({ error: 'Retry later' }, { status: 503 });
  }
}
