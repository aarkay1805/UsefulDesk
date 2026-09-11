import { engineSendTemplate } from '@/lib/automations/meta-send';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireProductAccess } from '@/lib/platform-access/server';
import { resolveAccountLocale } from '@/lib/locale/config';
import { buildFormatters, dayStartInTz, hourInTz, todayInTz } from '@/lib/locale/format';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

import {
  invoiceMilestones,
  isExpiredRenewalCandidate,
  isCollectibleInvoice,
  requiresAutoPayReconciliation,
  selectDueMilestone,
  shouldSuppressGeneralPreDue,
} from './policy';
import { selectPostExpiryMilestone, shouldEscalatePostExpiry } from './post-expiry';
import { processRetentionJob, queueRetentionCandidates } from './retention-worker';
import { processTransactionEventJob } from './transaction-events';
import { isRenewalChaseable } from '@/lib/memberships/pricing';
import type {
  InvoiceCollectionSettings,
  LifecycleReminderJob,
  LifecycleReminderKind,
  ReminderRunSummary,
} from './types';

export function createReminderBusinessKey({
  kind,
  invoiceId,
  subjectCycleId,
  milestoneKey,
}: {
  kind: LifecycleReminderKind;
  invoiceId: string | null;
  subjectCycleId: string;
  milestoneKey: string;
}): string {
  // Invoice-less lifecycle subjects (membership/service cycles) must not
  // collapse onto one another. `subjectCycleId` is immutable for every kind.
  return `${kind}:${invoiceId ?? 'none'}:${subjectCycleId}:${milestoneKey}`;
}

/** A daily chase reservation is exclusive; priority is resolved before it. */
export function decideDailyBudget({
  existingKind,
  candidateKind,
}: {
  existingKind: LifecycleReminderKind | null;
  candidateKind: LifecycleReminderKind;
}): 'allow' | 'defer' {
  void candidateKind;
  return existingKind ? 'defer' : 'allow';
}

export function isWithinReminderSendWindow(
  hour: number,
  start: number,
  end: number
): boolean {
  return hour >= start && hour <= end;
}

export function retryAt(attemptCount: number, now = new Date()): string {
  const minutes = Math.min(60, 2 ** Math.min(Math.max(attemptCount, 0), 5));
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

const MAX_JOBS_PER_RUN = 200;

type AccountRow = {
  id: string;
  owner_user_id: string;
  timezone: string;
  default_currency: string;
  country_code: string;
  locale: string;
  date_order: string;
  time_format: string;
  week_start: number;
  phone_country_code: string;
  measurement_system: string;
};

type InvoiceCandidate = {
  id: string;
  account_id: string;
  contact_id: string;
  membership_id: string | null;
  issued_at: string;
  invoice_number: string | null;
  balance: number;
  state: string;
  requires_refund_review: boolean;
  contact: { id: string; name: string | null; phone: string | null } | null;
};

type InstallmentCandidate = {
  id: string;
  invoice_id: string | null;
  contact_id: string;
  second_due_on: string;
  created_at: string;
};

type MembershipExpiryCandidate = {
  id: string;
  account_id: string;
  contact_id: string;
  end_date: string;
  status: string;
  collection_mode: string;
  fee_amount: number;
  contact: { id: string; name: string | null; phone: string | null } | null;
  plan: { name: string | null; plan_type: string | null } | null;
};

type ServiceExpiryCandidate = {
  id: string;
  account_id: string;
  contact_id: string;
  end_date: string;
  status: string;
  item_name_snapshot: string;
  current_renewal_price: number | null;
  item_is_active: boolean;
  option_is_active: boolean;
  member_name: string | null;
  phone: string | null;
};

type PostExpirySettings = {
  enabled: boolean;
  activatedOn: string | null;
  activatedAt: string | null;
  generation: string;
  catchUpDays: number;
  sendWindowStart: number;
  sendWindowEnd: number;
};

function postExpiryCycleKey(subjectId: string, endDate: string, generation: string) {
  return `${subjectId}:${endDate}:${generation}`;
}

const SETTINGS_SELECT =
  'account_id, invoice_collection_enabled, invoice_collection_activated_on, invoice_collection_activated_at, invoice_collection_generation, invoice_collection_before_due_days, invoice_collection_overdue_days, invoice_collection_catch_up_days, invoice_collection_send_window_start, invoice_collection_send_window_end, membership_post_expiry_enabled, membership_post_expiry_activated_on, membership_post_expiry_activated_at, membership_post_expiry_generation, membership_post_expiry_catch_up_days, service_post_expiry_enabled, service_post_expiry_activated_on, service_post_expiry_activated_at, service_post_expiry_generation, service_post_expiry_catch_up_days, promise_to_pay_reminders_enabled, promise_to_pay_reminders_activated_on, promise_to_pay_reminders_activated_at, promise_to_pay_reminders_generation, payment_link_follow_up_enabled, payment_link_follow_up_activated_on, payment_link_follow_up_activated_at, payment_link_follow_up_generation, payment_confirmations_enabled, payment_confirmations_activated_at, payment_confirmations_generation, autopay_recovery_enabled, autopay_recovery_activated_at, autopay_recovery_generation, session_pack_reminders_enabled, session_pack_reminders_activated_on, session_pack_reminders_activated_at, session_pack_reminders_generation, freeze_return_reminders_enabled, freeze_return_reminders_activated_on, freeze_return_reminders_activated_at, freeze_return_reminders_generation, membership_win_back_enabled, membership_win_back_activated_on, membership_win_back_activated_at, membership_win_back_generation, service_win_back_enabled, service_win_back_activated_on, service_win_back_activated_at, service_win_back_generation';

type CommitmentSettings = {
  enabled: boolean;
  activatedOn: string | null;
  activatedAt: string | null;
  generation: string;
};

function commitmentSettings(
  row: Record<string, unknown>,
  prefix: 'promise_to_pay_reminders' | 'payment_link_follow_up'
): CommitmentSettings {
  return {
    enabled: row[`${prefix}_enabled`] === true,
    activatedOn: typeof row[`${prefix}_activated_on`] === 'string' ? String(row[`${prefix}_activated_on`]) : null,
    activatedAt: typeof row[`${prefix}_activated_at`] === 'string' ? String(row[`${prefix}_activated_at`]) : null,
    generation: String(row[`${prefix}_generation`] ?? ''),
  };
}

type CollectionCommitment = {
  id: string; invoice_id: string; contact_id: string; kind: 'promise_to_pay' | 'verification_hold' | 'dispute_hold';
  state: string; amount: number | null; promised_on: string | null; revision: number; created_at: string; payment_allocation_snapshot?: number;
};

type PaymentLinkCandidate = {
  id: string; invoice_id: string; revision: number; expected_amount: number; short_url: string | null;
  expires_at: string; status: string; last_sent_at: string | null; last_whatsapp_message_id: string | null;
  invoice: { contact_id: string } | null;
};

function postExpirySettings(
  row: Record<string, unknown>,
  kind: 'membership_post_expiry' | 'service_post_expiry'
): PostExpirySettings {
  const prefix = kind === 'membership_post_expiry' ? 'membership_post_expiry' : 'service_post_expiry';
  return {
    enabled: row[`${prefix}_enabled`] === true,
    activatedOn: typeof row[`${prefix}_activated_on`] === 'string' ? String(row[`${prefix}_activated_on`]) : null,
    activatedAt: typeof row[`${prefix}_activated_at`] === 'string' ? String(row[`${prefix}_activated_at`]) : null,
    generation: String(row[`${prefix}_generation`] ?? ''),
    catchUpDays: Number(row[`${prefix}_catch_up_days`] ?? 2),
    // Post-expiry recovery shares the configurable lifecycle window rather
    // than inventing a second per-account clock.
    sendWindowStart: Number(row.invoice_collection_send_window_start ?? 9),
    sendWindowEnd: Number(row.invoice_collection_send_window_end ?? 19),
  };
}

class ReminderNoLongerEligibleError extends Error {}
class ReminderDeferredError extends Error {}
class ReminderSetupChangedError extends Error {}
class ReminderInfrastructureError extends Error {}

async function needsAutoPayReconciliation(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  invoiceId: string
): Promise<boolean> {
  const { data: lines, error: linesError } = await admin
    .from('invoice_line_balances')
    .select('membership_period_id')
    .eq('account_id', accountId)
    .eq('invoice_id', invoiceId)
    .gt('collectible_balance', 0);
  if (linesError) throw linesError;
  const periodIds = (lines ?? [])
    .map((line) => line.membership_period_id as string | null)
    .filter((id): id is string => id !== null);
  const [{ data: periods, error: periodsError }, { data: mandates, error: mandatesError }] =
    await Promise.all([
      periodIds.length
        ? admin.from('membership_periods').select('id, membership_id').in('id', periodIds)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('payment_mandates')
        .select('membership_id')
        .eq('account_id', accountId)
        .eq('status', 'active'),
    ]);
  if (periodsError || mandatesError) throw periodsError ?? mandatesError;
  const membershipByPeriod = new Map(
    (periods ?? []).map((period) => [period.id as string, period.membership_id as string])
  );
  return requiresAutoPayReconciliation({
    activeMandateMembershipIds: new Set(
      (mandates ?? []).map((mandate) => mandate.membership_id as string)
    ),
    lineMembershipIds: periodIds.map((periodId) => membershipByPeriod.get(periodId) ?? null),
  });
}

function asSettings(row: Record<string, unknown>): InvoiceCollectionSettings {
  return {
    accountId: String(row.account_id),
    enabled: row.invoice_collection_enabled === true,
    activatedOn:
      typeof row.invoice_collection_activated_on === 'string'
        ? row.invoice_collection_activated_on
        : null,
    activatedAt:
      typeof row.invoice_collection_activated_at === 'string'
        ? row.invoice_collection_activated_at
        : null,
    beforeDueDays: Array.isArray(row.invoice_collection_before_due_days)
      ? row.invoice_collection_before_due_days.map(Number)
      : [3, 1, 0],
    overdueDays: Array.isArray(row.invoice_collection_overdue_days)
      ? row.invoice_collection_overdue_days.map(Number)
      : [1, 3, 7, 14],
    catchUpDays: Number(row.invoice_collection_catch_up_days ?? 2),
    sendWindowStart: Number(row.invoice_collection_send_window_start ?? 9),
    sendWindowEnd: Number(row.invoice_collection_send_window_end ?? 19),
  };
}

function emptySummary(): ReminderRunSummary {
  return {
    accountsConsidered: 0,
    queued: 0,
    deferred: 0,
    attempted: 0,
    accepted: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
    ambiguous: 0,
    infrastructureFailures: 0,
    notes: [],
  };
}

function invoiceTemplate(kind: LifecycleReminderKind) {
  return kind === 'invoice_overdue' || kind === 'installment_overdue'
    ? TEMPLATE_CONTRACTS.invoice_overdue
    : TEMPLATE_CONTRACTS.invoice_due;
}

async function finishJob(
  admin: ReturnType<typeof supabaseAdmin>,
  job: LifecycleReminderJob,
  state: string,
  {
    providerMessageId = null,
    reason = null,
    nextAttemptAt = null,
  }: {
    providerMessageId?: string | null;
    reason?: Record<string, string> | null;
    nextAttemptAt?: string | null;
  } = {}
) {
  const { data, error } = await admin.rpc('finish_lifecycle_reminder_job', {
    p_job_id: job.id,
    p_worker_id: job.lease_owner,
    p_lease_generation: job.lease_generation,
    p_state: state,
    p_provider_message_id: providerMessageId,
    p_reason: reason,
    p_next_attempt_at: nextAttemptAt,
  });
  if (error || data !== true) {
    throw new Error(error?.message ?? 'lifecycle reminder lease was lost');
  }
}

async function findOrCreateConversation(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  userId: string,
  contactId: string
): Promise<string> {
  const { data: existing, error: existingError } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing.id as string;

  const { data: created, error } = await admin
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message ?? 'conversation unavailable');
  return created.id as string;
}

