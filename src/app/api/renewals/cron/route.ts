import { requireProductAccess } from '@/lib/platform-access/server';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { engineSendTemplate } from '@/lib/automations/meta-send';
import { resolveAccountLocale } from '@/lib/locale/config';
import { buildFormatters, hourInTz, todayInTz } from '@/lib/locale/format';
import {
  REMINDER_SEND_HOUR_LOCAL,
  RENEWAL_TEMPLATE_NAME,
  RENEWAL_TEMPLATE_NAMES,
  normalizeDaysBefore,
  selectRenewalTemplate,
  targetEndDates,
} from '@/lib/memberships/renewal-reminders';
import { isRenewalChaseable } from '@/lib/memberships/pricing';
import { runLegacyReminderDelivery } from '@/lib/reminders/legacy-delivery';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';

/**
 * Auto renewal reminders — the scheduled half of the renewal wedge.
 *
 * Hit on a schedule (Vercel Cron / external pinger), once a day is
 * plenty. For every account that opted in (renewal_reminder_settings
 * .enabled), it finds memberships expiring at each configured offset
 * and sends the exact approved Marketing renewal contract — the same message the manual
 * "Remind" button sends, just without an owner having to click.
 *
 * Guarded by the shared AUTOMATION_CRON_SECRET (same secret the
 * automations cron uses — one less env var to manage).
 *
 * Dedupe is claim-first against the UNIQUE(membership_id, end_date,
 * days_before) index: we INSERT a log row BEFORE sending, so a
 * conflict means "already handled" and two overlapping cron runs can't
 * double-message. The claim becomes non-retryable immediately before the
 * provider request; only a failure known to precede that boundary releases it.
 */

// A hard ceiling on sends per invocation — a backstop against a
// misconfigured account with a huge expiring cohort hammering Meta in
// one run. Anything above this simply waits for the next run.
const MAX_SENDS_PER_RUN = 200;
const SERVICE_TEMPLATE_NAME = TEMPLATE_CONTRACTS.service_renewal.payload.name;

class ReminderSetupBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderSetupBlockedError';
  }
}

class ReminderEligibilityChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderEligibilityChangedError';
  }
}

