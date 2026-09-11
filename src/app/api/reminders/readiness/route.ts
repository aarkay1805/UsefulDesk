import { NextResponse } from 'next/server';

import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { hourInTz, todayInTz } from '@/lib/locale/format';
import {
  diagnoseReminder,
  type ReminderDiagnosticTemplate,
} from '@/lib/memberships/reminder-readiness';
import { installmentReminderTargets } from '@/lib/memberships/installments';
import {
  REMINDER_SEND_HOUR_LOCAL,
  targetEndDates,
} from '@/lib/memberships/renewal-reminders';
import { isRenewalChaseable } from '@/lib/memberships/pricing';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';

export const runtime = 'nodejs';

type MembershipCandidate = {
  id: string;
  end_date: string;
  contact: { phone: string | null } | null;
  plan: { plan_type: string | null } | null;
};

type ServiceCandidate = {
  id: string;
  days_until_expiry: number;
  end_date: string;
  phone: string | null;
  service_days_before: number[] | null;
  current_renewal_price: number | null;
  item_is_active: boolean;
  option_is_active: boolean;
};

type InstallmentCandidate = {
  id: string;
  invoice_id: string | null;
  contact_id: string;
  second_due_on: string;
  contact: { phone: string | null } | null;
};

type InvoiceBalance = {
  id: string;
  balance: number;
  state: string;
  requires_refund_review: boolean;
};

type ReminderLedger = {
  subject_id: string;
  anchor_date: string;
  days_before: number;
  status?: string | null;
  claimed_at?: string | null;
};

interface CandidateCounts {
  dateMatchedCount: number;
  pendingCount: number;
  blockedCount: number;
  deferredCount: number;
}

function countCurrentCandidates(
  candidates: readonly {
    subjectId: string;
    anchorDate: string;
    daysBefore: number;
    hasPhone: boolean;
  }[],
  handled: ReadonlySet<string>,
  beforeSendHour: boolean
): CandidateCounts {
  const counts: CandidateCounts = {
    dateMatchedCount: candidates.length,
    pendingCount: 0,
    blockedCount: 0,
    deferredCount: 0,
  };
  for (const candidate of candidates) {
    const key = `${candidate.subjectId}|${candidate.anchorDate}|${candidate.daysBefore}`;
    if (handled.has(key)) continue;
    if (!candidate.hasPhone) {
      counts.blockedCount++;
    } else if (beforeSendHour) {
      counts.deferredCount++;
    } else {
      counts.pendingCount++;
    }
  }
  return counts;
}

function ledgerKeys(rows: readonly ReminderLedger[]): Set<string> {
  return new Set(
    rows.map((row) => `${row.subject_id}|${row.anchor_date}|${row.days_before}`)
  );
}

function templateDiagnostic(
  rows: Parameters<typeof evaluateTemplateReadiness>[0],
  contract: 'membership_renewal' | 'service_renewal' | 'installment_reminder'
): ReminderDiagnosticTemplate {
  const result = evaluateTemplateReadiness(rows, contract, 'en_US');
  return result.ready
    ? { ready: true, code: 'ready' }
    : { ready: false, code: result.code, message: result.message };
}

/**
 * Settings-only, no-PII diagnostic for existing reminder workers. This never
 * claims work, creates a conversation, or calls a provider; it repeats the
 * current candidate filters only to make setup and empty cohorts observable.
 */
