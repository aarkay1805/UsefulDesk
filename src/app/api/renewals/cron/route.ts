import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { resolveAccountLocale } from '@/lib/locale/config'
import { buildFormatters, hourInTz, todayInTz } from '@/lib/locale/format'
import {
  REMINDER_SEND_HOUR_LOCAL,
  RENEWAL_TEMPLATE_NAME,
  targetEndDates,
} from '@/lib/memberships/renewal-reminders'

/**
 * Auto renewal reminders — the scheduled half of the renewal wedge.
 *
 * Hit on a schedule (Vercel Cron / external pinger), once a day is
 * plenty. For every account that opted in (renewal_reminder_settings
 * .enabled), it finds memberships expiring at each configured offset
 * and sends the `gym_renewal_reminder` template — the same message the
 * manual "Remind" button sends, just without an owner having to click.
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
const MAX_SENDS_PER_RUN = 200

/** Shape of a membership row hydrated for a reminder (to-one embeds). */
interface ReminderCandidate {
  id: string
  contact_id: string
  fee_amount: number
  end_date: string
  contact: { id: string; name: string | null; phone: string | null } | null
  plan: { name: string | null; plan_type: string | null } | null
}

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  // "Today" is per-account (each gym's own time zone, migration 055) —
  // computed inside the loop. This stamp is just for the run log.
  const now = new Date()

  const summary = {
    run_at_utc: now.toISOString(),
    accounts_considered: 0,
    accounts_skipped: 0,
    accounts_before_send_hour: 0,
    sent: 0,
    failed: 0,
    skipped_already_sent: 0,
  }
  const notes: string[] = []

  // Every account that opted in. Small table (one row per account),
  // filtered to the enabled minority — cheap to scan whole.
  const { data: settingsRows, error: settingsErr } = await admin
    .from('renewal_reminder_settings')
    .select('account_id, days_before, enabled')
    .eq('enabled', true)

  if (settingsErr) {
    return NextResponse.json({ error: settingsErr.message }, { status: 500 })
  }
  if (!settingsRows || settingsRows.length === 0) {
    return NextResponse.json({ ...summary, note: 'no accounts opted in' })
  }

  for (const s of settingsRows) {
    if (summary.sent >= MAX_SENDS_PER_RUN) {
      notes.push('hit MAX_SENDS_PER_RUN — remaining accounts deferred to next run')
      break
    }

    const accountId = s.account_id as string
    summary.accounts_considered++

    // Readiness gate — mirror the manual button's useReminderReadiness:
    // WhatsApp must be connected AND the renewal template approved.
    // Under the service-role client we must scope every lookup by
    // account_id ourselves (no RLS to lean on).
    const [{ data: config }, { data: template }, { data: account }] =
      await Promise.all([
        admin
          .from('whatsapp_config')
          .select('status')
          .eq('account_id', accountId)
          .maybeSingle(),
        admin
          .from('message_templates')
          .select('language, status')
          .eq('account_id', accountId)
          .eq('name', RENEWAL_TEMPLATE_NAME)
          .eq('status', 'APPROVED')
          .maybeSingle(),
        admin
          .from('accounts')
          .select(
            'owner_user_id, default_currency, country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system',
          )
          .eq('id', accountId)
          .maybeSingle(),
      ])

    if (!config || config.status !== 'connected' || !template || !account) {
      summary.accounts_skipped++
      continue
    }

    // Everything downstream — "today", the send window, the template's
    // date and fee strings — follows THIS account's localization.
    const cfg = resolveAccountLocale(account)
    const fmt = buildFormatters(cfg)

    // Hourly job, per-zone window: skip until the account's local
    // morning. The claim ledger makes the first run at/after the send
    // hour the only one that actually messages.
    if (hourInTz(cfg.timeZone, now) < REMINDER_SEND_HOUR_LOCAL) {
      summary.accounts_before_send_hour++
      continue
    }

    const today = todayInTz(cfg.timeZone, now)
    const ownerUserId = account.owner_user_id as string
    const language = (template.language as string) ?? 'en_US'
    const targets = targetEndDates(s.days_before, today)

    for (const target of targets) {
      if (summary.sent >= MAX_SENDS_PER_RUN) break

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
          'id, contact_id, fee_amount, end_date, contact:contacts(id, name, phone), plan:membership_plans(name, plan_type)',
        )
        .eq('account_id', accountId)
        .eq('status', 'active')
        .eq('collection_mode', 'manual')
        .eq('end_date', target.endDate)

      if (mErr) {
        notes.push(`account ${accountId}: query failed — ${mErr.message}`)
        continue
      }
      // The to-one embeds come back as single objects at runtime; the
      // untyped client infers them as arrays, so cast to the real shape
      // (same approach as members-table.tsx casting to Membership[]).
      //
      // Only RECURRING plans get renewal nags (062): fixed-term plans
      // expire quietly and session packs surface via session counts.
      // Filtered in TS, not `!inner`, so legacy NULL-plan rows keep
      // their reminders (pre-062 behavior).
      const memberships = ((data ?? []) as unknown as ReminderCandidate[]).filter(
        (m) => !m.plan || m.plan.plan_type === 'recurring',
      )
      if (memberships.length === 0) continue

      for (const m of memberships) {
        if (summary.sent >= MAX_SENDS_PER_RUN) break

        const phone = m.contact?.phone?.trim()
        if (!phone) continue // no way to reach them — skip silently

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
            },
          )
          .select('id')
          .maybeSingle()

        if (claimErr) {
          notes.push(`account ${accountId}: claim failed — ${claimErr.message}`)
          continue
        }
        if (!claim) {
          // Conflict — already sent (or being sent). Not an error.
          summary.skipped_already_sent++
          continue
        }

        try {
          const conversationId = await findOrCreateConversation(
            admin,
            accountId,
            ownerUserId,
            m.contact_id as string,
          )

          // {{3}} expiry as the gym writes dates ("11 Jul 2026", not
          // raw ISO), {{4}} fee in its currency + grouping (₹1,00,000).
          const params = [
            m.contact?.name?.trim() || 'there',
            m.plan?.name || 'membership',
            fmt.date(target.endDate),
            fmt.money(m.fee_amount),
          ]

          const { whatsapp_message_id } = await engineSendTemplate({
            accountId,
            userId: ownerUserId,
            conversationId,
            contactId: m.contact_id as string,
            templateName: RENEWAL_TEMPLATE_NAME,
            language,
            params,
          })

          // Stamp the claim row with the real Meta id now the send landed.
          await admin
            .from('renewal_reminders_sent')
            .update({ wa_message_id: whatsapp_message_id })
            .eq('id', claim.id as string)

          summary.sent++
        } catch (err) {
          // Roll the claim back so a later run retries this member.
          await admin
            .from('renewal_reminders_sent')
            .delete()
            .eq('id', claim.id as string)
          summary.failed++
          notes.push(
            `account ${accountId} membership ${m.id}: send failed — ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        }
      }
    }
  }

  return NextResponse.json({ ...summary, notes })
}

type Admin = ReturnType<typeof supabaseAdmin>

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
  contactId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing) return existing.id as string

  const { data: created, error } = await admin
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('id')
    .single()

  if (error || !created) {
    throw new Error(`could not open a conversation: ${error?.message ?? 'unknown'}`)
  }
  return created.id as string
}
