import type { SupabaseClient } from '@supabase/supabase-js';
import { dayStartInTz, todayInTz } from '@/lib/locale/format';
import { isChargeableAmount } from './periods';
import { daysBetween, istToday, istAddDays } from './expiry';

/**
 * Owner-view gym KPIs for the dashboard. Every figure is an *action
 * list* count/total ("who to chase today"), not a vanity metric — the
 * PRD's "action lists over dashboards" principle. Membership status is
 * evaluated against the ACCOUNT's calendar day (pass `today` + timezone
 * from the account locale, migration 055) so owners anywhere see the
 * same day boundaries their members do.
 */
/** A member counts as inactive after this many days with no check-in. */
export const INACTIVE_DAYS = 10;

export interface GymStats {
  /** active memberships expiring within the next 7 days (inclusive). */
  expiring7: number;
  /** memberships with an unpaid fee (excluding cancelled). */
  feesDueCount: number;
  /** total unpaid fee amount across those memberships. */
  feesDueAmount: number;
  /** sum of paid ledger entries on the account-local current day. */
  collectedToday: number;
  /** daily average across the seven complete days before today. */
  collectionDailyAverage7d: number;
  /** active members who visited before but have now missed 10+ days. */
  missedVisitRisk: number;
  /** active members who have never checked in. */
  neverVisitedRisk: number;
}

export function summarizeAttendanceRisk(
  rows: { last_visit_at: string | null }[],
  today: string,
  timeZone: string
): Pick<GymStats, 'missedVisitRisk' | 'neverVisitedRisk'> {
  let missedVisitRisk = 0;
  let neverVisitedRisk = 0;
  for (const row of rows) {
    if (!row.last_visit_at) {
      neverVisitedRisk += 1;
      continue;
    }
    const lastVisitDay = todayInTz(timeZone, new Date(row.last_visit_at));
    if (daysBetween(lastVisitDay, today) >= INACTIVE_DAYS) {
      missedVisitRisk += 1;
    }
  }
  return { missedVisitRisk, neverVisitedRisk };
}

export function summarizeCollections(
  rows: { amount: number; paid_at: string }[],
  today: string,
  timeZone: string,
  benchmarkDays = 7
): Pick<GymStats, 'collectedToday' | 'collectionDailyAverage7d'> {
  const benchmarkStart = istAddDays(today, -benchmarkDays);
  let collectedToday = 0;
  let previousDays = 0;
  for (const row of rows) {
    const paidDay = todayInTz(timeZone, new Date(row.paid_at));
    const amount = Number(row.amount) || 0;
    if (paidDay === today) collectedToday += amount;
    else if (paidDay >= benchmarkStart && paidDay < today) {
      previousDays += amount;
    }
  }
  return {
    collectedToday,
    collectionDailyAverage7d: previousDays / benchmarkDays,
  };
}

export async function loadGymStats(
  db: SupabaseClient,
  today: string = istToday(),
  timeZone: string = 'Asia/Kolkata'
): Promise<GymStats> {
  const in7 = istAddDays(today, 7);
  const benchmarkStart = istAddDays(today, -7);
  const benchmarkStartInstant = (
    dayStartInTz(benchmarkStart, timeZone) ?? new Date()
  ).toISOString();

  const head = { count: 'exact' as const, head: true };

  const [activityRes, expiringRes, dueRes, paidRes] = await Promise.all([
    db
      .from('member_activity')
      .select('last_visit_at')
      .eq('is_trial', false)
      .eq('status', 'active')
      .gte('end_date', today),
    db
      .from('memberships')
      .select('id', head)
      .eq('is_trial', false)
      .eq('status', 'active')
      .gte('end_date', today)
      .lte('end_date', in7),
    // Ledger-derived balances for due memberships — partial payments
    // reduce the total instead of counting the full membership fee.
    db.from('membership_dues').select('balance').gt('balance', 0),
    db
      .from('payments')
      .select('amount, paid_at')
      .eq('status', 'paid')
      .gte('paid_at', benchmarkStartInstant),
  ]);

  const activityRows =
    (activityRes.data as { last_visit_at: string | null }[] | null) ?? [];
  const dueRows = ((dueRes.data as { balance: number }[] | null) ?? []).filter(
    (row) => isChargeableAmount(Number(row.balance) || 0)
  );
  const paidRows =
    (paidRes.data as { amount: number; paid_at: string }[] | null) ?? [];

  const risk = summarizeAttendanceRisk(activityRows, today, timeZone);
  const collections = summarizeCollections(paidRows, today, timeZone);

  return {
    expiring7: expiringRes.count ?? 0,
    feesDueCount: dueRows.length,
    feesDueAmount: dueRows.reduce((s, r) => s + Number(r.balance || 0), 0),
    ...collections,
    ...risk,
  };
}
