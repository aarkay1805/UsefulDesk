import { NextResponse } from 'next/server';

import { verifyWebhookSignature } from '@/lib/payments/razorpay';
import {
  buildRazorpayWebhookObservation,
  RazorpayWebhookObservationError,
} from '@/lib/payments/razorpay-webhook-observation';

export const runtime = 'nodejs';

/**
 * Observation-only Razorpay application webhook used for Stage 0A provider
 * acceptance. It is deliberately incapable of database or financial writes.
 * The eventual application-ingress processor replaces this handler in Stage 2.
 */
export async function POST(request: Request) {
  if (
    process.env.RAZORPAY_MODE !== 'test' ||
    process.env.RAZORPAY_PROVIDER_ACCEPTANCE_ONLY !== 'true'
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET_CURRENT;
  if (!secret) {
    console.error(
      '[razorpay application webhook] acceptance secret is not configured'
    );
    return NextResponse.json(
      { error: 'Webhook is not configured' },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const observation = buildRazorpayWebhookObservation(
      rawBody,
      request.headers.get('x-razorpay-event-id')
    );
    console.info(JSON.stringify(observation));
    return NextResponse.json({ ok: true, observed: true });
  } catch (error) {
    if (error instanceof RazorpayWebhookObservationError) {
      const status = error.code === 'payload_too_large' ? 413 : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    throw error;
  }
}
