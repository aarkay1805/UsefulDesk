// Legacy per-account Razorpay ingress. Signature verification and durable
// observation remain active after cutover; the database selector decides
// whether this route may enter the shared canonical processor.

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getRazorpayLegacyWebhookBinding } from '@/lib/payments/credentials';
import { verifyWebhookSignature } from '@/lib/payments/razorpay';
import { getRazorpayProviderMode } from '@/lib/payments/razorpay-config';
import {
  buildRazorpayWebhookDeliveryIdentity,
  recordRazorpayWebhookDelivery,
} from '@/lib/payments/razorpay-webhook-delivery';
import {
  parseRazorpayEvent,
  processCanonicalRazorpayWebhook,
} from '@/lib/payments/razorpay-webhook-processor';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params;
  const admin = supabaseAdmin();
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  const binding = await getRazorpayLegacyWebhookBinding(admin, accountId);
  if (!binding) {
    return NextResponse.json(
      { error: 'Webhook not configured for this account' },
      { status: 400 }
    );
  }
  if (!verifyWebhookSignature(rawBody, signature, binding.secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event;
  try {
    event = parseRazorpayEvent(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  if (event.account_id && event.account_id !== binding.externalAccountId) {
    return NextResponse.json(
      { error: 'Webhook account does not match this endpoint' },
      { status: 400 }
    );
  }

  const providerMode = getRazorpayProviderMode();
  const identity = buildRazorpayWebhookDeliveryIdentity({
    rawBody,
    headerEventId: request.headers.get('x-razorpay-event-id'),
    providerMode,
    externalAccountId: binding.externalAccountId,
  });
  try {
    await recordRazorpayWebhookDelivery(admin, {
      providerMode,
      identity,
      ingress: 'legacy_account',
      externalAccountId: binding.externalAccountId,
      accountId,
      signatureSecretGeneration: 'account',
      shadowOnly: binding.canonicalIngress !== 'legacy_account',
    });
  } catch (error) {
    console.error('[razorpay webhook] delivery observation failed:', error);
    return NextResponse.json(
      { error: 'Could not persist delivery observation' },
      { status: 500 }
    );
  }

  if (binding.canonicalIngress !== 'legacy_account') {
    return NextResponse.json({ ok: true, observed: true });
  }

  let result;
  try {
    result = await processCanonicalRazorpayWebhook({
      admin,
      accountId,
      externalAccountId: binding.externalAccountId,
      providerMode,
      identity,
      ingress: 'legacy_account',
      event,
    });
  } catch (error) {
    console.error('[razorpay webhook] event state persistence failed:', error);
    return NextResponse.json(
      { error: 'Could not persist event state' },
      { status: 500 }
    );
  }

  switch (result.outcome) {
    case 'processed':
      return NextResponse.json({ ok: true });
    case 'duplicate':
      return NextResponse.json({ ok: true, deduped: true });
    case 'busy':
      return NextResponse.json({ ok: true, processing: true });
    case 'conflict':
      return NextResponse.json(
        { error: 'Event id conflicts with another canonical event' },
        { status: 409 }
      );
    case 'failed':
      console.error('[razorpay webhook] handler failed:', result.error);
      return NextResponse.json(
        { error: 'Event processing failed; retry is safe' },
        { status: 500 }
      );
  }
}
