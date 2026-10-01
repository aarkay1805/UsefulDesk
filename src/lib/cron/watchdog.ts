export interface WatchdogCheck {
  group: 'ops' | 'renewals';
  healthy: boolean;
  reason: 'healthy' | 'inactive' | 'missing' | 'stale' | 'failed' | 'invalid';
}

/** Evaluate only fixed aggregate facts; never carry provider bodies into output. */
export function evaluateWatchdogSnapshot(snapshot: unknown): WatchdogCheck[] {
  const row = snapshot as { checked_at?: unknown; groups?: unknown } | null;
  const now =
    typeof row?.checked_at === 'string' ? Date.parse(row.checked_at) : NaN;
  const groups = Array.isArray(row?.groups) ? row.groups : [];
  return (['ops', 'renewals'] as const).map((group) => {
    const matches = groups.filter((item) => item?.group === group);
    const item = matches[0];
    let reason: WatchdogCheck['reason'] = 'healthy';
    if (
      !Number.isFinite(now) ||
      matches.length !== 1 ||
      typeof item?.active !== 'boolean'
    ) {
      reason = 'invalid';
    } else if (!item.active) {
      reason = 'inactive';
    } else if (item.last_response_at === null) {
      reason = 'missing';
    } else {
      const at =
        typeof item.last_response_at === 'string'
          ? Date.parse(item.last_response_at)
          : NaN;
      const limit = (group === 'ops' ? 45 : 120) * 60_000;
      if (
        !Number.isFinite(at) ||
        at > now ||
        typeof item.timed_out !== 'boolean'
      ) {
        reason = 'invalid';
      } else if (now - at > limit) {
        reason = 'stale';
      } else if (
        item.status_code !== 200 ||
        item.timed_out ||
        item.failed !== 0 ||
        item.dispatched !== (group === 'ops' ? 10 : 3)
      ) {
        reason = 'failed';
      }
    }
    return { group, healthy: reason === 'healthy', reason };
  });
}
