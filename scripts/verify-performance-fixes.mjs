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

  const membersPage = read('src/app/(dashboard)/members/page.tsx');
  requireText(
    membersPage,
    "import dynamic from 'next/dynamic'",
    'members page'
  );
  requireText(membersPage, 'const MemberForm = dynamic', 'members page');

  const dashboardPage = read('src/app/(dashboard)/dashboard/page.tsx');
  requireText(
    dashboardPage,
    'loadDashboardActionSnapshot',
    'dashboard server page'
  );
  requireText(dashboardPage, 'initialSnapshot=', 'dashboard server page');

  const deferredInsights = read(
    'src/components/dashboard/deferred-dashboard-insights.tsx'
  );
  requireText(deferredInsights, 'IntersectionObserver', 'deferred insights');

  const changelog = read('docs/changelog.md');
  const roadmap = read('PRDs/roadmap.md');
  requireText(changelog, 'Authenticated navigation performance', 'changelog');
  requireText(roadmap, 'Authenticated navigation performance', 'roadmap');

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
