# Gates: authenticated navigation performance

OWNS: GATES.md, scripts/verify-performance-fixes.mjs, src/app/(dashboard)/**, src/components/dashboard/**, src/components/layout/sidebar.tsx, src/components/layout/sidebar.ui.test.tsx, src/components/members/**, src/lib/memberships/**, docs/changelog.md, PRDs/roadmap.md

Scope: make authenticated navigation respond immediately, reduce initial dashboard and members work, bound renewal reads, and prove the optimized production artifacts and regressions.

- [x] G1: authenticated menu navigation has an instant route fallback and a pending link state covered by tests
      CHECK: npm exec vitest run src/components/layout/sidebar.ui.test.tsx 'src/app/(dashboard)/dashboard-shell.test.tsx' && node -e "console.log('navigation performance tests passed')"
      EXPECT: navigation performance tests passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration 1.27s (transform 108ms, setup 0ms, import 756ms, tests 123ms, environment 545ms) | navigation performance tests passed

- [x] G2: the default renewal queue fetch is account-scoped, column-bounded, date-window-bounded, and paginated with tested behavior
      CHECK: npm exec vitest run src/lib/memberships/renewal-queue.test.ts && node -e "console.log('renewal queue performance tests passed')"
      EXPECT: renewal queue performance tests passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration 182ms (transform 37ms, setup 0ms, import 111ms, tests 3ms, environment 0ms) | renewal queue performance tests passed

- [x] G3: dashboard action data is present on the first server payload and below-fold insights do not request data before activation
      CHECK: npm exec vitest run src/components/dashboard/dashboard-actions.test.tsx src/components/dashboard/deferred-dashboard-insights.test.tsx 'src/app/(dashboard)/dashboard/page.test.tsx' && node -e "console.log('dashboard performance tests passed')"
      EXPECT: dashboard performance tests passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration 926ms (transform 114ms, setup 0ms, import 464ms, tests 179ms, environment 800ms) | dashboard performance tests passed

- [x] G4: optimized production route-only JavaScript stays below the declared dashboard and members budgets
      CHECK: npm run build && node scripts/verify-performance-fixes.mjs bundles
      EXPECT: bundle performance verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=members route-only JavaScript: 87.6 KiB gzip (budget 205 KiB) | bundle performance verification passed

- [x] G5: performance source invariants and required product documentation are complete
      CHECK: node scripts/verify-performance-fixes.mjs source
      EXPECT: performance source verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=performance source verification passed

- [x] G6: the complete repository typecheck, lint, and test suite pass
      CHECK: npm run typecheck && npm run lint && npm test && node -e "console.log('repository regression verification passed')"
      EXPECT: repository regression verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Not implemented: Window's scrollTo() method | Not implemented: Window's scrollTo() method
