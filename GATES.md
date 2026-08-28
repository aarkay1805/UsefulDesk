# Gates: authenticated navigation performance

OWNS: GATES.md, benchmark-results/**, scripts/verify-performance-fixes.mjs, src/app/(dashboard)/**, src/components/dashboard/**, src/components/layout/sidebar.tsx, src/components/layout/sidebar.ui.test.tsx, src/components/members/**, src/lib/auth/**, src/lib/dashboard/**, src/lib/memberships/**, docs/changelog.md, PRDs/roadmap.md

Scope: make authenticated navigation respond immediately, reduce initial dashboard and members work, bound renewal reads, and prove the optimized production artifacts and regressions.

- [x] G1: authenticated menu navigation has an instant route fallback and a pending link state covered by tests
      CHECK: npm exec vitest run src/components/layout/sidebar.ui.test.tsx 'src/app/(dashboard)/dashboard-shell.test.tsx' && node -e "console.log('navigation performance tests passed')"
      EXPECT: navigation performance tests passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  1.49s (transform 97ms, setup 0ms, import 1.01s, tests 117ms, environment 640ms) | navigation performance tests passed

- [x] G2: the default renewal queue fetch is account-scoped, column-bounded, date-window-bounded, and paginated with tested behavior
      CHECK: npm exec vitest run src/lib/memberships/renewal-queue.test.ts && node -e "console.log('renewal queue performance tests passed')"
      EXPECT: renewal queue performance tests passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  160ms (transform 30ms, setup 0ms, import 67ms, tests 2ms, environment 0ms) | renewal queue performance tests passed

- [x] G3: dashboard action data is present on the first server payload and below-fold insights do not request data before activation
      CHECK: npm exec vitest run src/components/dashboard/dashboard-actions.test.tsx src/components/dashboard/deferred-dashboard-insights.test.tsx 'src/app/(dashboard)/dashboard/page.test.tsx' && node -e "console.log('dashboard performance tests passed')"
      EXPECT: dashboard performance tests passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  1.03s (transform 119ms, setup 0ms, import 581ms, tests 212ms, environment 755ms) | dashboard performance tests passed

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

- [x] G7: dashboard layout and page share one request-scoped authenticated selected-branch context with no duplicate account or timezone lookup, while invalid, unauthorized, and archived branches remain fail-closed
      CHECK: npm exec vitest run 'src/app/(dashboard)/dashboard-auth-context.test.ts' 'src/app/(dashboard)/dashboard-shell.test.tsx' 'src/app/(dashboard)/dashboard/page.test.tsx' && node -e "console.log('dashboard auth context verification passed')"
      EXPECT: dashboard auth context verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  215ms (transform 116ms, setup 0ms, import 318ms, tests 21ms, environment 0ms) | dashboard auth context verification passed

- [x] G8: independently renderable dashboard action sections stream without waiting for the slowest sibling, retain section-local failure UI, and emit safe bounded server-stage timing evidence
      CHECK: npm exec vitest run src/lib/dashboard/action-snapshot.test.ts src/components/dashboard/dashboard-streaming.test.tsx 'src/app/(dashboard)/dashboard/page.test.tsx' && node -e "console.log('dashboard streaming verification passed')"
      EXPECT: dashboard streaming verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  195ms (transform 104ms, setup 0ms, import 215ms, tests 20ms, environment 0ms) | dashboard streaming verification passed

- [x] G9: Members renders the selected renewal page before any inactive count finishes, does not issue an exact all-time expired count until that view is selected, and preserves accurate selected-window counts, caching, retries, recurring/account filters, and 50-row pagination
      CHECK: npm exec vitest run src/components/members/renewal-action-lists.test.tsx src/lib/memberships/renewal-queue.test.ts && node -e "console.log('renewal visible rows verification passed')"
      EXPECT: renewal visible rows verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Duration  950ms (transform 106ms, setup 0ms, import 464ms, tests 163ms, environment 331ms) | renewal visible rows verification passed

- [x] G10: the optimized source invariants and required changelog and roadmap entries are complete
      CHECK: node scripts/verify-performance-fixes.mjs source && node -e "console.log('performance source and docs verification passed')"
      EXPECT: performance source and docs verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=performance source verification passed | performance source and docs verification passed

- [x] G11: a fresh optimized production build keeps dashboard and Members route-only JavaScript below their declared budgets
      CHECK: npm run build && node scripts/verify-performance-fixes.mjs bundles
      EXPECT: bundle performance verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=members route-only JavaScript: 87.6 KiB gzip (budget 205 KiB) | bundle performance verification passed

- [x] G12: a controlled real-browser production benchmark records ten warm samples plus cold/cache-miss samples for pending feedback, route shell, Dashboard visible content, and Members visible rows, with medians, means, and Dashboard p90 reported without unsupported improvement claims
      EVIDENCE: `benchmark-results/2026-08-28-content-latency.md`; same-account production build in a real Chromium browser; 10 warm samples per route plus one cache-disabled cold sample per route. Combined pending/fallback medians 24.2/28.1 ms; Dashboard shell/first-section warm means 181.0/388.9 ms and cold 336.3/1,077.6 ms; all-sections warm mean/p90 1,176.2/2,854.7 ms and cold 3,492.2 ms (no full-completion improvement claimed); Members rows warm median/mean 229.7/308.9 ms and cold 697.4 ms.

- [x] G13: the complete repository typecheck, lint, and test suite pass after the latency changes
      CHECK: npm run typecheck && npm run lint && npm test && node -e "console.log('repository regression re-verification passed')"
      EXPECT: repository regression re-verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=355635d5efa7/23 entries; output=Not implemented: Window's scrollTo() method | Not implemented: Window's scrollTo() method
