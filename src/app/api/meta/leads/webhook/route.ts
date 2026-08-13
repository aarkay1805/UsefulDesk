// ============================================================
// Meta Lead Ads webhook — /api/meta/leads/webhook
//
// Facebook/Instagram lead ads deliver on the `page` object, and Meta
// gives every webhook object its own callback URL + verify token. So
// this cannot be a branch inside the WhatsApp webhook: it is a separate
// route, with a separate handshake, sharing only the app secret.
//
// WHY THIS PROCESSES INLINE INSTEAD OF IN after()
// The WhatsApp webhook responds 200 immediately and does its work in
// after(), because inbound message processing fans out to per-media
// Graph calls. Copying that here would be actively harmful: once we
// have returned 200, Meta considers the lead delivered and never
// retries — so any failure afterwards loses the lead FOREVER. A leadgen
// delivery is one Graph GET plus a few writes (well inside Meta's
// window), so we do the work first and let the status code tell the
// truth. On failure we return 500 and Meta retries with backoff for up
// to 36 hours. A lost lead is unrecoverable revenue; that is the entire
// point of the feature.
//
// IDEMPOTENCY
// Meta redelivers aggressively. Each lead is lease-claimed in
// webhook_events (the pattern from the Razorpay webhook) before any work.
// Contact + note capture is atomic and its original creation result stays
// on that durable event, so a failed delivery resumes safely. Only a
// processed event is a permanent 200 no-op.
// ============================================================

