// ============================================================
// POST /api/lead-forms/[token]/submit
//
// The product's ONLY unauthenticated write. Treat every request as
// hostile.
//
// Service-role, because contacts_insert requires
// is_account_member(account_id,'agent') (017:387) and an anonymous
// visitor can never satisfy that. The service role bypasses RLS, so
// every query here scopes account_id by hand — the form token is what
// resolves the tenant, and nothing else may.
//
// Defence order matters: cheap rejections first, DB last.
//   1. rate limit (per-IP)
//   2. honeypot     → 200, silently. NEVER 400: a distinct status code
//                     tells a bot which field is the trap.
//   3. Turnstile    → 403 (or 503 if the secret is missing in prod —
//                     misconfiguration is not the visitor's fault, and
//                     failing closed beats an unguarded public insert)
//   4. validate     → 400, using the SAME pure function the page ran.
//                     Client validation is convenience, not authorization.
//   5. write
// ============================================================

import { NextResponse, after } from 'next/server';

import {
  addContactTags,
  findOrCreateContact,
  resolveAuditUserId,
  ContactError,
} from '@/lib/api/v1/contacts';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { goalLabel } from '@/lib/leads/attributes';
import {
  validateCaptureSubmission,
  type CaptureFormInput,
} from '@/lib/leads/capture-form';
import { resolveFieldOptions } from '@/lib/leads/field-options';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { verifyTurnstile } from '@/lib/security/turnstile';

/** Identical body for created AND deduped. Anything else turns this
 *  endpoint into a free "is this number already a lead at that gym?"
 *  oracle for anyone holding the public link. */
const SUCCESS = { ok: true } as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`leadcapture:${ip}`, RATE_LIMITS.leadCapture);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }

  let body: Partial<CaptureFormInput> & { turnstile_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }

  // Honeypot. A real browser leaves the hidden field empty. Answer
  // exactly as we would a success, and write nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    console.warn('[lead-capture] honeypot tripped', { ip });
    return NextResponse.json(SUCCESS);
  }

  const turnstile = await verifyTurnstile(body.turnstile_token, ip);
  if (!turnstile.ok) {
    if (turnstile.reason === 'not_configured') {
      return NextResponse.json(
        { ok: false, reason: 'unavailable' },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { ok: false, reason: 'bot_check_failed' },
      { status: 403 }
    );
  }

  const admin = supabaseAdmin();

  const { data: form, error: formError } = await admin
    .from('lead_capture_forms')
    .select('id, account_id, consent_text, accounts(phone_country_code)')
    .eq('token', token)
    .eq('is_active', true)
    .maybeSingle();

  if (formError) {
    console.error('[lead-capture] form lookup error:', formError);
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 });
  }
  // A revoked or unknown token are the same answer: the link is dead.
  if (!form) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }

  const accountId = form.account_id as string;
  const account = form.accounts as { phone_country_code?: string | null } | null;
  const dialCode = account?.phone_country_code ?? '';

  // The gym's own source list — a submission may not invent a source
  // (contacts.source is free text, so a crafted payload would otherwise
  // pollute the account's curated list).
  const { data: sourceRows } = await admin
    .from('lead_field_options')
    .select('key, label')
    .eq('account_id', accountId)
    .eq('field', 'source')
    .order('sort_order');

  const sourceKeys = resolveFieldOptions('source', sourceRows).map((o) => o.key);

  const result = validateCaptureSubmission(
    {
      name: String(body.name ?? ''),
      phone: String(body.phone ?? ''),
      email: String(body.email ?? ''),
      goal: String(body.goal ?? ''),
      source: String(body.source ?? ''),
      consent: body.consent === true,
    },
    { dialCode, sourceKeys }
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: 'invalid', errors: result.errors },
      { status: 400 }
    );
  }

  const { name, phone, email, goal, source } = result.value;

  try {
    const auditUserId = await resolveAuditUserId(admin, accountId);

    const { id: contactId, created } = await findOrCreateContact(
      admin,
      accountId,
      auditUserId,
      { phone, name, email, receivedVia: 'form', source: source || null }
    );

    const goalText = goalLabel(goal);
    if (goalText) {
      await addContactTags(admin, accountId, auditUserId, contactId, [goalText]);
    }

    // Write the note on create AND on dedupe. A repeat enquiry from a
    // number the gym already has would otherwise be completely
    // invisible: findOrCreateContact returns the existing row, whose
    // received_via still says 'manual', and no automation fires. The
    // gym must still learn that this person asked again.
    const noteParts = [
      created
        ? 'New enquiry via the capture form.'
        : 'Existing lead enquired again via the capture form.',
      goalText ? `Goal: ${goalText}` : null,
      email ? `Email: ${email}` : null,
    ].filter(Boolean);

    const { error: noteError } = await admin.from('contact_notes').insert({
      account_id: accountId,
      contact_id: contactId,
      user_id: auditUserId,
      note_text: noteParts.join(' '),
    });
    if (noteError) {
      // Non-fatal: the lead is captured, which is what matters. Log it
      // rather than 500-ing and inviting a resubmit that double-writes.
      console.error('[lead-capture] note insert failed:', noteError);
    }

    // The consent record. Deliberately written even when the contact
    // deduped — this is the audit trail, the contact is its consequence.
    const { error: subError } = await admin
      .from('lead_capture_submissions')
      .insert({
        account_id: accountId,
        form_id: form.id,
        contact_id: contactId,
        created_contact: created,
        payload: { name, phone, email, goal, source },
        consent: true,
        consent_text: form.consent_text,
        ip,
        user_agent: request.headers.get('user-agent'),
      });
    if (subError) {
      console.error('[lead-capture] submission insert failed:', subError);
    }

    // Only a genuinely new contact is a "new contact". Firing this on a
    // dedupe would re-run the gym's welcome automation at someone who
    // already got it.
    if (created) {
      after(() =>
        runAutomationsForTrigger({
          accountId,
          triggerType: 'new_contact_created',
          contactId,
        })
      );
    }

    return NextResponse.json(SUCCESS);
  } catch (err) {
    if (err instanceof ContactError) {
      // A bad phone that survived the validator (E.164 edge) — the
      // visitor can fix that, so say so rather than 500.
      if (err.status === 400) {
        return NextResponse.json(
          { ok: false, reason: 'invalid', errors: ['phone_invalid'] },
          { status: 400 }
        );
      }
    }
    console.error('[lead-capture] submit failed:', err);
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 });
  }
}