export function postExpiryReplyStartAt(endDate: string, timeZone: string): string {
  const start = dayStartInTz(endDate, timeZone);
  if (!start) throw new Error('invalid post-expiry cycle date');
  return start.toISOString();
}

async function hasCustomerReplySinceExpiry(
  admin: ReturnType<typeof supabaseAdmin>,
  job: LifecycleReminderJob,
  timeZone: string
): Promise<boolean> {
  // A reply is a customer message in this contact's account after the expired
  // cycle began. It is deliberately checked again at beforeSend, not merely
  // while queueing, so a response cannot race a leased reminder.
  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', job.account_id)
    .eq('contact_id', job.contact_id)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation) return false;
  const { data, error } = await admin
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id as string)
    .eq('sender_type', 'customer')
    .gte('created_at', postExpiryReplyStartAt(job.effective_due_on, timeZone))
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function currentPostExpirySubject(
  admin: ReturnType<typeof supabaseAdmin>,
  job: LifecycleReminderJob,
  today: string
): Promise<MembershipExpiryCandidate | ServiceExpiryCandidate | null> {
  if (job.kind === 'membership_post_expiry') {
    const { data, error } = await admin
      .from('memberships')
      .select('id, account_id, contact_id, end_date, status, collection_mode, fee_amount, contact:contacts(id, name, phone), plan:membership_plans(name, plan_type)')
      .eq('account_id', job.account_id)
      .eq('id', job.membership_id)
      .maybeSingle();
    if (error) throw error;
    const membership = data as unknown as MembershipExpiryCandidate | null;
    if (!membership || membership.contact_id !== job.contact_id || membership.end_date !== job.effective_due_on) return null;
    return isExpiredRenewalCandidate({
      status: membership.status,
      endDate: membership.end_date,
      today,
      renewable: isRenewalChaseable(membership.plan),
      activeAutoPay: membership.collection_mode === 'auto',
    }) ? membership : null;
  }
  const { data, error } = await admin
    .from('service_renewal_queue')
    .select('id, account_id, contact_id, end_date, status, item_name_snapshot, current_renewal_price, item_is_active, option_is_active, member_name, phone')
    .eq('account_id', job.account_id)
    .eq('id', job.member_service_id)
    .maybeSingle();
  if (error) throw error;
  const service = data as unknown as ServiceExpiryCandidate | null;
  if (!service || service.contact_id !== job.contact_id || service.end_date !== job.effective_due_on) return null;
  return isExpiredRenewalCandidate({
    status: service.status,
    endDate: service.end_date,
    today,
    renewable: service.item_is_active && service.option_is_active && service.current_renewal_price !== null,
  }) ? service : null;
}

async function processPostExpiryJob({
  admin,
  job,
  account,
  now,
  summary,
}: {
  admin: ReturnType<typeof supabaseAdmin>;
  job: LifecycleReminderJob;
  account: AccountRow;
  now: Date;
  summary: ReminderRunSummary;
}): Promise<void> {
  const kind = job.kind as 'membership_post_expiry' | 'service_post_expiry';
  const { data: rawSetting, error: settingError } = await admin
    .from('renewal_reminder_settings')
    .select(SETTINGS_SELECT)
    .eq('account_id', job.account_id)
    .maybeSingle();
  if (settingError || !rawSetting) {
    await finishJob(admin, job, 'blocked', { reason: { code: 'post_expiry_settings_unavailable' } });
    summary.blocked++;
    return;
  }
  const settings = postExpirySettings(rawSetting as Record<string, unknown>, kind);
  if (!settings.enabled || !settings.activatedOn || !settings.activatedAt || settings.generation !== job.activation_generation) {
    await finishJob(admin, job, 'skipped', { reason: { code: 'post_expiry_no_longer_active' } });
    summary.skipped++;
    return;
  }
  const locale = resolveAccountLocale(account);
  const today = todayInTz(locale.timeZone, now);
  if (!isWithinReminderSendWindow(hourInTz(locale.timeZone, now), settings.sendWindowStart, settings.sendWindowEnd)) {
    await finishJob(admin, job, 'deferred', { reason: { code: 'outside_send_window' }, nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString() });
    summary.deferred++;
    return;
  }
  let subject: MembershipExpiryCandidate | ServiceExpiryCandidate | null;
  try { subject = await currentPostExpirySubject(admin, job, today); }
  catch {
    await finishJob(admin, job, 'blocked', { reason: { code: 'post_expiry_subject_unavailable' } });
    summary.infrastructureFailures++; summary.blocked++; return;
  }
  if (!subject) {
    await finishJob(admin, job, 'skipped', { reason: { code: 'post_expiry_subject_changed' } });
    summary.skipped++; return;
  }
  try {
    if (await hasCustomerReplySinceExpiry(admin, job, locale.timeZone)) {
      await finishJob(admin, job, 'skipped', { reason: { code: 'customer_replied' } });
      summary.skipped++; return;
    }
  } catch {
    await finishJob(admin, job, 'blocked', { reason: { code: 'reply_history_unavailable' } });
    summary.infrastructureFailures++; summary.blocked++; return;
  }
  const { data: history, error: historyError } = await admin
    .from('lifecycle_reminder_jobs')
    .select('milestone_key, state')
    .eq('account_id', job.account_id)
    .eq(kind === 'membership_post_expiry' ? 'membership_id' : 'member_service_id', kind === 'membership_post_expiry' ? job.membership_id : job.member_service_id)
    .eq('effective_due_on', job.effective_due_on)
    .eq('activation_generation', job.activation_generation);
  if (historyError) throw historyError;
  const latest = selectPostExpiryMilestone({
    endDate: job.effective_due_on, today, activatedOn: settings.activatedOn,
    handledKeys: (history ?? []).filter((row) => ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(row.state as string)).map((row) => row.milestone_key as string),
    catchUpDays: settings.catchUpDays,
  });
  if (!latest || latest.key !== job.milestone_key) {
    await finishJob(admin, job, 'skipped', { reason: { code: 'superseded_or_expired_milestone' } });
    summary.skipped++; return;
  }
  const phone = kind === 'membership_post_expiry'
    ? (subject as MembershipExpiryCandidate).contact?.phone?.trim()
    : (subject as ServiceExpiryCandidate).phone?.trim();
  if (!phone) { await finishJob(admin, job, 'blocked', { reason: { code: 'missing_phone' } }); summary.blocked++; return; }
  const template = kind === 'membership_post_expiry' ? TEMPLATE_CONTRACTS.membership_post_expiry : TEMPLATE_CONTRACTS.service_post_expiry;
  const [{ data: config }, { data: templates }] = await Promise.all([
    admin.from('whatsapp_config').select('status').eq('account_id', job.account_id).maybeSingle(),
    admin.from('message_templates').select('*').eq('account_id', job.account_id).eq('name', template.payload.name),
  ]);
  const readiness = evaluateTemplateReadiness(templates, template.id, 'en_US');
  if (!config || config.status !== 'connected' || !readiness.ready) {
    await finishJob(admin, job, 'blocked', { reason: { code: !config || config.status !== 'connected' ? 'whatsapp_not_connected' : readiness.code } });
    summary.blocked++; return;
  }
  const { data: reserved, error: reservationError } = await admin.rpc('reserve_lifecycle_reminder_daily_claim', {
    p_job_id: job.id, p_worker_id: job.lease_owner, p_lease_generation: job.lease_generation, p_send_on: today,
  });
  if (reservationError || reserved !== 'reserved') {
    await finishJob(admin, job, reservationError ? 'blocked' : 'deferred', {
      reason: { code: reservationError ? 'daily_coordination_unavailable' : 'daily_contact_budget' },
      nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    });
    if (reservationError) summary.blocked++;
    else summary.deferred++;
    return;
  }
  const fmt = buildFormatters(locale);
  const params = kind === 'membership_post_expiry'
    ? [((subject as MembershipExpiryCandidate).contact?.name?.trim() || 'there'), (subject as MembershipExpiryCandidate).plan?.name || 'membership', fmt.date(job.effective_due_on), fmt.money(Number((subject as MembershipExpiryCandidate).fee_amount))]
    : [((subject as ServiceExpiryCandidate).member_name?.trim() || 'there'), (subject as ServiceExpiryCandidate).item_name_snapshot, fmt.date(job.effective_due_on), fmt.money(Number((subject as ServiceExpiryCandidate).current_renewal_price))];
  let providerRequestStarted = false;
  try {
    await finishJob(admin, job, 'attempting'); summary.attempted++;
    const conversationId = await findOrCreateConversation(admin, job.account_id, account.owner_user_id, job.contact_id);
    const { whatsapp_message_id } = await engineSendTemplate({
      beforeSend: async () => {
        const { data: finalSetting, error: finalSettingError } = await admin.from('renewal_reminder_settings').select(SETTINGS_SELECT).eq('account_id', job.account_id).maybeSingle();
        if (finalSettingError) throw new ReminderInfrastructureError('post_expiry_settings_unavailable');
        const final = finalSetting ? postExpirySettings(finalSetting as Record<string, unknown>, kind) : null;
        if (!final || !final.enabled || final.generation !== job.activation_generation) throw new ReminderNoLongerEligibleError('post_expiry_no_longer_active');
        const finalToday = todayInTz(locale.timeZone, new Date());
        if (!isWithinReminderSendWindow(hourInTz(locale.timeZone, new Date()), final.sendWindowStart, final.sendWindowEnd)) throw new ReminderSetupChangedError('send window changed');
        const finalSubject = await currentPostExpirySubject(admin, job, finalToday);
        if (!finalSubject || await hasCustomerReplySinceExpiry(admin, job, locale.timeZone)) throw new ReminderNoLongerEligibleError('post_expiry_subject_changed_or_replied');
        const { data: finalHistory, error: finalHistoryError } = await admin
          .from('lifecycle_reminder_jobs')
          .select('milestone_key, state')
          .eq('account_id', job.account_id)
          .eq(kind === 'membership_post_expiry' ? 'membership_id' : 'member_service_id', kind === 'membership_post_expiry' ? job.membership_id : job.member_service_id)
          .eq('effective_due_on', job.effective_due_on)
          .eq('activation_generation', job.activation_generation);
        if (finalHistoryError) throw finalHistoryError;
        const finalLatest = selectPostExpiryMilestone({
          endDate: job.effective_due_on,
          today: finalToday,
          activatedOn: final.activatedOn!,
          handledKeys: (finalHistory ?? [])
            .filter((row) => ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(row.state as string))
            .map((row) => row.milestone_key as string),
          catchUpDays: final.catchUpDays,
        });
        if (!finalLatest || finalLatest.key !== job.milestone_key) throw new ReminderNoLongerEligibleError('superseded_or_expired_milestone');
        params[3] = fmt.money(Number(kind === 'membership_post_expiry' ? (finalSubject as MembershipExpiryCandidate).fee_amount : (finalSubject as ServiceExpiryCandidate).current_renewal_price));
        const { data: marked, error: markError } = await admin.rpc('mark_lifecycle_reminder_provider_attempt', { p_job_id: job.id, p_worker_id: job.lease_owner, p_lease_generation: job.lease_generation });
        if (markError || marked !== true) throw new Error(markError?.message ?? 'provider attempt lease lost');
        providerRequestStarted = true;
      }, accountId: job.account_id, userId: account.owner_user_id, conversationId, contactId: job.contact_id,
      templateName: template.payload.name, language: readiness.row.language ?? 'en_US', params,
    });
    await finishJob(admin, job, 'accepted', { providerMessageId: whatsapp_message_id }); summary.accepted++;
    if (shouldEscalatePostExpiry({ milestoneKey: job.milestone_key, state: 'accepted', hasCustomerReply: false })) {
      const { data: escalation, error } = await admin.rpc('escalate_post_expiry_reminder', { p_job_id: job.id });
      if (error) summary.notes.push(`job ${job.id}: escalation unavailable — ${error.message}`);
      else summary.notes.push(`job ${job.id}: post-expiry escalation ${String(escalation)}`);
    }
  } catch (error) {
    if (error instanceof ReminderNoLongerEligibleError) { await finishJob(admin, job, 'skipped', { reason: { code: error.message } }); summary.skipped++; }
    else if (error instanceof ReminderInfrastructureError) { await finishJob(admin, job, 'blocked', { reason: { code: error.message } }); summary.infrastructureFailures++; summary.blocked++; }
    else if (providerRequestStarted) { await finishJob(admin, job, 'ambiguous', { reason: { code: 'provider_outcome_unknown' } }); summary.ambiguous++; }
    else { await finishJob(admin, job, 'queued', { reason: { code: 'provider_request_failed' }, nextAttemptAt: retryAt(job.attempt_count, now) }); summary.failed++; }
  }
}

