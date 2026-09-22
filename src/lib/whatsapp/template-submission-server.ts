import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';
import { decrypt } from './encryption';
import { editMessageTemplate, submitMessageTemplate } from './meta-api';
import { buildMetaTemplatePayload } from './template-components';
import { ensureTemplateHeaderHandle } from './template-header-handle';
import {
  ApprovedTemplateCategoryChangeError,
  editCategoryForMeta,
  resolveSubmittedTemplateCategory,
} from './template-lifecycle-policy';
import { normalizeStatus } from './template-status-normalize';
import {
  validateTemplatePayload,
  type TemplatePayload,
} from './template-validators';

export type TemplateSubmissionContext = {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
};

export type TemplateProviderContext = {
  wabaId: string;
  accessToken: string;
};

export class TemplateSubmissionError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly code?: string,
    readonly metaTemplateId?: string
  ) {
    super(message);
    this.name = 'TemplateSubmissionError';
  }
}

export function templatesDryRun(): boolean {
  return (
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
  );
}

function validateSupportedPayload(payload: TemplatePayload) {
  if (payload.category === 'Authentication') {
    throw new TemplateSubmissionError(
      'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
      400
    );
  }
  try {
    validateTemplatePayload(payload);
  } catch (error) {
    throw new TemplateSubmissionError(
      error instanceof Error ? error.message : 'Validation failed.',
      400
    );
  }
}

export async function loadTemplateProviderContext({
  supabase,
  accountId,
}: Pick<
  TemplateSubmissionContext,
  'supabase' | 'accountId'
>): Promise<TemplateProviderContext> {
  const { data: config, error } = await supabase
    .from('whatsapp_config')
    .select('waba_id, access_token')
    .eq('account_id', accountId)
    .single();
  if (error || !config) {
    throw new TemplateSubmissionError(
      'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
      400
    );
  }
  if (!config.waba_id) {
    throw new TemplateSubmissionError(
      'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
      400
    );
  }
  return {
    wabaId: config.waba_id,
    accessToken: decrypt(config.access_token),
  };
}

function buildUpsertRow(
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: string;
    metaTemplateId: string | null;
    submissionError: string | null;
    category?: MessageTemplate['category'];
  }
) {
  return {
    account_id: accountId,
    user_id: userId,
    name: payload.name,
    category: extras.category ?? payload.category,
    language: payload.language,
    parameter_format: 'POSITIONAL',
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    rejection_reason: null,
    last_submitted_at: new Date().toISOString(),
  };
}

async function upsertTemplateRow(
  supabase: SupabaseClient,
  row: ReturnType<typeof buildUpsertRow>
) {
  return supabase
    .from('message_templates')
    .upsert(row, { onConflict: 'account_id,name,language' })
    .select()
    .single();
}

