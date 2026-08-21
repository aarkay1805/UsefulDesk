import { NextResponse } from 'next/server';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  META_TEMPLATE_SYNC_FIELDS,
  buildSyncedTemplateRow,
  type MetaTemplate,
} from '@/lib/whatsapp/template-sync';

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Locally-created templates (no Meta counterpart) are NOT deleted —
 * they remain visible so the user can notice drift and clean up.
 */

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export async function POST() {
  let ctx;
  try {
    ctx = await requireSettingsAccess();
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const { supabase, accountId, userId } = ctx;

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 }
      );
    }

    if (!config.waba_id) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
        },
        { status: 400 }
      );
    }

    const accessToken = decrypt(config.access_token);

    const metaTemplates: MetaTemplate[] = [];
    let nextUrl: string | null =
      `${META_API_BASE}/${config.waba_id}/message_templates?limit=100&fields=${META_TEMPLATE_SYNC_FIELDS}`;
    const PAGE_CAP = 20;
    let pageCount = 0;

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++;
      const metaRes: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`;
        try {
          const body = await metaRes.json();
          if (body?.error?.message) metaErr = body.error.message;
        } catch {
          // response wasn't JSON — keep the fallback
        }
        return NextResponse.json({ error: metaErr }, { status: 502 });
      }

      const metaBody: {
        data?: MetaTemplate[];
        paging?: { next?: string };
      } = await metaRes.json();
      if (metaBody.data) metaTemplates.push(...metaBody.data);
      nextUrl = metaBody.paging?.next ?? null;
    }

    let inserted = 0;
    let updated = 0;
    const errors: { name: string; language: string; message: string }[] = [];

    for (const t of metaTemplates) {
      const row = buildSyncedTemplateRow(t, accountId, userId);

      const { data: existing, error: lookupErr } = await supabase
        .from('message_templates')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', t.name)
        .eq('language', t.language)
        .maybeSingle();

      if (lookupErr) {
        errors.push({
          name: t.name,
          language: t.language,
          message: lookupErr.message,
        });
        continue;
      }

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id);
        if (updErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: updErr.message,
          });
        } else {
          updated++;
        }
      } else {
        const { error: insErr } = await supabase
          .from('message_templates')
          .insert(row);
        if (insErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: insErr.message,
          });
        } else {
          inserted++;
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    });
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 }
    );
  }
}
