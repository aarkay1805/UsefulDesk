// ============================================================
// Meta Lead Ads webhook — /api/meta/leads/webhook
//
// Meta considers a successful response a delivered lead, so ingestion stays
// inline. Durable, tenant-owned leases make retries safe and let the recovery
// cron resume events that Meta no longer retries.
// ============================================================

import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  processOwnedMetaLeadEvent,
  type LeadgenValue,
} from '@/lib/meta/lead-ingestion';
import { resolveMetaLeadgenVerifyToken } from '@/lib/meta/webhook-verify-token';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Meta's app-level subscription handshake. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const expected = resolveMetaLeadgenVerifyToken();

  if (!expected) {
    console.error(
      '[meta-leads] no webhook verification credential is configured — ' +
        'rejecting the handshake. Set META_LEADGEN_VERIFY_TOKEN or ' +
        'META_APP_SECRET, then re-verify the Page webhook in Meta.'
    );
    return new Response('Forbidden', { status: 403 });
  }

  if (searchParams.get('hub.mode') !== 'subscribe') {
    return new Response('Bad Request', { status: 400 });
  }

  const presented = searchParams.get('hub.verify_token') ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return new Response('Forbidden', { status: 403 });
  }

  const challenge = searchParams.get('hub.challenge') ?? '';
  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(request: Request) {
  // The signature covers the raw bytes, not a re-encoded JSON body.
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: {
    object?: string;
    entry?: { changes?: { field?: string; value?: LeadgenValue }[] }[];
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.object !== 'page') {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const admin = supabaseAdmin();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;

      const value = change.value ?? {};
      const leadgenId = value.leadgen_id;
      const pageId = value.page_id;
      if (!leadgenId || !pageId) continue;

      const eventId = `meta:leadgen:${leadgenId}`;
      const { data: config, error: configError } = await admin
        .from('meta_page_config')
        .select('id, account_id')
        .eq('page_id', pageId)
        .maybeSingle();

      if (configError) {
        console.error('[meta-leads] configured Page lookup failed');
        return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
      }
      if (!config) {
        // Unknown Pages cannot be assigned safely. A retry cannot create the
        // missing tenant relationship, so acknowledge without storing data.
        console.warn('[meta-leads] delivery for unconfigured Page ignored');
        continue;
      }

      const accountId = config.account_id as string;
      const processingOwner = crypto.randomUUID();
      const { data: claim, error: claimError } = await admin.rpc(
        'claim_meta_lead_webhook_event_owned',
        {
          p_event_id: eventId,
          p_account_id: accountId,
          p_payload: value,
          p_processing_owner: processingOwner,
          p_lease_seconds: 300,
        }
      );

      if (claimError) {
        console.error('[meta-leads] event claim failed');
        return NextResponse.json({ error: 'Claim failed' }, { status: 500 });
      }
      if (claim === 'processed') continue;
      if (claim !== 'claimed') {
        console.warn('[meta-leads] event claim unavailable');
        return NextResponse.json(
          { error: 'Claim unavailable' },
          { status: 500 }
        );
      }

      try {
        await processOwnedMetaLeadEvent({
          admin,
          event: { eventId, accountId, payload: value },
          processingOwner,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Meta lead processing failed';
        const { data: failed, error: failError } = await admin.rpc(
          'fail_meta_lead_webhook_event_owned',
          {
            p_event_id: eventId,
            p_account_id: accountId,
            p_processing_owner: processingOwner,
            p_error: message,
          }
        );
        if (failError || failed !== true) {
          console.error('[meta-leads] failed to retain owned retry state');
        }
        console.error('[meta-leads] lead ingestion failed');
        return NextResponse.json({ error: 'Ingest failed' }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