/** Shape of a membership row hydrated for a reminder (to-one embeds). */
interface ReminderCandidate {
  id: string;
  contact_id: string;
  start_date: string;
  fee_amount: number;
  end_date: string;
  status?: string;
  collection_mode?: string;
  contact: { id: string; name: string | null; phone: string | null } | null;
  plan: { name: string | null; plan_type: string | null } | null;
}

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  // "Today" is per-account (each gym's own time zone, migration 055) —
  // computed inside the loop. This stamp is just for the run log.
  const now = new Date();

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
    service_sent: 0,
    service_failed: 0,
    service_ambiguous: 0,
    service_blocked: 0,
  };
  const notes: string[] = [];

  // Every account that opted in. Small table (one row per account),
  // filtered to the enabled minority — cheap to scan whole.
  const { data: settingsRows, error: settingsErr } = await admin
    .from('renewal_reminder_settings')
    .select('account_id, days_before, enabled')
    .eq('enabled', true);

  if (settingsErr) {
    summary.failed++;
    notes.push(`renewal settings query failed — ${settingsErr.message}`);
  }
  for (const s of settingsErr ? [] : (settingsRows ?? [])) {
    if (summary.sent >= MAX_SENDS_PER_RUN) {
      notes.push(
        'hit MAX_SENDS_PER_RUN — remaining accounts deferred to next run'
      );
      break;
    }

    const accountId = s.account_id as string;
    try {
      await requireProductAccess(admin, accountId);
    } catch {
      notes.push(`account ${accountId}: product_access_required`);
      continue;
    }
    summary.accounts_considered++;

    // Readiness gate — mirror the manual button's useReminderReadiness:
    // WhatsApp must be connected AND the renewal template approved.
    // Under the service-role client we must scope every lookup by
    // account_id ourselves (no RLS to lean on).
    const [configResult, templatesResult, accountResult] = await Promise.all([
      admin
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle(),
      admin
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .in('name', [...RENEWAL_TEMPLATE_NAMES]),
      admin
        .from('accounts')
        .select(
          'owner_user_id, default_currency, country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system'
        )
        .eq('id', accountId)
        .maybeSingle(),
    ]);
    const readinessError =
      configResult.error ?? templatesResult.error ?? accountResult.error;
    if (readinessError) {
      summary.failed++;
      notes.push(
        `account ${accountId}: readiness query failed — ${readinessError.message}`
      );
      continue;
    }
    const config = configResult.data;
    const templates = templatesResult.data;
    const account = accountResult.data;

    const templateReadiness = evaluateTemplateReadiness(
      templates,
      'membership_renewal',
      'en_US'
    );
    const template = selectRenewalTemplate(templates);

    if (!config || config.status !== 'connected' || !template || !account) {
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
      continue;
    }

    // Everything downstream — "today", the send window, the template's
    // date and fee strings — follows THIS account's localization.
    const cfg = resolveAccountLocale(account);
    const fmt = buildFormatters(cfg);

    // Hourly job, per-zone window: skip until the account's local
    // morning. The claim ledger makes the first run at/after the send
    // hour the only one that actually messages.
    if (hourInTz(cfg.timeZone, now) < REMINDER_SEND_HOUR_LOCAL) {
      summary.accounts_before_send_hour++;
      continue;
    }

    const today = todayInTz(cfg.timeZone, now);
    const ownerUserId = account.owner_user_id as string;
    const language = (template.language as string) ?? 'en_US';
    const targets = targetEndDates(s.days_before, today);

    for (const target of targets) {
      if (summary.sent >= MAX_SENDS_PER_RUN) break;

      // Only `active` memberships expiring exactly on this date. Frozen /
      // cancelled are excluded in the query; an equality on the indexed
      // end_date column keeps this cheap.
      //
      // Skip members on auto-collection (`collection_mode='auto'`, migration
      // 059): a live UPI-AutoPay mandate collects their renewal, so nagging
      // them would double-contact. A FAILED mandate is already flipped back
      // to 'manual' by revoke_mandate (webhook), so those members fall
      // through to this reminder — that IS the dunning fallback.
      const { data, error: mErr } = await admin
        .from('memberships')
        .select(
          'id, contact_id, start_date, fee_amount, end_date, contact:contacts(id, name, phone), plan:membership_plans(name, plan_type)'
        )
        .eq('account_id', accountId)
        .eq('status', 'active')
        .eq('collection_mode', 'manual')
        .eq('end_date', target.endDate);

      if (mErr) {
        summary.failed++;
        notes.push(`account ${accountId}: query failed — ${mErr.message}`);
        continue;
      }
      // The to-one embeds come back as single objects at runtime; the
      // untyped client infers them as arrays, so cast to the real shape
      // (same approach as members-table.tsx casting to Membership[]).
      //
      // Only RECURRING plans get renewal nags (062). Filtered in TS, not
      // `!inner`, so legacy NULL-plan rows keep their reminders.
      const memberships = (
        (data ?? []) as unknown as ReminderCandidate[]
      ).filter((m) => isRenewalChaseable(m.plan));
      if (memberships.length === 0) continue;

      for (const m of memberships) {
        if (summary.sent >= MAX_SENDS_PER_RUN) break;

        const phone = m.contact?.phone?.trim();
        if (!phone) continue; // no way to reach them — skip silently

        try {
          const result = await runLegacyReminderDelivery(
            {
              async claim() {
                const { data: claim, error } = await admin
                  .from('renewal_reminders_sent')
                  .upsert(
                    {
                      account_id: accountId,
                      membership_id: m.id as string,
                      contact_id: m.contact_id as string,
                      end_date: target.endDate,
                      days_before: target.daysBefore,
                      delivery_state: 'claimed',
                      provider_attempted_at: null,
                      last_error: null,
                    },
                    {
                      onConflict: 'membership_id,end_date,days_before',
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
                  .from('renewal_reminders_sent')
                  .update({
                    delivery_state: 'attempting',
                    provider_attempted_at: new Date().toISOString(),
                  })
                  .eq('id', claim.id)
                  .eq('delivery_state', 'claimed')
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(error?.message ?? 'reminder claim was lost');
                }
              },
              async accept(claim, providerMessageId) {
                const { data, error } = await admin
                  .from('renewal_reminders_sent')
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
                    error?.message ?? 'accepted reminder was not persisted'
                  );
                }
              },
              async retainAmbiguous(claim, details) {
                const { data, error } = await admin
                  .from('renewal_reminders_sent')
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
                    error?.message ?? 'ambiguous reminder was not retained'
                  );
                }
              },
              async releasePreProvider(claim) {
                const { data, error } = await admin
                  .from('renewal_reminders_sent')
                  .delete()
                  .eq('id', claim.id)
                  .eq('delivery_state', 'claimed')
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ??
                      'retryable reminder claim was not released'
                  );
                }
              },
            },
            async (markProviderAttempt) => {
              const conversationId = await findOrCreateConversation(
                admin,
                accountId,
                ownerUserId,
                m.contact_id as string
              );
              const params = [
                m.contact?.name?.trim() || 'there',
                m.plan?.name || 'membership',
                fmt.date(target.endDate),
                fmt.money(m.fee_amount),
              ];
              return engineSendTemplate({
                beforeSend: async () => {
                  const [settingsResult, membershipResult] = await Promise.all([
                    admin
                      .from('renewal_reminder_settings')
                      .select('enabled, days_before')
                      .eq('account_id', accountId)
                      .maybeSingle(),
                    admin
                      .from('memberships')
                      .select(
                        'id, contact_id, start_date, fee_amount, end_date, status, collection_mode, contact:contacts(id, name, phone), plan:membership_plans(name, plan_type)'
                      )
                      .eq('account_id', accountId)
                      .eq('id', m.id)
                      .maybeSingle(),
                  ]);
                  if (settingsResult.error) throw settingsResult.error;
                  if (membershipResult.error) throw membershipResult.error;

                  const current =
                    membershipResult.data as unknown as ReminderCandidate | null;
                  const currentTargetStillScheduled = targetEndDates(
                    settingsResult.data?.days_before,
                    todayInTz(cfg.timeZone)
                  ).some(
                    (scheduled) =>
                      scheduled.daysBefore === target.daysBefore &&
                      scheduled.endDate === target.endDate
                  );
                  if (
                    !settingsResult.data?.enabled ||
                    !currentTargetStillScheduled
                  ) {
                    throw new ReminderEligibilityChangedError(
                      'membership reminder rule or schedule changed'
                    );
                  }
                  if (
                    !current ||
                    current.id !== m.id ||
                    current.contact_id !== m.contact_id ||
                    current.start_date !== m.start_date ||
                    current.end_date !== target.endDate ||
                    current.status !== 'active' ||
                    current.collection_mode !== 'manual' ||
                    !isRenewalChaseable(current.plan) ||
                    !current.contact?.phone?.trim()
                  ) {
                    throw new ReminderEligibilityChangedError(
                      'membership cycle is no longer reminder-eligible'
                    );
                  }

                  params[0] = current.contact.name?.trim() || 'there';
                  params[1] = current.plan?.name || 'membership';
                  params[2] = fmt.date(current.end_date);
                  params[3] = fmt.money(Number(current.fee_amount));
                  await markProviderAttempt();
                },
                accountId,
                userId: ownerUserId,
                conversationId,
                contactId: m.contact_id as string,
                templateName: template.name ?? RENEWAL_TEMPLATE_NAME,
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
                `account ${accountId} membership ${m.id}: provider accepted; local persistence needs review — ${result.warning}`
              );
            }
          } else if (result.outcome === 'ambiguous') {
            summary.ambiguous++;
            summary.failed++;
            notes.push(
              `account ${accountId} membership ${m.id}: provider outcome unknown — ${result.error}`
            );
          } else {
            if (result.cause instanceof ReminderEligibilityChangedError) {
              summary.skipped_ineligible++;
              notes.push(
                `account ${accountId} membership ${m.id}: skipped — ${result.error}`
              );
            } else {
              summary.failed++;
              notes.push(
                `account ${accountId} membership ${m.id}: pre-provider failure; safe to retry — ${result.error}`
              );
            }
          }
        } catch (err) {
          summary.failed++;
          notes.push(
            `account ${accountId} membership ${m.id}: delivery state update failed — ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }
  }

  // Services use their own schedule and claim ledger. The RPC atomically
  // claims only due rows with a current sellable rate. Only failures recorded
  // before the provider boundary reopen; sent and ambiguous rows stay deduped.
  if (summary.sent < MAX_SENDS_PER_RUN) {
    const { data: serviceCandidates, error: serviceClaimError } =
      await admin.rpc('claim_service_renewal_reminders', {
        p_limit: MAX_SENDS_PER_RUN - summary.sent,
      });
    if (serviceClaimError) {
      summary.service_failed++;
      summary.failed++;
      notes.push(
        `service reminder claim failed — ${serviceClaimError.message}`
      );
    } else {
      for (const candidate of (serviceCandidates ??
        []) as ServiceReminderCandidate[]) {
        try {
          const result = await runLegacyReminderDelivery(
            {
              async claim() {
                return {
                  memberServiceId: candidate.id,
                  endDate: candidate.end_date,
                  daysBefore: candidate.days_until_expiry,
                };
              },
              async markProviderAttempt(claim) {
                const { data, error } = await admin
                  .from('service_renewal_reminders_sent')
                  .update({
                    status: 'attempting',
                    provider_attempted_at: new Date().toISOString(),
                  })
                  .eq('member_service_id', claim.memberServiceId)
                  .eq('end_date', claim.endDate)
                  .eq('days_before', claim.daysBefore)
                  .eq('status', 'claimed')
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ?? 'service reminder claim was lost'
                  );
                }
              },
              async accept(claim, providerMessageId) {
                const { data, error } = await admin
                  .from('service_renewal_reminders_sent')
                  .update({
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    wa_message_id: providerMessageId,
                    last_error: null,
                  })
                  .eq('member_service_id', claim.memberServiceId)
                  .eq('end_date', claim.endDate)
                  .eq('days_before', claim.daysBefore)
                  .in('status', ['attempting', 'sent'])
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ??
                      'accepted service reminder was not persisted'
                  );
                }
              },
              async retainAmbiguous(claim, details) {
                const { data, error } = await admin
                  .from('service_renewal_reminders_sent')
                  .update({
                    status: details.providerMessageId ? 'sent' : 'ambiguous',
                    sent_at: details.providerMessageId
                      ? new Date().toISOString()
                      : null,
                    wa_message_id: details.providerMessageId,
                    last_error: details.error.slice(0, 1000),
                  })
                  .eq('member_service_id', claim.memberServiceId)
                  .eq('end_date', claim.endDate)
                  .eq('days_before', claim.daysBefore)
                  .eq('status', 'attempting')
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ??
                      'ambiguous service reminder was not retained'
                  );
                }
              },
              async releasePreProvider(claim, errorMessage) {
                const { data, error } = await admin
                  .from('service_renewal_reminders_sent')
                  .update({
                    status: 'failed',
                    provider_attempted_at: null,
                    last_error: errorMessage.slice(0, 1000),
                  })
                  .eq('member_service_id', claim.memberServiceId)
                  .eq('end_date', claim.endDate)
                  .eq('days_before', claim.daysBefore)
                  .eq('status', 'claimed')
                  .select('id')
                  .maybeSingle();
                if (error || !data) {
                  throw new Error(
                    error?.message ??
                      'retryable service reminder was not released'
                  );
                }
              },
            },
            async (markProviderAttempt) => {
              const [configResult, templateResult, accountResult] =
                await Promise.all([
                  admin
                    .from('whatsapp_config')
                    .select('status')
                    .eq('account_id', candidate.account_id)
                    .maybeSingle(),
                  admin
                    .from('message_templates')
                    .select('*')
                    .eq('account_id', candidate.account_id)
                    .eq('name', SERVICE_TEMPLATE_NAME)
                    .eq('language', 'en_US')
                    .maybeSingle(),
                  admin
                    .from('accounts')
                    .select(
                      'owner_user_id, default_currency, country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system'
                    )
                    .eq('id', candidate.account_id)
                    .single(),
                ]);
              const readinessError =
                configResult.error ??
                templateResult.error ??
                accountResult.error;
              if (readinessError) {
                throw new Error(
                  `service readiness query failed — ${readinessError.message}`
                );
              }
              const config = configResult.data;
              const template = templateResult.data;
              const account = accountResult.data;
              const templateReadiness = evaluateTemplateReadiness(
                template ? [template] : [],
                'service_renewal',
                'en_US'
              );
              if (!config || config.status !== 'connected') {
                throw new ReminderSetupBlockedError(
                  'setup required: connect WhatsApp'
                );
              }
              if (!templateReadiness.ready) {
                throw new ReminderSetupBlockedError(
                  `setup required: ${templateReadiness.message}`
                );
              }
              if (!account) {
                throw new ReminderSetupBlockedError(
                  'setup required: account not found'
                );
              }
              if (!candidate.phone) {
                throw new ReminderSetupBlockedError(
                  'member has no phone number'
                );
              }
              const fmt = buildFormatters(resolveAccountLocale(account));
              const conversationId = await findOrCreateConversation(
                admin,
                candidate.account_id,
                account.owner_user_id,
                candidate.contact_id
              );
              const params = [
                candidate.member_name?.trim() || 'there',
                candidate.item_name_snapshot,
                fmt.date(candidate.end_date),
                fmt.money(Number(candidate.current_renewal_price)),
              ];
              return engineSendTemplate({
                beforeSend: async () => {
                  const { data, error } = await admin
                    .from('service_renewal_queue')
                    .select(
                      'id, account_id, contact_id, status, member_name, phone, item_name_snapshot, end_date, days_until_expiry, service_enabled, service_days_before, current_renewal_price, item_is_active, option_is_active'
                    )
                    .eq('account_id', candidate.account_id)
                    .eq('id', candidate.id)
                    .maybeSingle();
                  if (error) throw error;
                  const current =
                    data as unknown as ServiceReminderCandidate | null;
                  if (
                    !current ||
                    current.id !== candidate.id ||
                    current.account_id !== candidate.account_id ||
                    current.contact_id !== candidate.contact_id ||
                    current.status !== 'active' ||
                    current.end_date !== candidate.end_date ||
                    current.days_until_expiry !== candidate.days_until_expiry ||
                    !current.service_enabled ||
                    !normalizeDaysBefore(current.service_days_before).includes(
                      candidate.days_until_expiry
                    ) ||
                    current.current_renewal_price === null ||
                    !current.item_is_active ||
                    !current.option_is_active ||
                    !current.phone?.trim()
                  ) {
                    throw new ReminderEligibilityChangedError(
                      'service is no longer reminder-eligible'
                    );
                  }

                  params[0] = current.member_name?.trim() || 'there';
                  params[1] = current.item_name_snapshot;
                  params[2] = fmt.date(current.end_date);
                  params[3] = fmt.money(Number(current.current_renewal_price));
                  await markProviderAttempt();
                },
                accountId: candidate.account_id,
                userId: account.owner_user_id,
                conversationId,
                contactId: candidate.contact_id,
                templateName: SERVICE_TEMPLATE_NAME,
                language: templateReadiness.row.language ?? 'en_US',
                params,
              });
            }
          );

          if (result.outcome === 'accepted') {
            summary.service_sent++;
            summary.sent++;
            summary.accepted++;
            if (result.warning) {
              summary.service_failed++;
              summary.failed++;
              notes.push(
                `account ${candidate.account_id} service ${candidate.id}: provider accepted; local persistence needs review — ${result.warning}`
              );
            }
          } else if (result.outcome === 'ambiguous') {
            summary.service_ambiguous++;
            summary.ambiguous++;
            summary.service_failed++;
            summary.failed++;
            notes.push(
              `account ${candidate.account_id} service ${candidate.id}: provider outcome unknown — ${result.error}`
            );
          } else if (result.outcome === 'retryable_failure') {
            const eligibilityChanged =
              result.cause instanceof ReminderEligibilityChangedError;
            const blocked = result.cause instanceof ReminderSetupBlockedError;
            if (eligibilityChanged) {
              summary.skipped_ineligible++;
            } else if (blocked) {
              summary.service_blocked++;
            } else {
              summary.service_failed++;
              summary.failed++;
            }
            notes.push(
              `account ${candidate.account_id} service ${candidate.id}: ${
                eligibilityChanged
                  ? 'skipped — '
                  : blocked
                    ? 'blocked — '
                    : 'pre-provider failure; safe to retry — '
              }${result.error}`
            );
          }
        } catch (error) {
          if (error instanceof ReminderSetupBlockedError) {
            summary.service_blocked++;
          } else {
            summary.service_failed++;
            summary.failed++;
          }
          notes.push(
            `account ${candidate.account_id} service ${candidate.id}: delivery state update failed — ${
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

interface ServiceReminderCandidate {
  id: string;
  account_id: string;
  contact_id: string;
  status?: string;
  member_name: string | null;
  phone: string | null;
  item_name_snapshot: string;
  end_date: string;
  days_until_expiry: number;
  service_enabled?: boolean;
  service_days_before?: number[] | null;
  current_renewal_price: number | null;
  item_is_active?: boolean;
  option_is_active?: boolean;
}

type Admin = ReturnType<typeof supabaseAdmin>;

/**
 * Return the contact's conversation id in this account, creating one if
 * absent. Mirrors the send route's find-or-create (and the webhook's) so
 * an auto-reminder to a member who never messaged still lands in a single
 * shared thread. Runs on the service-role client (no RLS) — every field
 * is account-scoped by construction.
 */
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
