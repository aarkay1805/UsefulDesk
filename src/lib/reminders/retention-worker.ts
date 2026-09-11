import { engineSendTemplate } from '@/lib/automations/meta-send';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  dayStartInTz,
  buildFormatters,
  hourInTz,
  todayInTz,
} from '@/lib/locale/format';
import { resolveAccountLocale } from '@/lib/locale/config';
import { sessionsRemaining } from '@/lib/memberships/attendance-limits';
import { istAddDays } from '@/lib/memberships/expiry';
import { isRenewalChaseable } from '@/lib/memberships/pricing';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import {
  TEMPLATE_CONTRACTS,
  type TemplateContractId,
} from '@/lib/whatsapp/template-contracts';

import { isExpiredRenewalCandidate } from './policy';
import {
  isCurrentSessionPackMilestone,
  latestWinBackMilestone,
  sessionPackMilestone,
  shouldStopWinBack,
} from './retention';
import type { LifecycleReminderJob, ReminderRunSummary } from './types';

type Admin = ReturnType<typeof supabaseAdmin>;
type Account = {
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
type Finish = (
  state: string,
  options?: {
    providerMessageId?: string | null;
    reason?: Record<string, string>;
    nextAttemptAt?: string | null;
  }
) => Promise<void>;
type Conversation = (
  accountId: string,
  userId: string,
  contactId: string
) => Promise<string>;

type Feature = {
  enabled: boolean;
  activatedOn: string | null;
  activatedAt: string | null;
  generation: string | null;
};
const RETENTION_SETTINGS =
  'invoice_collection_send_window_start, invoice_collection_send_window_end, session_pack_reminders_enabled, session_pack_reminders_activated_on, session_pack_reminders_activated_at, session_pack_reminders_generation, freeze_return_reminders_enabled, freeze_return_reminders_activated_on, freeze_return_reminders_activated_at, freeze_return_reminders_generation, membership_win_back_enabled, membership_win_back_activated_on, membership_win_back_activated_at, membership_win_back_generation, service_win_back_enabled, service_win_back_activated_on, service_win_back_activated_at, service_win_back_generation';

function isWithinSendWindow(hour: number, start: number, end: number) {
  return hour >= start && hour <= end;
}

function shortSequenceStillPending(
  history: readonly Record<string, unknown>[],
  subjectField: 'membership_id' | 'member_service_id',
  subjectId: string,
  dueOn: string
) {
  const kind =
    subjectField === 'membership_id'
      ? 'membership_post_expiry'
      : 'service_post_expiry';
  return history.some(
    (row) =>
      row[subjectField] === subjectId &&
      row.effective_due_on === dueOn &&
      row.kind === kind &&
      ['queued', 'leased', 'attempting', 'deferred', 'blocked'].includes(
        String(row.state)
      )
  );
}

function feature(row: Record<string, unknown>, prefix: string): Feature {
  return {
    enabled: row[`${prefix}_enabled`] === true,
    activatedOn:
      typeof row[`${prefix}_activated_on`] === 'string'
        ? String(row[`${prefix}_activated_on`])
        : null,
    activatedAt:
      typeof row[`${prefix}_activated_at`] === 'string'
        ? String(row[`${prefix}_activated_at`])
        : null,
    generation:
      typeof row[`${prefix}_generation`] === 'string'
        ? String(row[`${prefix}_generation`])
        : null,
  };
}

function featureForKind(
  row: Record<string, unknown>,
  kind: LifecycleReminderJob['kind']
): Feature | null {
  if (kind === 'session_pack_low' || kind === 'session_pack_exhausted')
    return feature(row, 'session_pack_reminders');
  if (kind === 'freeze_return') return feature(row, 'freeze_return_reminders');
  if (kind === 'membership_win_back')
    return feature(row, 'membership_win_back');
  if (kind === 'service_win_back') return feature(row, 'service_win_back');
  return null;
}

function retentionKey(
  kind: LifecycleReminderJob['kind'],
  subject: string,
  milestone: string
) {
  return `${kind}:none:${subject}:${milestone}`;
}

function retryAt(attempt: number, now: Date) {
  return new Date(
    now.getTime() + Math.min(60, 2 ** Math.min(attempt, 5)) * 60_000
  ).toISOString();
}

type Member = {
  id: string;
  account_id: string;
  contact_id: string;
  start_date: string;
  end_date: string;
  status: string;
  collection_mode: string;
  planned_return_on: string | null;
  plan: {
    name: string | null;
    plan_type: string | null;
    sessions_count: number | null;
  } | null;
  contact: { name: string | null; phone: string | null } | null;
};
type Service = {
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

async function usedSessions(
  admin: Admin,
  members: readonly Member[],
  timeZone: string
): Promise<Map<string, number>> {
  const tracked = members.filter(
    (member) =>
      member.plan?.plan_type === 'session_pack' && member.plan.sessions_count
  );
  if (!tracked.length) return new Map<string, number>();
  const starts = tracked.map((member) =>
    dayStartInTz(member.start_date, timeZone)?.toISOString()
  );
  if (starts.some((start) => !start))
    throw new Error('session_pack_cycle_start_invalid');
  const { data, error } = await admin.rpc('attendance_usage_counts', {
    p_membership_ids: tracked.map((member) => member.id),
    p_window_starts: starts,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    membership_id: string;
    used: number | null;
  }>;
  return new Map<string, number>(
    rows.map((row) => [String(row.membership_id), Number(row.used) || 0])
  );
}

async function hasReply(
  admin: Admin,
  accountId: string,
  contactId: string,
  endDate: string,
  timeZone: string
) {
  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation) return false;
  const start = dayStartInTz(endDate, timeZone);
  if (!start) throw new Error('expiry_cycle_start_invalid');
  const { data, error } = await admin
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id as string)
    .eq('sender_type', 'customer')
    .gte('created_at', start.toISOString())
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function hasOpenCommitment(
  admin: Admin,
  accountId: string,
  contactId: string
) {
  const { data, error } = await admin
    .from('invoice_collection_commitments')
    .select('id, invoice:invoices!inner(contact_id)')
    .eq('account_id', accountId)
    .eq('state', 'open');
  if (error) throw error;
  return (data ?? []).some(
    (row) =>
      (row.invoice as { contact_id?: string } | null)?.contact_id === contactId
  );
}

async function hasPendingShortSequence(
  admin: Admin,
  job: LifecycleReminderJob
) {
  const kind =
    job.kind === 'membership_win_back'
      ? 'membership_post_expiry'
      : 'service_post_expiry';
  const field =
    kind === 'membership_post_expiry' ? 'membership_id' : 'member_service_id';
  const subjectId =
    kind === 'membership_post_expiry'
      ? job.membership_id
      : job.member_service_id;
  const { data, error } = await admin
    .from('lifecycle_reminder_jobs')
    .select('id')
    .eq('account_id', job.account_id)
    .eq(field, subjectId)
    .eq('effective_due_on', job.effective_due_on)
    .eq('kind', kind)
    .in('state', ['queued', 'leased', 'attempting', 'deferred', 'blocked'])
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function queueRetentionCandidates(input: {
  admin: Admin;
  account: Account;
  rawSetting: Record<string, unknown>;
  today: string;
  now: Date;
  summary: ReminderRunSummary;
}) {
  const { admin, account, rawSetting, today, summary } = input;
  const locale = resolveAccountLocale(account);
  const sessions = feature(rawSetting, 'session_pack_reminders');
  const freeze = feature(rawSetting, 'freeze_return_reminders');
  const membershipWinBack = feature(rawSetting, 'membership_win_back');
  const serviceWinBack = feature(rawSetting, 'service_win_back');
  const { data: history, error: historyError } = await admin
    .from('lifecycle_reminder_jobs')
    .select(
      'kind, membership_id, member_service_id, subject_cycle_id, effective_due_on, milestone_key, state, activation_generation'
    )
    .eq('account_id', account.id);
  if (historyError) throw historyError;

  const { data: members, error: membersError } = await admin
    .from('memberships')
    .select(
      'id, account_id, contact_id, start_date, end_date, status, collection_mode, planned_return_on, plan:membership_plans(name, plan_type, sessions_count), contact:contacts(name, phone)'
    )
    .eq('account_id', account.id);
  if (membersError) throw membersError;
  const typedMembers = (members ?? []) as unknown as Member[];
  if (sessions.enabled && sessions.activatedOn && sessions.activatedAt) {
    const activatedOn = sessions.activatedOn;
    const current = typedMembers.filter(
      (member) =>
        member.status === 'active' &&
        member.start_date >= activatedOn &&
        member.plan?.plan_type === 'session_pack' &&
        member.plan.sessions_count
    );
    const counts = await usedSessions(admin, current, locale.timeZone);
    for (const member of current) {
      const milestone = sessionPackMilestone(
        sessionsRemaining(
          Number(member.plan?.sessions_count ?? 0),
          counts.get(member.id) ?? 0
        )
      );
      if (!milestone) continue;
      const kind =
        milestone.key === 'sessions-0'
          ? 'session_pack_exhausted'
          : 'session_pack_low';
      const subject = `${member.id}:${member.start_date}:${member.end_date}:${sessions.generation}`;
      const { data, error } = await admin
        .from('lifecycle_reminder_jobs')
        .upsert(
          {
            account_id: account.id,
            contact_id: member.contact_id,
            membership_id: member.id,
            kind,
            subject_cycle_id: subject,
            milestone_key: milestone.key,
            business_key: retentionKey(kind, subject, milestone.key),
            effective_due_on: member.end_date,
            coordination_on: today,
            activation_generation: sessions.generation,
          },
          { onConflict: 'account_id,business_key', ignoreDuplicates: true }
        )
        .select('id');
      if (error)
        summary.notes.push(
          `session pack ${member.id}: queue failed — ${error.message}`
        );
      else if (data?.length) summary.queued++;
    }
  }
  if (freeze.enabled && freeze.activatedOn && freeze.activatedAt) {
    const activatedOn = freeze.activatedOn;
    for (const member of typedMembers.filter(
      (candidate) =>
        candidate.status === 'frozen' &&
        candidate.planned_return_on &&
        candidate.planned_return_on >= activatedOn
    )) {
      const plannedReturnOn = member.planned_return_on;
      if (!plannedReturnOn) continue;
      const subject = `${member.id}:${plannedReturnOn}:${freeze.generation}`;
      for (const [kind, milestone] of [
        ['freeze_return', 'return-before-1'],
        ['freeze_return', 'return-day-follow-up'],
      ] as const) {
        const dueOn =
          milestone === 'return-before-1'
            ? istAddDays(plannedReturnOn, -1)
            : plannedReturnOn;
        // A customer should never receive yesterday's return reminder. The
        // return-day staff task is the bounded catch-up action.
        if (
          (milestone === 'return-before-1' && dueOn !== today) ||
          (milestone === 'return-day-follow-up' && dueOn > today) ||
          dueOn < activatedOn
        )
          continue;
        const { data, error } = await admin
          .from('lifecycle_reminder_jobs')
          .upsert(
            {
              account_id: account.id,
              contact_id: member.contact_id,
              membership_id: member.id,
              kind,
              subject_cycle_id: subject,
              milestone_key: milestone,
              business_key: retentionKey(kind, subject, milestone),
              effective_due_on: plannedReturnOn,
              coordination_on: today,
              activation_generation: freeze.generation,
            },
            { onConflict: 'account_id,business_key', ignoreDuplicates: true }
          )
          .select('id');
        if (error)
          summary.notes.push(
            `freeze ${member.id}: queue failed — ${error.message}`
          );
        else if (data?.length) summary.queued++;
      }
    }
  }
  if (
    membershipWinBack.enabled &&
    membershipWinBack.activatedOn &&
    membershipWinBack.activatedAt
  ) {
    for (const member of typedMembers) {
      if (
        !isExpiredRenewalCandidate({
          status: member.status,
          endDate: member.end_date,
          today,
          renewable: isRenewalChaseable(member.plan),
          activeAutoPay: member.collection_mode === 'auto',
        }) ||
        member.end_date < membershipWinBack.activatedOn
      )
        continue;
      if (
        shortSequenceStillPending(
          (history ?? []) as Record<string, unknown>[],
          'membership_id',
          member.id,
          member.end_date
        )
      )
        continue;
      const subject = `${member.id}:${member.end_date}:${membershipWinBack.generation}`;
      // Choose the newest due event *before* considering handled history. A
      // blocked +14 job must not wake up and send after +30 becomes due.
      const latest = latestWinBackMilestone({
        endDate: member.end_date,
        today,
        activatedOn: membershipWinBack.activatedOn,
        catchUpDays: 2,
      });
      if (!latest) continue;
      const handled = (history ?? [])
        .filter(
          (row) =>
            row.kind === 'membership_win_back' &&
            row.subject_cycle_id === subject &&
            row.effective_due_on === member.end_date &&
            row.activation_generation === membershipWinBack.generation &&
            ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(
              String(row.state)
            )
        )
        .map((row) => String(row.milestone_key));
      if (handled.includes(latest.key)) continue;
      const milestone = latest;
      const { data, error } = await admin
        .from('lifecycle_reminder_jobs')
        .upsert(
          {
            account_id: account.id,
            contact_id: member.contact_id,
            membership_id: member.id,
            kind: 'membership_win_back',
            subject_cycle_id: subject,
            milestone_key: milestone.key,
            business_key: retentionKey(
              'membership_win_back',
              subject,
              milestone.key
            ),
            effective_due_on: member.end_date,
            coordination_on: today,
            activation_generation: membershipWinBack.generation,
          },
          { onConflict: 'account_id,business_key', ignoreDuplicates: true }
        )
        .select('id');
      if (error)
        summary.notes.push(
          `membership ${member.id}: win-back queue failed — ${error.message}`
        );
      else if (data?.length) summary.queued++;
    }
  }
  if (
    serviceWinBack.enabled &&
    serviceWinBack.activatedOn &&
    serviceWinBack.activatedAt
  ) {
    const { data: services, error } = await admin
      .from('service_renewal_queue')
      .select(
        'id, account_id, contact_id, end_date, status, item_name_snapshot, current_renewal_price, item_is_active, option_is_active, member_name, phone'
      )
      .eq('account_id', account.id)
      .gte('end_date', serviceWinBack.activatedOn)
      .lt('end_date', today);
    if (error) throw error;
    for (const service of (services ?? []) as unknown as Service[]) {
      if (
        !isExpiredRenewalCandidate({
          status: service.status,
          endDate: service.end_date,
          today,
          renewable:
            service.item_is_active &&
            service.option_is_active &&
            service.current_renewal_price !== null,
        })
      )
        continue;
      if (
        shortSequenceStillPending(
          (history ?? []) as Record<string, unknown>[],
          'member_service_id',
          service.id,
          service.end_date
        )
      )
        continue;
      const subject = `${service.id}:${service.end_date}:${serviceWinBack.generation}`;
      const latest = latestWinBackMilestone({
        endDate: service.end_date,
        today,
        activatedOn: serviceWinBack.activatedOn,
        catchUpDays: 2,
      });
      if (!latest) continue;
      const handled = (history ?? [])
        .filter(
          (row) =>
            row.kind === 'service_win_back' &&
            row.subject_cycle_id === subject &&
            row.effective_due_on === service.end_date &&
            row.activation_generation === serviceWinBack.generation &&
            ['accepted', 'delivered', 'ambiguous', 'skipped'].includes(
              String(row.state)
            )
        )
        .map((row) => String(row.milestone_key));
      if (handled.includes(latest.key)) continue;
      const milestone = latest;
      const { data, error: queueError } = await admin
        .from('lifecycle_reminder_jobs')
        .upsert(
          {
            account_id: account.id,
            contact_id: service.contact_id,
            member_service_id: service.id,
            kind: 'service_win_back',
            subject_cycle_id: subject,
            milestone_key: milestone.key,
            business_key: retentionKey(
              'service_win_back',
              subject,
              milestone.key
            ),
            effective_due_on: service.end_date,
            coordination_on: today,
            activation_generation: serviceWinBack.generation,
          },
          { onConflict: 'account_id,business_key', ignoreDuplicates: true }
        )
        .select('id');
      if (queueError)
        summary.notes.push(
          `service ${service.id}: win-back queue failed — ${queueError.message}`
        );
      else if (data?.length) summary.queued++;
    }
  }
}

async function currentMember(admin: Admin, job: LifecycleReminderJob) {
  const { data, error } = await admin
    .from('memberships')
    .select(
      'id, account_id, contact_id, start_date, end_date, status, collection_mode, planned_return_on, plan:membership_plans(name, plan_type, sessions_count), contact:contacts(name, phone)'
    )
    .eq('account_id', job.account_id)
    .eq('id', job.membership_id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Member | null;
}

async function currentService(admin: Admin, job: LifecycleReminderJob) {
  const { data, error } = await admin
    .from('service_renewal_queue')
    .select(
      'id, account_id, contact_id, end_date, status, item_name_snapshot, current_renewal_price, item_is_active, option_is_active, member_name, phone'
    )
    .eq('account_id', job.account_id)
    .eq('id', job.member_service_id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Service | null;
}

async function hasReplacementCycle(
  admin: Admin,
  job: LifecycleReminderJob
): Promise<boolean> {
  if (job.kind === 'membership_win_back') {
    const { data, error } = await admin
      .from('memberships')
      .select('id')
      .eq('account_id', job.account_id)
      .eq('contact_id', job.contact_id)
      .eq('status', 'active')
      .gt('end_date', job.effective_due_on)
      .limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  const { data, error } = await admin
    .from('member_services')
    .select('id')
    .eq('account_id', job.account_id)
    .eq('contact_id', job.contact_id)
    .eq('renewed_from_service_id', job.member_service_id)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

function isLatestWinBackJob(
  job: LifecycleReminderJob,
  today: string,
  activatedOn: string
) {
  return (
    latestWinBackMilestone({
      endDate: job.effective_due_on,
      today,
      activatedOn,
      catchUpDays: 2,
    })?.key === job.milestone_key
  );
}

/** Re-read the mutable subject at the provider boundary. Queue eligibility is
 * only a snapshot; this closes renewal, reply, hold, attendance, and edited
 * return-date races without ever asking the provider to decide them. */
async function ensureRetentionBeforeSend(
  admin: Admin,
  job: LifecycleReminderJob,
  account: Account,
  now: Date
): Promise<string[] | undefined> {
  const { data: raw, error } = await admin
    .from('renewal_reminder_settings')
    .select(RETENTION_SETTINGS)
    .eq('account_id', job.account_id)
    .maybeSingle();
  if (error) throw new Error('retention_before_send_lookup_unavailable');
  const settings = raw
    ? featureForKind(raw as Record<string, unknown>, job.kind)
    : null;
  if (
    !settings ||
    !settings.enabled ||
    !settings.activatedOn ||
    !settings.activatedAt ||
    settings.generation !== job.activation_generation
  )
    throw new Error('retention_before_send_ineligible');
  const locale = resolveAccountLocale(account);
  const today = todayInTz(locale.timeZone, now);
  if (
    job.milestone_key !== 'return-day-follow-up' &&
    !isWithinSendWindow(
      hourInTz(locale.timeZone, now),
      Number(
        (raw as Record<string, unknown>).invoice_collection_send_window_start ??
          9
      ),
      Number(
        (raw as Record<string, unknown>).invoice_collection_send_window_end ??
          19
      )
    )
  )
    throw new Error('retention_before_send_outside_window');
  if (
    job.kind === 'session_pack_low' ||
    job.kind === 'session_pack_exhausted'
  ) {
    const member = await currentMember(admin, job);
    if (
      !member ||
      member.contact_id !== job.contact_id ||
      member.status !== 'active' ||
      member.plan?.plan_type !== 'session_pack' ||
      !member.plan.sessions_count ||
      job.subject_cycle_id !==
        `${member.id}:${member.start_date}:${member.end_date}:${settings.generation}`
    )
      throw new Error('retention_before_send_ineligible');
    const counts = await usedSessions(admin, [member], locale.timeZone);
    if (
      !isCurrentSessionPackMilestone(
        sessionsRemaining(
          Number(member.plan.sessions_count),
          counts.get(member.id) ?? 0
        ),
        job.milestone_key
      )
    )
      throw new Error('retention_before_send_ineligible');
    const contactName = member.contact?.name?.trim() || 'there';
    return job.kind === 'session_pack_low'
      ? [
          contactName,
          member.plan.name || 'session pack',
          String(
            sessionsRemaining(
              Number(member.plan.sessions_count),
              counts.get(member.id) ?? 0
            )
          ),
        ]
      : [contactName, member.plan.name || 'session pack'];
  } else if (job.kind === 'freeze_return') {
    const member = await currentMember(admin, job);
    if (
      !member ||
      member.contact_id !== job.contact_id ||
      member.status !== 'frozen' ||
      member.planned_return_on !== job.effective_due_on ||
      job.subject_cycle_id !==
        `${member.id}:${member.planned_return_on}:${settings.generation}`
    )
      throw new Error('retention_before_send_ineligible');
    if (
      job.milestone_key === 'return-before-1' &&
      today !== istAddDays(job.effective_due_on, -1)
    )
      throw new Error('retention_before_send_ineligible');
  } else {
    const membership = job.kind === 'membership_win_back';
    const subject = membership
      ? await currentMember(admin, job)
      : await currentService(admin, job);
    const eligible =
      subject &&
      subject.contact_id === job.contact_id &&
      subject.end_date === job.effective_due_on &&
      (membership
        ? isExpiredRenewalCandidate({
            status: (subject as Member).status,
            endDate: subject.end_date,
            today,
            renewable: isRenewalChaseable((subject as Member).plan),
            activeAutoPay: (subject as Member).collection_mode === 'auto',
          })
        : isExpiredRenewalCandidate({
            status: (subject as Service).status,
            endDate: subject.end_date,
            today,
            renewable:
              (subject as Service).item_is_active &&
              (subject as Service).option_is_active &&
              (subject as Service).current_renewal_price !== null,
          }));
    if (
      !eligible ||
      !isLatestWinBackJob(job, today, settings.activatedOn) ||
      (await hasReplacementCycle(admin, job)) ||
      (await hasReply(
        admin,
        job.account_id,
        job.contact_id,
        job.effective_due_on,
        locale.timeZone
      )) ||
      (await hasOpenCommitment(admin, job.account_id, job.contact_id)) ||
      (await hasPendingShortSequence(admin, job))
    )
      throw new Error('retention_before_send_ineligible');
    if (membership) {
      const member = subject as Member;
      return [
        member.contact?.name?.trim() || 'there',
        member.plan?.name || 'membership',
      ];
    }
    const service = subject as Service;
    return [
      service.member_name?.trim() || 'there',
      service.item_name_snapshot,
      buildFormatters(locale).money(Number(service.current_renewal_price)),
    ];
  }
}

export async function processRetentionJob(input: {
  admin: Admin;
  job: LifecycleReminderJob;
  account: Account;
  now: Date;
  summary: ReminderRunSummary;
  finish: Finish;
  findConversation: Conversation;
  markProviderAttempt: () => Promise<void>;
  reserveDailyClaim: (sendOn: string) => Promise<'reserved' | 'deferred'>;
}) {
  const {
    admin,
    job,
    account,
    now,
    summary,
    finish,
    findConversation,
    markProviderAttempt,
    reserveDailyClaim,
  } = input;
  const { data: raw, error: settingsError } = await admin
    .from('renewal_reminder_settings')
    .select(RETENTION_SETTINGS)
    .eq('account_id', job.account_id)
    .maybeSingle();
  if (settingsError || !raw) {
    await finish('queued', {
      reason: { code: 'retention_settings_unavailable' },
      nextAttemptAt: retryAt(job.attempt_count, now),
    });
    summary.failed++;
    return;
  }
  const settings = featureForKind(raw as Record<string, unknown>, job.kind);
  if (
    !settings ||
    !settings.enabled ||
    !settings.activatedOn ||
    !settings.activatedAt ||
    settings.generation !== job.activation_generation
  ) {
    await finish('skipped', {
      reason: { code: 'retention_lifecycle_no_longer_active' },
    });
    summary.skipped++;
    return;
  }
  const locale = resolveAccountLocale(account);
  const today = todayInTz(locale.timeZone, now);
  let contactName = 'there';
  let phone: string | null = null;
  let templateId: TemplateContractId | null = null;
  let params: string[] = [];
  try {
    if (
      job.kind === 'session_pack_low' ||
      job.kind === 'session_pack_exhausted'
    ) {
      const member = await currentMember(admin, job);
      if (
        !member ||
        member.contact_id !== job.contact_id ||
        member.status !== 'active' ||
        !member.plan?.sessions_count ||
        member.plan.plan_type !== 'session_pack' ||
        job.subject_cycle_id !==
          `${member.id}:${member.start_date}:${member.end_date}:${settings.generation}`
      )
        throw new Error('retention_subject_changed');
      const counts = await usedSessions(admin, [member], locale.timeZone);
      const remaining = sessionsRemaining(
        Number(member.plan?.sessions_count ?? 0),
        counts.get(member.id) ?? 0
      );
      if (!isCurrentSessionPackMilestone(remaining, job.milestone_key))
        throw new Error('session_threshold_superseded');
      contactName = member.contact?.name?.trim() || contactName;
      phone = member.contact?.phone?.trim() || null;
      templateId =
        job.kind === 'session_pack_low'
          ? 'session_pack_low'
          : 'session_pack_exhausted';
      params =
        job.kind === 'session_pack_low'
          ? [contactName, member.plan.name || 'session pack', String(remaining)]
          : [contactName, member.plan.name || 'session pack'];
    } else if (job.kind === 'freeze_return') {
      const member = await currentMember(admin, job);
      if (
        !member ||
        member.contact_id !== job.contact_id ||
        member.status !== 'frozen' ||
        member.planned_return_on !== job.effective_due_on ||
        job.subject_cycle_id !==
          `${member.id}:${member.planned_return_on}:${settings.generation}`
      )
        throw new Error('planned_return_changed');
      if (job.milestone_key === 'return-day-follow-up') {
        if (today < job.effective_due_on) {
          await finish('deferred', {
            reason: { code: 'planned_return_not_today' },
            nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString(),
          });
          summary.deferred++;
          return;
        }
        const { data, error } = await admin.rpc(
          'create_freeze_return_follow_up',
          { p_job_id: job.id }
        );
        if (error || !['created', 'existing'].includes(String(data))) {
          await finish('queued', {
            reason: { code: 'freeze_return_follow_up_unavailable' },
            nextAttemptAt: retryAt(job.attempt_count, now),
          });
          summary.failed++;
          return;
        }
        await finish('accepted', {
          reason: { code: `freeze_return_follow_up_${String(data)}` },
        });
        summary.accepted++;
        return;
      }
      if (
        today !== istAddDays(job.effective_due_on, -1) ||
        today < settings.activatedOn
      )
        throw new Error('retention_subject_changed');
      contactName = member.contact?.name?.trim() || contactName;
      phone = member.contact?.phone?.trim() || null;
      templateId = 'freeze_return';
      params = [
        contactName,
        buildFormatters(locale).date(job.effective_due_on),
      ];
    } else {
      const membership = job.kind === 'membership_win_back';
      const subject = membership
        ? await currentMember(admin, job)
        : await currentService(admin, job);
      if (
        !subject ||
        subject.contact_id !== job.contact_id ||
        subject.end_date !== job.effective_due_on
      )
        throw new Error('renewed_or_replaced');
      const eligible = membership
        ? isExpiredRenewalCandidate({
            status: (subject as Member).status,
            endDate: subject.end_date,
            today,
            renewable: isRenewalChaseable((subject as Member).plan),
            activeAutoPay: (subject as Member).collection_mode === 'auto',
          })
        : isExpiredRenewalCandidate({
            status: (subject as Service).status,
            endDate: subject.end_date,
            today,
            renewable:
              (subject as Service).item_is_active &&
              (subject as Service).option_is_active &&
              (subject as Service).current_renewal_price !== null,
          });
      if (!isLatestWinBackJob(job, today, settings.activatedOn))
        throw new Error('win_back_milestone_superseded');
      if (await hasReplacementCycle(admin, job))
        throw new Error('renewed_or_replaced');
      const stopped = shouldStopWinBack({
        renewedOrReplaced: !eligible,
        cancelled: subject.status === 'cancelled',
        replied: await hasReply(
          admin,
          job.account_id,
          job.contact_id,
          job.effective_due_on,
          locale.timeZone
        ),
        openCommitmentOrHold: await hasOpenCommitment(
          admin,
          job.account_id,
          job.contact_id
        ),
        shortSequencePending: await hasPendingShortSequence(admin, job),
      });
      if (stopped) throw new Error('win_back_stopped');
      if (membership) {
        const member = subject as Member;
        contactName = member.contact?.name?.trim() || contactName;
        phone = member.contact?.phone?.trim() || null;
        templateId = 'membership_win_back';
        params = [contactName, member.plan?.name || 'membership'];
      } else {
        const service = subject as Service;
        contactName = service.member_name?.trim() || contactName;
        phone = service.phone?.trim() || null;
        templateId = 'service_win_back';
        params = [
          contactName,
          service.item_name_snapshot,
          buildFormatters(locale).money(Number(service.current_renewal_price)),
        ];
      }
    }
  } catch (error) {
    const code =
      error instanceof Error ? error.message : 'retention_lookup_unavailable';
    if (
      [
        'retention_subject_changed',
        'session_threshold_superseded',
        'planned_return_changed',
        'renewed_or_replaced',
        'win_back_milestone_superseded',
        'win_back_stopped',
      ].includes(code)
    ) {
      await finish('skipped', { reason: { code } });
      summary.skipped++;
    } else {
      await finish('queued', {
        reason: { code: 'retention_lookup_unavailable' },
        nextAttemptAt: retryAt(job.attempt_count, now),
      });
      summary.failed++;
    }
    return;
  }
  if (
    job.milestone_key !== 'return-day-follow-up' &&
    !isWithinSendWindow(
      hourInTz(locale.timeZone, now),
      Number(
        (raw as Record<string, unknown>).invoice_collection_send_window_start ??
          9
      ),
      Number(
        (raw as Record<string, unknown>).invoice_collection_send_window_end ??
          19
      )
    )
  ) {
    await finish('deferred', {
      reason: { code: 'outside_send_window' },
      nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString(),
    });
    summary.deferred++;
    return;
  }
  if (!phone || !templateId) {
    await finish('blocked', { reason: { code: 'missing_phone' } });
    summary.blocked++;
    return;
  }
  const template = TEMPLATE_CONTRACTS[templateId];
  const [{ data: config }, { data: templates }] = await Promise.all([
    admin
      .from('whatsapp_config')
      .select('status')
      .eq('account_id', job.account_id)
      .maybeSingle(),
    admin
      .from('message_templates')
      .select('*')
      .eq('account_id', job.account_id)
      .eq('name', template.payload.name),
  ]);
  const readiness = evaluateTemplateReadiness(templates, templateId, 'en_US');
  if (!config || config.status !== 'connected' || !readiness.ready) {
    await finish('blocked', {
      reason: {
        code:
          !config || config.status !== 'connected'
            ? 'whatsapp_not_connected'
            : readiness.code,
      },
    });
    summary.blocked++;
    return;
  }
  const reservation = await reserveDailyClaim(today);
  if (reservation !== 'reserved') {
    await finish('deferred', {
      reason: { code: 'daily_contact_budget' },
      nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString(),
    });
    summary.deferred++;
    return;
  }
  let started = false;
  try {
    await finish('attempting');
    summary.attempted++;
    const conversationId = await findConversation(
      job.account_id,
      account.owner_user_id,
      job.contact_id
    );
    const result = await engineSendTemplate({
      beforeSend: async () => {
        const currentParams = await ensureRetentionBeforeSend(
          admin,
          job,
          account,
          now
        );
        if (currentParams) params.splice(0, params.length, ...currentParams);
        await markProviderAttempt();
        started = true;
      },
      accountId: job.account_id,
      userId: account.owner_user_id,
      conversationId,
      contactId: job.contact_id,
      templateName: template.payload.name,
      language: readiness.row.language ?? 'en_US',
      params,
    });
    await finish('accepted', { providerMessageId: result.whatsapp_message_id });
    summary.accepted++;
  } catch (error) {
    const code =
      error instanceof Error ? error.message : 'provider_request_failed';
    if (code === 'retention_before_send_ineligible') {
      await finish('skipped', { reason: { code } });
      summary.skipped++;
    } else if (code === 'retention_before_send_lookup_unavailable') {
      await finish('queued', {
        reason: { code },
        nextAttemptAt: retryAt(job.attempt_count, now),
      });
      summary.failed++;
    } else if (code === 'retention_before_send_outside_window') {
      await finish('deferred', {
        reason: { code: 'outside_send_window' },
        nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString(),
      });
      summary.deferred++;
    }
    if (started) {
      await finish('ambiguous', {
        reason: { code: 'provider_outcome_unknown' },
      });
      summary.ambiguous++;
    } else if (
      code !== 'retention_before_send_ineligible' &&
      code !== 'retention_before_send_lookup_unavailable' &&
      code !== 'retention_before_send_outside_window'
    ) {
      await finish('queued', {
        reason: { code: 'provider_request_failed' },
        nextAttemptAt: retryAt(job.attempt_count, now),
      });
      summary.failed++;
    }
  }
}
