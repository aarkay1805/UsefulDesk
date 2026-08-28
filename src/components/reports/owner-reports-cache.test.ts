import { describe, expect, it } from 'vitest';
import {
  PerformanceReportCache,
  reportCacheKey,
  reportCacheScope,
  type PerformanceSnapshot,
} from './owner-reports-cache';

describe('OwnerReportsView snapshot cache', () => {
  const firstSnapshot = { marker: 'first' } as unknown as PerformanceSnapshot;
  const secondSnapshot = {
    marker: 'second',
  } as unknown as PerformanceSnapshot;

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  }

  it('normalizes keys and isolates every user, branch, timezone, month, and staff input', () => {
    const allStaff = reportCacheKey(
      ' user-a ',
      ' branch-a ',
      ' Asia/Kolkata ',
      ' 2026-08 ',
      null
    );

    expect(allStaff).toBe(
      reportCacheKey('user-a', 'branch-a', 'Asia/Kolkata', '2026-08', ' ')
    );
    expect(allStaff).not.toBe(
      reportCacheKey('user-b', 'branch-a', 'Asia/Kolkata', '2026-08', null)
    );
    expect(allStaff).not.toBe(
      reportCacheKey('user-a', 'branch-b', 'Asia/Kolkata', '2026-08', null)
    );
    expect(allStaff).not.toBe(
      reportCacheKey('user-a', 'branch-a', 'UTC', '2026-08', null)
    );
    expect(allStaff).not.toBe(
      reportCacheKey('user-a', 'branch-a', 'Asia/Kolkata', '2026-07', null)
    );
    expect(allStaff).not.toBe(
      reportCacheKey('user-a', 'branch-a', 'Asia/Kolkata', '2026-08', 'staff-a')
    );
  });

  it('loads once, reuses an exact completed key, and expires it at the TTL', async () => {
    let now = 1_000;
    const cache = new PerformanceReportCache({
      ttlMs: 30_000,
      now: () => now,
    });
    const scope = reportCacheScope('user-a', 'branch-a');
    const key = reportCacheKey(
      'user-a',
      'branch-a',
      'Asia/Kolkata',
      '2026-08',
      null
    );
    let requests = 0;
    const loader = async () => {
      requests += 1;
      return firstSnapshot;
    };

    await expect(cache.load(scope, key, loader)).resolves.toBe(firstSnapshot);
    await expect(cache.load(scope, key, loader)).resolves.toBe(firstSnapshot);
    expect(requests).toBe(1);
    expect(cache.peekFresh(scope, key)).toBe(firstSnapshot);

    now += 30_000;
    expect(cache.peek(scope, key)).toBe(firstSnapshot);
    expect(cache.peekFresh(scope, key)).toBeNull();
    await expect(cache.load(scope, key, loader)).resolves.toBe(firstSnapshot);
    expect(requests).toBe(2);
  });

  it('deduplicates an in-flight exact key, including rapid A→B→A', async () => {
    const cache = new PerformanceReportCache();
    const scope = reportCacheScope('user-a', 'branch-a');
    const keyA = reportCacheKey(
      'user-a',
      'branch-a',
      'Asia/Kolkata',
      '2026-08',
      null
    );
    const keyB = reportCacheKey(
      'user-a',
      'branch-a',
      'Asia/Kolkata',
      '2026-07',
      null
    );
    const pendingA = deferred<PerformanceSnapshot>();
    const pendingB = deferred<PerformanceSnapshot>();
    let requests = 0;

    const firstA = cache.load(scope, keyA, () => {
      requests += 1;
      return pendingA.promise;
    });
    const onlyB = cache.load(scope, keyB, () => {
      requests += 1;
      return pendingB.promise;
    });
    const secondA = cache.load(scope, keyA, () => {
      requests += 1;
      return Promise.resolve(secondSnapshot);
    });

    expect(secondA).toBe(firstA);
    expect(requests).toBe(0);
    await Promise.resolve();
    expect(requests).toBe(2);

    pendingB.resolve(secondSnapshot);
    pendingA.resolve(firstSnapshot);
    await expect(Promise.all([firstA, onlyB, secondA])).resolves.toEqual([
      firstSnapshot,
      secondSnapshot,
      firstSnapshot,
    ]);
    expect(cache.peek(scope, keyA)).toBe(firstSnapshot);
    expect(cache.peek(scope, keyB)).toBe(secondSnapshot);
  });

  it('lets explicit refresh bypass cache and prevents the older response from winning', async () => {
    const cache = new PerformanceReportCache();
    const scope = reportCacheScope('user-a', 'branch-a');
    const key = reportCacheKey(
      'user-a',
      'branch-a',
      'Asia/Kolkata',
      '2026-08',
      null
    );
    const older = deferred<PerformanceSnapshot>();
    const refresh = deferred<PerformanceSnapshot>();
    const first = cache.load(scope, key, () => older.promise);
    const forced = cache.load(scope, key, () => refresh.promise, {
      force: true,
    });

    refresh.resolve(secondSnapshot);
    await expect(forced).resolves.toBe(secondSnapshot);
    expect(cache.peek(scope, key)).toBe(secondSnapshot);

    older.resolve(firstSnapshot);
    await expect(first).resolves.toBe(firstSnapshot);
    expect(cache.peek(scope, key)).toBe(secondSnapshot);
  });

  it('clears completed and pending data when the user/account scope changes', async () => {
    const cache = new PerformanceReportCache();
    const scopeA = reportCacheScope('user-a', 'branch-a');
    const scopeB = reportCacheScope('user-b', 'branch-a');
    const keyA = reportCacheKey(
      'user-a',
      'branch-a',
      'Asia/Kolkata',
      '2026-08',
      null
    );
    const keyB = reportCacheKey(
      'user-b',
      'branch-a',
      'Asia/Kolkata',
      '2026-08',
      null
    );

    await cache.load(scopeA, keyA, async () => firstSnapshot);
    expect(cache.peek(scopeA, keyA)).toBe(firstSnapshot);
    await cache.load(scopeB, keyB, async () => secondSnapshot);

    expect(cache.peek(scopeA, keyA)).toBeNull();
    expect(cache.peek(scopeB, keyB)).toBe(secondSnapshot);
    expect(cache.completedSize).toBe(1);
  });

  it('supports exact invalidation and evicts the least-recently-used completed key', async () => {
    const cache = new PerformanceReportCache({ maxEntries: 2 });
    const scope = reportCacheScope('user-a', 'branch-a');
    const key = (month: string) =>
      reportCacheKey('user-a', 'branch-a', 'Asia/Kolkata', month, null);

    await cache.load(scope, key('2026-06'), async () => firstSnapshot);
    await cache.load(scope, key('2026-07'), async () => secondSnapshot);
    await cache.load(scope, key('2026-06'), async () => secondSnapshot);
    await cache.load(scope, key('2026-08'), async () => secondSnapshot);

    expect(cache.peek(scope, key('2026-06'))).toBe(firstSnapshot);
    expect(cache.peek(scope, key('2026-07'))).toBeNull();
    expect(cache.peek(scope, key('2026-08'))).toBe(secondSnapshot);
    expect(cache.completedSize + cache.inFlightSize).toBeLessThanOrEqual(2);

    cache.invalidate(scope, key('2026-06'));
    expect(cache.peek(scope, key('2026-06'))).toBeNull();
  });

  it('bounds pending entries without letting an evicted promise repopulate the cache', async () => {
    const cache = new PerformanceReportCache({ maxEntries: 2 });
    const scope = reportCacheScope('user-a', 'branch-a');
    const key = (month: string) =>
      reportCacheKey('user-a', 'branch-a', 'Asia/Kolkata', month, null);
    const june = deferred<PerformanceSnapshot>();
    const july = deferred<PerformanceSnapshot>();
    const august = deferred<PerformanceSnapshot>();

    const juneLoad = cache.load(scope, key('2026-06'), () => june.promise);
    const julyLoad = cache.load(scope, key('2026-07'), () => july.promise);
    const augustLoad = cache.load(scope, key('2026-08'), () => august.promise);
    expect(cache.completedSize + cache.inFlightSize).toBe(2);

    june.resolve(firstSnapshot);
    july.resolve(secondSnapshot);
    august.resolve(secondSnapshot);
    await Promise.all([juneLoad, julyLoad, augustLoad]);

    expect(cache.peek(scope, key('2026-06'))).toBeNull();
    expect(cache.completedSize + cache.inFlightSize).toBeLessThanOrEqual(2);
  });
});
