export type DashboardTimingStage =
  | 'auth.user'
  | 'auth.bootstrap'
  | 'section.gymMetrics'
  | 'section.followUps'
  | 'section.expiringMemberships'
  | 'section.uncontactedLeads'
  | 'section.attention';

/**
 * Record fixed-label server timing without tenant ids, user ids, query text,
 * row data, or error details. The bounded shape is safe to retain in normal
 * production logs and useful when a slow aggregate hides its own bottleneck.
 */
export async function measureDashboardStage<T>(
  stage: DashboardTimingStage,
  work: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  let status: 'ok' | 'error' = 'ok';
  try {
    return await work();
  } catch (error) {
    status = 'error';
    throw error;
  } finally {
    console.info('[dashboard timing]', {
      stage,
      status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}
