import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { engineSendTemplate } from '@/lib/automations/meta-send';
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { resolveAccountLocale } from '@/lib/locale/config';
import { buildFormatters, hourInTz, todayInTz } from '@/lib/locale/format';
import { istAddDays } from '@/lib/memberships/expiry';
import {
  INSTALLMENT_REMINDER_TEMPLATE_NAME,
  installmentReminderTargets,
} from '@/lib/memberships/installments';
import { REMINDER_SEND_HOUR_LOCAL } from '@/lib/memberships/renewal-reminders';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';

const MAX_SENDS_PER_RUN = 200;

interface InstallmentCandidate {
  id: string;
  invoice_id: string | null;
  membership_id: string;
  contact_id: string;
  period_end: string;
  second_amount: number;
  second_due_on: string;
  contact: { id: string; name: string | null; phone: string | null } | null;
  membership: {
    status: string;
    plan: { name: string | null } | null;
  } | null;
}

interface InvoiceBalance {
  id: string;
  balance: number;
  state: string;
  requires_refund_review: boolean;
}

/**
 * Sends claim-first, balance-aware WhatsApp reminders for the second half of
 * conversion installment plans. Selecting "Part now, part later" is the
 * per-member opt-in; no account-wide reminder toggle is required.
 */
export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const now = new Date();
  const utcToday = todayInTz('UTC', now);
  const summary = {
    run_at_utc: now.toISOString(),
    accounts_considered: 0,
    accounts_skipped: 0,
    accounts_before_send_hour: 0,
    sent: 0,
    failed: 0,
    skipped_already_sent: 0,
  };
  const notes: string[] = [];

  // Account-local "today" can be one day either side of UTC. Bound the
  // candidate scan to that drift plus the furthest reminder offset.
  const { data: dueAccountRows, error: dueAccountsError } = await admin
    .from('membership_installment_plans')
    .select('account_id')
    .gte('second_due_on', istAddDays(utcToday, -1))
    .lte('second_due_on', istAddDays(utcToday, 8));

  if (dueAccountsError) {
    return NextResponse.json(
      { error: dueAccountsError.message },
      { status: 500 }
    );
  }

  const accountIds = Array.from(
    new Set((dueAccountRows ?? []).map((row) => row.account_id as string))
  );
  if (accountIds.length === 0) {
    return NextResponse.json({
      ...summary,
      note: 'no installment reminders due',
    });
  }

  for (const accountId of accountIds) {
    if (summary.sent >= MAX_SENDS_PER_RUN) {
      notes.push(
        'hit MAX_SENDS_PER_RUN — remaining accounts deferred to next run'
      );
      break;
    }
    summary.accounts_considered++;

    const [{ data: config }, { data: template }, { data: account }] =
      await Promise.all([
        admin
          .from('whatsapp_config')
          .select('status')
          .eq('account_id', accountId)
          .maybeSingle(),
        admin
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('name', INSTALLMENT_REMINDER_TEMPLATE_NAME)
          .eq('language', 'en_US')
          .maybeSingle(),
        admin
          .from('accounts')
          .select(
            'owner_user_id, default_currency, country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system'
          )
          .eq('id', accountId)
          .maybeSingle(),
      ]);

    const templateReadiness = evaluateTemplateReadiness(
      template ? [template] : [],
      'installment_reminder',
      'en_US'
    );
    if (
      !config ||
      config.status !== 'connected' ||
      !templateReadiness.ready ||
      !account
    ) {
      summary.accounts_skipped++;
      if (!templateReadiness.ready) {
        notes.push(`account ${accountId}: ${templateReadiness.message}`);
      }
      continue;
    }

    const locale = resolveAccountLocale(account);
    const fmt = buildFormatters(locale);
    if (hourInTz(locale.timeZone, now) < REMINDER_SEND_HOUR_LOCAL) {
      summary.accounts_before_send_hour++;
      continue;
    }

    const today = todayInTz(locale.timeZone, now);
    const ownerUserId = account.owner_user_id as string;
    const language = (templateReadiness.row.language as string) ?? 'en_US';

    for (const target of installmentReminderTargets(today)) {
      if (summary.sent >= MAX_SENDS_PER_RUN) break;

      const { data, error: candidateError } = await admin
        .from('membership_installment_plans')
        .select(
          'id, invoice_id, membership_id, contact_id, period_end, second_amount, second_due_on, contact:contacts(id, name, phone), membership:memberships(status, plan:membership_plans(name))'
        )
        .eq('account_id', accountId)
        .eq('second_due_on', target.dueOn);

      if (candidateError) {
        notes.push(
          `account ${accountId}: installment query failed — ${candidateError.message}`
        );
        continue;
      }

      const candidates = (data ?? []) as unknown as InstallmentCandidate[];
      if (candidates.length === 0) continue;

      const invoiceIds = candidates
        .map((candidate) => candidate.invoice_id)
        .filter((id): id is string => Boolean(id));
      const { data: invoiceRows, error: invoiceError } = invoiceIds.length
        ? await admin
            .from('invoice_balances')
            .select('id, membership_id, balance, state, requires_refund_review')
            .eq('account_id', accountId)
            .in('id', invoiceIds)
            .eq('state', 'open')
            .eq('requires_refund_review', false)
            .gt('balance', 0)
        : { data: [], error: null };

      if (invoiceError) {
        notes.push(
          `account ${accountId}: balance query failed — ${invoiceError.message}`
        );
        continue;
      }

      const balanceByInvoice = new Map(
        ((invoiceRows ?? []) as InvoiceBalance[]).map((invoice) => [
          invoice.id,
          Number(invoice.balance),
        ])
      );

      for (const candidate of candidates) {
        if (summary.sent >= MAX_SENDS_PER_RUN) break;

        const balance = candidate.invoice_id
          ? (balanceByInvoice.get(candidate.invoice_id) ?? 0)
          : 0;
        const phone = candidate.contact?.phone?.trim();
        if (balance <= 0 || !phone) continue;

        const { data: claim, error: claimError } = await admin
          .from('installment_reminders_sent')
          .upsert(
            {
              account_id: accountId,
              installment_plan_id: candidate.id,
              membership_id: candidate.membership_id,
              contact_id: candidate.contact_id,
              due_on: candidate.second_due_on,
              days_before: target.daysBefore,
            },
            {
              onConflict: 'installment_plan_id,due_on,days_before',
              ignoreDuplicates: true,
            }
          )
          .select('id')
          .maybeSingle();

        if (claimError) {
          notes.push(
            `account ${accountId}: reminder claim failed — ${claimError.message}`
          );
          continue;
        }
        if (!claim) {
          summary.skipped_already_sent++;
          continue;
        }

        try {
          const conversationId = await findOrCreateConversation(
            admin,
            accountId,
            ownerUserId,
            candidate.contact_id
          );
          const amountDue = Math.min(Number(candidate.second_amount), balance);
          const { whatsapp_message_id } = await engineSendTemplate({
            accountId,
            userId: ownerUserId,
            conversationId,
            contactId: candidate.contact_id,
            templateName: INSTALLMENT_REMINDER_TEMPLATE_NAME,
            language,
            params: [
              candidate.contact?.name?.trim() || 'there',
              fmt.money(amountDue),
              candidate.membership?.plan?.name || 'membership',
              fmt.date(candidate.second_due_on),
            ],
          });

          await admin
            .from('installment_reminders_sent')
            .update({ wa_message_id: whatsapp_message_id })
            .eq('id', claim.id as string);
          summary.sent++;
        } catch (error) {
          await admin
            .from('installment_reminders_sent')
            .delete()
            .eq('id', claim.id as string);
          summary.failed++;
          notes.push(
            `account ${accountId} installment ${candidate.id}: send failed — ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
  }

  return NextResponse.json({ ...summary, notes });
}

type Admin = ReturnType<typeof supabaseAdmin>;

async function findOrCreateConversation(
  admin: Admin,
  accountId: string,
  userId: string,
  contactId: string
): Promise<string> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: created, error } = await admin
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('id')
    .single();

  if (error || !created) {
    throw new Error(
      `could not open a conversation: ${error?.message ?? 'unknown'}`
    );
  }
  return created.id as string;
}
