import type {
  FinanceAdPerformance,
  FinanceExpenseTotals,
} from '@/lib/finance/overview';
import type { OwnerReport } from '@/lib/reports/types';

const ALL_STAFF = 'all';

export interface PerformanceSnapshot {
  report: OwnerReport;
  adPerformance: FinanceAdPerformance | null;
  expenseTotals: FinanceExpenseTotals | null;
}

export type ReportCache = Record<string, PerformanceSnapshot>;

export function reportCacheKey(
  accountId: string,
  timeZone: string,
  month: string,
  staffUserId: string | null
) {
  return `${accountId}:${timeZone}:${month}:${staffUserId ?? ALL_STAFF}`;
}

export function needsPerformanceSnapshot(
  cache: ReportCache,
  accountId: string,
  timeZone: string,
  month: string,
  staffUserId: string | null
) {
  return !cache[reportCacheKey(accountId, timeZone, month, staffUserId)];
}