async function queuePostExpiryCandidates({
  admin,
  account,
  rawSetting,
  today,
  summary,
}: {
  admin: ReturnType<typeof supabaseAdmin>;
  account: AccountRow;
  rawSetting: Record<string, unknown>;
  today: string;
  summary: ReminderRunSummary;
}): Promise<void> {
  const membershipSettings = postExpirySettings(rawSetting, 'membership_post_expiry');
  const serviceSettings = postExpirySettings(rawSetting, 'service_post_expiry');
  const { data: history, error: historyError } = await admin
    .from('lifecycle_reminder_jobs')
    .select('membership_id, member_service_id, effective_due_on, activation_generation, milestone_key')
    .eq('account_id', account.id);
  if (historyError) throw historyError;
  const handledMembership = new Map<string, string[]>();
  const handledService = new Map<string, string[]>();
  for (const row of history ?? []) {
    if (row.membership_id) {
      const key = postExpiryCycleKey(row.membership_id as string, row.effective_due_on as string, row.activation_generation as string);
      handledMembership.set(key, [...(handledMembership.get(key) ?? []), row.milestone_key as string]);
    }
    if (row.member_service_id) {
      const key = postExpiryCycleKey(row.member_service_id as string, row.effective_due_on as string, row.activation_generation as string);
      handledService.set(key, [...(handledService.get(key) ?? []), row.milestone_key as string]);
    }
  }
  if (membershipSettings.enabled && membershipSettings.activatedOn && membershipSettings.activatedAt) {
    const { data, error } = await admin
      .from('memberships')
      .select('id, account_id, contact_id, end_date, status, collection_mode, fee_amount, contact:contacts(id, name, phone), plan:membership_plans(name, plan_type)')
      .eq('account_id', account.id)
      .eq('status', 'active')
      .lt('end_date', today)
      .gte('end_date', membershipSettings.activatedOn);
    if (error) throw error;
    for (const member of (data ?? []) as unknown as MembershipExpiryCandidate[]) {
      if (!isExpiredRenewalCandidate({ status: member.status, endDate: member.end_date, today, renewable: isRenewalChaseable(member.plan), activeAutoPay: member.collection_mode === 'auto' })) continue;
      const cycleKey = postExpiryCycleKey(member.id, member.end_date, membershipSettings.generation);
      const milestone = selectPostExpiryMilestone({ endDate: member.end_date, today, activatedOn: membershipSettings.activatedOn, handledKeys: handledMembership.get(cycleKey) ?? [], catchUpDays: membershipSettings.catchUpDays });
      if (!milestone) continue;
      const subjectCycleId = `${member.id}:${member.end_date}:${membershipSettings.generation}`;
      const { data: created, error: queueError } = await admin.from('lifecycle_reminder_jobs').upsert({
        account_id: account.id, contact_id: member.contact_id, membership_id: member.id,
        kind: 'membership_post_expiry', subject_cycle_id: subjectCycleId, milestone_key: milestone.key,
        business_key: createReminderBusinessKey({ kind: 'membership_post_expiry', invoiceId: null, subjectCycleId, milestoneKey: milestone.key }),
        effective_due_on: member.end_date, coordination_on: today, activation_generation: membershipSettings.generation,
      }, { onConflict: 'account_id,business_key', ignoreDuplicates: true }).select('id');
      if (queueError) summary.notes.push(`membership ${member.id}: post-expiry queue failed — ${queueError.message}`);
      else if (created?.length) summary.queued++;
    }
  }
  if (serviceSettings.enabled && serviceSettings.activatedOn && serviceSettings.activatedAt) {
    const { data, error } = await admin
      .from('service_renewal_queue')
      .select('id, account_id, contact_id, end_date, status, created_at, item_name_snapshot, current_renewal_price, item_is_active, option_is_active, member_name, phone')
      .eq('account_id', account.id)
      .lt('end_date', today)
      .gte('end_date', serviceSettings.activatedOn);
    if (error) throw error;
    for (const service of (data ?? []) as unknown as ServiceExpiryCandidate[]) {
      if (!isExpiredRenewalCandidate({ status: service.status, endDate: service.end_date, today, renewable: service.item_is_active && service.option_is_active && service.current_renewal_price !== null })) continue;
      const cycleKey = postExpiryCycleKey(service.id, service.end_date, serviceSettings.generation);
      const milestone = selectPostExpiryMilestone({ endDate: service.end_date, today, activatedOn: serviceSettings.activatedOn, handledKeys: handledService.get(cycleKey) ?? [], catchUpDays: serviceSettings.catchUpDays });
      if (!milestone) continue;
      const subjectCycleId = `${service.id}:${service.end_date}:${serviceSettings.generation}`;
      const { data: created, error: queueError } = await admin.from('lifecycle_reminder_jobs').upsert({
        account_id: account.id, contact_id: service.contact_id, member_service_id: service.id,
        kind: 'service_post_expiry', subject_cycle_id: subjectCycleId, milestone_key: milestone.key,
        business_key: createReminderBusinessKey({ kind: 'service_post_expiry', invoiceId: null, subjectCycleId, milestoneKey: milestone.key }),
        effective_due_on: service.end_date, coordination_on: today, activation_generation: serviceSettings.generation,
      }, { onConflict: 'account_id,business_key', ignoreDuplicates: true }).select('id');
      if (queueError) summary.notes.push(`service ${service.id}: post-expiry queue failed — ${queueError.message}`);
      else if (created?.length) summary.queued++;
    }
  }
}

async function reconcilePostExpiryEscalations(
  admin: ReturnType<typeof supabaseAdmin>,
  summary: ReminderRunSummary
): Promise<void> {
  // Provider acceptance and staff-task creation are distinct durable effects.
  // A transient task-write failure must be retried without re-sending WhatsApp.
  const { data, error } = await admin
    .from('lifecycle_reminder_jobs')
    .select('id')
    .in('kind', ['membership_post_expiry', 'service_post_expiry'])
    .eq('milestone_key', 'expired-7')
    .in('state', ['accepted', 'delivered'])
    .is('escalated_at', null);
  if (error) {
    summary.infrastructureFailures++;
    summary.notes.push(`post-expiry escalation reconciliation unavailable: ${error.message}`);
    return;
  }
  for (const job of data ?? []) {
    const { data: result, error: escalationError } = await admin.rpc('escalate_post_expiry_reminder', { p_job_id: job.id });
    if (escalationError) {
      summary.infrastructureFailures++;
      summary.notes.push(`job ${job.id}: escalation unavailable — ${escalationError.message}`);
    } else {
      summary.notes.push(`job ${job.id}: post-expiry escalation ${String(result)}`);
    }
  }
}

