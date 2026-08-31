import { pathToFileURL } from 'node:url';

export const DEFAULT_WORKFLOWS = Object.freeze([
  Object.freeze({
    file: 'ops-crons.yml',
    name: 'ops-crons',
    maxAgeMinutes: 75,
    failureOnStale: false,
  }),
  Object.freeze({
    file: 'renewals-cron.yml',
    name: 'renewals-cron',
    maxAgeMinutes: 120,
    failureOnStale: false,
  }),
  Object.freeze({
    file: 'production-backup.yml',
    name: 'Production backup',
    maxAgeMinutes: 1_800,
  }),
]);

function successfulScheduledRun(run) {
  return (
    run?.event === 'schedule' &&
    run?.status === 'completed' &&
    run?.conclusion === 'success' &&
    typeof run?.created_at === 'string' &&
    Number.isFinite(Date.parse(run.created_at))
  );
}

export function evaluateWorkflowFreshness({ now, workflows, runsByWorkflow }) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('now must be a valid Date');
  }

  return workflows.map((workflow) => {
    const blocksHealth = workflow.failureOnStale !== false;
    const annotationLevel = blocksHealth ? 'error' : 'warning';
    const latestSuccess = (runsByWorkflow[workflow.file] ?? [])
      .filter(successfulScheduledRun)
      .sort(
        (left, right) =>
          Date.parse(right.created_at) - Date.parse(left.created_at)
      )[0];

    if (!latestSuccess) {
      return {
        name: workflow.name,
        file: workflow.file,
        maxAgeMinutes: workflow.maxAgeMinutes,
        ageMinutes: null,
        latestSuccessAt: null,
        latestSuccessUrl: null,
        stale: true,
        annotationLevel,
        blocksHealth,
        reason: 'no successful scheduled run found',
      };
    }

    const ageMs = Math.max(0, nowMs - Date.parse(latestSuccess.created_at));
    const ageMinutes = Math.ceil(ageMs / 60_000);
    const stale = ageMs > workflow.maxAgeMinutes * 60_000;

    return {
      name: workflow.name,
      file: workflow.file,
      maxAgeMinutes: workflow.maxAgeMinutes,
      ageMinutes,
      latestSuccessAt: latestSuccess.created_at,
      latestSuccessUrl: latestSuccess.html_url ?? null,
      stale,
      ...(stale ? { annotationLevel, blocksHealth } : {}),
      reason: stale
        ? `latest successful scheduled run is ${ageMinutes} minutes old (limit: ${workflow.maxAgeMinutes})`
        : null,
    };
  });
}

async function fetchWorkflowRuns({ repository, token, workflowFile }) {
  const endpoint = new URL(
    `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflowFile)}/runs`
  );
  endpoint.searchParams.set('per_page', '20');

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'usefuldesk-schedule-health',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub Actions API returned HTTP ${response.status} for ${workflowFile}`
    );
  }

  const payload = await response.json();
  if (!Array.isArray(payload.workflow_runs)) {
    throw new Error(
      `GitHub Actions API returned an invalid run list for ${workflowFile}`
    );
  }
  return payload.workflow_runs;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const token = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim();
  if (!repository || !token) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  }

  const entries = await Promise.all(
    DEFAULT_WORKFLOWS.map(async (workflow) => [
      workflow.file,
      await fetchWorkflowRuns({
        repository,
        token,
        workflowFile: workflow.file,
      }),
    ])
  );
  const statuses = evaluateWorkflowFreshness({
    now: new Date(),
    workflows: DEFAULT_WORKFLOWS,
    runsByWorkflow: Object.fromEntries(entries),
  });

  for (const status of statuses) {
    if (status.stale) {
      const runLink = status.latestSuccessUrl
        ? ` Last success: ${status.latestSuccessUrl}`
        : '';
      const annotation = `::${status.annotationLevel} title=Stale GitHub schedule::${status.name}: ${status.reason}.${runLink}`;
      console[status.blocksHealth ? 'error' : 'warn'](annotation);
    } else {
      console.log(
        `${status.name}: healthy (${status.ageMinutes} minutes since the latest scheduled success)`
      );
    }
  }

  if (statuses.some((status) => status.blocksHealth)) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(
      `::error title=GitHub schedule health check failed::${error.message}`
    );
    process.exitCode = 1;
  });
}
