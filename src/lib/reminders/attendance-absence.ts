import {
  engineSendTemplate,
  MetaAcceptedPersistenceError,
} from '@/lib/automations/meta-send';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dayStartInTz, timeInTzToUtc, todayInTz } from '@/lib/locale/format';
import { istAddDays } from '@/lib/memberships/expiry';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

import type { LifecycleReminderJob, ReminderRunSummary } from './types';

type Admin = ReturnType<typeof supabaseAdmin>;
type Account = {
  owner_user_id: string;
  timezone: string;
  legalBusinessName: string | null;
};

/** The ending hour is inclusive, so its :30 mark is the last half-hour
 * before the configured sending window closes. */
export function absenceDueAt(
  visitOn: string,
  assignedArrival: string | null,
  sendWindowEnd: number,
  timezone: string
): Date | null {
  if (assignedArrival) {
    const arrival = timeInTzToUtc(
      visitOn,
      assignedArrival.slice(0, 5),
      timezone
    );
    return arrival ? new Date(arrival.getTime() + 60 * 60_000) : null;
  }
  return timeInTzToUtc(
    visitOn,
    `${String(sendWindowEnd).padStart(2, '0')}:30`,
    timezone
  );
}

export function absenceStreakStart(
  membershipStart: string,
  lastVisitOn: string | null
): string {
  const afterLastVisit = lastVisitOn
    ? istAddDays(lastVisitOn, 1)
    : membershipStart;
  return afterLastVisit > membershipStart ? afterLastVisit : membershipStart;
}

export function hasSixAbsentDays(
  visitOn: string,
  membershipStart: string,
  lastVisitOn: string | null
): boolean {
  return (
    visitOn >= istAddDays(absenceStreakStart(membershipStart, lastVisitOn), 5)
  );
}

class Ineligible extends Error {}

