import { NextResponse, type NextRequest } from 'next/server';

import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { dayStartInTz } from '@/lib/locale/format';
import { REMINDER_RULES } from '@/lib/reminders/rules';
import {
  ACTIVITY_PAGE_SIZE,
  isIsoDate,
  parseActivityCursor,
  parseActivityOutcome,
  serializeActivityCursor,
  type AutomatedMessageActivityRow,
} from '@/lib/reminders/activity';

export const runtime = 'nodejs';

/** Read-only activity across durable lifecycle jobs and the three older ledgers.
 * The SQL view applies each requested filter before its keyset page. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireSettingsAccess();
    const params = request.nextUrl.searchParams;
    const ruleId = params.get('rule');
    const outcome = parseActivityOutcome(params.get('outcome'));
    const from = params.get('from');
    const to = params.get('to');
    const rawCursor = params.get('cursor');
    const cursor = parseActivityCursor(rawCursor);

    if (
      (params.has('outcome') && !outcome) ||
      (ruleId && !REMINDER_RULES.some((rule) => rule.id === ruleId)) ||
      (params.has('from') && !isIsoDate(from)) ||
      (params.has('to') && !isIsoDate(to)) ||
      (rawCursor && !cursor)
    ) {
      return NextResponse.json(
        { error: 'Invalid activity filter.' },
        { status: 400 }
      );
    }
    const { data: account, error: accountError } = await ctx.supabase
      .from('accounts')
      .select('timezone')
      .eq('id', ctx.accountId)
      .maybeSingle();
    if (accountError || !account?.timezone)
      throw accountError ?? new Error('Account timezone unavailable.');
    const timezone = account.timezone;
    const fromStart = from ? dayStartInTz(from, timezone) : null;
    const toDate = to ? new Date(`${to}T12:00:00Z`) : null;
    const nextTo = toDate
      ? new Date(toDate.getTime() + 86_400_000).toISOString().slice(0, 10)
      : null;
    const toStart = nextTo ? dayStartInTz(nextTo, timezone) : null;
    if ((from && !fromStart) || (to && !toStart) || (from && to && from > to)) {
      return NextResponse.json(
        { error: 'Invalid activity date range.' },
        { status: 400 }
      );
    }

    let query = ctx.supabase
      .from('automated_message_activity')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('occurred_at', { ascending: false })
      .order('activity_id', { ascending: false })
      .limit(ACTIVITY_PAGE_SIZE + 1);

    if (ruleId) query = query.eq('rule_id', ruleId);
    if (outcome) query = query.eq('outcome', outcome);
    if (fromStart) query = query.gte('occurred_at', fromStart.toISOString());
    if (toStart) query = query.lt('occurred_at', toStart.toISOString());
    if (cursor) {
      query = query.or(
        `occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},activity_id.lt.${cursor.activityId})`
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as AutomatedMessageActivityRow[];
    const hasMore = rows.length > ACTIVITY_PAGE_SIZE;
    const items = hasMore ? rows.slice(0, ACTIVITY_PAGE_SIZE) : rows;
    return NextResponse.json({
      items,
      nextCursor:
        hasMore && items.length ? serializeActivityCursor(items.at(-1)!) : null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
