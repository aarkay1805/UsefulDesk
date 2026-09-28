import { NextResponse } from 'next/server';

import {
  confirmTestPayment,
  recordTestRenewalFailure,
} from '@/lib/subscriptions/test-flow';
import {
  testBillingConfig,
  verifyTestWebhookSignature,
} from '@/lib/subscriptions/test-provider';

export const runtime = 'nodejs';

/** Separate Usefulmade Test webhook; gym collection events use another route. */
export async function POST(request: Request) {
  let config;
  try {
    config = testBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > 1_000_000)
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  if (
    !verifyTestWebhookSignature(
      raw,
      request.headers.get('x-razorpay-signature'),
      config
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
  const event = value as Record<string, unknown>;
  if (event.account_id !== config.merchantId)
    return NextResponse.json({ error: 'Wrong merchant' }, { status: 403 });
  if (event.event !== 'payment.captured' && event.event !== 'payment.failed')
    return NextResponse.json({ received: true });
  const payload = event.payload as {
    payment?: { entity?: Record<string, unknown> };
  } | null;
  const payment = payload?.payment?.entity;
  if (
    !payment ||
    typeof payment.id !== 'string' ||
    !/^pay_[A-Za-z0-9]+$/.test(payment.id) ||
    typeof payment.order_id !== 'string' ||
    !/^order_[A-Za-z0-9]+$/.test(payment.order_id)
  ) {
    return NextResponse.json(
      { error: 'Invalid payment event' },
      { status: 400 }
    );
  }
  try {
    if (event.event === 'payment.failed') {
      await recordTestRenewalFailure({
        orderId: payment.order_id,
        paymentId: payment.id,
      });
    } else
      await confirmTestPayment({
        source: 'webhook',
        orderId: payment.order_id,
        paymentId: payment.id,
      });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[subscription Test webhook] processing failed:', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Retry later' }, { status: 503 });
  }
}
