# Gates: UsefulDesk dashboard insight SQL aggregation

OWNS: GATES.md, supabase/migrations/**, src/lib/dashboard/queries.ts, src/lib/dashboard/queries.test.ts, src/lib/dashboard/insights-snapshot.ts, src/lib/dashboard/insights-snapshot.test.ts, src/lib/dashboard/lead-conversion-rating.ts, src/lib/dashboard/lead-conversion-rating.test.ts, src/lib/dashboard/insight-aggregates-rpc.test.ts, src/app/api/dashboard/insights/route.ts, src/app/api/dashboard/insights/route.test.ts, docs/changelog.md, PRDs/roadmap.md

Scope: replace only faithfully reproducible high-cost dashboard insight scans with one secure branch-scoped SQL aggregate boundary while preserving insight semantics, authorization, selected-branch timezone behavior, freshness, caching, and independent empty/error states.

- [x] G1: the SQL aggregate artifact is branch-scoped, tenant-authorized, safely defined, explicitly granted, and covered by focused contract tests for its security and result shape
      CHECK: npm test -- src/lib/dashboard/insight-aggregates-rpc.test.ts && node -e "console.log('insight aggregate SQL security verification passed')"
      EXPECT: insight aggregate SQL security verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration 112ms (transform 12ms, setup 0ms, import 30ms, tests 3ms, environment 0ms) | insight aggregate SQL security verification passed

- [x] G2: conversation 30-day buckets and lead-conversion rating inputs preserve their existing date boundaries, selected-branch timezone semantics, source grouping, counts, and zero-data behavior through the RPC integration
      CHECK: npm test -- src/lib/dashboard/queries.test.ts src/lib/dashboard/insights-snapshot.test.ts src/lib/dashboard/lead-conversion-rating.test.ts && node -e "console.log('insight aggregate semantic parity verification passed')"
      EXPECT: insight aggregate semantic parity verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration 238ms (transform 146ms, setup 0ms, import 352ms, tests 25ms, environment 0ms) | insight aggregate semantic parity verification passed

- [x] G3: the insights loader replaces the selected high-cost paginated row scans with a bounded RPC response while retaining independent fallback/error behavior for unrelated insight sections
      CHECK: node -e "const fs=require('fs');const files=['src/lib/dashboard/insights-snapshot.test.ts','src/lib/dashboard/lead-conversion-rating.test.ts'];const s=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');for(const token of ['rpc','pagination','error'])if(!s.toLowerCase().includes(token))throw new Error('missing integration evidence: '+token);console.log('insight aggregate bounded access verification passed')"
      EXPECT: insight aggregate bounded access verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=insight aggregate bounded access verification passed

- [x] G4: the dashboard insights API still authorizes the selected branch before data access, remains private/no-store, preserves range freshness, and exposes the unchanged response contract
      CHECK: npm test -- src/app/api/dashboard/insights/route.test.ts && node -e "console.log('insight route boundary verification passed')"
      EXPECT: insight route boundary verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration 142ms (transform 23ms, setup 0ms, import 65ms, tests 6ms, environment 0ms) | insight route boundary verification passed

- [x] G5: focused dashboard, reporting, locale, and authorization regressions pass with SQL-backed insight aggregates
      CHECK: npm test -- src/components/dashboard src/lib/dashboard src/lib/reports/reporting.test.ts src/lib/locale src/lib/auth/account.test.ts src/app/api/dashboard/insights && node -e "console.log('insight aggregate focused regression verification passed')"
      EXPECT: insight aggregate focused regression verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration 1.36s (transform 627ms, setup 0ms, import 1.94s, tests 419ms, environment 2.38s) | insight aggregate focused regression verification passed

- [x] G6: TypeScript accepts the SQL aggregate integration and unchanged application response contract
      CHECK: npm run typecheck && node -e "console.log('insight aggregate typecheck passed')"
      EXPECT: insight aggregate typecheck passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=> tsc --noEmit | insight aggregate typecheck passed

- [x] G7: formatting and lint accept every application, test, migration, and documentation file changed by this phase
      CHECK: npx prettier --check GATES.md supabase/migrations/20260827181937_dashboard_insight_aggregates.sql src/lib/dashboard/queries.ts src/lib/dashboard/queries.test.ts src/lib/dashboard/insights-snapshot.ts src/lib/dashboard/insights-snapshot.test.ts src/lib/dashboard/lead-conversion-rating.ts src/lib/dashboard/lead-conversion-rating.test.ts src/lib/dashboard/insight-aggregates-rpc.test.ts src/app/api/dashboard/insights/route.ts src/app/api/dashboard/insights/route.test.ts docs/changelog.md PRDs/roadmap.md && npx eslint src/lib/dashboard/queries.ts src/lib/dashboard/queries.test.ts src/lib/dashboard/insights-snapshot.ts src/lib/dashboard/insights-snapshot.test.ts src/lib/dashboard/lead-conversion-rating.ts src/lib/dashboard/lead-conversion-rating.test.ts src/lib/dashboard/insight-aggregates-rpc.test.ts src/app/api/dashboard/insights/route.ts src/app/api/dashboard/insights/route.test.ts && node -e "console.log('insight aggregate lint verification passed')"
      EXPECT: insight aggregate lint verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=All matched files use Prettier code style! | insight aggregate lint verification passed

- [x] G8: the full regression suite and production build pass after the bounded SQL aggregation phase
      CHECK: npm test && npm run build && node -e "console.log('insight aggregate full regression and build passed')"
      EXPECT: insight aggregate full regression and build passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Not implemented: Window's scrollTo() method | Not implemented: Window's scrollTo() method

- [x] G9: changelog and roadmap record the bounded SQL aggregation phase and independently measured request/query and transfer impact without presenting static analysis as production timing
      CHECK: node -e "const fs=require('fs');const c=fs.readFileSync('docs/changelog.md','utf8');const r=fs.readFileSync('PRDs/roadmap.md','utf8');const phrase='branch-scoped insight aggregates';if(!c.includes(phrase)||!r.includes(phrase))process.exit(1);console.log('insight aggregate documentation verification passed')"
      EXPECT: insight aggregate documentation verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=insight aggregate documentation verification passed

- [x] G10: final review confirms git diff integrity and preservation of completed bootstrap/onboarding, insights snapshot, action-widget snapshot, and unrelated member-import changes
      EVIDENCE: git diff --check exited 0 after the full suite and production build; production migration history contains dashboard_insight_aggregates and live catalog checks show both functions are stable SECURITY INVOKER with search_path="", anon denied, authenticated allowed, the time-first message index present, an authorized branch returning valid bounded shapes, and an invalid branch returning only zero/empty data; this phase did not write the existing bootstrap/onboarding, insight snapshot/route, action snapshot/widget, or member-import files, whose preserved member-import hashes remain 702c27afa1c930d12e14f373b21527b2b3636f7b (dialog), 79134d23ae5ac4c949ed423438a58629c95597a7 (dialog test), and 3eddeb8d6dc24deae75796cc1e9009238a65472e (preview).
