// ============================================================
// POST /api/lead-forms       — create the account's capture form, or
//                              rotate its token ({ rotate: true }).
//
// Admin+ only. Token minting is the one write the Settings card can't
// do through the browser client: the plaintext is generated here with
// a CSPRNG and returned once in the response, and callers must not be
// able to set it themselves.
//
// One form per gym (lead_capture_forms.account_id is UNIQUE), so the
// no-body call is idempotent: it returns the existing form rather than
// erroring, which lets the Settings card call it on first render.
// ============================================================

import { randomBytes } from 'crypto';

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';

/** 32 CSPRNG bytes → 43 base64url chars. Same entropy as an invite
 *  token; unlike one, it is stored in plaintext (see migration 064). */
function generateFormToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const ip = getClientIp(request);
    const limit = checkRateLimit(`leadform:${userId}:${ip}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    let rotate = false;
    try {
      const body = (await request.json()) as { rotate?: unknown };
      rotate = body?.rotate === true;
    } catch {
      // No body — the create-if-missing case.
    }

    const { data: existing, error: readError } = await supabase
      .from('lead_capture_forms')
      .select('id, token, is_active, headline, intro, consent_text')
      .eq('account_id', accountId)
      .maybeSingle();

    if (readError) {
      console.error('[lead-forms] read error:', readError);
      return NextResponse.json({ error: 'Failed to load form' }, { status: 500 });
    }

    if (existing && !rotate) {
      return NextResponse.json({ form: existing });
    }

    if (existing && rotate) {
      // Rotating invalidates every printed poster and every bio link.
      // The UI confirms before calling this; the route just does it.
      const { data: rotated, error } = await supabase
        .from('lead_capture_forms')
        .update({ token: generateFormToken() })
        .eq('id', existing.id)
        // RLS-blocked writes return no error and zero rows — select the
        // row back and treat an empty result as failure, or we'd toast
        // success over a write that never happened.
        .select('id, token, is_active, headline, intro, consent_text')
        .maybeSingle();

      if (error || !rotated) {
        console.error('[lead-forms] rotate error:', error);
        return NextResponse.json({ error: 'Failed to rotate link' }, { status: 500 });
      }
      return NextResponse.json({ form: rotated });
    }

    const { data: created, error } = await supabase
      .from('lead_capture_forms')
      .insert({
        account_id: accountId,
        token: generateFormToken(),
        created_by: userId,
      })
      .select('id, token, is_active, headline, intro, consent_text')
      .maybeSingle();

    if (error || !created) {
      console.error('[lead-forms] create error:', error);
      return NextResponse.json({ error: 'Failed to create form' }, { status: 500 });
    }

    return NextResponse.json({ form: created }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
