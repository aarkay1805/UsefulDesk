# Gates: UsefulDesk dashboard insights request consolidation

OWNS: GATES.md, src/app/api/dashboard/insights/**, src/components/dashboard/dashboard-insights.tsx, src/components/dashboard/dashboard-insights.test.tsx, src/lib/dashboard/insights-snapshot.ts, src/lib/dashboard/insights-snapshot.test.ts, src/lib/dashboard/queries.ts, src/lib/dashboard/queries.test.ts, src/lib/dashboard/types.ts, docs/changelog.md, PRDs/roadmap.md

Scope: replace the dashboard insights post-boot Supabase fan-out with one branch-authorized, no-store API snapshot that returns bounded aggregates and previews while preserving independent section failures and fresh range changes.

- [x] G1: the server snapshot authorizes the selected branch before reads, resolves the branch locale authoritatively, returns bounded initial aggregates/previews, and preserves independent section failures
      CHECK: npm test -- src/app/api/dashboard/insights/route.test.ts src/lib/dashboard/insights-snapshot.test.ts src/lib/dashboard/queries.test.ts && node -e "console.log('dashboard insights server snapshot verification passed')"
      EXPECT: dashboard insights server snapshot verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  172ms (transform 100ms, setup 0ms, import 227ms, tests 20ms, environment 0ms) | dashboard insights server snapshot verification passed

- [x] G2: initial dashboard insights hydration performs one no-store browser fetch instead of direct Supabase reads, and 7/30/90 range changes use the same fresh server boundary
      CHECK: npm test -- src/components/dashboard/dashboard-insights.test.tsx && node -e "console.log('dashboard insights browser request verification passed')"
      EXPECT: dashboard insights browser request verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  871ms (transform 32ms, setup 0ms, import 136ms, tests 70ms, environment 585ms) | dashboard insights browser request verification passed

- [x] G3: existing dashboard aggregation, rating, locale, and auth-boundary behavior remains regression-safe with the consolidated request path
      CHECK: npm test -- src/lib/dashboard src/lib/memberships/stats.test.ts src/lib/auth/account.test.ts src/app/api/onboarding/status/route.test.ts 'src/app/(dashboard)/dashboard-shell.test.tsx' 'src/app/(dashboard)/layout.test.tsx' && node -e "console.log('dashboard insights integration verification passed')"
      EXPECT: dashboard insights integration verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  365ms (transform 602ms, setup 0ms, import 1.45s, tests 88ms, environment 1ms) | dashboard insights integration verification passed

- [x] G4: TypeScript accepts the server/client snapshot contract and route boundary
      CHECK: npm run typecheck && node -e "console.log('dashboard insights typecheck passed')"
      EXPECT: dashboard insights typecheck passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=> tsc --noEmit | dashboard insights typecheck passed

- [x] G5: formatting and lint accept every file owned by this phase
      CHECK: npx prettier --check GATES.md src/app/api/dashboard/insights/route.ts src/app/api/dashboard/insights/route.test.ts src/components/dashboard/dashboard-insights.tsx src/components/dashboard/dashboard-insights.test.tsx src/lib/dashboard/insights-snapshot.ts src/lib/dashboard/insights-snapshot.test.ts src/lib/dashboard/queries.ts src/lib/dashboard/queries.test.ts src/lib/dashboard/types.ts docs/changelog.md PRDs/roadmap.md && npx eslint src/app/api/dashboard/insights/route.ts src/app/api/dashboard/insights/route.test.ts src/components/dashboard/dashboard-insights.tsx src/components/dashboard/dashboard-insights.test.tsx src/lib/dashboard/insights-snapshot.ts src/lib/dashboard/insights-snapshot.test.ts src/lib/dashboard/queries.ts src/lib/dashboard/queries.test.ts src/lib/dashboard/types.ts && node -e "console.log('dashboard insights lint verification passed')"
      EXPECT: dashboard insights lint verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=All matched files use Prettier code style! | dashboard insights lint verification passed

- [x] G6: the full regression suite passes after dashboard insights consolidation
      CHECK: npm test && node -e "console.log('dashboard insights full regression verification passed')"
      EXPECT: dashboard insights full regression verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Not implemented: Window's scrollTo() method | Not implemented: Window's scrollTo() method

- [x] G7: the Next.js production build accepts the new route and client boundary
      CHECK: npm run build && node -e "console.log('dashboard insights production build passed')"
      EXPECT: dashboard insights production build passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=ƒ  (Dynamic)  server-rendered on demand | dashboard insights production build passed

- [x] G8: changelog and roadmap both record the bounded dashboard insights snapshot and measurable browser request reduction
      CHECK: node -e "const fs=require('fs');const c=fs.readFileSync('docs/changelog.md','utf8');const r=fs.readFileSync('PRDs/roadmap.md','utf8');const phrase='bounded dashboard insights snapshot';if(!c.includes(phrase)||!r.includes(phrase))process.exit(1);console.log('dashboard insights documentation verification passed')"
      EXPECT: dashboard insights documentation verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=dashboard insights documentation verification passed

- [x] G9: final diff review confirms the completed bootstrap/onboarding behavior and unrelated member-import UI/tests were preserved
      EVIDENCE: git diff --check exited 0; write and format targets stayed within this phase's OWNS paths; the pre-existing member-import workspace and dashboard bootstrap/onboarding diffs remain present and untouched; the combined full suite and production build passed.
