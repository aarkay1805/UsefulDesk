import { requireProductAccess } from '@/lib/platform-access/server';
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
import { isChargeableAmount } from '@/lib/memberships/periods';
import { runLegacyReminderDelivery } from '@/lib/reminders/legacy-delivery';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import { loadLegalBusinessName } from '@/lib/whatsapp/legal-business-name';

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
  account_id?: string;
  contact_id?: string;
  membership_id?: string | null;
  collectible_balance: number;
  state: string;
  requires_refund_review: boolean;
}

class ReminderEligibilityChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderEligibilityChangedError';
  }
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
    accepted: 0,
    ambiguous: 0,
    sent: 0,
    failed: 0,
    skipped_already_sent: 0,
    skipped_ineligible: 0,
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
    summary.failed++;
    notes.push(
      `installment account query failed — ${dueAccountsError.message}`
    );
    return NextResponse.json({ ...summary, notes }, { status: 503 });
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
    try {
      await requireProductAccess(admin, accountId);
    } catch {
      notes.push(`account ${accountId}: product_access_required`);
      continue;
    }
    if (summary.sent >= MAX_SENDS_PER_RUN) {
      notes.push(
        'hit MAX_SENDS_PER_RUN — remaining accounts deferred to next run'
      );
      break;
    }
    summary.accounts_considered++;

    const [configResult, templateResult, accountResult] = await Promise.all([
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
    const readinessError =
      configResult.error ?? templateResult.error ?? accountResult.error;
    if (readinessError) {
      summary.failed++;
      notes.push(
        `account ${accountId}: readiness query failed — ${readinessError.message}`
      );
      continue;
    }
    const config = configResult.data;
    const template = templateResult.data;
    const account = accountResult.data;
    const legalIdentity = await loadLegalBusinessName(
      admin as unknown as Parameters<typeof loadLegalBusinessName>[0],
      accountId
    );

    const templateReadiness = evaluateTemplateReadiness(
      template ? [template] : [],
      'installment_reminder',
      'en_US'
    );
    if (
      !config ||
      config.status !== 'connected' ||
      !templateReadiness.ready ||
      !account ||
      !legalIdentity.ok
    ) {
      summary.accounts_skipped++;
      if (!config || config.status !== 'connected') {
        notes.push(`account ${accountId}: blocked: connect WhatsApp`);
      }
      if (!templateReadiness.ready) {
        notes.push(
          `account ${accountId}: blocked: ${templateReadiness.message}`
        );
      }
      if (!account) {
        notes.push(
          `account ${accountId}: blocked: account locale is unavailable`
        );
      }
      if (!legalIdentity.ok) {
        notes.push(`account ${accountId}: blocked: ${legalIdentity.code}`);
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
        summary.failed++;
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
            .select(
              'id, membership_id, collectible_balance, state, requires_refund_review'
            )
            .eq('account_id', accountId)
            .in('id', invoiceIds)
            .eq('state', 'open')
            .eq('requires_refund_review', false)
            .gt('collectible_balance', 0)
        : { data: [], error: null };

      if (invoiceError) {
        summary.failed++;
        notes.push(
          `account ${accountId}: balance query failed — ${invoiceError.message}`
        );
        continue;
      }

      const balanceByInvoice = new Map(
        ((invoiceRows ?? []) as InvoiceBalance[]).map((invoice) => [
          invoice.id,
          Number(invoice.collectible_balance),
        ])
      );
      const { data: commitmentRows, error: commitmentError } = invoiceIds.length
        ? await admin
            .from('invoice_collection_commitments')
            .select('invoice_id')
            .eq('account_id', accountId)
            .in('invoice_id', invoiceIds)
            .eq('state', 'open')
        : { data: [], error: null };
      if (commitmentError) {
        summary.failed++;
        notes.push(
          `account ${accountId}: commitment hold lookup failed — ${commitmentError.message}`
        );
        continue;
      }
      const heldInvoiceIds = new Set(
        (commitmentRows ?? []).map((row) => row.invoice_id as string)
      );

      for (const candidate of candidates) {
        if (summary.sent >= MAX_SENDS_PER_RUN) break;

        const balance = candidate.invoice_id
          ? (balanceByInvoice.get(candidate.invoice_id) ?? 0)
          : 0;
        const phone = candidate.contact?.phone?.trim();
        if (
          !isChargeableAmount(balance) ||
          !phone ||
          (candidate.invoice_id && heldInvoiceIds.has(candidate.invoice_id))
        )
          continue;

        try {
          const invoiceId = candidate.invoice_id as string;
          const params = [
            candidate.contact?.name?.trim() || 'there',
            fmt.money(Math.min(Number(candidate.second_amount), balance)),
            candidate.membership?.plan?.name || 'membership',
            fmt.date(candidate.second_due_on),
            legalIdentity.name,
          ];
          const result = await runLegacyReminderDelivery(
            {
              async claim() {
                const { data: claim, error } = await admin
                  .from('installment_reminders_sent')
                  .upsert(
                    {
                      account_id: accountId,
                      installment_plan_id: candidate.id,
                      membership_id: candidate.membership_id,
                      contact_id: candidate.contact_id,
                      due_on: candidate.second_due_on,
                      days_before: target.daysBefore,
                      delivery_state: 'claimed',
                      provider_attempted_at: null,
                      last_error: null,
                    },
                    {
                      onConflict: 'installment_plan_id,due_on,days_before',
                      ignoreDuplicates: true,
                    }
                  )
                  .select('id')
                  .maybeSingle();
                if (error) throw error;
                return claim ? { id: claim.id as string } : null;
              },
              async markProviderAttempt(claim) {
                const { data, error } = await admin
                  .from('installment_reminders_sent')
                  .update({
                    delivery_state: 'attempting',
                    provider_attempted_at: new Date().toISOString(),
                  })
                  .eq('id', claim.id)
                  .eq('delivery_state', 'claimed')
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ?? 'installment reminder claim was lost'
                  );
                }
              },
              async accept(claim, providerMessageId) {
                const { data, error } = await admin
                  .from('installment_reminders_sent')
                  .update({
                    delivery_state: 'accepted',
                    wa_message_id: providerMessageId,
                    last_error: null,
                  })
                  .eq('id', claim.id)
                  .in('delivery_state', ['attempting', 'accepted'])
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ??
                      'accepted installment reminder was not persisted'
                  );
                }
              },
              async retainAmbiguous(claim, details) {
                const { data, error } = await admin
                  .from('installment_reminders_sent')
                  .update({
                    delivery_state: details.providerMessageId
                      ? 'accepted'
                      : 'ambiguous',
                    wa_message_id: details.providerMessageId,
                    last_error: details.error.slice(0, 1000),
                  })
                  .eq('id', claim.id)
                  .eq('delivery_state', 'attempting')
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ??
                      'ambiguous installment reminder was not retained'
                  );
                }
              },
              async releasePreProvider(claim) {
                const { data, error } = await admin
                  .from('installment_reminders_sent')
                  .delete()
                  .eq('id', claim.id)
                  .eq('delivery_state', 'claimed')
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ??
                      'retryable installment reminder claim was not released'
                  );
                }
              },
            },
            async (markProviderAttempt) => {
              const conversationId = await findOrCreateConversation(
                admin,
                accountId,
                ownerUserId,
                candidate.contact_id
              );
              return engineSendTemplate({
                beforeSend: async () => {
                  const [planResult, balanceResult, holdResult] =
                    await Promise.all([
                      admin
                        .from('membership_installment_plans')
                        .select(
                          'id, invoice_id, membership_id, contact_id, period_end, second_amount, second_due_on, contact:contacts(id, name, phone), membership:memberships(status, plan:membership_plans(name))'
                        )
                        .eq('account_id', accountId)
                        .eq('id', candidate.id)
                        .maybeSingle(),
                      admin
                        .from('invoice_balances')
                        .select(
                          'id, account_id, contact_id, membership_id, collectible_balance, state, requires_refund_review'
                        )
                        .eq('account_id', accountId)
                        .eq('id', invoiceId)
                        .maybeSingle(),
                      admin
                        .from('invoice_collection_commitments')
                        .select('id')
                        .eq('account_id', accountId)
                        .eq('invoice_id', invoiceId)
                        .eq('state', 'open')
                        .limit(1),
                    ]);
                  if (planResult.error) throw planResult.error;
                  if (balanceResult.error) throw balanceResult.error;
                  if (holdResult.error) throw holdResult.error;

                  const currentPlan =
                    planResult.data as unknown as InstallmentCandidate | null;
                  const currentBalance =
                    balanceResult.data as InvoiceBalance | null;
                  const currentTargetStillScheduled =
                    installmentReminderTargets(todayInTz(locale.timeZone)).some(
                      (scheduled) =>
                        scheduled.daysBefore === target.daysBefore &&
                        scheduled.dueOn === target.dueOn
                    );
                  if (
                    !currentPlan ||
                    currentPlan.id !== candidate.id ||
                    currentPlan.invoice_id !== invoiceId ||
                    currentPlan.membership_id !== candidate.membership_id ||
                    currentPlan.contact_id !== candidate.contact_id ||
                    currentPlan.second_due_on !== candidate.second_due_on ||
                    currentPlan.second_due_on !== target.dueOn ||
                    !currentTargetStillScheduled ||
                    !currentPlan.contact?.phone?.trim() ||
                    !currentBalance ||
                    currentBalance.id !== invoiceId ||
                    currentBalance.account_id !== accountId ||
                    currentBalance.contact_id !== candidate.contact_id ||
                    currentBalance.membership_id !== candidate.membership_id ||
                    currentBalance.state !== 'open' ||
                    currentBalance.requires_refund_review ||
                    !isChargeableAmount(
                      Number(currentBalance.collectible_balance)
                    )
                  ) {
                    throw new ReminderEligibilityChangedError(
                      'installment or invoice is no longer reminder-eligible'
                    );
                  }
                  if ((holdResult.data ?? []).length > 0) {
                    throw new ReminderEligibilityChangedError(
                      'invoice commitment or hold is open'
                    );
                  }

                  params[0] = currentPlan.contact.name?.trim() || 'there';
                  params[1] = fmt.money(
                    Math.min(
                      Number(currentPlan.second_amount),
                      Number(currentBalance.collectible_balance)
                    )
                  );
                  params[2] =
                    currentPlan.membership?.plan?.name || 'membership';
                  params[3] = fmt.date(currentPlan.second_due_on);
                  await markProviderAttempt();
                },
                accountId,
                userId: ownerUserId,
                conversationId,
                contactId: candidate.contact_id,
                templateName: INSTALLMENT_REMINDER_TEMPLATE_NAME,
                language,
                params,
              });
            }
          );

          if (result.outcome === 'duplicate') {
            summary.skipped_already_sent++;
          } else if (result.outcome === 'accepted') {
            summary.sent++;
            summary.accepted++;
            if (result.warning) {
              summary.failed++;
              notes.push(
                `account ${accountId} installment ${candidate.id}: provider accepted; local persistence needs review — ${result.warning}`
              );
            }
          } else if (result.outcome === 'ambiguous') {
            summary.ambiguous++;
            summary.failed++;
            notes.push(
              `account ${accountId} installment ${candidate.id}: provider outcome unknown — ${result.error}`
            );
          } else {
            if (result.cause instanceof ReminderEligibilityChangedError) {
              summary.skipped_ineligible++;
              notes.push(
                `account ${accountId} installment ${candidate.id}: skipped — ${result.error}`
              );
            } else {
              summary.failed++;
              notes.push(
                `account ${accountId} installment ${candidate.id}: pre-provider failure; safe to retry — ${result.error}`
              );
            }
          }
        } catch (error) {
          summary.failed++;
          notes.push(
            `account ${accountId} installment ${candidate.id}: delivery state update failed — ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
  }

  return NextResponse.json(
    { ...summary, notes },
    { status: summary.failed > 0 || summary.ambiguous > 0 ? 503 : 200 }
  );
}

type Admin = ReturnType<typeof supabaseAdmin>;

async function findOrCreateConversation(
  admin: Admin,
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

  if (existingError) {
    throw new Error(`could not read conversation: ${existingError.message}`);
  }

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
