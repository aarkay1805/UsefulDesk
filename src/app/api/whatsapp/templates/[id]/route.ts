import { NextResponse } from 'next/server';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { deleteMessageTemplate } from '@/lib/whatsapp/meta-api';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { shouldDeleteTemplateFromMeta } from '@/lib/whatsapp/template-lifecycle-policy';
import {
  TemplateSubmissionError,
  templatesDryRun,
  updateTemplateForReview,
} from '@/lib/whatsapp/template-submission-server';
import type { MessageTemplate } from '@/types';

/**
 * Per-template lifecycle endpoint.
 *
 * PATCH  — edit an existing Meta-side template (and re-submit). Used
 *          by the "Edit" action on APPROVED rows and the "Resubmit"
 *          action on REJECTED / PAUSED rows. Meta replaces components
 *          wholesale on edit and bumps status back to PENDING.
 *
 * DELETE — remove the template on Meta (when meta_template_id is set,
 *          scoped to a single language variant via hsm_id) AND drop
 *          the local row. Local-only rows skip the Meta call.
 *
 * Initial submission (DRAFT → PENDING) lives at the sibling
 * /submit endpoint — keep this route narrowly about lifecycle of
 * already-submitted templates.
 */

// uuid v4 plus the looser shape Postgres gen_random_uuid emits.
// We don't need exhaustive RFC parsing — just enough to reject
// "../etc/passwd"-style payloads before they hit Supabase.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireSettingsAccess();
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 }
      );
    }
    const { supabase, accountId } = ctx;

    let payload: TemplatePayload;
    try {
      payload = (await request.json()) as TemplatePayload;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }

    // RLS handles ownership, but we need the existing row to read
    // meta_template_id and status — fetch explicitly.
    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, name, status, category, meta_template_id, language')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (lookupErr || !existing) {
      return NextResponse.json(
        { error: 'Template not found.' },
        { status: 404 }
      );
    }

    const result = await updateTemplateForReview({
      ...ctx,
      payload,
      existing: existing as MessageTemplate,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error editing template:', error);
    if (error instanceof TemplateSubmissionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not edit template.',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireSettingsAccess();
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 }
      );
    }
    const { supabase, accountId } = ctx;

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, name, meta_template_id, provider_missing_since')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (lookupErr || !existing) {
      return NextResponse.json(
        { error: 'Template not found.' },
        { status: 404 }
      );
    }

    if (
      shouldDeleteTemplateFromMeta(
        {
          metaTemplateId: existing.meta_template_id,
          providerMissingSince: existing.provider_missing_since,
        },
        templatesDryRun()
      )
    ) {
      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .single();
      if (configError || !config || !config.waba_id) {
        return NextResponse.json(
          { error: 'WhatsApp not configured — cannot delete on Meta.' },
          { status: 400 }
        );
      }
      const accessToken = decrypt(config.access_token);
      try {
        await deleteMessageTemplate({
          wabaId: config.waba_id,
          accessToken,
          name: existing.name,
          metaTemplateId: existing.meta_template_id,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta delete failed.';
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    const { data: deleted, error: delErr } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', id)
      .select('id');
    if (delErr || !deleted?.length) {
      return NextResponse.json(
        {
          error: `Deleted on Meta but failed to delete locally${delErr ? `: ${delErr.message}` : '.'}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      dry_run: templatesDryRun(),
    });
  } catch (error) {
    console.error('Error deleting template:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not delete template.',
      },
      { status: 500 }
    );
  }
}
