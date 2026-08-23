import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { diagnoseAndRepairMetaPage } from '@/lib/meta/lead-ads-health';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import {
  exchangeEmbeddedSignupCode,
  exchangeForLongLivedUserToken,
  getMetaUser,
  getPageLeadAccess,
  getPageLeadgenSubscription,
  listPagesWithTokens,
  subscribePageToLeadgen,
  unsubscribePageFromLeadgen,
} from '@/lib/whatsapp/meta-api';

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const { accountId, userId } = await requireSettingsAccess();
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      return NextResponse.json(
        { error: 'Meta app credentials are not configured on the server.' },
        { status: 500 }
      );
    }

    const { code, redirect_uri: rawRedirectUri } = (await request.json()) as {
      code?: string;
      redirect_uri?: string;
    };
    if (!code) {
      return NextResponse.json(
        { error: 'Missing authorization code' },
        { status: 400 }
      );
    }
    let redirectUri: string | undefined;
    if (rawRedirectUri) {
      try {
        const parsed = new URL(rawRedirectUri);
        const requestOrigin = request.headers.get('origin');
        if (
          parsed.protocol !== 'https:' ||
          (parsed.hostname !== 'staticxx.facebook.com' &&
            parsed.origin !== requestOrigin)
        ) {
          throw new Error('Unsupported redirect URI');
        }
        redirectUri = rawRedirectUri;
      } catch {
        return NextResponse.json(
          { error: 'Invalid Meta OAuth redirect URI' },
          { status: 400 }
        );
      }
    }

    const shortLived = await exchangeEmbeddedSignupCode({
      appId,
      appSecret,
      code,
      redirectUri,
    });
    const { accessToken: userToken, expiresIn } =
      await exchangeForLongLivedUserToken({
        appId,
        appSecret,
        shortLivedToken: shortLived,
      });
    const metaUser = await getMetaUser({ userAccessToken: userToken });
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1_000).toISOString()
      : null;
    const pages = await listPagesWithTokens({ userAccessToken: userToken });
    if (pages.length === 0) {
      return NextResponse.json(
        {
          error:
            'No Facebook Pages were granted. Re-run the connect flow and select at least one Page.',
        },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const connected: { id: string; name: string }[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];

    for (const page of pages) {
      const { data: existing, error: lookupError } = await admin
        .from('meta_page_config')
        .select('id, account_id, credential_generation')
        .eq('page_id', page.id)
        .maybeSingle();
      if (lookupError) {
        skipped.push({
          id: page.id,
          name: page.name,
          reason: 'Failed to save.',
        });
        continue;
      }
      if (existing && existing.account_id !== accountId) {
        skipped.push({
          id: page.id,
          name: page.name,
          reason:
            'This Page is already connected to another UsefulDesk account.',
        });
        continue;
      }

      const health = await diagnoseAndRepairMetaPage({
        provider: {
          getLeadAccess: (signal) =>
            getPageLeadAccess({
              pageId: page.id,
              pageAccessToken: page.access_token,
              userId: metaUser.id,
              appId,
              signal,
            }),
          getLeadgenSubscription: (signal) =>
            getPageLeadgenSubscription({
              pageId: page.id,
              pageAccessToken: page.access_token,
              appId,
              signal,
            }),
          subscribeLeadgen: (signal) =>
            subscribePageToLeadgen({
              pageId: page.id,
              pageAccessToken: page.access_token,
              signal,
            }),
        },
      });
      if (health.kind !== 'healthy' && health.kind !== 'repaired') {
        skipped.push({
          id: page.id,
          name: page.name,
          reason:
            health.resolution ??
            health.message ??
            'Meta could not verify this Page for Lead Ads.',
        });
        continue;
      }

      const now = new Date().toISOString();
      const credentialGeneration = existing
        ? ((existing.credential_generation as number | null) ?? 1) + 1
        : 1;
      const row = {
        account_id: accountId,
        user_id: userId,
        page_id: page.id,
        page_name: page.name,
        page_access_token: encrypt(page.access_token),
        connected_meta_user_id: metaUser.id,
        credential_generation: credentialGeneration,
        token_expires_at: tokenExpiresAt,
        status: 'connected',
        subscribed_at: now,
        health_checked_at: now,
        last_healthy_at: now,
        ...(health.leadAccessVerified === false
          ? {}
          : { lead_access_verified_at: now }),
        subscription_verified_at: now,
        last_repair_at: health.kind === 'repaired' ? now : null,
        next_health_check_at: new Date(
          Date.now() + 6 * 60 * 60 * 1_000
        ).toISOString(),
        consecutive_health_failures: 0,
        last_error: null,
        health_error_code: null,
        health_error_resolution: null,
        health_lease_owner: null,
        health_lease_until: null,
        attention_started_at: null,
        attention_notified_at: null,
      };

      const writeResult = existing
        ? await admin
            .from('meta_page_config')
            .update(row)
            .eq('id', existing.id)
            .eq('account_id', accountId)
            .select('id')
        : await admin.from('meta_page_config').insert(row).select('id');
      const writeFailed =
        Boolean(writeResult.error) ||
        !Array.isArray(writeResult.data) ||
        writeResult.data.length === 0;
      if (writeFailed) {
        if (health.kind === 'repaired') {
          try {
            await unsubscribePageFromLeadgen({
              pageId: page.id,
              pageAccessToken: page.access_token,
            });
          } catch {
            console.warn('[meta-leads] provider compensation failed');
          }
        }
        skipped.push({
          id: page.id,
          name: page.name,
          reason: 'Failed to save.',
        });
        continue;
      }
      connected.push({ id: page.id, name: page.name });
    }

    return NextResponse.json({ connected, skipped });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOriginRequest(request);
    const { accountId } = await requireSettingsAccess();
    const { page_id: pageId } = (await request.json()) as { page_id?: string };
    if (!pageId) {
      return NextResponse.json({ error: 'Missing page_id' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: config, error: configError } = await admin
      .from('meta_page_config')
      .select('id, page_access_token')
      .eq('page_id', pageId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (configError || !config) {
      return NextResponse.json(
        { error: 'Page not connected' },
        { status: 404 }
      );
    }

    try {
      await unsubscribePageFromLeadgen({
        pageId,
        pageAccessToken: decrypt(config.page_access_token as string),
      });
    } catch {
      console.warn(
        '[meta-leads] provider unsubscribe failed; removing local connection'
      );
    }

    const { data: deleted, error } = await admin
      .from('meta_page_config')
      .delete()
      .eq('id', config.id)
      .eq('account_id', accountId)
      .select('id');
    if (error || !deleted?.length) {
      return NextResponse.json(
        { error: 'Failed to disconnect' },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
