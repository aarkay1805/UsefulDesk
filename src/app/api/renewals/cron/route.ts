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
  selectRenewalTemplate,
  targetEndDates,
} from '@/lib/memberships/renewal-reminders';
import { isRenewalChaseable } from '@/lib/memberships/pricing';
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
 * double-message. If the send then fails, the claim is deleted so a
 * later run retries.
 */

// A hard ceiling on sends per invocation — a backstop against a
// misconfigured account with a huge expiring cohort hammering Meta in
// one run. Anything above this simply waits for the next run.
const MAX_SENDS_PER_RUN = 200;
const SERVICE_TEMPLATE_NAME = TEMPLATE_CONTRACTS.service_renewal.payload.name;

/** Shape of a membership row hydrated for a reminder (to-one embeds). */
interface ReminderCandidate {
  id: string;
  contact_id: string;
  fee_amount: number;
  end_date: string;
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
    sent: 0,
    failed: 0,
    skipped_already_sent: 0,
    service_sent: 0,
    service_failed: 0,
  };
  const notes: string[] = [];

  // Every account that opted in. Small table (one row per account),
  // filtered to the enabled minority — cheap to scan whole.
  const { data: settingsRows, error: settingsErr } = await admin
    .from('renewal_reminder_settings')
    .select('account_id, days_before, enabled')
    .eq('enabled', true);

  if (settingsErr) {
    return NextResponse.json({ error: settingsErr.message }, { status: 500 });
  }
  for (const s of settingsRows ?? []) {
    if (summary.sent >= MAX_SENDS_PER_RUN) {
      notes.push(
        'hit MAX_SENDS_PER_RUN — remaining accounts deferred to next run'
      );
      break;
    }

    const accountId = s.account_id as string;
    summary.accounts_considered++;

    // Readiness gate — mirror the manual button's useReminderReadiness:
    // WhatsApp must be connected AND the renewal template approved.
    // Under the service-role client we must scope every lookup by
    // account_id ourselves (no RLS to lean on).
    const [{ data: config }, { data: templates }, { data: account }] =
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
          .in('name', [...RENEWAL_TEMPLATE_NAMES]),
        admin
          .from('accounts')
          .select(
            'owner_user_id, default_currency, country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system'
          )
          .eq('id', accountId)
          .maybeSingle(),
      ]);

    const template = selectRenewalTemplate(templates);

    if (!config || config.status !== 'connected' || !template || !account) {
      summary.accounts_skipped++;
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
          'id, contact_id, fee_amount, end_date, contact:contacts(id, name, phone), plan:membership_plans(name, plan_type)'
        )
        .eq('account_id', accountId)
        .eq('status', 'active')
        .eq('collection_mode', 'manual')
        .eq('end_date', target.endDate);

      if (mErr) {
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

        // Claim-first dedupe. Insert the log row BEFORE sending; a
        // conflict (ignoreDuplicates → empty return) means another run,
        // or an earlier offset today, already handled this exact
        // (membership, expiry, offset).
        const { data: claim, error: claimErr } = await admin
          .from('renewal_reminders_sent')
          .upsert(
            {
              account_id: accountId,
              membership_id: m.id as string,
              contact_id: m.contact_id as string,
              end_date: target.endDate,
              days_before: target.daysBefore,
            },
            {
              onConflict: 'membership_id,end_date,days_before',
              ignoreDuplicates: true,
            }
          )
          .select('id')
          .maybeSingle();

        if (claimErr) {
          notes.push(
            `account ${accountId}: claim failed — ${claimErr.message}`
          );
          continue;
        }
        if (!claim) {
          // Conflict — already sent (or being sent). Not an error.
          summary.skipped_already_sent++;
          continue;
        }

        try {
          const conversationId = await findOrCreateConversation(
            admin,
            accountId,
            ownerUserId,
            m.contact_id as string
          );

          // {{3}} expiry as the gym writes dates ("11 Jul 2026", not
          // raw ISO), {{4}} fee in its currency + grouping (₹1,00,000).
          const params = [
            m.contact?.name?.trim() || 'there',
            m.plan?.name || 'membership',
            fmt.date(target.endDate),
            fmt.money(m.fee_amount),
          ];

          const { whatsapp_message_id } = await engineSendTemplate({
            accountId,
            userId: ownerUserId,
            conversationId,
            contactId: m.contact_id as string,
            templateName: template.name ?? RENEWAL_TEMPLATE_NAME,
            language,
            params,
          });

          // Stamp the claim row with the real Meta id now the send landed.
          await admin
            .from('renewal_reminders_sent')
            .update({ wa_message_id: whatsapp_message_id })
            .eq('id', claim.id as string);

          summary.sent++;
        } catch (err) {
          // Roll the claim back so a later run retries this member.
          await admin
            .from('renewal_reminders_sent')
            .delete()
            .eq('id', claim.id as string);
          summary.failed++;
          notes.push(
            `account ${accountId} membership ${m.id}: send failed — ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }
  }

  // Services use their own schedule and claim ledger. The RPC atomically
  // claims only due rows with a current sellable rate; failed claims are
  // reopened on a later run, while sent rows are permanently deduped.
  if (summary.sent < MAX_SENDS_PER_RUN) {
    const { data: serviceCandidates, error: serviceClaimError } =
      await admin.rpc('claim_service_renewal_reminders', {
        p_limit: MAX_SENDS_PER_RUN - summary.sent,
      });
    if (serviceClaimError) {
      notes.push(
        `service reminder claim failed — ${serviceClaimError.message}`
      );
    } else {
      for (const candidate of (serviceCandidates ??
        []) as ServiceReminderCandidate[]) {
        try {
          const [{ data: config }, { data: template }, { data: account }] =
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
          const templateReadiness = evaluateTemplateReadiness(
            template ? [template] : [],
            'service_renewal',
            'en_US'
          );
          if (!config || config.status !== 'connected') {
            throw new Error('setup required: connect WhatsApp');
          }
          if (!templateReadiness.ready) {
            throw new Error(`setup required: ${templateReadiness.message}`);
          }
          if (!account) throw new Error('setup required: account not found');
          if (!candidate.phone) throw new Error('member has no phone number');
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
            fmt.money(candidate.current_renewal_price),
          ];
          const { whatsapp_message_id } = await engineSendTemplate({
            accountId: candidate.account_id,
            userId: account.owner_user_id,
            conversationId,
            contactId: candidate.contact_id,
            templateName: SERVICE_TEMPLATE_NAME,
            language: templateReadiness.row.language ?? 'en_US',
            params,
          });
          await admin.rpc('finish_service_renewal_reminder', {
            p_member_service_id: candidate.id,
            p_end_date: candidate.end_date,
            p_days_before: candidate.days_until_expiry,
            p_succeeded: true,
            p_wa_message_id: whatsapp_message_id,
            p_error: null,
          });
          summary.service_sent++;
          summary.sent++;
        } catch (error) {
          await admin.rpc('finish_service_renewal_reminder', {
            p_member_service_id: candidate.id,
            p_end_date: candidate.end_date,
            p_days_before: candidate.days_until_expiry,
            p_succeeded: false,
            p_wa_message_id: null,
            p_error: error instanceof Error ? error.message : String(error),
          });
          summary.service_failed++;
          summary.failed++;
          notes.push(
            `account ${candidate.account_id} service ${candidate.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
  }

  return NextResponse.json({ ...summary, notes });
}

interface ServiceReminderCandidate {
  id: string;
  account_id: string;
  contact_id: string;
  member_name: string | null;
  phone: string | null;
  item_name_snapshot: string;
  end_date: string;
  days_until_expiry: number;
  current_renewal_price: number;
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
