import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const root = process.cwd();
const mode = process.argv[2];

function fail(message) {
  throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
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

function requireOccurrenceCount(source, token, expected, label) {
  const measured = source.split(token).length - 1;
  if (measured !== expected) {
    fail(
      `${label} contains ${measured} occurrences of ${JSON.stringify(token)}; expected ${expected}`
    );
  }
}

function requireOrder(source, first, second, label) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    fail(
      `${label} does not place ${JSON.stringify(first)} before ${JSON.stringify(second)}`
    );
  }
}

function assertNoStarSelect(source, label) {
  if (/\.select\(\s*['"]\*['"]\s*\)/.test(source)) {
    fail(`${label} still contains an unbounded select('*')`);
  }
}

function verifyNegativeControl() {
  let rejected = false;
  try {
    assertNoStarSelect("db.from('rows').select('*')", 'positive control');
  } catch {
    rejected = true;
  }
  if (!rejected) fail("select('*') negative control did not fail");
}

function verifySource() {
  verifyNegativeControl();

  const loadingPath = 'src/app/(dashboard)/loading.tsx';
  if (!fs.existsSync(path.join(root, loadingPath))) {
    fail('authenticated route loading boundary is missing');
  }

  const sidebar = read('src/components/layout/sidebar.tsx');
  requireText(sidebar, 'useLinkStatus', 'sidebar');
  requireText(sidebar, 'data-pending', 'sidebar');

  const renewalQueue = read('src/lib/memberships/renewal-queue.ts');
  assertNoStarSelect(renewalQueue, 'renewal queue');
  requireText(
    renewalQueue,
    ".eq('account_id', request.accountId)",
    'renewal queue'
  );
  requireText(renewalQueue, '.range(', 'renewal queue');
  requireText(renewalQueue, 'RENEWAL_PAGE_SIZE', 'renewal queue');

  const renewalLists = read('src/components/members/renewal-action-lists.tsx');
  forbidText(
    renewalLists,
    'const [page, otherCount] = await Promise.all',
    'renewal action lists'
  );
  requireOrder(
    renewalLists,
    'const page = await loadRenewalQueuePage',
    'const otherCount = await loadRenewalQueueCount',
    'renewal action lists'
  );
  requireText(
    renewalLists,
    'if (otherDays === null) return',
    'renewal action lists'
  );

  const membersPage = read('src/app/(dashboard)/members/page.tsx');
  requireText(
    membersPage,
    "import dynamic from 'next/dynamic'",
    'members page'
  );
  requireText(membersPage, 'const MemberForm = dynamic', 'members page');

  const dashboardPage = read('src/app/(dashboard)/dashboard/page.tsx');
  forbidText(dashboardPage, 'getCurrentAccount', 'dashboard server page');
  forbidText(
    dashboardPage,
    'loadDashboardActionDateContext',
    'dashboard server page'
  );
  requireText(
    dashboardPage,
    'DashboardActionSectionStream',
    'dashboard server page'
  );
  for (const section of [
    'gymMetrics',
    'followUps',
    'expiringMemberships',
    'uncontactedLeads',
    'attention',
  ]) {
    requireText(dashboardPage, `section="${section}"`, 'dashboard server page');
  }

  const dashboardLayout = read('src/app/(dashboard)/layout.tsx');
  requireText(
    dashboardLayout,
    'getDashboardRequestContext',
    'dashboard layout'
  );

  const requestContext = read('src/lib/auth/dashboard-request-context.ts');
  requireText(
    requestContext,
    'cache(loadDashboardRequestContext)',
    'request context'
  );
  requireText(requestContext, 'loadDashboardAuthBootstrap', 'request context');
  requireText(requestContext, 'createClient(accountRow.id)', 'request context');
  requireText(requestContext, 'todayInTz(locale.timeZone)', 'request context');

  const dashboardStreaming = read(
    'src/components/dashboard/dashboard-streaming.tsx'
  );
  requireText(dashboardStreaming, '<Suspense', 'dashboard streaming');
  requireText(
    dashboardStreaming,
    'loadDashboardActionSnapshotForRequest',
    'dashboard streaming'
  );
  requireText(
    dashboardStreaming,
    'selectDashboardActionSection',
    'dashboard streaming'
  );
  requireText(dashboardStreaming, 'autoLoad={false}', 'dashboard streaming');

  const dashboardSnapshot = read('src/lib/dashboard/action-snapshot.ts');
  requireText(
    dashboardSnapshot,
    'measureDashboardStage',
    'dashboard action snapshot'
  );
  requireText(
    dashboardSnapshot,
    "db.rpc('dashboard_action_snapshot'",
    'dashboard action snapshot'
  );
  forbidText(
    dashboardSnapshot,
    'loadOwnerAttention',
    'dashboard action snapshot'
  );
  forbidText(
    dashboardSnapshot,
    'loadDashboardActionSection',
    'dashboard action snapshot'
  );

  const actionAttention = read('src/lib/dashboard/action-attention.ts');
  requireText(
    actionAttention,
    "db.rpc('dashboard_action_attention'",
    'dashboard attention loader'
  );
  forbidText(
    actionAttention,
    'selected_branch_owner_report',
    'dashboard attention loader'
  );

  const dashboardActions = read(
    'src/components/dashboard/dashboard-actions.tsx'
  );
  requireOccurrenceCount(
    dashboardActions,
    'fetch(',
    1,
    'dashboard action browser boundary'
  );
  requireText(
    dashboardActions,
    "fetch('/api/dashboard/actions', { cache: 'no-store' })",
    'dashboard action browser boundary'
  );
  for (const widget of [
    'gym-metrics.tsx',
    'follow-up-queue.tsx',
    'expiring-memberships.tsx',
    'uncontacted-leads.tsx',
    'needs-attention-card.tsx',
  ]) {
    const source = read(`src/components/dashboard/${widget}`);
    forbidText(source, 'fetch(', `dashboard widget ${widget}`);
    forbidText(source, 'createClient(', `dashboard widget ${widget}`);
  }

  const deferredInsights = read(
    'src/components/dashboard/deferred-dashboard-insights.tsx'
  );
  requireText(deferredInsights, 'IntersectionObserver', 'deferred insights');

  const changelog = read('docs/changelog.md');
  const roadmap = read('PRDs/roadmap.md');
  requireText(changelog, 'Authenticated navigation performance', 'changelog');
  requireText(changelog, 'request-scoped dashboard context', 'changelog');
  requireText(roadmap, 'Authenticated navigation performance', 'roadmap');
  requireText(roadmap, 'request-scoped dashboard context', 'roadmap');

  console.log('performance source verification passed');
}

function routeOnlyGzipKiB(route) {
  const manifestPath = path.join(
    root,
    `.next/server/app/(dashboard)/${route}/page_client-reference-manifest.js`
  );
  if (!fs.existsSync(manifestPath)) {
    fail(`missing production manifest for ${route}; run npm run build first`);
  }

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(manifestPath, 'utf8'), context);
  const manifest =
    context.globalThis.__RSC_MANIFEST[`/(dashboard)/${route}/page`];
  const pageKey = `[project]/src/app/(dashboard)/${route}/page`;
  const layoutKey = '[project]/src/app/(dashboard)/layout';
  const pageFiles = manifest.entryJSFiles[pageKey] ?? [];
  const layoutFiles = new Set(manifest.entryJSFiles[layoutKey] ?? []);
  const routeFiles = pageFiles.filter((file) => !layoutFiles.has(file));

  const gzipBytes = routeFiles.reduce((total, file) => {
    const contents = fs.readFileSync(path.join(root, '.next', file));
    return total + zlib.gzipSync(contents).length;
  }, 0);
  return gzipBytes / 1024;
}

function verifyBundles() {
  const budgets = {
    dashboard: 175,
    members: 205,
  };
  for (const [route, budget] of Object.entries(budgets)) {
    const measured = routeOnlyGzipKiB(route);
    console.log(
      `${route} route-only JavaScript: ${measured.toFixed(1)} KiB gzip (budget ${budget} KiB)`
    );
    if (measured >= budget) {
      fail(`${route} route-only JavaScript exceeds its ${budget} KiB budget`);
    }
  }
  console.log('bundle performance verification passed');
}

if (mode === 'source') verifySource();
else if (mode === 'bundles') verifyBundles();
else fail('usage: node scripts/verify-performance-fixes.mjs <source|bundles>');