async function currentMember(
  admin: Admin,
  job: LifecycleReminderJob,
  account: Account,
  now: Date
): Promise<{
  name: string;
  phone: string;
  sendWindowEnd: number;
  assignedArrival: string | null;
} | null> {
  const { data: settings, error: settingsError } = await admin
    .from('renewal_reminder_settings')
    .select(
      'attendance_streak_enabled, attendance_streak_generation, invoice_collection_send_window_end'
    )
    .eq('account_id', job.account_id)
    .maybeSingle();
  if (settingsError) throw settingsError;
  if (
    job.kind !== 'attendance_streak' ||
    !settings?.attendance_streak_enabled ||
    settings.attendance_streak_generation !== job.activation_generation
  )
    return null;

  const { data: membership, error: membershipError } = await admin
    .from('memberships')
    .select(
      'id, contact_id, status, start_date, end_date, contact:contacts(name, phone, assigned_arrival_time)'
    )
    .eq('id', job.membership_id)
    .eq('account_id', job.account_id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  const contact = membership?.contact as unknown as {
    name: string | null;
    phone: string | null;
    assigned_arrival_time: string | null;
  } | null;
  if (
    !membership ||
    !contact ||
    membership.contact_id !== job.contact_id ||
    membership.status !== 'active' ||
    membership.start_date > job.effective_due_on ||
    membership.end_date < job.effective_due_on ||
    membership.end_date < todayInTz(account.timezone, now) ||
    !contact.phone?.trim()
  )
    return null;

  {
    const { data: visits, error: visitsError } = await admin
      .from('attendance')
      .select('checked_in_at')
      .eq('account_id', job.account_id)
      .eq('contact_id', job.contact_id)
      .lte('checked_in_at', now.toISOString())
      .order('checked_in_at', { ascending: false })
      .limit(1);
    if (visitsError) throw visitsError;
    const lastVisitOn = visits?.[0]?.checked_in_at
      ? todayInTz(account.timezone, new Date(visits[0].checked_in_at))
      : null;
    const streakStart = absenceStreakStart(membership.start_date, lastVisitOn);
    const sixAbsentDays = hasSixAbsentDays(
      job.effective_due_on,
      membership.start_date,
      lastVisitOn
    );
    if (
      !sixAbsentDays ||
      ![1, 2].some(
        (number) =>
          job.milestone_key ===
          `since-${streakStart}:on-${job.effective_due_on}:n-${number}`
      )
    ) {
      return null;
    }
    const { data: replied, error: replyError } = await admin.rpc(
      'attendance_absence_has_reply',
      { p_job_id: job.id, p_streak_start: streakStart }
    );
    if (replyError) throw replyError;
    if (replied) return null;
  }

  const sendWindowEnd = Number(
    settings?.invoice_collection_send_window_end ?? 19
  );
  const dueAt = absenceDueAt(
    job.effective_due_on,
    contact.assigned_arrival_time,
    sendWindowEnd,
    account.timezone
  );
  const localToday = todayInTz(account.timezone, now);
  const currentDueAt = [localToday, istAddDays(localToday, -1)]
    .map((date) =>
      absenceDueAt(
        date,
        contact.assigned_arrival_time,
        sendWindowEnd,
        account.timezone
      )
    )
    .filter((slot): slot is Date => !!slot && slot.getTime() <= now.getTime())
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (
    !dueAt ||
    !currentDueAt ||
    !job.scheduled_for_at ||
    dueAt.getTime() !== new Date(job.scheduled_for_at).getTime() ||
    now.getTime() < dueAt.getTime() ||
    now.getTime() < currentDueAt.getTime() ||
    now.getTime() - currentDueAt.getTime() > 2 * 60 * 60_000
  )
    return null;

  const start = dayStartInTz(job.effective_due_on, account.timezone);
  const end = dayStartInTz(
    istAddDays(job.effective_due_on, 1),
    account.timezone
  );
  if (!start || !end) return null;
  const { data: attendance, error: attendanceError } = await admin
    .from('attendance')
    .select('id')
    .eq('account_id', job.account_id)
    .eq('contact_id', job.contact_id)
    .gte('checked_in_at', start.toISOString())
    .lt('checked_in_at', end.toISOString())
    .limit(1);
  if (attendanceError) throw attendanceError;
  if (attendance?.length) return null;
  return {
    name: contact.name?.trim() || 'there',
    phone: contact.phone,
    sendWindowEnd,
    assignedArrival: contact.assigned_arrival_time,
  };
}

export async function processAttendanceAbsenceJob({
  admin,
  job,
  account,
  now,
  summary,
  finish,
  findConversation,
  markProviderAttempt,
  reserveDailyClaim,
}: {
  admin: Admin;
  job: LifecycleReminderJob;
  account: Account;
  now: Date;
  summary: ReminderRunSummary;
  finish: (
    state: string,
    options?: {
      providerMessageId?: string;
      reason?: { code: string };
      nextAttemptAt?: string;
    }
  ) => Promise<void>;
  findConversation: (
    accountId: string,
    userId: string,
    contactId: string
  ) => Promise<string>;
  markProviderAttempt: () => Promise<void>;
  reserveDailyClaim: (sendOn: string) => Promise<'reserved' | 'deferred'>;
}) {
  const ineligibleCode = 'attendance_streak_no_longer_eligible';
  const member = await currentMember(admin, job, account, now);
  if (!member) {
    await finish('skipped', {
      reason: { code: ineligibleCode },
    });
    summary.skipped++;
    return;
  }
  if (!account.legalBusinessName) {
    await finish('blocked', {
      reason: { code: 'legal_business_identity_missing' },
    });
    summary.blocked++;
    return;
  }
  const template = TEMPLATE_CONTRACTS.attendance_streak;
  const [
    { data: config, error: configError },
    { data: templates, error: templateError },
  ] = await Promise.all([
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
  if (configError || templateError) throw configError ?? templateError;
  const readiness = evaluateTemplateReadiness(templates, template.id, 'en_US');
  if (config?.status !== 'connected' || !readiness.ready) {
    await finish('blocked', {
      reason: {
        code:
          config?.status !== 'connected'
            ? 'whatsapp_not_connected'
            : readiness.code,
      },
    });
    summary.blocked++;
    return;
  }
  const reservation = await reserveDailyClaim(todayInTz(account.timezone, now));
  if (reservation !== 'reserved') {
    const localToday = todayInTz(account.timezone, now);
    const nextAttemptAt = [localToday, istAddDays(localToday, 1)]
      .map((date) =>
        absenceDueAt(
          date,
          member.assignedArrival,
          member.sendWindowEnd,
          account.timezone
        )
      )
      .filter((slot): slot is Date => !!slot && slot.getTime() > now.getTime())
      .sort((a, b) => a.getTime() - b.getTime())[0]
      ?.toISOString();
    await finish('deferred', {
      reason: { code: 'daily_contact_budget' },
      nextAttemptAt,
    });
    summary.deferred++;
    return;
  }
  await finish('attempting');
  summary.attempted++;
  let attempted = false;
  try {
    const conversationId = await findConversation(
      job.account_id,
      account.owner_user_id,
      job.contact_id
    );
    const params = [member.name, account.legalBusinessName];
    const sent = await engineSendTemplate({
      beforeSend: async () => {
        const latest = await currentMember(admin, job, account, new Date());
        if (!latest) throw new Ineligible(ineligibleCode);
        params[0] = latest.name;
        await markProviderAttempt();
        attempted = true;
      },
      accountId: job.account_id,
      userId: account.owner_user_id,
      conversationId,
      contactId: job.contact_id,
      templateName: template.payload.name,
      language: readiness.row.language ?? 'en_US',
      params,
    });
    await finish('accepted', { providerMessageId: sent.whatsapp_message_id });
    summary.accepted++;
  } catch (error) {
    if (error instanceof MetaAcceptedPersistenceError) {
      await finish('accepted', { providerMessageId: error.whatsappMessageId });
      summary.accepted++;
    } else if (error instanceof Ineligible) {
      await finish('skipped', { reason: { code: error.message } });
      summary.skipped++;
    } else if (attempted) {
      await finish('ambiguous', {
        reason: { code: 'provider_outcome_unknown' },
      });
      summary.ambiguous++;
    } else {
      await finish('queued', {
        reason: { code: 'provider_request_failed' },
        nextAttemptAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      });
      summary.failed++;
    }
  }
}
