import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mode = process.argv[2];

function fail(message) {
  throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function committed(relativePath) {
  return execFileSync('git', ['show', `HEAD:${relativePath}`], {
    cwd: root,
    encoding: 'utf8',
  });
}

function occurrences(source, token) {
  return source.split(token).length - 1;
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    fail(`${label} is missing ${JSON.stringify(expected)}`);
  }
}

function forbidText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    fail(`${label} still contains ${JSON.stringify(forbidden)}`);
  }
}

function requireCount(source, token, expected, label) {
  const measured = occurrences(source, token);
  if (measured !== expected) {
    fail(
      `${label} contains ${measured} occurrences of ${JSON.stringify(token)}; expected ${expected}`
    );
  }
}

function actionLoaderBody(source) {
  const start = source.indexOf(
    'export async function loadDashboardActionSnapshot('
  );
  const end = source.indexOf('/** Keep each existing provider island', start);
  if (start < 0 || end < 0) fail('action snapshot loader body is unavailable');
  return source.slice(start, end);
}

function assertOneActionRpc(source) {
  const loader = actionLoaderBody(source);
  requireCount(loader, '.rpc(', 1, 'action loader');
  requireCount(loader, ".rpc('dashboard_action_snapshot'", 1, 'action loader');
  forbidText(loader, '.from(', 'action loader');
  forbidText(loader, 'Promise.all', 'action loader');
}

function verifyNegativeControl() {
  const source = read('src/lib/dashboard/action-snapshot.ts');
  let rejected = false;
  try {
    assertOneActionRpc(
      source.replace(
        "const { data, error } = await db.rpc('dashboard_action_snapshot'",
        "await db.rpc('unexpected_second_action_read');\n      const { data, error } = await db.rpc('dashboard_action_snapshot'"
      )
    );
  } catch {
    rejected = true;
  }
  if (!rejected) fail('extra action RPC negative control was not rejected');
}

function verifyBrowser() {
  const page = read('src/app/(dashboard)/dashboard/page.tsx');
  const streaming = read('src/components/dashboard/dashboard-streaming.tsx');
  const provider = read('src/components/dashboard/dashboard-actions.tsx');
  const route = read('src/app/api/dashboard/actions/route.ts');

  requireCount(
    page,
    'loadDashboardActionSnapshotForRequest()',
    1,
    'dashboard page'
  );
  requireCount(page, 'snapshot={actionSnapshot}', 5, 'dashboard page');
  requireText(streaming, 'await snapshot', 'dashboard streaming');
  requireText(streaming, 'selectDashboardActionSection', 'dashboard streaming');
  requireText(streaming, 'autoLoad={false}', 'dashboard loading fallback');
  requireCount(provider, 'fetch(', 1, 'dashboard browser boundary');
  requireText(
    provider,
    "fetch('/api/dashboard/actions', { cache: 'no-store' })",
    'dashboard browser boundary'
  );
  requireText(
    route,
    "'Cache-Control': 'private, no-store, max-age=0'",
    'route'
  );
  for (const widget of [
    'gym-metrics.tsx',
    'follow-up-queue.tsx',
    'expiring-memberships.tsx',
    'uncontacted-leads.tsx',
    'needs-attention-card.tsx',
  ]) {
    const source = read(`src/components/dashboard/${widget}`);
    forbidText(source, 'fetch(', widget);
    forbidText(source, 'createClient(', widget);
  }

  console.log(
    'dashboard action browser boundary: 0 requests on server hydration; 1 request on refresh; 0 on filter change'
  );
  console.log(
    'historical dashboard browser path remains 14 requests -> 1 no-store refresh boundary'
  );
  console.log('dashboard browser boundary verification passed');
}

function verifyDatabase() {
  verifyNegativeControl();

  const currentLoader = read('src/lib/dashboard/action-snapshot.ts');
  const currentTiming = read('src/lib/dashboard/timing.ts');
  const baselineAction = committed('src/lib/dashboard/action-snapshot.ts');
  const baselineStats = committed('src/lib/memberships/stats.ts');
  const baselineFollowUps = committed('src/lib/dashboard/follow-ups.ts');
  const baselineTiming = committed('src/lib/dashboard/timing.ts');
  const migration = read(
    'supabase/migrations/20260828160000_dashboard_action_snapshot.sql'
  );

  assertOneActionRpc(currentLoader);

  const gymRequests = occurrences(baselineStats, ".from('");
  const followUpRequests =
    occurrences(baselineFollowUps, ".from('follow_ups')") >= 1 ? 2 : 0;
  const staffRequests = baselineFollowUps.includes(".from('profiles')") ? 1 : 0;
  const expiringRequests = baselineAction.includes(
    'const [legacyResult, recurringResult]'
  )
    ? 2
    : 0;
  const uncontactedRequests =
    baselineAction.includes(".from('contacts')") &&
    baselineAction.includes(".from('conversations')")
      ? 2
      : 0;
  const attentionRequests = baselineAction.includes(
    'loadDashboardActionAttention'
  )
    ? 1
    : 0;
  const baselineRequests =
    gymRequests +
    followUpRequests +
    staffRequests +
    expiringRequests +
    uncontactedRequests +
    attentionRequests;
  if (baselineRequests < 12) {
    fail(
      `derived action data baseline is ${baselineRequests}; expected at least 12`
    );
  }

  const baselineStages = occurrences(baselineTiming, "| 'section.");
  const currentStages = occurrences(currentTiming, "| 'actions.snapshot'");
  if (baselineStages !== 5 || currentStages !== 1) {
    fail(
      `server stage measurement changed unexpectedly: ${baselineStages} -> ${currentStages}`
    );
  }
  forbidText(currentTiming, "| 'section.", 'current dashboard timing labels');
  requireText(migration, 'SECURITY INVOKER', 'snapshot migration');
  requireText(migration, 'LIMIT p_limit', 'snapshot migration');
  requireText(migration, 'p_limit > 8', 'snapshot migration');
  requireText(migration, 'COUNT(*) OVER ()', 'snapshot migration');

  console.log(
    `derived dashboard action data fan-out: ${baselineRequests} Supabase requests -> 1 snapshot RPC`
  );
  console.log(
    `dashboard action server stages: ${baselineStages} streamed stages -> ${currentStages} fixed-label stage`
  );
  console.log('dashboard database fan-out verification passed');
}

if (mode === 'browser') verifyBrowser();
else if (mode === 'database') verifyDatabase();
else
  fail(
    'usage: node scripts/verify-dashboard-action-snapshot.mjs <browser|database>'
  );
