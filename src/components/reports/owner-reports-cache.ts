import type { BranchPerformanceSnapshot } from '@/lib/reports/reporting';

const ALL_STAFF = 'all';

export const PERFORMANCE_REPORT_CACHE_TTL_MS = 30_000;
export const PERFORMANCE_REPORT_CACHE_MAX_ENTRIES = 12;

export type PerformanceSnapshot = BranchPerformanceSnapshot;

interface CompletedEntry {
  snapshot: PerformanceSnapshot;
  expiresAt: number;
}

interface InFlightEntry {
  token: symbol;
  promise: Promise<PerformanceSnapshot>;
}

interface PerformanceReportCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

function normalized(value: string): string {
  return value.trim();
}

export function reportCacheScope(userId: string, accountId: string): string {
  return JSON.stringify([normalized(userId), normalized(accountId)]);
}

export function reportCacheKey(
  userId: string,
  accountId: string,
  timeZone: string,
  month: string,
  staffUserId: string | null
): string {
  const normalizedStaff = staffUserId?.trim() || ALL_STAFF;
  return JSON.stringify([
    normalized(userId),
    normalized(accountId),
    normalized(timeZone),
    normalized(month),
    normalizedStaff,
  ]);
}

/**
 * Browser-memory cache for the expensive selected-branch report snapshot.
 * A scope change drops every completed and pending entry before new work starts.
 * Promise entries intentionally survive component unmounts so Strict Mode and
 * App Router remounts can join the same request; component cleanup remains
 * responsible for ignoring a result after it stops displaying that key.
 */
export class PerformanceReportCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private activeScope: string | null = null;
  private completed = new Map<string, CompletedEntry>();
  private inFlight = new Map<string, InFlightEntry>();

  constructor({
    ttlMs = PERFORMANCE_REPORT_CACHE_TTL_MS,
    maxEntries = PERFORMANCE_REPORT_CACHE_MAX_ENTRIES,
    now = () => Date.now(),
  }: PerformanceReportCacheOptions = {}) {
    if (ttlMs < 0) throw new Error('Report cache TTL must not be negative.');
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Report cache size must be a positive integer.');
    }
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  peek(scope: string, key: string): PerformanceSnapshot | null {
    if (scope !== this.activeScope) return null;
    return this.completed.get(key)?.snapshot ?? null;
  }

  peekFresh(scope: string, key: string): PerformanceSnapshot | null {
    if (scope !== this.activeScope) return null;
    const entry = this.completed.get(key);
    return entry && entry.expiresAt > this.now() ? entry.snapshot : null;
  }

  load(
    scope: string,
    key: string,
    loader: () => Promise<PerformanceSnapshot>,
    { force = false }: { force?: boolean } = {}
  ): Promise<PerformanceSnapshot> {
    this.activate(scope);

    if (!force) {
      const completed = this.completed.get(key);
      if (completed && completed.expiresAt > this.now()) {
        // Refresh insertion order so bounded eviction is least-recently-used.
        this.completed.delete(key);
        this.completed.set(key, completed);
        return Promise.resolve(completed.snapshot);
      }
      if (completed) this.completed.delete(key);

      const pending = this.inFlight.get(key);
      if (pending) return pending.promise;
    }

    const token = Symbol(key);
    const promise = Promise.resolve()
      .then(loader)
      .then((snapshot) => {
        const pending = this.inFlight.get(key);
        if (this.activeScope === scope && pending?.token === token) {
          this.inFlight.delete(key);
          this.completed.delete(key);
          this.completed.set(key, {
            snapshot,
            expiresAt: this.now() + this.ttlMs,
          });
          this.trimToBound();
        }
        return snapshot;
      })
      .finally(() => {
        if (this.inFlight.get(key)?.token === token) {
          this.inFlight.delete(key);
        }
      });

    this.inFlight.set(key, { token, promise });
    this.trimToBound();
    return promise;
  }

  invalidate(scope: string, key?: string): void {
    if (scope !== this.activeScope) return;
    if (key) {
      this.completed.delete(key);
      this.inFlight.delete(key);
      return;
    }
    this.completed.clear();
    this.inFlight.clear();
  }

  clear(): void {
    this.activeScope = null;
    this.completed.clear();
    this.inFlight.clear();
  }

  get completedSize(): number {
    return this.completed.size;
  }

  get inFlightSize(): number {
    return this.inFlight.size;
  }

  private activate(scope: string): void {
    if (scope === this.activeScope) return;
    this.activeScope = scope;
    this.completed.clear();
    this.inFlight.clear();
  }

  private trimToBound(): void {
    while (this.completed.size + this.inFlight.size > this.maxEntries) {
      const completedKey = this.completed.keys().next().value as
        string | undefined;
      if (completedKey !== undefined) {
        this.completed.delete(completedKey);
        continue;
      }
      const pendingKey = this.inFlight.keys().next().value as
        string | undefined;
      if (pendingKey === undefined) return;
      this.inFlight.delete(pendingKey);
    }
  }
}

export const performanceReportCache = new PerformanceReportCache();
