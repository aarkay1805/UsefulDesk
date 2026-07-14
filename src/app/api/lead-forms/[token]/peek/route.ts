// ============================================================
// GET /api/lead-forms/[token]/peek
//
// Public — no auth. Lets /f/<token> render the gym's name and its
// consent copy before an anonymous visitor fills anything in.
//
// Security model (mirrors /api/invitations/[token]/peek):
//   - Token is in the URL PATH, not the query, so it stays out of
//     standard access-log "referer" fields.
//   - peek_lead_capture_form is SECURITY DEFINER, so it crosses the
//     RLS wall that (correctly) denies anon any SELECT on
//     lead_capture_forms. It returns a FIXED shape — never account_id,
//     never the form id, never a column the page doesn't render. A
//     public endpoint leaks exactly what it selects.
//   - Per-IP rate limit before the DB is touched.
//
// Unlike the invitation token, this one is NOT hashed: it grants no
// read of anything and must stay re-copyable (it lives in an Instagram
// bio). See the migration 064 header for the full reasoning.
// ============================================================

import { NextResponse } from 'next/server';

import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`formpeek:${ip}`, RATE_LIMITS.leadFormPeek);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('peek_lead_capture_form', {
    p_token: token,
  });

  if (error) {
    console.error('[lead-forms/peek] rpc error:', error);
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 });
  }

  // The RPC always returns { ok: true, … } or { ok: false, reason }.
  // Forward it verbatim so the route never has to interpret it.
  return NextResponse.json(data);
}
