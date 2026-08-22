import 'server-only';

import { addContactTags, resolveAuditUserId } from '@/lib/api/v1/contacts';
import type { supabaseAdmin } from '@/lib/automations/admin-client';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { normalizeSubmittedPhone } from '@/lib/leads/capture-form';
import { mapMetaLeadFields } from '@/lib/leads/meta-field-mapping';
import {
  classifyMetaLeadHealthFailure,
  localMetaEncryptionFailure,
  type MetaLeadHealthResult,
} from '@/lib/meta/lead-ads-health';
import { decrypt } from '@/lib/whatsapp/encryption';
import { fetchLeadgenLead, MetaGraphError } from '@/lib/whatsapp/meta-api';

type AdminClient = ReturnType<typeof supabaseAdmin>;

export interface LeadgenValue {
  leadgen_id?: string;
  page_id?: string;
  form_id?: string;
  ad_id?: string;
  created_time?: number;
}

export interface OwnedMetaLeadEvent {
  eventId: string;
  accountId: string;
  payload: LeadgenValue;
}

export type MetaLeadIngestionResult =
  { status: 'processed'; contactId: string } | { status: 'skipped_no_phone' };

interface ProcessOwnedMetaLeadEventArgs {
  admin: AdminClient;
  event: OwnedMetaLeadEvent;
  processingOwner: string;
}

type MetaLeadCaptureResult = {
  contact_id: string;
  created_contact: boolean;
  automation_dispatched: boolean;
};

async function recordProvenConnectionFailure(args: {
  admin: AdminClient;
  configId: string;
  accountId: string;
  credentialGeneration: number;
  result: MetaLeadHealthResult;
}) {
  if (!args.result.humanAction) return;
  const { data, error } = await args.admin
    .from('meta_page_config')
    .update({
      status: 'error',
      last_error: args.result.message,
      health_error_code: args.result.code,
      health_error_resolution: args.result.resolution,
      next_health_check_at: new Date().toISOString(),
    })
    .eq('id', args.configId)
    .eq('account_id', args.accountId)
    .eq('credential_generation', args.credentialGeneration)
    .select('id');
  if (error || !data?.length) {
    console.error('[meta-leads] connection failure state write failed');
  }
}

export async function processOwnedMetaLeadEvent(
  args: ProcessOwnedMetaLeadEventArgs
): Promise<MetaLeadIngestionResult> {
  const { admin, event, processingOwner } = args;
  const leadgenId = event.payload.leadgen_id;
  const pageId = event.payload.page_id;
  if (!leadgenId || !pageId) {
    throw new Error('Meta lead event payload is incomplete');
  }

  const { data: config, error: configError } = await admin
    .from('meta_page_config')
    .select('id, account_id, page_id, page_access_token, credential_generation')
    .eq('page_id', pageId)
    .eq('account_id', event.accountId)
    .maybeSingle();
  if (configError || !config) {
    throw new Error('Meta Page configuration is unavailable');
  }

  const configId = config.id as string;
  const credentialGeneration =
    (config.credential_generation as number | null) ?? 1;
  let accessToken: string;
  try {
    accessToken = decrypt(config.page_access_token as string);
  } catch (error) {
    await recordProvenConnectionFailure({
      admin,
      configId,
      accountId: event.accountId,
      credentialGeneration,
      result: localMetaEncryptionFailure(),
    });
    throw error;
  }

  let lead;
  try {
    lead = await fetchLeadgenLead({ leadgenId, accessToken });
  } catch (error) {
    if (error instanceof MetaGraphError) {
      await recordProvenConnectionFailure({
        admin,
        configId,
        accountId: event.accountId,
        credentialGeneration,
        result: classifyMetaLeadHealthFailure(error),
      });
    }
    throw error;
  }

  const mapped = mapMetaLeadFields(lead.field_data ?? []);
  if (!mapped.phone) {
    const { data: completed, error: completeError } = await admin.rpc(
      'complete_meta_lead_without_phone_owned',
      {
        p_config_id: configId,
        p_account_id: event.accountId,
        p_event_id: event.eventId,
        p_processing_owner: processingOwner,
      }
    );
    if (completeError || completed !== true) {
      throw new Error('Failed to complete phone-less Meta lead event');
    }
    return { status: 'skipped_no_phone' };
  }

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('phone_country_code')
    .eq('id', event.accountId)
    .maybeSingle();
  if (accountError) throw new Error('Meta lead account locale is unavailable');

  const phone =
    normalizeSubmittedPhone(
      mapped.phone,
      (account?.phone_country_code as string) ?? ''
    ) ?? mapped.phone;
  const auditUserId = await resolveAuditUserId(admin, event.accountId);

  const { data: capture, error: captureError } = await admin
    .rpc('capture_meta_lead_webhook_event', {
      p_event_id: event.eventId,
      p_account_id: event.accountId,
      p_audit_user_id: auditUserId,
      p_phone: phone,
      p_name: mapped.name,
      p_email: mapped.email,
      p_source: lead.platform === 'ig' ? 'instagram' : 'facebook',
      p_note_details: mapped.extras
        .map((extra) => `${extra.label}: ${extra.value}`)
        .join('\n'),
    })
    .single();
  if (captureError || !capture) {
    throw new Error('Atomic Meta lead capture failed');
  }

  const {
    contact_id: contactId,
    created_contact: created,
    automation_dispatched: automationDispatched,
  } = capture as MetaLeadCaptureResult;

  if (created && !automationDispatched) {
    await runAutomationsForTrigger({
      accountId: event.accountId,
      triggerType: 'new_contact_created',
      contactId,
    });
    const { data: marked, error: markError } = await admin.rpc(
      'mark_meta_lead_automation_dispatched',
      {
        p_event_id: event.eventId,
        p_account_id: event.accountId,
      }
    );
    if (markError || marked !== true) {
      throw new Error('Failed to retain Meta automation dispatch state');
    }
  }

  const goalExtra = mapped.extras.find((extra) =>
    /goal|objective|interest/i.test(extra.label)
  );
  if (goalExtra) {
    try {
      await addContactTags(admin, event.accountId, auditUserId, contactId, [
        goalExtra.value,
      ]);
    } catch {
      console.error('[meta-leads] optional goal tag failed');
    }
  }

  const { data: completed, error: completeError } = await admin.rpc(
    'complete_meta_lead_webhook_event_owned',
    {
      p_event_id: event.eventId,
      p_account_id: event.accountId,
      p_processing_owner: processingOwner,
      p_processing_context: {},
    }
  );
  if (completeError || completed !== true) {
    throw new Error('Failed to complete owned Meta lead event');
  }

  const { data: updated, error: statusError } = await admin
    .from('meta_page_config')
    .update({ last_lead_at: new Date().toISOString(), last_error: null })
    .eq('id', configId)
    .eq('account_id', event.accountId)
    .eq('credential_generation', credentialGeneration)
    .select('id');
  if (statusError || !updated?.length) {
    console.error('[meta-leads] last-lead timestamp write failed');
  }

  return { status: 'processed', contactId };
}