async function queueCommitmentAndLinkCandidates({
  admin, account, rawSetting, today, now, summary,
}: {
  admin: ReturnType<typeof supabaseAdmin>; account: AccountRow; rawSetting: Record<string, unknown>;
  today: string; now: Date; summary: ReminderRunSummary;
}): Promise<void> {
  const promise = commitmentSettings(rawSetting, 'promise_to_pay_reminders');
  const linkFollowUp = commitmentSettings(rawSetting, 'payment_link_follow_up');
  if (!promise.enabled && !linkFollowUp.enabled) return;
  const [{ data: history, error: historyError }, { data: commitments, error: commitmentsError }, { data: links, error: linksError }] = await Promise.all([
    admin.from('lifecycle_reminder_jobs').select('collection_commitment_id, commitment_revision, payment_link_id, payment_link_revision, milestone_key, state').eq('account_id', account.id),
    promise.enabled && promise.activatedAt
      ? admin.from('invoice_collection_commitments').select('id, invoice_id, contact_id, kind, state, amount, promised_on, revision, created_at').eq('account_id', account.id).eq('kind', 'promise_to_pay').in('state', ['open', 'broken']).gte('created_at', promise.activatedAt)
      : Promise.resolve({ data: [], error: null }),
    linkFollowUp.enabled && linkFollowUp.activatedAt
      ? admin.from('razorpay_payment_links').select('id, invoice_id, revision, expected_amount, short_url, expires_at, status, last_sent_at, last_whatsapp_message_id, invoice:invoices(contact_id)').eq('account_id', account.id).eq('status', 'created').not('last_sent_at', 'is', null).gte('last_sent_at', linkFollowUp.activatedAt)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (historyError || commitmentsError || linksError) throw historyError ?? commitmentsError ?? linksError;
  for (const item of (commitments ?? []) as unknown as CollectionCommitment[]) {
    if (!promise.enabled || !promise.activatedOn || !item.promised_on || item.promised_on < promise.activatedOn) continue;
    const reconciliation = await admin.rpc('reconcile_invoice_collection_commitment', { p_id: item.id });
    if (reconciliation.error) throw reconciliation.error;
    const broken = reconciliation.data === 'broken';
    const handled = (history ?? []).filter((job) => job.collection_commitment_id === item.id && Number(job.commitment_revision) === item.revision && ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(job.state as string)).map((job) => job.milestone_key as string);
    if (broken && !handled.includes('promise-broken')) {
      const subjectCycleId = `${item.id}:${item.revision}:${promise.generation}`;
      const { data, error } = await admin.from('lifecycle_reminder_jobs').upsert({
        account_id: account.id, contact_id: item.contact_id, invoice_id: item.invoice_id, collection_commitment_id: item.id, commitment_revision: item.revision,
        kind: 'promise_to_pay', subject_cycle_id: subjectCycleId, milestone_key: 'promise-broken',
        business_key: createReminderBusinessKey({ kind: 'promise_to_pay', invoiceId: item.invoice_id, subjectCycleId, milestoneKey: 'promise-broken' }),
        effective_due_on: item.promised_on, coordination_on: today, activation_generation: promise.generation,
      }, { onConflict: 'account_id,business_key', ignoreDuplicates: true }).select('id');
      if (error) summary.notes.push(`broken commitment ${item.id}: queue failed — ${error.message}`); else if (data?.length) summary.queued++;
      continue;
    }
    if (reconciliation.data !== 'open') continue;
    const milestone = selectDueMilestone({ anchorDate: item.promised_on, today, activatedOn: promise.activatedOn, milestones: [{ key: 'promise-before-1', offsetDays: -1 }, { key: 'promise-due', offsetDays: 0 }], handledKeys: handled, catchUpDays: 1 });
    if (!milestone) continue;
    const subjectCycleId = `${item.id}:${item.revision}:${promise.generation}`;
    const { data, error } = await admin.from('lifecycle_reminder_jobs').upsert({
      account_id: account.id, contact_id: item.contact_id, invoice_id: item.invoice_id, collection_commitment_id: item.id, commitment_revision: item.revision,
      kind: 'promise_to_pay', subject_cycle_id: subjectCycleId, milestone_key: milestone.key,
      business_key: createReminderBusinessKey({ kind: 'promise_to_pay', invoiceId: item.invoice_id, subjectCycleId, milestoneKey: milestone.key }),
      effective_due_on: item.promised_on, coordination_on: today, activation_generation: promise.generation,
    }, { onConflict: 'account_id,business_key', ignoreDuplicates: true }).select('id');
    if (error) summary.notes.push(`commitment ${item.id}: queue failed — ${error.message}`); else if (data?.length) summary.queued++;
  }
  for (const link of (links ?? []) as unknown as PaymentLinkCandidate[]) {
    if (!linkFollowUp.enabled || !linkFollowUp.activatedOn || !link.last_sent_at || !link.last_whatsapp_message_id || !link.short_url || !link.invoice?.contact_id) continue;
    if (new Date(link.expires_at) <= now) {
      const { data: escalation, error } = await admin.rpc('escalate_expired_payment_link', { p_link_id: link.id });
      if (error) summary.notes.push(`payment link ${link.id}: expiry action unavailable — ${error.message}`);
      else summary.notes.push(`payment link ${link.id}: expiry action ${String(escalation)}`);
      continue;
    }
    const sentOn = todayInTz(resolveAccountLocale(account).timeZone, new Date(link.last_sent_at));
    if (sentOn < linkFollowUp.activatedOn) continue;
    const handled = (history ?? []).filter((job) => job.payment_link_id === link.id && Number(job.payment_link_revision) === link.revision && ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(job.state as string)).map((job) => job.milestone_key as string);
    const milestone = selectDueMilestone({ anchorDate: sentOn, today, activatedOn: linkFollowUp.activatedOn, milestones: [{ key: 'link-after-1', offsetDays: 1 }, { key: 'link-after-3', offsetDays: 3 }], handledKeys: handled, catchUpDays: 1 });
    if (!milestone) continue;
    const subjectCycleId = `${link.id}:${link.revision}:${linkFollowUp.generation}`;
    const { data, error } = await admin.from('lifecycle_reminder_jobs').upsert({
      account_id: account.id, invoice_id: link.invoice_id, payment_link_id: link.id, payment_link_revision: link.revision,
      contact_id: link.invoice.contact_id, kind: 'payment_link_follow_up', subject_cycle_id: subjectCycleId, milestone_key: milestone.key,
      business_key: createReminderBusinessKey({ kind: 'payment_link_follow_up', invoiceId: link.invoice_id, subjectCycleId, milestoneKey: milestone.key }),
      effective_due_on: sentOn, coordination_on: today, activation_generation: linkFollowUp.generation,
    }, { onConflict: 'account_id,business_key', ignoreDuplicates: true }).select('id');
    if (error) summary.notes.push(`payment link ${link.id}: queue failed — ${error.message}`); else if (data?.length) summary.queued++;
  }
}

async function processCommitmentOrLinkJob({ admin, job, account, now, summary }: {
  admin: ReturnType<typeof supabaseAdmin>; job: LifecycleReminderJob; account: AccountRow; now: Date; summary: ReminderRunSummary;
}) {
  const { data: rawSetting, error: settingError } = await admin.from('renewal_reminder_settings').select(SETTINGS_SELECT).eq('account_id', job.account_id).maybeSingle();
  if (settingError || !rawSetting) { await finishJob(admin, job, 'blocked', { reason: { code: 'commitment_settings_unavailable' } }); summary.blocked++; return; }
  const prefix = job.kind === 'promise_to_pay' ? 'promise_to_pay_reminders' : 'payment_link_follow_up';
  const settings = commitmentSettings(rawSetting as Record<string, unknown>, prefix);
  const locale = resolveAccountLocale(account);
  const today = todayInTz(locale.timeZone, now);
  if (!settings.enabled || !settings.activatedOn || !settings.activatedAt || settings.generation !== job.activation_generation) { await finishJob(admin, job, 'skipped', { reason: { code: 'commitment_lifecycle_no_longer_active' } }); summary.skipped++; return; }
  if (!isWithinReminderSendWindow(hourInTz(locale.timeZone, now), Number((rawSetting as Record<string, unknown>).invoice_collection_send_window_start ?? 9), Number((rawSetting as Record<string, unknown>).invoice_collection_send_window_end ?? 19))) { await finishJob(admin, job, 'deferred', { reason: { code: 'outside_send_window' }, nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString() }); summary.deferred++; return; }
  const { data: invoice, error: invoiceError } = await admin.from('invoice_balances').select('id, contact_id, invoice_number, balance, state, requires_refund_review, contact:contacts(id, name, phone)').eq('account_id', job.account_id).eq('id', job.invoice_id).maybeSingle();
  const current = invoice as unknown as InvoiceCandidate | null;
  if (invoiceError) throw invoiceError;
  if (!current || !isCollectibleInvoice({ state: current.state, balance: Number(current.balance), requiresRefundReview: current.requires_refund_review })) { await finishJob(admin, job, 'skipped', { reason: { code: 'invoice_no_longer_collectible' } }); summary.skipped++; return; }
  if (job.kind === 'payment_link_follow_up') {
    const { data: holds, error: holdsError } = await admin.from('invoice_collection_commitments').select('id').eq('account_id', job.account_id).eq('invoice_id', current.id).eq('state', 'open');
    if (holdsError) throw holdsError;
    if ((holds ?? []).length > 0) {
      await finishJob(admin, job, 'deferred', { reason: { code: 'invoice_commitment_or_hold_open' }, nextAttemptAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString() });
      summary.deferred++; return;
    }
  }
  let template = TEMPLATE_CONTRACTS.payment_promise_reminder;
  let params: string[];
  let promiseReminderAmount: number | null = null;
  if (job.kind === 'promise_to_pay') {
    const { data: commitment, error } = await admin.from('invoice_collection_commitments').select('id, invoice_id, contact_id, kind, state, amount, promised_on, revision, payment_allocation_snapshot').eq('account_id', job.account_id).eq('invoice_id', current.id).eq('id', job.collection_commitment_id).maybeSingle();
    if (error) throw error;
    const item = commitment as unknown as CollectionCommitment | null;
    if (!item || item.invoice_id !== current.id || item.contact_id !== current.contact_id || item.kind !== 'promise_to_pay' || item.revision !== job.commitment_revision || !item.promised_on || item.amount === null || !['open', 'broken'].includes(item.state) || (item.state === 'broken') !== (job.milestone_key === 'promise-broken')) { await finishJob(admin, job, 'skipped', { reason: { code: 'promise_changed_or_resolved' } }); summary.skipped++; return; }
    const { data: otherOpenCommitments, error: otherOpenCommitmentsError } = await admin
      .from('invoice_collection_commitments')
      .select('id')
      .eq('account_id', job.account_id)
      .eq('invoice_id', current.id)
      .eq('state', 'open')
      .neq('id', item.id);
    if (otherOpenCommitmentsError) throw otherOpenCommitmentsError;
    if ((otherOpenCommitments ?? []).length > 0) {
      await finishJob(admin, job, 'deferred', { reason: { code: 'invoice_hold_open' }, nextAttemptAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString() });
      summary.deferred++; return;
    }
    const result = await admin.rpc('reconcile_invoice_collection_commitment', { p_id: item.id });
    if (result.error) throw result.error;
    if ((job.milestone_key === 'promise-broken' && result.data !== 'broken') || (job.milestone_key !== 'promise-broken' && result.data !== 'open')) { await finishJob(admin, job, 'skipped', { reason: { code: 'promise_payment_reconciled' } }); summary.skipped++; return; }
    const latest = job.milestone_key === 'promise-broken'
      ? selectDueMilestone({ anchorDate: item.promised_on, today, activatedOn: settings.activatedOn, milestones: [{ key: 'promise-broken', offsetDays: 1 }], handledKeys: [], catchUpDays: 1 })
      : selectDueMilestone({ anchorDate: item.promised_on, today, activatedOn: settings.activatedOn, milestones: [{ key: 'promise-before-1', offsetDays: -1 }, { key: 'promise-due', offsetDays: 0 }], handledKeys: [], catchUpDays: 1 });
    if (!latest || latest.key !== job.milestone_key) { await finishJob(admin, job, 'skipped', { reason: { code: 'promise_milestone_superseded' } }); summary.skipped++; return; }
    const allocation = await admin.rpc('invoice_commitment_payment_allocations', { p_invoice_id: item.invoice_id });
    if (allocation.error) throw allocation.error;
    promiseReminderAmount = Math.min(Number(current.balance), Math.max(Number(item.amount) - Math.max(Number(allocation.data ?? 0) - Number(item.payment_allocation_snapshot ?? 0), 0), 0));
    if (promiseReminderAmount <= 0) { await finishJob(admin, job, 'skipped', { reason: { code: 'promise_payment_reconciled' } }); summary.skipped++; return; }
    params = [current.contact?.name?.trim() || 'there', current.invoice_number ?? `#${current.id.slice(0, 8).toUpperCase()}`, buildFormatters(locale).money(promiseReminderAmount), buildFormatters(locale).date(item.promised_on)];
  } else {
    template = TEMPLATE_CONTRACTS.payment_link;
    const { data: link, error } = await admin.from('razorpay_payment_links').select('id, invoice_id, revision, expected_amount, short_url, expires_at, status, last_sent_at, last_whatsapp_message_id').eq('account_id', job.account_id).eq('invoice_id', current.id).eq('id', job.payment_link_id).maybeSingle();
    if (error) throw error;
    const item = link as unknown as PaymentLinkCandidate | null;
    if (!item || item.invoice_id !== current.id || item.revision !== job.payment_link_revision || item.status !== 'created' || !item.short_url || !item.last_sent_at || !item.last_whatsapp_message_id || new Date(item.expires_at) <= now || Number(item.expected_amount) !== Number(current.balance)) { await finishJob(admin, job, 'skipped', { reason: { code: 'payment_link_not_current' } }); summary.skipped++; return; }
    const sentOn = todayInTz(locale.timeZone, new Date(item.last_sent_at));
    const latest = selectDueMilestone({ anchorDate: sentOn, today, activatedOn: settings.activatedOn, milestones: [{ key: 'link-after-1', offsetDays: 1 }, { key: 'link-after-3', offsetDays: 3 }], handledKeys: [], catchUpDays: 1 });
    if (!latest || latest.key !== job.milestone_key) { await finishJob(admin, job, 'skipped', { reason: { code: 'link_milestone_superseded' } }); summary.skipped++; return; }
    params = [current.contact?.name?.trim() || 'there', buildFormatters(locale).money(Number(current.balance)), current.invoice_number ?? `#${current.id.slice(0, 8).toUpperCase()}`, item.short_url];
  }
  const phone = current.contact?.phone?.trim();
  if (!phone) { await finishJob(admin, job, 'blocked', { reason: { code: 'missing_phone' } }); summary.blocked++; return; }
  const [{ data: config }, { data: templates }] = await Promise.all([admin.from('whatsapp_config').select('status').eq('account_id', job.account_id).maybeSingle(), admin.from('message_templates').select('*').eq('account_id', job.account_id).eq('name', template.payload.name)]);
  const readiness = evaluateTemplateReadiness(templates, template.id, 'en_US');
  if (!config || config.status !== 'connected' || !readiness.ready) { await finishJob(admin, job, 'blocked', { reason: { code: !config || config.status !== 'connected' ? 'whatsapp_not_connected' : readiness.code } }); summary.blocked++; return; }
  const { data: reservation, error: reservationError } = await admin.rpc('reserve_lifecycle_reminder_daily_claim', { p_job_id: job.id, p_worker_id: job.lease_owner, p_lease_generation: job.lease_generation, p_send_on: today });
  if (reservationError || reservation !== 'reserved') { await finishJob(admin, job, reservationError ? 'blocked' : 'deferred', { reason: { code: reservationError ? 'daily_coordination_unavailable' : 'daily_contact_budget' }, nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString() }); if (reservationError) summary.blocked++; else summary.deferred++; return; }
  let providerRequestStarted = false;
  try {
    await finishJob(admin, job, 'attempting'); summary.attempted++;
    const conversationId = await findOrCreateConversation(admin, job.account_id, account.owner_user_id, current.contact_id);
    const result = await engineSendTemplate({
      beforeSend: async () => {
        // The queue has a durable reservation, but this is the actual Meta boundary:
        // re-read invoice truth and mark the non-retryable provider attempt.
        const { data: finalSetting, error: finalSettingError } = await admin.from('renewal_reminder_settings').select(SETTINGS_SELECT).eq('account_id', job.account_id).maybeSingle();
        if (finalSettingError) throw new ReminderDeferredError('commitment_settings_unavailable');
        if (!finalSetting) throw new ReminderNoLongerEligibleError('commitment_lifecycle_no_longer_active');
        const finalSettings = commitmentSettings(finalSetting as Record<string, unknown>, prefix);
        if (!finalSettings.enabled || !finalSettings.activatedAt || !finalSettings.activatedOn || finalSettings.generation !== job.activation_generation) throw new ReminderNoLongerEligibleError('commitment_lifecycle_no_longer_active');
        if (!isWithinReminderSendWindow(hourInTz(locale.timeZone, now), Number((finalSetting as Record<string, unknown>).invoice_collection_send_window_start ?? 9), Number((finalSetting as Record<string, unknown>).invoice_collection_send_window_end ?? 19))) throw new ReminderDeferredError('outside_send_window');
        const { data: finalInvoice, error: finalInvoiceError } = await admin.from('invoice_balances').select('balance, state, requires_refund_review').eq('account_id', job.account_id).eq('id', job.invoice_id).maybeSingle();
        if (finalInvoiceError) throw new ReminderDeferredError('invoice_balance_unavailable');
        if (!finalInvoice || !isCollectibleInvoice({ state: finalInvoice.state as string, balance: Number(finalInvoice.balance), requiresRefundReview: Boolean(finalInvoice.requires_refund_review) })) throw new ReminderNoLongerEligibleError('invoice no longer collectible');
        if (await needsAutoPayReconciliation(admin, job.account_id, current.id)) throw new ReminderDeferredError('autopay_reconciliation_required');
        if (job.kind === 'promise_to_pay') {
          const { data: finalPromise, error: finalPromiseLookupError } = await admin.from('invoice_collection_commitments').select('id, kind, state, amount, promised_on, revision, payment_allocation_snapshot').eq('account_id', job.account_id).eq('invoice_id', current.id).eq('id', job.collection_commitment_id).maybeSingle();
          if (finalPromiseLookupError) throw new ReminderDeferredError('promise_lookup_unavailable');
          if (!finalPromise || finalPromise.kind !== 'promise_to_pay' || Number(finalPromise.revision) !== job.commitment_revision || (job.milestone_key === 'promise-broken' ? finalPromise.state !== 'broken' : finalPromise.state !== 'open')) throw new ReminderNoLongerEligibleError('promise_changed_or_resolved');
          const { data: finalOpenHolds, error: finalOpenHoldsError } = await admin.from('invoice_collection_commitments').select('id').eq('account_id', job.account_id).eq('invoice_id', current.id).eq('state', 'open').neq('id', job.collection_commitment_id);
          if (finalOpenHoldsError) throw new ReminderDeferredError('commitment_lookup_unavailable');
          if ((finalOpenHolds ?? []).length > 0) throw new ReminderDeferredError('invoice_hold_open');
          const reconciliation = await admin.rpc('reconcile_invoice_collection_commitment', { p_id: job.collection_commitment_id });
          if (reconciliation.error) throw new ReminderDeferredError('promise_reconciliation_unavailable');
          if (job.milestone_key === 'promise-broken' ? reconciliation.data !== 'broken' : reconciliation.data !== 'open') throw new ReminderNoLongerEligibleError('promise_payment_reconciled');
          const { data: finalPromiseRow, error: finalPromiseError } = await admin.from('invoice_collection_commitments').select('amount, payment_allocation_snapshot').eq('account_id', job.account_id).eq('invoice_id', current.id).eq('id', job.collection_commitment_id).maybeSingle();
          const finalAllocation = await admin.rpc('invoice_commitment_payment_allocations', { p_invoice_id: job.invoice_id });
          const finalAmount = Math.min(Number(finalInvoice.balance), Math.max(Number(finalPromiseRow?.amount ?? 0) - Math.max(Number(finalAllocation.data ?? 0) - Number(finalPromiseRow?.payment_allocation_snapshot ?? 0), 0), 0));
          if (finalPromiseError || finalAllocation.error) throw new ReminderDeferredError('promise_balance_unavailable');
          if (finalAmount <= 0) throw new ReminderNoLongerEligibleError('promise_payment_reconciled');
          if (finalAmount !== promiseReminderAmount) throw new ReminderDeferredError('promise_residual_changed');
        } else {
          const { data: finalOpenCommitments, error: finalOpenCommitmentsError } = await admin.from('invoice_collection_commitments').select('id').eq('account_id', job.account_id).eq('invoice_id', current.id).eq('state', 'open');
          if (finalOpenCommitmentsError) throw new ReminderDeferredError('commitment_lookup_unavailable');
          if ((finalOpenCommitments ?? []).length > 0) throw new ReminderDeferredError('invoice_commitment_or_hold_open');
          const { data: finalLink, error: finalLinkError } = await admin.from('razorpay_payment_links').select('id, invoice_id, revision, expected_amount, short_url, expires_at, status, last_sent_at, last_whatsapp_message_id').eq('account_id', job.account_id).eq('invoice_id', current.id).eq('id', job.payment_link_id).maybeSingle();
          if (finalLinkError) throw new ReminderDeferredError('payment_link_lookup_unavailable');
          if (!finalLink || Number(finalLink.revision) !== job.payment_link_revision || finalLink.status !== 'created' || !finalLink.short_url || !finalLink.last_sent_at || !finalLink.last_whatsapp_message_id || new Date(finalLink.expires_at) <= now || Number(finalLink.expected_amount) !== Number(finalInvoice.balance) || new Date(finalLink.last_sent_at) < new Date(finalSettings.activatedAt)) throw new ReminderNoLongerEligibleError('payment_link_not_current');
          const finalMilestone = selectDueMilestone({ anchorDate: todayInTz(locale.timeZone, new Date(finalLink.last_sent_at)), today, activatedOn: finalSettings.activatedOn, milestones: [{ key: 'link-after-1', offsetDays: 1 }, { key: 'link-after-3', offsetDays: 3 }], handledKeys: [], catchUpDays: 1 });
          if (!finalMilestone || finalMilestone.key !== job.milestone_key) throw new ReminderNoLongerEligibleError('link_milestone_superseded');
        }
        const { data: marked, error: markError } = await admin.rpc('mark_lifecycle_reminder_provider_attempt', { p_job_id: job.id, p_worker_id: job.lease_owner, p_lease_generation: job.lease_generation });
        if (markError || marked !== true) throw new Error(markError?.message ?? 'provider attempt lease lost'); providerRequestStarted = true;
      }, accountId: job.account_id, userId: account.owner_user_id, conversationId, contactId: current.contact_id, templateName: template.payload.name, language: readiness.row.language ?? 'en_US', params,
    });
    await finishJob(admin, job, 'accepted', { providerMessageId: result.whatsapp_message_id }); summary.accepted++;
  } catch (error) {
    if (error instanceof ReminderNoLongerEligibleError) { await finishJob(admin, job, 'skipped', { reason: { code: error.message } }); summary.skipped++; }
    else if (error instanceof ReminderDeferredError) { await finishJob(admin, job, 'deferred', { reason: { code: error.message }, nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString() }); summary.deferred++; }
    else if (providerRequestStarted) { await finishJob(admin, job, 'ambiguous', { reason: { code: 'provider_outcome_unknown' } }); summary.ambiguous++; }
    else { await finishJob(admin, job, 'queued', { reason: { code: 'provider_request_failed' }, nextAttemptAt: retryAt(job.attempt_count, now) }); summary.failed++; }
  }
}

/**
 * Queue only invoices issued after the current activation generation. The
 * invoice model has no general due-date column, so issued-at (in the account
 * timezone) is the documented effective due date; fixed installments retain
 * their promised second_due_on in their dedicated subject/cycle jobs.
 */
export async function runLifecycleReminderWorker(
  now = new Date()
): Promise<ReminderRunSummary> {
  const admin = supabaseAdmin();
  const summary = emptySummary();
  const workerId = crypto.randomUUID();
  const { data: rawSettings, error: settingsError } = await admin
    .from('renewal_reminder_settings')
    .select(SETTINGS_SELECT);
  if (settingsError) throw settingsError;

  // Provider acceptance is not delivery. Reconcile only from the existing
  // durable inbox message record keyed by Meta's provider message id.
  const { data: acceptedJobs, error: acceptedJobsError } = await admin
    .from('lifecycle_reminder_jobs')
    .select('id, provider_message_id')
    .eq('state', 'accepted')
    .not('provider_message_id', 'is', null);
  if (acceptedJobsError) {
    summary.infrastructureFailures++;
    summary.notes.push(`delivery reconciliation unavailable: ${acceptedJobsError.message}`);
  } else if ((acceptedJobs ?? []).length > 0) {
    const messageIds = acceptedJobs!.map((job) => job.provider_message_id as string);
    const { data: messages, error: messagesError } = await admin
      .from('messages')
      .select('message_id, status')
      .in('message_id', messageIds)
      .in('status', ['delivered', 'read', 'failed']);
    if (messagesError) {
      summary.infrastructureFailures++;
      summary.notes.push(`delivery status lookup unavailable: ${messagesError.message}`);
    } else {
      const statusByMessageId = new Map(
        (messages ?? []).map((message) => [message.message_id as string, message.status as string])
      );
      const deliveryUpdates = await Promise.all(
        acceptedJobs!
          .filter((job) => statusByMessageId.has(job.provider_message_id as string))
          .map((job) =>
            admin
              .from('lifecycle_reminder_jobs')
              .update(
                statusByMessageId.get(job.provider_message_id as string) === 'failed'
                  ? { state: 'failed', reason: { code: 'provider_delivery_failed' } }
                  : { state: 'delivered', delivered_at: new Date().toISOString() }
              )
              .eq('id', job.id)
              .eq('state', 'accepted')
          )
      );
      const deliveryUpdateError = deliveryUpdates.find((result) => result.error)?.error;
      if (deliveryUpdateError) {
        summary.infrastructureFailures++;
        summary.notes.push(`delivery reconciliation write unavailable: ${deliveryUpdateError.message}`);
      }
    }
  }
  await reconcilePostExpiryEscalations(admin, summary);

  const accountContexts = new Map<
    string,
    { account: AccountRow }
  >();
  for (const rawSetting of (rawSettings ?? []) as Record<string, unknown>[]) {
    const settings = asSettings(rawSetting);
    const membershipPostExpiry = postExpirySettings(rawSetting, 'membership_post_expiry');
    const servicePostExpiry = postExpirySettings(rawSetting, 'service_post_expiry');
    const promiseToPay = commitmentSettings(rawSetting, 'promise_to_pay_reminders');
    const paymentLinkFollowUp = commitmentSettings(rawSetting, 'payment_link_follow_up');
    const retentionEnabled = rawSetting.session_pack_reminders_enabled === true || rawSetting.freeze_return_reminders_enabled === true || rawSetting.membership_win_back_enabled === true || rawSetting.service_win_back_enabled === true;
    const transactionEventsEnabled = rawSetting.payment_confirmations_enabled === true || rawSetting.autopay_recovery_enabled === true;
    if (
      (!settings.enabled || !settings.activatedOn || !settings.activatedAt) &&
      (!membershipPostExpiry.enabled || !membershipPostExpiry.activatedOn || !membershipPostExpiry.activatedAt) &&
      (!servicePostExpiry.enabled || !servicePostExpiry.activatedOn || !servicePostExpiry.activatedAt) &&
      (!promiseToPay.enabled || !promiseToPay.activatedOn || !promiseToPay.activatedAt) &&
      (!paymentLinkFollowUp.enabled || !paymentLinkFollowUp.activatedOn || !paymentLinkFollowUp.activatedAt) &&
      !transactionEventsEnabled &&
      !retentionEnabled
    ) continue;
    const { data: account, error: accountError } = await admin
      .from('accounts')
      .select(
        'id, owner_user_id, timezone, default_currency, country_code, locale, date_order, time_format, week_start, phone_country_code, measurement_system'
      )
      .eq('id', settings.accountId)
      .maybeSingle();
    if (accountError || !account) {
      summary.notes.push(`account ${settings.accountId}: account locale unavailable`);
      continue;
    }
    try {
      await requireProductAccess(admin, settings.accountId);
    } catch {
      summary.notes.push(`account ${settings.accountId}: product_access_required`);
      continue;
    }
    const typedAccount = account as AccountRow;
    accountContexts.set(settings.accountId, { account: typedAccount });
    summary.accountsConsidered++;

    const locale = resolveAccountLocale(typedAccount);
    const today = todayInTz(locale.timeZone, now);
    try {
      await queuePostExpiryCandidates({ admin, account: typedAccount, rawSetting, today, summary });
    } catch (error) {
      summary.infrastructureFailures++;
      summary.notes.push(`account ${settings.accountId}: post-expiry source query failed — ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await queueCommitmentAndLinkCandidates({ admin, account: typedAccount, rawSetting, today, now, summary });
    } catch (error) {
      summary.infrastructureFailures++;
      summary.notes.push(`account ${settings.accountId}: commitment source query failed — ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await queueRetentionCandidates({ admin, account: typedAccount, rawSetting, today, now, summary });
    } catch (error) {
      summary.infrastructureFailures++;
      summary.notes.push(`account ${settings.accountId}: retention source query failed — ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!settings.enabled || !settings.activatedOn || !settings.activatedAt) continue;
    if (
      !isWithinReminderSendWindow(
        hourInTz(locale.timeZone, now),
        settings.sendWindowStart,
        settings.sendWindowEnd
      )
    ) {
      summary.deferred++;
      continue;
    }

    const [
      { data: invoices, error: invoicesError },
      { data: handled },
      { data: installments, error: installmentsError },
    ] =
      await Promise.all([
        admin
          .from('invoice_balances')
          .select(
            'id, account_id, contact_id, membership_id, issued_at, invoice_number, balance, state, requires_refund_review, contact:contacts(id, name, phone)'
          )
          .eq('account_id', settings.accountId)
          .gte('issued_at', settings.activatedAt),
        admin
          .from('lifecycle_reminder_jobs')
          .select('invoice_id, installment_plan_id, milestone_key')
          .eq('account_id', settings.accountId),
        admin
          .from('membership_installment_plans')
          .select('id, invoice_id, contact_id, second_due_on, created_at')
          .eq('account_id', settings.accountId)
          .gte('created_at', settings.activatedAt),
      ]);
    if (invoicesError || installmentsError) {
      summary.infrastructureFailures++;
      summary.notes.push(`account ${settings.accountId}: collection source query failed — ${(invoicesError ?? installmentsError)?.message}`);
      continue;
    }
    const installmentInvoiceIds = new Set(
      ((installments ?? []) as unknown as InstallmentCandidate[])
        .map((installment) => installment.invoice_id)
        .filter((invoiceId): invoiceId is string => invoiceId !== null)
    );
    const handledByInvoice = new Map<string, string[]>();
    const handledByInstallment = new Map<string, string[]>();
    for (const row of handled ?? []) {
      if (row.invoice_id && !row.installment_plan_id) {
        handledByInvoice.set(row.invoice_id as string, [
          ...(handledByInvoice.get(row.invoice_id as string) ?? []),
          row.milestone_key as string,
        ]);
      }
      if (row.installment_plan_id) {
        handledByInstallment.set(row.installment_plan_id as string, [
          ...(handledByInstallment.get(row.installment_plan_id as string) ?? []),
          row.milestone_key as string,
        ]);
      }
    }
    const generation = String(rawSetting.invoice_collection_generation);
    for (const invoice of (invoices ?? []) as unknown as InvoiceCandidate[]) {
      if (!isCollectibleInvoice({
        state: invoice.state,
        balance: Number(invoice.balance),
        requiresRefundReview: invoice.requires_refund_review,
      })) continue;
      const effectiveDueOn = todayInTz(locale.timeZone, new Date(invoice.issued_at));
      const milestone = selectDueMilestone({
        anchorDate: effectiveDueOn,
        today,
        activatedOn: settings.activatedOn,
        milestones: invoiceMilestones(settings.beforeDueDays, settings.overdueDays),
        handledKeys: handledByInvoice.get(invoice.id) ?? [],
        catchUpDays: settings.catchUpDays,
      });
      if (!milestone) continue;
      if (
        shouldSuppressGeneralPreDue({
          invoiceId: invoice.id,
          milestone,
          installmentInvoiceIds,
        })
      ) {
        continue;
      }
      const kind: LifecycleReminderKind =
        milestone.offsetDays > 0 ? 'invoice_overdue' : 'invoice_due';
      const subjectCycleId = `${invoice.id}:${generation}`;
      const businessKey = createReminderBusinessKey({
        kind,
        invoiceId: invoice.id,
        subjectCycleId,
        milestoneKey: milestone.key,
      });
      const { data: created, error: queueError } = await admin
        .from('lifecycle_reminder_jobs')
        .upsert(
          {
            account_id: settings.accountId,
            contact_id: invoice.contact_id,
            invoice_id: invoice.id,
            kind,
            subject_cycle_id: subjectCycleId,
            milestone_key: milestone.key,
            business_key: businessKey,
            effective_due_on: effectiveDueOn,
            coordination_on: today,
            activation_generation: generation,
          },
          { onConflict: 'account_id,business_key', ignoreDuplicates: true }
        )
        .select('id');
      if (queueError) {
        summary.notes.push(`invoice ${invoice.id}: queue failed — ${queueError.message}`);
      } else if (created?.length) {
        summary.queued++;
      }
    }

    const collectibleInvoices = new Map(
      ((invoices ?? []) as unknown as InvoiceCandidate[])
        .filter((invoice) =>
          isCollectibleInvoice({
            state: invoice.state,
            balance: Number(invoice.balance),
            requiresRefundReview: invoice.requires_refund_review,
          })
        )
        .map((invoice) => [invoice.id, invoice])
    );
    for (const installment of (installments ?? []) as unknown as InstallmentCandidate[]) {
      if (!installment.invoice_id || !collectibleInvoices.has(installment.invoice_id)) continue;
      const milestone = selectDueMilestone({
        anchorDate: installment.second_due_on,
        today,
        activatedOn: settings.activatedOn,
        milestones: settings.overdueDays.map((days) => ({
          key: `overdue-${Math.abs(days)}`,
          offsetDays: Math.abs(days),
        })),
        handledKeys: handledByInstallment.get(installment.id) ?? [],
        catchUpDays: settings.catchUpDays,
      });
      if (!milestone) continue;
      const subjectCycleId = `${installment.id}:${generation}`;
      const businessKey = createReminderBusinessKey({
        kind: 'installment_overdue',
        invoiceId: installment.invoice_id,
        subjectCycleId,
        milestoneKey: milestone.key,
      });
      const { data: created, error: queueError } = await admin
        .from('lifecycle_reminder_jobs')
        .upsert(
          {
            account_id: settings.accountId,
            contact_id: installment.contact_id,
            invoice_id: installment.invoice_id,
            installment_plan_id: installment.id,
            kind: 'installment_overdue',
            subject_cycle_id: subjectCycleId,
            milestone_key: milestone.key,
            business_key: businessKey,
            effective_due_on: installment.second_due_on,
            coordination_on: today,
            activation_generation: generation,
          },
          { onConflict: 'account_id,business_key', ignoreDuplicates: true }
        )
        .select('id');
      if (queueError) {
        summary.notes.push(`installment ${installment.id}: queue failed — ${queueError.message}`);
      } else if (created?.length) {
        summary.queued++;
      }
    }
  }

  const { data: claimed, error: claimError } = await admin.rpc(
    'claim_lifecycle_reminder_jobs',
    { p_worker_id: workerId, p_limit: MAX_JOBS_PER_RUN }
  );
  if (claimError) throw claimError;
  for (const job of (claimed ?? []) as LifecycleReminderJob[]) {
    try {
    const context = accountContexts.get(job.account_id);
    if (!context) {
      await finishJob(admin, job, 'blocked', { reason: { code: 'account_not_enabled' } });
      summary.blocked++;
      continue;
    }
    const { account } = context;
    if (job.kind === 'membership_post_expiry' || job.kind === 'service_post_expiry') {
      await processPostExpiryJob({ admin, job, account, now, summary });
      continue;
    }
    if (job.kind === 'promise_to_pay' || job.kind === 'payment_link_follow_up') {
      await processCommitmentOrLinkJob({ admin, job, account, now, summary });
      continue;
    }
    if (job.kind === 'payment_confirmation' || job.kind === 'autopay_recovery') {
      const outcome = await processTransactionEventJob({
        admin, job, account, now,
        finish: (state, options) => finishJob(admin, job, state, options),
        findConversation: (accountId, userId, contactId) => findOrCreateConversation(admin, accountId, userId, contactId),
        markProviderAttempt: async () => {
          const { data, error } = await admin.rpc('mark_lifecycle_reminder_provider_attempt', {
            p_job_id: job.id, p_worker_id: job.lease_owner, p_lease_generation: job.lease_generation,
          });
          if (error || data !== true) throw new Error(error?.message ?? 'provider attempt lease lost');
        },
        reserveDailyClaim: async (sendOn) => {
          const { data, error } = await admin.rpc('reserve_lifecycle_reminder_daily_claim', {
            p_job_id: job.id, p_worker_id: job.lease_owner, p_lease_generation: job.lease_generation, p_send_on: sendOn,
          });
          if (error || (data !== 'reserved' && data !== 'deferred')) throw new Error(error?.message ?? 'daily coordination lease lost');
          return data;
        },
      });
      if (outcome === 'accepted') summary.accepted++;
      else if (outcome === 'blocked') summary.blocked++;
      else if (outcome === 'skipped') summary.skipped++;
      else if (outcome === 'deferred') summary.deferred++;
      else if (outcome === 'ambiguous') summary.ambiguous++;
      else summary.failed++;
      continue;
    }
    if (job.kind === 'session_pack_low' || job.kind === 'session_pack_exhausted' || job.kind === 'freeze_return' || job.kind === 'membership_win_back' || job.kind === 'service_win_back') {
      await processRetentionJob({
        admin, job, account, now, summary,
        finish: (state, options) => finishJob(admin, job, state, options),
        findConversation: (accountId, userId, contactId) => findOrCreateConversation(admin, accountId, userId, contactId),
        markProviderAttempt: async () => {
          const { data, error } = await admin.rpc('mark_lifecycle_reminder_provider_attempt', { p_job_id: job.id, p_worker_id: job.lease_owner, p_lease_generation: job.lease_generation });
          if (error || data !== true) throw new Error(error?.message ?? 'provider attempt lease lost');
        },
        reserveDailyClaim: async (sendOn) => {
          const { data, error } = await admin.rpc('reserve_lifecycle_reminder_daily_claim', { p_job_id: job.id, p_worker_id: job.lease_owner, p_lease_generation: job.lease_generation, p_send_on: sendOn });
          if (error || (data !== 'reserved' && data !== 'deferred')) throw new Error(error?.message ?? 'daily coordination lease lost');
          return data;
        },
      });
      continue;
    }
    const { data: currentSettingsRow, error: currentSettingsError } = await admin
      .from('renewal_reminder_settings')
      .select(SETTINGS_SELECT)
      .eq('account_id', job.account_id)
      .maybeSingle();
    if (currentSettingsError || !currentSettingsRow) {
      await finishJob(admin, job, 'blocked', {
        reason: { code: 'invoice_collection_settings_unavailable' },
      });
      summary.blocked++;
      continue;
    }
    const currentSettings = asSettings(currentSettingsRow as Record<string, unknown>);
    if (
      !currentSettings.enabled ||
      String((currentSettingsRow as Record<string, unknown>).invoice_collection_generation) !==
        job.activation_generation
    ) {
      await finishJob(admin, job, 'skipped', {
        reason: { code: 'invoice_collection_no_longer_active' },
      });
      summary.skipped++;
      continue;
    }
    const locale = resolveAccountLocale(account);
    const today = todayInTz(locale.timeZone, now);
    if (!isWithinReminderSendWindow(hourInTz(locale.timeZone, now), currentSettings.sendWindowStart, currentSettings.sendWindowEnd)) {
      await finishJob(admin, job, 'deferred', {
        reason: { code: 'outside_send_window' },
        nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      });
      summary.deferred++;
      continue;
    }
    const { data: invoice, error: invoiceError } = await admin
      .from('invoice_balances')
      .select('id, contact_id, membership_id, invoice_number, balance, state, requires_refund_review, contact:contacts(id, name, phone)')
      .eq('account_id', job.account_id)
      .eq('id', job.invoice_id)
      .maybeSingle();
    const current = invoice as unknown as InvoiceCandidate | null;
    if (invoiceError) {
      await finishJob(admin, job, 'queued', {
        reason: { code: 'invoice_lookup_failed' },
        nextAttemptAt: retryAt(job.attempt_count, now),
      });
      summary.infrastructureFailures++;
      summary.failed++;
      continue;
    }
    if (!current || !isCollectibleInvoice({ state: current.state, balance: Number(current.balance), requiresRefundReview: current.requires_refund_review })) {
      await finishJob(admin, job, 'skipped', { reason: { code: 'invoice_no_longer_collectible' } });
      summary.skipped++;
      continue;
    }
    const { data: activeCommitments, error: activeCommitmentsError } = await admin
      .from('invoice_collection_commitments')
      .select('id')
      .eq('account_id', job.account_id)
      .eq('invoice_id', current.id)
      .eq('state', 'open');
    if (activeCommitmentsError) {
      await finishJob(admin, job, 'blocked', { reason: { code: 'commitment_hold_lookup_unavailable' } });
      summary.infrastructureFailures++; summary.blocked++; continue;
    }
    if ((activeCommitments ?? []).length > 0) {
      await finishJob(admin, job, 'deferred', {
        reason: { code: 'invoice_commitment_or_hold_open' },
        nextAttemptAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
      });
      summary.deferred++; continue;
    }
    let autopayHold = false;
    try {
      autopayHold = await needsAutoPayReconciliation(admin, job.account_id, current.id);
    } catch {
      await finishJob(admin, job, 'blocked', {
        reason: { code: 'autopay_reconciliation_unavailable' },
      });
      summary.blocked++;
      continue;
    }
    if (autopayHold) {
      // A mandate is membership-scoped, while payments allocate to exact lines.
      // Do not silently skip a mixed invoice or message its whole balance.
      await finishJob(admin, job, 'blocked', {
        reason: { code: 'autopay_reconciliation_required' },
      });
      summary.blocked++;
      continue;
    }
    const { data: lifecycleHistory, error: lifecycleHistoryError } = await admin
      .from('lifecycle_reminder_jobs')
      .select('milestone_key, state')
      .eq('account_id', job.account_id)
      .eq('invoice_id', job.invoice_id);
    if (lifecycleHistoryError) {
      await finishJob(admin, job, 'blocked', {
        reason: { code: 'lifecycle_history_unavailable' },
      });
      summary.infrastructureFailures++;
      summary.blocked++;
      continue;
    }
    let latestMilestone = null;
    if (job.kind === 'installment_overdue') {
      const { data: installment, error: installmentError } = await admin
        .from('membership_installment_plans')
        .select('id, invoice_id, second_due_on')
        .eq('id', job.installment_plan_id)
        .eq('account_id', job.account_id)
        .maybeSingle();
      if (installmentError || !installment || installment.invoice_id !== job.invoice_id) {
        await finishJob(admin, job, 'skipped', { reason: { code: 'installment_no_longer_current' } });
        summary.skipped++;
        continue;
      }
      latestMilestone = selectDueMilestone({
        anchorDate: installment.second_due_on,
        today,
        activatedOn: currentSettings.activatedOn!,
        milestones: currentSettings.overdueDays.map((days) => ({ key: `overdue-${days}`, offsetDays: days })),
        handledKeys: (lifecycleHistory ?? [])
          .filter((row) => ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(row.state as string))
          .map((row) => row.milestone_key as string),
        catchUpDays: currentSettings.catchUpDays,
      });
    } else {
      const { data: installmentForInvoice } = await admin
        .from('membership_installment_plans')
        .select('id')
        .eq('account_id', job.account_id)
        .eq('invoice_id', job.invoice_id)
        .maybeSingle();
      if (installmentForInvoice) {
        await finishJob(admin, job, 'skipped', { reason: { code: 'fixed_installment_owns_invoice' } });
        summary.skipped++;
        continue;
      }
      latestMilestone = selectDueMilestone({
        anchorDate: job.effective_due_on,
        today,
        activatedOn: currentSettings.activatedOn!,
        milestones: invoiceMilestones(currentSettings.beforeDueDays, currentSettings.overdueDays),
        handledKeys: (lifecycleHistory ?? [])
          .filter((row) => ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(row.state as string))
          .map((row) => row.milestone_key as string),
        catchUpDays: currentSettings.catchUpDays,
      });
    }
    if (!latestMilestone || latestMilestone.key !== job.milestone_key) {
      await finishJob(admin, job, 'skipped', { reason: { code: 'superseded_or_expired_milestone' } });
      summary.skipped++;
      continue;
    }
    const phone = current.contact?.phone?.trim();
    if (!phone) {
      await finishJob(admin, job, 'blocked', { reason: { code: 'missing_phone' } });
      summary.blocked++;
      continue;
    }
    const template = invoiceTemplate(job.kind);
    const [{ data: config }, { data: templates }] = await Promise.all([
      admin.from('whatsapp_config').select('status').eq('account_id', job.account_id).maybeSingle(),
      admin.from('message_templates').select('*').eq('account_id', job.account_id).eq('name', template.payload.name),
    ]);
    const readiness = evaluateTemplateReadiness(templates, template.id, 'en_US');
    if (!config || config.status !== 'connected' || !readiness.ready) {
      await finishJob(admin, job, 'blocked', { reason: { code: !config || config.status !== 'connected' ? 'whatsapp_not_connected' : readiness.code } });
      summary.blocked++;
      continue;
    }
    const { data: dailyReservation, error: dailyReservationError } = await admin.rpc(
      'reserve_lifecycle_reminder_daily_claim',
      {
        p_job_id: job.id,
        p_worker_id: job.lease_owner,
        p_lease_generation: job.lease_generation,
        p_send_on: today,
      }
    );
    if (dailyReservationError || dailyReservation !== 'reserved') {
      if (dailyReservationError) {
        await finishJob(admin, job, 'blocked', {
          reason: { code: 'daily_coordination_unavailable' },
          nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
        });
        summary.blocked++;
      } else {
        await finishJob(admin, job, 'deferred', {
          reason: { code: 'daily_contact_budget' },
          nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
        });
        summary.deferred++;
      }
      continue;
    }
    let providerRequestStarted = false;
    try {
      // Persist the pre-provider boundary. A crash after this boundary remains
      // explicitly ambiguous instead of silently risking a duplicate send.
      await finishJob(admin, job, 'attempting');
      summary.attempted++;
      const fmt = buildFormatters(locale);
      const conversationId = await findOrCreateConversation(admin, job.account_id, account.owner_user_id, job.contact_id);
      const templateParams = [
        current.contact?.name?.trim() || 'there',
        current.invoice_number ?? `#${current.id.slice(0, 8).toUpperCase()}`,
        fmt.money(Number(current.balance)),
        fmt.date(job.effective_due_on),
      ];
      const { whatsapp_message_id } = await engineSendTemplate({
        beforeSend: async () => {
          // This is the actual provider boundary. Re-read mutable financial
          // truth and the fixed installment promise before Meta can receive a
          // request; update the mutable parameter array with the fresh balance.
          const { data: finalSettingsRow, error: finalSettingsError } = await admin
            .from('renewal_reminder_settings')
            .select('account_id, invoice_collection_enabled, invoice_collection_activated_on, invoice_collection_activated_at, invoice_collection_generation, invoice_collection_before_due_days, invoice_collection_overdue_days, invoice_collection_catch_up_days, invoice_collection_send_window_start, invoice_collection_send_window_end')
            .eq('account_id', job.account_id)
            .maybeSingle();
          if (finalSettingsError || !finalSettingsRow) {
            throw new ReminderSetupChangedError('invoice collection settings unavailable');
          }
          const finalSettings = asSettings(finalSettingsRow as Record<string, unknown>);
          if (!finalSettings.enabled || String((finalSettingsRow as Record<string, unknown>).invoice_collection_generation) !== job.activation_generation) {
            throw new ReminderNoLongerEligibleError('invoice collection disabled or regenerated');
          }
          if (!isWithinReminderSendWindow(hourInTz(locale.timeZone, new Date()), finalSettings.sendWindowStart, finalSettings.sendWindowEnd)) {
            throw new ReminderSetupChangedError('send window changed');
          }
          const { data: latestInvoice, error: latestInvoiceError } = await admin
            .from('invoice_balances')
            .select('id, invoice_number, balance, state, requires_refund_review')
            .eq('account_id', job.account_id)
            .eq('id', job.invoice_id)
            .maybeSingle();
          if (latestInvoiceError) throw latestInvoiceError;
          if (
            !latestInvoice ||
            !isCollectibleInvoice({
              state: latestInvoice.state as string,
              balance: Number(latestInvoice.balance),
              requiresRefundReview: Boolean(latestInvoice.requires_refund_review),
            })
          ) {
            throw new ReminderNoLongerEligibleError('invoice no longer collectible');
          }
          if (await needsAutoPayReconciliation(admin, job.account_id, latestInvoice.id as string)) {
            throw new ReminderNoLongerEligibleError('autopay reconciliation required');
          }
          const { data: finalCommitments, error: finalCommitmentsError } = await admin
            .from('invoice_collection_commitments')
            .select('id')
            .eq('account_id', job.account_id)
            .eq('invoice_id', latestInvoice.id as string)
            .eq('state', 'open');
          if (finalCommitmentsError) throw finalCommitmentsError;
          if ((finalCommitments ?? []).length > 0) {
            throw new ReminderNoLongerEligibleError('invoice commitment or hold is open');
          }
          const { data: finalHistory, error: finalHistoryError } = await admin
            .from('lifecycle_reminder_jobs')
            .select('milestone_key, state')
            .eq('account_id', job.account_id)
            .eq('invoice_id', job.invoice_id);
          if (finalHistoryError) throw finalHistoryError;
          const finalHandled = (finalHistory ?? [])
            .filter((row) => ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(row.state as string))
            .map((row) => row.milestone_key as string);
          const finalToday = todayInTz(locale.timeZone, new Date());
          const finalLatest = job.kind === 'installment_overdue'
            ? selectDueMilestone({
                anchorDate: job.effective_due_on,
                today: finalToday,
                activatedOn: finalSettings.activatedOn!,
                milestones: finalSettings.overdueDays.map((days) => ({ key: `overdue-${Math.abs(days)}`, offsetDays: Math.abs(days) })),
                handledKeys: finalHandled,
                catchUpDays: finalSettings.catchUpDays,
              })
            : selectDueMilestone({
                anchorDate: job.effective_due_on,
                today: finalToday,
                activatedOn: finalSettings.activatedOn!,
                milestones: invoiceMilestones(finalSettings.beforeDueDays, finalSettings.overdueDays),
                handledKeys: finalHandled,
                catchUpDays: finalSettings.catchUpDays,
              });
          if (!finalLatest || finalLatest.key !== job.milestone_key) {
            throw new ReminderNoLongerEligibleError('superseded_or_expired_milestone');
          }
          if (job.installment_plan_id) {
            const { data: installment, error: installmentError } = await admin
              .from('membership_installment_plans')
              .select('second_due_on, invoice_id')
              .eq('id', job.installment_plan_id)
              .eq('account_id', job.account_id)
              .maybeSingle();
            if (installmentError) throw installmentError;
            if (!installment || installment.invoice_id !== job.invoice_id || installment.second_due_on !== job.effective_due_on) {
              throw new ReminderNoLongerEligibleError('installment promise changed');
            }
          }
          templateParams[1] = (latestInvoice.invoice_number as string | null) ?? templateParams[1];
          templateParams[2] = fmt.money(Number(latestInvoice.balance));
          const { data: marked, error: markError } = await admin.rpc(
            'mark_lifecycle_reminder_provider_attempt',
            {
              p_job_id: job.id,
              p_worker_id: job.lease_owner,
              p_lease_generation: job.lease_generation,
            }
          );
          if (markError || marked !== true) {
            throw new Error(markError?.message ?? 'provider attempt lease lost');
          }
          providerRequestStarted = true;
        },
        accountId: job.account_id,
        userId: account.owner_user_id,
        conversationId,
        contactId: job.contact_id,
        templateName: template.payload.name,
        language: readiness.row.language ?? 'en_US',
        params: templateParams,
      });
      try {
        await finishJob(admin, job, 'accepted', { providerMessageId: whatsapp_message_id });
        summary.accepted++;
      } catch (error) {
        summary.ambiguous++;
        summary.notes.push(`job ${job.id}: provider accepted but durable completion failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      try {
        if (error instanceof ReminderSetupChangedError) {
          await finishJob(admin, job, 'blocked', { reason: { code: error.message } });
          summary.blocked++;
        } else if (error instanceof ReminderNoLongerEligibleError) {
          await finishJob(admin, job, 'skipped', {
            reason: { code: error.message },
          });
          summary.skipped++;
        } else if (providerRequestStarted) {
          // A transport error, or a post-send persistence error from the
          // shared sender, cannot prove Meta did not accept the message.
          await finishJob(admin, job, 'ambiguous', {
            reason: {
              code: 'provider_outcome_unknown',
              detail: error instanceof Error ? error.message : String(error),
            },
          });
          summary.ambiguous++;
        } else {
          await finishJob(admin, job, 'queued', {
            reason: { code: 'provider_request_failed' },
            nextAttemptAt: retryAt(job.attempt_count, now),
          });
          summary.failed++;
        }
      } catch {
        summary.ambiguous++;
      }
    }
    } catch (error) {
      // One broken row/RPC must not strand the rest of the claimed batch.
      summary.infrastructureFailures++;
      summary.notes.push(
        `job ${job.id}: processing failed — ${error instanceof Error ? error.message : String(error)}`
      );
      try {
        await finishJob(admin, job, 'blocked', {
          reason: { code: 'job_processing_infrastructure_failure' },
        });
        summary.blocked++;
      } catch {
        // The expired lease is reconciled by the next claim pass; never abort
        // the remaining independently leased jobs.
      }
    }
  }
  return summary;
}