import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { addContactTags, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { normalizeSubmittedPhone } from '@/lib/leads/capture-form';
import { mapMetaLeadFields } from '@/lib/leads/meta-field-mapping';
import { decrypt } from '@/lib/whatsapp/encryption';
import { fetchLeadgenLead } from '@/lib/whatsapp/meta-api';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface LeadgenValue {
  leadgen_id?: string;
  page_id?: string;
  form_id?: string;
  ad_id?: string;
  created_time?: number;
}

type MetaLeadCaptureResult = {
  contact_id: string;
  created_contact: boolean;
  automation_dispatched: boolean;
};

/**
 * GET — Meta's subscription handshake.
 *
 * The WhatsApp route brute-force-decrypts every account's saved
 * verify_token out of whatsapp_config, which works only because each
 * tenant pasted one. A Page webhook is configured ONCE, app-level, in
 * the Meta App Dashboard, so the token lives in an env var.
 *
 * Fails closed when unset — same posture as the signature check.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const expected = process.env.META_LEADGEN_VERIFY_TOKEN;

  if (!expected) {
    console.error(
      '[meta-leads] META_LEADGEN_VERIFY_TOKEN is not set — rejecting the ' +
        'handshake. Set it, then re-verify the Page webhook in the Meta ' +
        'App Dashboard.'
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
  // Read the RAW body before parsing — request.json() re-encodes and the
  // HMAC would no longer match.
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    // Deliberately 401, not 200: a rejected signature should show up as
    // a failure in Meta's dashboard rather than being silently accepted.
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

  // A Page webhook can carry feed posts, mentions, messages… Take only
  // leadgen, and only from the page object.
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

      // ---- resolve the tenant -------------------------------------
      const { data: config, error: configError } = await admin
        .from('meta_page_config')
        .select('id, account_id, page_access_token')
        .eq('page_id', pageId)
        .maybeSingle();

      if (configError) {
        console.error('[meta-leads] config lookup failed:', configError);
        return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
      }
      if (!config) {
        // A page nobody has claimed. 200 (not 500) — retrying would never
        // help, and a permanent 500 makes Meta disable the subscription.
        console.warn('[meta-leads] no account for page', pageId);
        continue;
      }

      const accountId = config.account_id as string;

      // ---- claim it ------------------------------------------------
      // The database owns the retry lease and retains any prior atomic
      // capture result. A processed redelivery remains a permanent no-op;
      // a failed/stale delivery resumes with its original created_contact
      // state instead of inferring it again from the contacts table.
      const { data: claim, error: claimError } = await admin.rpc(
        'claim_meta_lead_webhook_event',
        {
          p_event_id: eventId,
          p_account_id: accountId,
          p_payload: value,
        }
      );

      if (claimError) {
        console.error('[meta-leads] claim failed:', claimError);
        return NextResponse.json({ error: 'Claim failed' }, { status: 500 });
      }
      if (claim === 'processed') continue;
      if (claim !== 'claimed') {
        console.warn('[meta-leads] event claim unavailable', eventId, claim);
        return NextResponse.json(
          { error: 'Claim unavailable' },
          { status: 500 }
        );
      }

      try {
        const accessToken = decrypt(config.page_access_token as string);
        const lead = await fetchLeadgenLead({ leadgenId, accessToken });
        const mapped = mapMetaLeadFields(lead.field_data ?? []);

        // ---- no phone → skip, and TELL the gym ---------------------
        // contacts.phone is NOT NULL, and a phone-less lead is
        // unreachable on the WhatsApp wedge anyway. Rather than drop it
        // silently, count it: Settings surfaces "N leads skipped — your
        // Meta form doesn't ask for a phone number", which is a problem
        // the gym can actually fix in Ads Manager.
        if (!mapped.phone) {
          const { data: current } = await admin
            .from('meta_page_config')
            .select('skipped_no_phone')
            .eq('id', config.id)
            .maybeSingle();
          await admin
            .from('meta_page_config')
            .update({
              skipped_no_phone:
                ((current?.skipped_no_phone as number) ?? 0) + 1,
            })
            .eq('id', config.id);

          const { data: completed, error: completeError } = await admin.rpc(
            'complete_meta_lead_webhook_event',
            {
              p_event_id: eventId,
              p_account_id: accountId,
              p_processing_context: {
                meta_lead: { skipped: 'no_phone' },
              },
            }
          );
          if (completeError || completed !== true) {
            throw new Error('Failed to complete skipped Meta lead event');
          }

          console.warn('[meta-leads] lead has no phone, skipped', leadgenId);
          continue;
        }

        // Meta usually prefills +91… from the profile, but a MANUALLY
        // typed answer is raw text and just as likely to be 10 bare
        // digits — which stores clean and is then unmessageable forever.
        // Same normalizer the capture form uses.
        const { data: account } = await admin
          .from('accounts')
          .select('phone_country_code')
          .eq('id', accountId)
          .maybeSingle();

        const phone =
          normalizeSubmittedPhone(
            mapped.phone,
            (account?.phone_country_code as string) ?? ''
          ) ?? mapped.phone;

        const auditUserId = await resolveAuditUserId(admin, accountId);

        // One transaction owns the complete durable capture boundary. It
        // creates/dedupes the contact, writes exactly one enquiry note for
        // this Meta delivery, and stores the ORIGINAL created flag on the
        // event. A partial retry therefore resumes instead of reclassifying
        // the lead as an existing-contact enquiry.
        const { data: capture, error: captureError } = await admin
          .rpc('capture_meta_lead_webhook_event', {
            p_event_id: eventId,
            p_account_id: accountId,
            p_audit_user_id: auditUserId,
            p_phone: phone,
            p_name: mapped.name,
            p_email: mapped.email,
            // Instagram and Facebook lead ads are the same webhook but a
            // different acquisition channel, and the gym reports on them
            // separately.
            p_source: lead.platform === 'ig' ? 'instagram' : 'facebook',
            p_note_details: mapped.extras
              .map((e) => `${e.label}: ${e.value}`)
              .join('\n'),
          })
          .single();
        if (captureError || !capture) {
          console.error('[meta-leads] atomic capture failed:', captureError);
          throw new Error('Atomic Meta lead capture failed');
        }
        const {
          contact_id: contactId,
          created_contact: created,
          automation_dispatched: automationDispatched,
        } = capture as MetaLeadCaptureResult;

        if (created && !automationDispatched) {
          await runAutomationsForTrigger({
            accountId,
            triggerType: 'new_contact_created',
            contactId,
          });
          const { data: marked, error: markError } = await admin.rpc(
            'mark_meta_lead_automation_dispatched',
            {
              p_event_id: eventId,
              p_account_id: accountId,
            }
          );
          if (markError || marked !== true) {
            throw new Error('Failed to retain Meta automation dispatch state');
          }
        }

        // Meta's own goal answers are free text — tag only what matches a
        // goal we know, so an ad's custom question can't mint junk tags.
        const goalExtra = mapped.extras.find((e) =>
          /goal|objective|interest/i.test(e.label)
        );
        if (goalExtra) {
          try {
            await addContactTags(admin, accountId, auditUserId, contactId, [
              goalExtra.value,
            ]);
          } catch (tagError) {
            // Goal classification is enrichment, not part of lead capture.
            // A tag outage must not turn a committed new lead into a retry
            // that loses its note or new-contact automation.
            console.error('[meta-leads] goal tag failed:', tagError);
          }
        }

        const { data: completed, error: completeError } = await admin.rpc(
          'complete_meta_lead_webhook_event',
          {
            p_event_id: eventId,
            p_account_id: accountId,
            p_processing_context: {},
          }
        );
        if (completeError || completed !== true) {
          throw new Error('Failed to complete Meta lead event');
        }

        const { error: configUpdateError } = await admin
          .from('meta_page_config')
          .update({ last_lead_at: new Date().toISOString(), last_error: null })
          .eq('id', config.id);
        if (configUpdateError) {
          console.error(
            '[meta-leads] capture status update failed:',
            configUpdateError
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const { error: failError } = await admin.rpc(
          'fail_meta_lead_webhook_event',
          {
            p_event_id: eventId,
            p_account_id: accountId,
            p_error: message,
          }
        );
        if (failError) {
          console.error(
            '[meta-leads] failed to retain retry state:',
            failError
          );
        }
        await admin
          .from('meta_page_config')
          .update({ last_error: message })
          .eq('id', config.id);

        console.error('[meta-leads] failed to ingest', leadgenId, error);
        return NextResponse.json({ error: 'Ingest failed' }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
