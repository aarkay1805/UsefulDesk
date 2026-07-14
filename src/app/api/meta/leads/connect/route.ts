// ============================================================
// POST   /api/meta/leads/connect   — connect Facebook Pages for lead ads
// DELETE /api/meta/leads/connect   — disconnect one page
//
// Mirrors /api/whatsapp/embedded-signup beat for beat, against a SECOND
// Facebook Login for Business config: the WhatsApp Embedded Signup
// config is fixed-permission (whatsapp_business_*), so page scopes
// cannot be bolted onto it. This one carries pages_show_list,
// leads_retrieval and pages_manage_metadata.
//
// No page picker: the FBLB popup already made the user choose which
// Pages to grant, so /me/accounts returns exactly the granted set. We
// connect all of them and report any that another account already owns.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import {
  exchangeEmbeddedSignupCode,
  exchangeForLongLivedUserToken,
  listPagesWithTokens,
  subscribePageToLeadgen,
  unsubscribePageFromLeadgen,
} from '@/lib/whatsapp/meta-api';

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      return NextResponse.json(
        { error: 'Meta app credentials are not configured on the server.' },
        { status: 500 }
      );
    }

    const { code } = (await request.json()) as { code?: string };
    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    // 1. code → user token. The ES helper is a plain FBLB exchange and
    //    works for this config too, despite its WhatsApp-ish name.
    const shortLived = await exchangeEmbeddedSignupCode({ appId, appSecret, code });

    // 2. ALWAYS long-lived-swap first. Page tokens inherit the lifetime
    //    of the user token they came from: from a short-lived one they
    //    die in ~1h and lead ingestion then stops SILENTLY. From a
    //    long-lived one they don't expire.
    const { accessToken: userToken, expiresIn } = await exchangeForLongLivedUserToken({
      appId,
      appSecret,
      shortLivedToken: shortLived,
    });
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const pages = await listPagesWithTokens({ userAccessToken: userToken });
    if (pages.length === 0) {
      return NextResponse.json(
        { error: 'No Facebook Pages were granted. Re-run the connect flow and tick at least one Page.' },
        { status: 400 }
      );
    }

    // Service role: a page claimed by a DIFFERENT account is invisible
    // under the caller's RLS, and we must detect that to report it.
    const admin = supabaseAdmin();
    const connected: { id: string; name: string }[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];

    for (const page of pages) {
      const { data: existing } = await admin
        .from('meta_page_config')
        .select('id, account_id')
        .eq('page_id', page.id)
        .maybeSingle();

      if (existing && existing.account_id !== accountId) {
        skipped.push({
          id: page.id,
          name: page.name,
          reason: 'This Page is already connected to another UsefulDesk account.',
        });
        continue;
      }

      // Subscribe to leadgen. Best-effort: a failure here (usually a
      // missing pages_manage_metadata grant) must not lose the token we
      // just obtained — we store it and surface the error instead.
      let subscribedAt: string | null = null;
      let lastError: string | null = null;
      try {
        await subscribePageToLeadgen({
          pageId: page.id,
          pageAccessToken: page.access_token,
        });
        subscribedAt = new Date().toISOString();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error('[meta-leads] subscribe failed for page', page.id, error);
      }

      const row = {
        account_id: accountId,
        user_id: userId,
        page_id: page.id,
        page_name: page.name,
        page_access_token: encrypt(page.access_token),
        token_expires_at: tokenExpiresAt,
        status: lastError ? 'error' : 'connected',
        subscribed_at: subscribedAt,
        last_error: lastError,
      };

      const { error: upsertError } = existing
        ? await admin.from('meta_page_config').update(row).eq('id', existing.id)
        : await admin.from('meta_page_config').insert(row);

      if (upsertError) {
        console.error('[meta-leads] upsert failed for page', page.id, upsertError);
        skipped.push({ id: page.id, name: page.name, reason: 'Failed to save.' });
        continue;
      }

      connected.push({ id: page.id, name: page.name });
    }

    return NextResponse.json({ connected, skipped });
  } catch (err) {
    if (err instanceof Error && !(err as { status?: number }).status) {
      console.error('[meta-leads] connect failed:', err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const { page_id: pageId } = (await request.json()) as { page_id?: string };
    if (!pageId) {
      return NextResponse.json({ error: 'Missing page_id' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: config } = await admin
      .from('meta_page_config')
      .select('id, page_access_token')
      .eq('page_id', pageId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!config) {
      return NextResponse.json({ error: 'Page not connected' }, { status: 404 });
    }

    // Tell Meta to stop sending leads we would only drop. Best-effort:
    // if the token is already dead, deleting our row is still correct.
    try {
      await unsubscribePageFromLeadgen({
        pageId,
        pageAccessToken: decrypt(config.page_access_token as string),
      });
    } catch (error) {
      console.warn('[meta-leads] unsubscribe failed (continuing):', error);
    }

    const { error } = await admin
      .from('meta_page_config')
      .delete()
      .eq('id', config.id);
    if (error) {
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