export async function GET() {
  try {
    const ctx = await requireSettingsAccess();
    const db = ctx.supabase;

    const [settingsResult, configResult, templatesResult, accountResult] =
      await Promise.all([
        db
          .from('renewal_reminder_settings')
          .select('enabled, days_before, service_enabled, service_days_before')
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
        db
          .from('whatsapp_config')
          .select('status')
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
        db
          .from('message_templates')
          .select('*')
          .eq('account_id', ctx.accountId)
          .in('name', [
            TEMPLATE_CONTRACTS.membership_renewal.payload.name,
            TEMPLATE_CONTRACTS.service_renewal.payload.name,
            TEMPLATE_CONTRACTS.installment_reminder.payload.name,
          ]),
        db
          .from('accounts')
          .select('timezone')
          .eq('id', ctx.accountId)
          .maybeSingle(),
      ]);

    const firstError =
      settingsResult.error ??
      configResult.error ??
      templatesResult.error ??
      accountResult.error;
    if (firstError) throw firstError;

    const settings = settingsResult.data;
    const timezone = accountResult.data?.timezone ?? 'UTC';
    const today = todayInTz(timezone);
    const diagnosticNow = new Date();
    const beforeSendHour =
      hourInTz(timezone, diagnosticNow) < REMINDER_SEND_HOUR_LOCAL;
    const membershipTargets = targetEndDates(settings?.days_before, today);
    const membershipDaysByEndDate = new Map(
      membershipTargets.map((target) => [target.endDate, target.daysBefore])
    );
    const installmentTargets = installmentReminderTargets(today);
    const installmentDaysByDueDate = new Map(
      installmentTargets.map((target) => [target.dueOn, target.daysBefore])
    );

    const [membershipsResult, servicesResult, installmentsResult] =
      await Promise.all([
        membershipTargets.length
          ? db
              .from('memberships')
              .select(
                'id, end_date, contact:contacts(phone), plan:membership_plans(plan_type)'
              )
              .eq('account_id', ctx.accountId)
              .eq('status', 'active')
              .eq('collection_mode', 'manual')
              .in(
                'end_date',
                membershipTargets.map((target) => target.endDate)
              )
          : Promise.resolve({ data: [], error: null }),
        db
          .from('service_renewal_queue')
          .select(
            'id, end_date, phone, days_until_expiry, service_days_before, current_renewal_price, item_is_active, option_is_active'
          )
          .eq('account_id', ctx.accountId)
          .eq('service_enabled', true),
        db
          .from('membership_installment_plans')
          .select(
            'id, invoice_id, contact_id, second_due_on, contact:contacts(phone)'
          )
          .eq('account_id', ctx.accountId)
          .in(
            'second_due_on',
            installmentTargets.map((target) => target.dueOn)
          ),
      ]);

    const candidateError =
      membershipsResult.error ??
      servicesResult.error ??
      installmentsResult.error;
    if (candidateError) throw candidateError;

    const installmentRows = (installmentsResult.data ??
      []) as unknown as InstallmentCandidate[];
    const invoiceIds = installmentRows.flatMap((row) =>
      row.invoice_id ? [row.invoice_id] : []
    );
    const balancesResult = invoiceIds.length
      ? await db
          .from('invoice_balances')
          .select('id, balance, state, requires_refund_review')
          .eq('account_id', ctx.accountId)
          .in('id', invoiceIds)
      : { data: [], error: null };
    if (balancesResult.error) throw balancesResult.error;

    const collectibleInvoiceIds = new Set(
      ((balancesResult.data ?? []) as InvoiceBalance[])
        .filter(
          (row) =>
            row.state === 'open' &&
            !row.requires_refund_review &&
            Number(row.balance) > 0
        )
        .map((row) => row.id)
    );
    const memberships = (
      (membershipsResult.data ?? []) as unknown as MembershipCandidate[]
    ).filter((row) => isRenewalChaseable(row.plan));
    const services = (
      (servicesResult.data ?? []) as unknown as ServiceCandidate[]
    ).filter(
      (row) =>
        row.service_days_before?.includes(row.days_until_expiry) &&
        row.current_renewal_price !== null &&
        row.item_is_active &&
        row.option_is_active
    );
    const installments = installmentRows.filter(
      (row) => row.invoice_id && collectibleInvoiceIds.has(row.invoice_id)
    );

    const [
      membershipLedgerResult,
      serviceLedgerResult,
      installmentLedgerResult,
    ] = await Promise.all([
      memberships.length
        ? db
            .from('renewal_reminders_sent')
            .select('membership_id, end_date, days_before')
            .eq('account_id', ctx.accountId)
            .in(
              'membership_id',
              memberships.map((row) => row.id)
            )
        : Promise.resolve({ data: [], error: null }),
      services.length
        ? db
            .from('service_renewal_reminders_sent')
            .select(
              'member_service_id, end_date, days_before, status, claimed_at'
            )
            .eq('account_id', ctx.accountId)
            .in(
              'member_service_id',
              services.map((row) => row.id)
            )
        : Promise.resolve({ data: [], error: null }),
      installments.length
        ? db
            .from('installment_reminders_sent')
            .select('installment_plan_id, due_on, days_before')
            .eq('account_id', ctx.accountId)
            .in(
              'installment_plan_id',
              installments.map((row) => row.id)
            )
        : Promise.resolve({ data: [], error: null }),
    ]);
    const ledgerError =
      membershipLedgerResult.error ??
      serviceLedgerResult.error ??
      installmentLedgerResult.error;
    if (ledgerError) throw ledgerError;

    const membershipCounts = countCurrentCandidates(
      memberships.flatMap((row) => {
        const daysBefore = membershipDaysByEndDate.get(row.end_date);
        return daysBefore === undefined
          ? []
          : [
              {
                subjectId: row.id,
                anchorDate: row.end_date,
                daysBefore,
                hasPhone: Boolean(row.contact?.phone?.trim()),
              },
            ];
      }),
      ledgerKeys(
        (
          (membershipLedgerResult.data ?? []) as {
            membership_id: string;
            end_date: string;
            days_before: number;
          }[]
        ).map((row) => ({
          subject_id: row.membership_id,
          anchor_date: row.end_date,
          days_before: row.days_before,
        }))
      ),
      beforeSendHour
    );
    const serviceRows = (serviceLedgerResult.data ?? []) as {
      member_service_id: string;
      end_date: string;
      days_before: number;
      status: string | null;
      claimed_at: string | null;
    }[];
    const activeServiceClaims = new Set(
      serviceRows
        .filter(
          (row) =>
            row.status === 'sent' ||
            (row.status === 'claimed' &&
              row.claimed_at !== null &&
              new Date(row.claimed_at).getTime() >
                diagnosticNow.getTime() - 15 * 60 * 1000)
        )
        .map(
          (row) => `${row.member_service_id}|${row.end_date}|${row.days_before}`
        )
    );
    const serviceCounts = countCurrentCandidates(
      services.map((row) => ({
        subjectId: row.id,
        anchorDate: row.end_date,
        daysBefore: row.days_until_expiry,
        hasPhone: Boolean(row.phone?.trim()),
      })),
      activeServiceClaims,
      beforeSendHour
    );
    const installmentCounts = countCurrentCandidates(
      installments.flatMap((row) => {
        const daysBefore = installmentDaysByDueDate.get(row.second_due_on);
        return daysBefore === undefined
          ? []
          : [
              {
                subjectId: row.id,
                anchorDate: row.second_due_on,
                daysBefore,
                hasPhone: Boolean(row.contact?.phone?.trim()),
              },
            ];
      }),
      ledgerKeys(
        (
          (installmentLedgerResult.data ?? []) as {
            installment_plan_id: string;
            due_on: string;
            days_before: number;
          }[]
        ).map((row) => ({
          subject_id: row.installment_plan_id,
          anchor_date: row.due_on,
          days_before: row.days_before,
        }))
      ),
      beforeSendHour
    );

    const templates = templatesResult.data ?? [];
    const whatsappConnected = configResult.data?.status === 'connected';
    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      diagnostics: [
        diagnoseReminder({
          kind: 'membership_renewal',
          enabled: Boolean(settings?.enabled),
          whatsappConnected,
          template: templateDiagnostic(templates, 'membership_renewal'),
          ...membershipCounts,
        }),
        diagnoseReminder({
          kind: 'service_renewal',
          enabled: Boolean(settings?.service_enabled),
          whatsappConnected,
          template: templateDiagnostic(templates, 'service_renewal'),
          ...serviceCounts,
        }),
        diagnoseReminder({
          kind: 'installment_reminder',
          // Each joining installment is an explicit opt-in; there is no
          // account-wide switch to report as disabled.
          enabled: true,
          whatsappConnected,
          template: templateDiagnostic(templates, 'installment_reminder'),
          ...installmentCounts,
        }),
      ],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
