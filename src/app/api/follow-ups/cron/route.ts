import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth'

/**
 * Follow-up reminder delivery — makes `follow_ups.remind_at` real.
 *
 * Migration 044 recorded the reminder slot ("this records intent; the
 * delivery runner is future work") — this is that runner. Hit on a
 * schedule (every 15–30 min is plenty; slots are hourly), it finds
 * open tasks whose remind_at has arrived and drops an in-app
 * notification on the task's owner (falling back to the task creator
 * when unassigned).
 *
 * Guarded by the shared AUTOMATION_CRON_SECRET, same as the renewals
 * cron. Dedupe is claim-first against `reminder_sent_at` (047): the
 * UPDATE ... WHERE reminder_sent_at IS NULL claims the row atomically,
 * so overlapping runs can't double-notify. A failed notification
 * insert rolls the claim back for retry on the next run.
 */

// Backstop against a pathological backlog hammering one run.
const MAX_NOTIFICATIONS_PER_RUN = 500

interface DueReminder {
  id: string
  account_id: string
  contact_id: string
  assigned_to: string | null
  created_by: string
  task_type: string
  due_date: string
  note: string | null
  contact: { name: string | null; phone: string | null } | null
}

const TASK_LABEL: Record<string, string> = {
  call: 'Call',
  email: 'Email',
  todo: 'To-do',
}

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const nowIso = new Date().toISOString()

  const summary = { due: 0, notified: 0, skipped_claimed: 0, failed: 0 }
  const notes: string[] = []

  // Open tasks whose reminder slot has arrived and is unclaimed. The
  // partial index from 047 makes this scan cheap regardless of table
  // size. Oldest first so a backlog drains in order.
  const { data, error } = await admin
    .from('follow_ups')
    .select(
      'id, account_id, contact_id, assigned_to, created_by, task_type, due_date, note, contact:contacts(name, phone)',
    )
    .eq('status', 'open')
    .not('remind_at', 'is', null)
    .is('reminder_sent_at', null)
    .lte('remind_at', nowIso)
    .order('remind_at', { ascending: true })
    .limit(MAX_NOTIFICATIONS_PER_RUN)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // To-one embeds come back as single objects at runtime; the untyped
  // client infers arrays, so cast (same approach as the renewals cron).
  const reminders = (data ?? []) as unknown as DueReminder[]
  summary.due = reminders.length

  for (const r of reminders) {
    // Claim first — only one run gets to flip reminder_sent_at from
    // NULL. Losing the race (0 rows) means another run owns this row.
    const { data: claimed } = await admin
      .from('follow_ups')
      .update({ reminder_sent_at: nowIso })
      .eq('id', r.id)
      .is('reminder_sent_at', null)
      .select('id')

    if (!claimed || claimed.length === 0) {
      summary.skipped_claimed++
      continue
    }

    const recipient = r.assigned_to ?? r.created_by
    const who = r.contact?.name?.trim() || r.contact?.phone || 'a lead'
    const label = TASK_LABEL[r.task_type] ?? 'Follow-up'

    const { error: notifErr } = await admin.from('notifications').insert({
      account_id: r.account_id,
      user_id: recipient,
      type: 'follow_up_reminder',
      contact_id: r.contact_id,
      // System-triggered — no actor.
      title: `${label} due: ${who}`,
      body: r.note?.trim() || `Follow-up due ${r.due_date}`,
    })

    if (notifErr) {
      // Roll the claim back so the next run retries.
      await admin
        .from('follow_ups')
        .update({ reminder_sent_at: null })
        .eq('id', r.id)
      summary.failed++
      notes.push(`follow_up ${r.id}: notify failed — ${notifErr.message}`)
      continue
    }

    summary.notified++
  }

  return NextResponse.json({ ...summary, notes })
}
