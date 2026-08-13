// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts, and persist the
//                        broadcast plus each recipient's complete send
//                        payload with status 'pending'.
//   deliverBroadcast() — start the same owner-leased database drain
//                        used later by authenticated cron recovery.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
// ============================================================

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { MessageTemplate } from '@/types';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { assertBusinessMessageAllowed } from '@/lib/consent/business-messaging';

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
  /** Positional body params for the template ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  phone: string;
  params: string[];
}

interface ClaimedBroadcastRecipient {
  recipient_id: string;
  broadcast_id: string;
  account_id: string;
  template_name: string;
  template_language: string;
  destination_phone: string;
  template_params: unknown;
  attempt_count: number;
  created_at: string;
}

interface BroadcastDeliveryContext {
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
}

export interface BroadcastDrainResult {
  claimed: number;
  sent: number;
  failed: number;
  deferred: number;
  oldestAgeSeconds: number | null;
  notes: string[];
}

export interface BroadcastPlan {
  accountId: string;
  broadcastId: string;
  templateName: string;
  templateLanguage: string;
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) — counted as failed. */
  rejected: number;
}

const MAX_RECIPIENTS = 1000;
const CLAIM_BATCH_LIMIT = 25;
const RECIPIENT_LEASE_SECONDS = 300;

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact. Returns a plan for {@link deliverBroadcast}. Throws
 * {@link BroadcastError} on bad input / missing config / a malformed
 * template / a DB failure — nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  params: CreateBroadcastParams
): Promise<BroadcastPlan> {
  const { name, templateName, recipients } = params;
  const templateLanguage = params.templateLanguage || 'en_US';

  if (!templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required", 400);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      'bad_request',
      "'recipients' must be a non-empty array of { to, params? }",
      400
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      'bad_request',
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400
    );
  }

  // Config (fail fast + provides the audit trail owner already resolved
  // by the caller). Meta send needs phone_number_id + decrypted token.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
  const accessToken = decrypt(config.access_token);

  // Template row (once) for header/button components; guard a
  // malformed local row rather than N identical opaque failures.
  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle();
  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
      500
    );
  }
  const templateRow = (rawTemplateRow as MessageTemplate | null) ?? null;

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  const resolved: { contactId: string; phone: string; params: string[] }[] = [];
  let rejected = 0;
  for (const r of recipients) {
    const sanitized = sanitizePhoneForMeta(
      typeof r.to === 'string' ? r.to : ''
    );
    if (!isValidE164(sanitized)) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateContact(db, accountId, auditUserId, {
      phone: sanitized,
    });
    resolved.push({
      contactId: id,
      phone: sanitized,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  // Keep the first occurrence so the contact is messaged once and its
  // params aren't silently overwritten by a later duplicate — and so
  // the row↔params pairing below (keyed by contact_id) is unambiguous.
  const seenContact = new Set<string>();
  const deduped = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  if (deduped.length === 0) {
    throw new BroadcastError(
      'bad_request',
      'No recipients had a valid E.164 phone number',
      400
    );
  }

  // Persist the broadcast + its recipients. The count columns
  // (sent/delivered/read/replied/failed) are owned by the DB aggregate
  // trigger (migrations 003/005) and derived purely from
  // broadcast_recipients rows — we deliberately do NOT seed them here
  // (a manual value would be clobbered by the trigger on the first
  // recipient change). `rejected` phones have no recipient row, so they
  // are reported to the caller in the POST response, not in these
  // persisted counts.
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      name: name || `API broadcast (${templateName})`,
      template_name: templateName,
      template_language: templateLanguage,
      status: 'sending',
      total_recipients: deduped.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    console.error('[broadcast-core] create broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  const { data: recipientRows, error: rErr } = await db
    .from('broadcast_recipients')
    .insert(
      deduped.map((r) => ({
        broadcast_id: broadcast.id,
        contact_id: r.contactId,
        status: 'pending' as const,
        destination_phone: r.phone,
        template_params: r.params,
      }))
    )
    .select('id, contact_id');
  if (rErr || !recipientRows) {
    console.error('[broadcast-core] create recipients error:', rErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  // Pair each inserted recipient row back to its phone/params by
  // contact_id — unambiguous now that duplicates are collapsed.
  const byContact = new Map(deduped.map((r) => [r.contactId, r]));
  const planned: PlannedRecipient[] = recipientRows.map((row) => {
    const r = byContact.get(row.contact_id as string)!;
    return {
      recipientRowId: row.id as string,
      phone: r.phone,
      params: r.params,
    };
  });

  return {
    accountId,
    broadcastId: broadcast.id,
    templateName,
    templateLanguage,
    phoneNumberId: config.phone_number_id,
    accessToken,
    templateRow,
    planned,
    rejected,
  };
}

/**
 * Start the first database-backed drain for a newly created plan. Designed
 * for `after()`; an interrupted invocation leaves owner-leased pending rows
 * for the authenticated cron worker instead of stranding in-memory work.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  await drainPublicBroadcastRecipients(db, {
    broadcastId: plan.broadcastId,
    limit: plan.planned.length,
  });
}

/**
 * Atomically claims and delivers persisted public-API broadcast recipients.
 * The POST route uses this as its immediate `after()` drain, while the cron
 * route calls the same worker without a broadcast id to reclaim unfinished
 * rows after an invocation timeout.
 */
export async function drainPublicBroadcastRecipients(
  db: SupabaseClient,
  input: { broadcastId?: string; limit: number }
): Promise<BroadcastDrainResult> {
  const result: BroadcastDrainResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    oldestAgeSeconds: null,
    notes: [],
  };
  const contextCache = new Map<string, Promise<BroadcastDeliveryContext>>();
  let remaining = Math.min(Math.max(input.limit, 1), MAX_RECIPIENTS);

  while (remaining > 0) {
    const batchLimit = Math.min(remaining, CLAIM_BATCH_LIMIT);
    const leaseOwner = randomUUID();
    const { data, error } = await db.rpc('claim_public_broadcast_recipients', {
      p_lease_owner: leaseOwner,
      p_limit: batchLimit,
      p_broadcast_id: input.broadcastId ?? null,
      p_lease_seconds: RECIPIENT_LEASE_SECONDS,
    });
    if (error) {
      throw new Error(`claim public broadcast recipients: ${error.message}`);
    }

    const claimed = (Array.isArray(data) ? data : []) as
      ClaimedBroadcastRecipient[] | [];
    if (claimed.length === 0) break;

    result.claimed += claimed.length;
    remaining -= claimed.length;
    const oldest = Math.min(
      ...claimed.map((row) => new Date(row.created_at).getTime())
    );
    const oldestAgeSeconds = Math.max(
      0,
      Math.floor((Date.now() - oldest) / 1000)
    );
    result.oldestAgeSeconds = Math.max(
      result.oldestAgeSeconds ?? 0,
      oldestAgeSeconds
    );

    for (const recipient of claimed) {
      try {
        const outcome = await deliverClaimedBroadcastRecipient(
          db,
          recipient,
          leaseOwner,
          contextCache
        );
        result[outcome] += 1;
      } catch (error) {
        result.deferred += 1;
        const message =
          error instanceof Error ? error.message : 'Unknown recovery error';
        result.notes.push(`${recipient.recipient_id}:${message.slice(0, 500)}`);
        console.error(
          '[broadcast-core] recipient delivery deferred:',
          recipient.recipient_id,
          message
        );
        // Keep the claim intact. If this process dies or an infrastructure
        // dependency is temporarily unavailable, the expired lease makes the
        // same persisted recipient recoverable without a second state model.
      }
    }

    if (claimed.length < batchLimit) break;
  }

  return result;
}

async function deliverClaimedBroadcastRecipient(
  db: SupabaseClient,
  recipient: ClaimedBroadcastRecipient,
  leaseOwner: string,
  contextCache: Map<string, Promise<BroadcastDeliveryContext>>
): Promise<'sent' | 'failed'> {
  const contextKey = [
    recipient.account_id,
    recipient.template_name,
    recipient.template_language,
  ].join(':');
  let contextPromise = contextCache.get(contextKey);
  if (!contextPromise) {
    contextPromise = loadBroadcastDeliveryContext(db, recipient);
    contextCache.set(contextKey, contextPromise);
  }
  const context = await contextPromise;

  const phone = sanitizePhoneForMeta(recipient.destination_phone);
  const params = Array.isArray(recipient.template_params)
    ? recipient.template_params.filter(
        (value): value is string => typeof value === 'string'
      )
    : [];
  let sentMessageId: string | null = null;
  let lastError: string | null = null;

  try {
    await assertBusinessMessageAllowed(
      db,
      recipient.account_id,
      phone,
      'broadcast'
    );
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Consent check failed';
  }

  for (const variant of lastError ? [] : phoneVariants(phone)) {
    try {
      const sendResult = await sendTemplateMessage({
        phoneNumberId: context.phoneNumberId,
        accessToken: context.accessToken,
        to: variant,
        templateName: recipient.template_name,
        language: recipient.template_language,
        template: context.templateRow ?? undefined,
        params,
      });
      sentMessageId = sendResult.messageId;
      lastError = null;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      lastError = message;
      if (!isRecipientNotAllowedError(message)) break;
    }
  }

  if (sentMessageId) {
    const { data, error } = await db.rpc(
      'complete_public_broadcast_recipient',
      {
        p_recipient_id: recipient.recipient_id,
        p_lease_owner: leaseOwner,
        p_whatsapp_message_id: sentMessageId,
      }
    );
    if (error || data !== true) {
      throw new Error(
        `complete public broadcast recipient: ${error?.message ?? 'lease no longer owned'}`
      );
    }
    return 'sent';
  }

  const { data, error } = await db.rpc('fail_public_broadcast_recipient', {
    p_recipient_id: recipient.recipient_id,
    p_lease_owner: leaseOwner,
    p_error: lastError || 'Unknown error',
  });
  if (error || data !== true) {
    throw new Error(
      `fail public broadcast recipient: ${error?.message ?? 'lease no longer owned'}`
    );
  }
  return 'failed';
}

async function loadBroadcastDeliveryContext(
  db: SupabaseClient,
  recipient: ClaimedBroadcastRecipient
): Promise<BroadcastDeliveryContext> {
  const [configResult, templateResult] = await Promise.all([
    db
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', recipient.account_id)
      .single(),
    db
      .from('message_templates')
      .select('*')
      .eq('account_id', recipient.account_id)
      .eq('name', recipient.template_name)
      .eq('language', recipient.template_language)
      .maybeSingle(),
  ]);

  if (configResult.error || !configResult.data) {
    throw new Error(
      `WhatsApp configuration unavailable: ${configResult.error?.message ?? 'missing row'}`
    );
  }
  if (templateResult.error) {
    throw new Error(`load message template: ${templateResult.error.message}`);
  }
  if (templateResult.data && !isMessageTemplate(templateResult.data)) {
    throw new Error('Message template is malformed locally');
  }

  return {
    phoneNumberId: configResult.data.phone_number_id as string,
    accessToken: decrypt(configResult.data.access_token as string),
    templateRow:
      (templateResult.data as MessageTemplate | null | undefined) ?? null,
  };
}