export async function createTemplateForReview({
  supabase,
  accountId,
  userId,
  payload,
  provider,
}: TemplateSubmissionContext & {
  payload: TemplatePayload;
  provider?: TemplateProviderContext;
}) {
  validateSupportedPayload(payload);
  const dryRun = templatesDryRun();
  let metaTemplateId: string;
  let metaStatus: string;
  let categoryResult = resolveSubmittedTemplateCategory(
    payload.category,
    undefined
  );

  if (dryRun) {
    metaTemplateId = `dry-run-${crypto.randomUUID()}`;
    metaStatus = 'PENDING';
  } else {
    const providerContext =
      provider ?? (await loadTemplateProviderContext({ supabase, accountId }));
    try {
      await ensureTemplateHeaderHandle(payload, providerContext.accessToken);
    } catch (error) {
      throw new TemplateSubmissionError(
        error instanceof Error ? error.message : 'Header image upload failed.',
        400
      );
    }

    try {
      const meta = await submitMessageTemplate({
        wabaId: providerContext.wabaId,
        accessToken: providerContext.accessToken,
        payload: buildMetaTemplatePayload(payload),
      });
      metaTemplateId = meta.id;
      metaStatus = meta.status;
      categoryResult = resolveSubmittedTemplateCategory(
        payload.category,
        meta.category
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Meta submit failed.';
      await upsertTemplateRow(
        supabase,
        buildUpsertRow(accountId, userId, payload, {
          status: 'DRAFT',
          metaTemplateId: null,
          submissionError: message,
        })
      );
      const rateLimited = /\b429\b/.test(message);
      throw new TemplateSubmissionError(
        rateLimited
          ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
          : message,
        rateLimited ? 429 : 502
      );
    }
  }

  const { data: template, error } = await upsertTemplateRow(
    supabase,
    buildUpsertRow(accountId, userId, payload, {
      status: normalizeStatus(metaStatus),
      metaTemplateId,
      submissionError: null,
      category: categoryResult.category,
    })
  );
  if (error) {
    throw new TemplateSubmissionError(
      `Submitted to Meta but failed to save locally: ${error.message}. Run "Sync from Meta" to recover.`,
      500,
      undefined,
      metaTemplateId
    );
  }

  return {
    template,
    dry_run: dryRun,
    category_changed: categoryResult.categoryChanged,
    warning: categoryResult.warning,
  };
}

export async function updateTemplateForReview({
  supabase,
  accountId,
  payload,
  existing,
  provider,
}: TemplateSubmissionContext & {
  payload: TemplatePayload;
  existing: MessageTemplate;
  provider?: TemplateProviderContext;
}) {
  validateSupportedPayload(payload);
  if (!existing.meta_template_id) {
    throw new TemplateSubmissionError(
      'This template was never submitted to Meta — submit it as a new template instead.',
      400
    );
  }
  if (!['APPROVED', 'REJECTED', 'PAUSED'].includes(existing.status ?? '')) {
    throw new TemplateSubmissionError(
      `Templates in status ${existing.status} cannot be edited. Allowed: APPROVED, REJECTED, PAUSED.`,
      400
    );
  }

  let editCategory;
  try {
    editCategory = editCategoryForMeta(
      existing.status ?? '',
      existing.category,
      payload.category
    );
  } catch (error) {
    if (error instanceof ApprovedTemplateCategoryChangeError) {
      throw new TemplateSubmissionError(error.message, 409, error.code);
    }
    throw error;
  }

  const dryRun = templatesDryRun();
  if (!dryRun) {
    const providerContext =
      provider ?? (await loadTemplateProviderContext({ supabase, accountId }));
    try {
      await ensureTemplateHeaderHandle(payload, providerContext.accessToken);
    } catch (error) {
      throw new TemplateSubmissionError(
        error instanceof Error ? error.message : 'Header image upload failed.',
        400
      );
    }

    try {
      await editMessageTemplate({
        metaTemplateId: existing.meta_template_id,
        accessToken: providerContext.accessToken,
        name: existing.name,
        language: existing.language ?? 'en_US',
        components: buildMetaTemplatePayload(payload).components,
        category: editCategory,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Meta edit failed.';
      await supabase
        .from('message_templates')
        .update({
          submission_error: message,
          last_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      throw new TemplateSubmissionError(message, 502);
    }
  }

  const { data: template, error } = await supabase
    .from('message_templates')
    .update({
      category:
        existing.status === 'APPROVED' ? existing.category : payload.category,
      header_type: payload.header_type ?? null,
      header_content: payload.header_content ?? null,
      header_media_url: payload.header_media_url ?? null,
      header_handle: payload.header_handle ?? null,
      body_text: payload.body_text,
      footer_text: payload.footer_text ?? null,
      buttons: payload.buttons ?? null,
      sample_values: payload.sample_values ?? null,
      status: 'PENDING',
      submission_error: null,
      rejection_reason: null,
      last_submitted_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select()
    .single();
  if (error) {
    throw new TemplateSubmissionError(
      `Edited on Meta but failed to save locally: ${error.message}. Run "Sync from Meta" to recover.`,
      500
    );
  }

  return { template, dry_run: dryRun };
}
