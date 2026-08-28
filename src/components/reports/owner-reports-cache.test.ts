import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  needsPerformanceSnapshot,
  reportCacheKey,
  type PerformanceSnapshot,
  type ReportCache,
} from './owner-reports-cache';

describe('OwnerReportsView snapshot cache', () => {
  it('keys snapshots by branch, timezone, month, and staff scope', () => {
    const allStaff = reportCacheKey(
      'branch-a',
      'Asia/Kolkata',
      '2026-08',
      null
    );

    expect(allStaff).not.toBe(
      reportCacheKey('branch-b', 'Asia/Kolkata', '2026-08', null)
    );
    expect(allStaff).not.toBe(
      reportCacheKey('branch-a', 'UTC', '2026-08', null)
    );
    expect(allStaff).not.toBe(
      reportCacheKey('branch-a', 'Asia/Kolkata', '2026-07', null)
    );
    expect(allStaff).not.toBe(
      reportCacheKey('branch-a', 'Asia/Kolkata', '2026-08', 'staff-a')
    );
  });

  it('suppresses a revisit fetch only for an exact cached key', () => {
    const snapshot = {} as PerformanceSnapshot;
    const cache: ReportCache = {
      [reportCacheKey('branch-a', 'Asia/Kolkata', '2026-08', null)]: snapshot,
    };

    expect(
      needsPerformanceSnapshot(
        cache,
        'branch-a',
        'Asia/Kolkata',
        '2026-08',
        null
      )
    ).toBe(false);
    expect(
      needsPerformanceSnapshot(
        cache,
        'branch-a',
        'Asia/Kolkata',
        '2026-08',
        'staff-a'
      )
    ).toBe(true);
  });

  it('guards the effect cache path while keeping Retry as an explicit fetch', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/reports/owner-reports-view.tsx'),
      'utf8'
    );
    const effectStart = source.indexOf('useEffect(() => {');
    const effectEnd = source.indexOf('const snapshot =', effectStart);
    const effect = source.slice(effectStart, effectEnd);
    const retryStart = source.indexOf('function retry()');
    const retryEnd = source.indexOf('function exportReport()', retryStart);
    const retry = source.slice(retryStart, retryEnd);

    expect(effect).toContain('!needsPerformanceSnapshot(');
    expect(effect.indexOf('!needsPerformanceSnapshot(')).toBeLessThan(
      effect.indexOf('fetchReport(month, staffUserId)')
    );
    expect(retry).toContain('setLoading(true)');
    expect(retry).toContain('fetchReport(month, staffUserId)');
    expect(source).toContain('loadBranchPerformanceSnapshot(');
    expect(source).not.toContain('loadOwnerReport(');
    expect(source).not.toContain('loadFinanceAdPerformance(');
    expect(source).not.toContain('loadFinanceExpenseTotals(');
  });
});
