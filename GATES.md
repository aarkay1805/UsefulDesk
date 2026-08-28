# Gates: dashboard action attention aggregate

OWNS: GATES.md, scripts/verify-performance-fixes.mjs, src/lib/dashboard/action-attention.ts, src/lib/dashboard/action-attention.test.ts, src/lib/dashboard/action-attention-rpc.test.ts, src/lib/dashboard/action-snapshot.ts, src/lib/dashboard/action-snapshot.test.ts, supabase/migrations/*_dashboard_action_attention.sql, docs/changelog.md, PRDs/roadmap.md

Scope: replace the dashboard attention section's full 30-day owner-report workload with one selected-branch, viewer-readable, RLS-invoker aggregate while preserving the existing server-hydrated action snapshot, bounded queues, refresh behavior, and independent failures.

- [x] G1: the attention loader calls one narrow aggregate that returns only the three rendered counts, uses the authorized branch calendar day, and fails section-locally
      CHECK: npm exec vitest run src/lib/dashboard/action-attention.test.ts src/lib/dashboard/action-snapshot.test.ts && node -e "console.log('dashboard attention loader verification passed')"
      EXPECT: dashboard attention loader verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration  170ms (transform 58ms, setup 0ms, import 111ms, tests 13ms, environment 0ms) | dashboard attention loader verification passed

- [x] G2: the new aggregate is SECURITY INVOKER, validates the branch day, retains selected-branch RLS as the tenant boundary, and grants viewer-capable authenticated execution without anon or service-role access
      CHECK: npm exec vitest run src/lib/dashboard/action-attention-rpc.test.ts && node -e "console.log('dashboard attention RLS verification passed')"
      EXPECT: dashboard attention RLS verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration  85ms (transform 9ms, setup 0ms, import 22ms, tests 2ms, environment 0ms) | dashboard attention RLS verification passed

- [x] G3: the browser action path remains zero action API requests on the initial server-hydrated response and exactly one private no-store request on refresh, preserving the measured 14-to-1 historical consolidation with no widget-side Supabase fetches
      CHECK: npm exec vitest run src/components/dashboard/dashboard-actions.test.tsx src/components/dashboard/dashboard-streaming.test.tsx src/app/api/dashboard/actions/route.test.ts 'src/app/(dashboard)/dashboard/page.test.tsx' && node scripts/verify-performance-fixes.mjs source && node -e "console.log('dashboard browser request path verification passed')"
      EXPECT: dashboard browser request path verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=performance source verification passed | dashboard browser request path verification passed

- [x] G4: the focused dashboard, reporting, auth, locale, and membership-domain regressions pass with the new aggregate boundary
      CHECK: npm exec vitest run src/lib/reports/reporting.test.ts src/lib/dashboard 'src/app/(dashboard)/dashboard-auth-context.test.ts' src/lib/memberships/stats.test.ts src/lib/locale && node -e "console.log('dashboard integration regression verification passed')"
      EXPECT: dashboard integration regression verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration  327ms (transform 514ms, setup 0ms, import 1.18s, tests 132ms, environment 1ms) | dashboard integration regression verification passed

- [x] G5: repository typecheck, lint, formatting, and the complete test suite pass
      CHECK: npm run typecheck && npm run lint && npm run format:check && npm test && node -e "console.log('repository quality verification passed')"
      EXPECT: repository quality verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Not implemented: Window's scrollTo() method | Not implemented: Window's scrollTo() method

- [x] G6: a fresh production build passes and dashboard and Members route-only JavaScript remain within their established budgets
      CHECK: npm run build && node scripts/verify-performance-fixes.mjs bundles
      EXPECT: bundle performance verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=members route-only JavaScript: 87.6 KiB gzip (budget 205 KiB) | bundle performance verification passed

- [x] G7: the migration is connector-applied to the UsefulDesk databases and live metadata plus a non-owner authenticated call prove the function is invoker-safe, viewer-capable, and selected-branch scoped
      EVIDENCE: Supabase connector versions `20260828102546` (UsefulDesk Razorpay Test) and `20260828102714` (UsefulDesk Production); both metadata probes returned `security_definer=false`, stable volatility, authenticated execute true, anon/service-role execute false. Neither database currently has a literal viewer membership, so each live branch-context probe used an existing agent with `owner_membership=false`; `current_user=authenticated` and all three aggregate counts were valid. Static G2 proves the function has no minimum-role check beyond underlying viewer-readable selected-branch RLS. Both databases' security and performance advisors returned zero findings naming `dashboard_action_attention`.

- [x] G8: the diff is limited to the declared attention slice, required documentation, and gate evidence; the prior auth/bootstrap, insights snapshot, action snapshot/streaming, and member-import implementation remain unchanged outside the explicitly listed integration files
      EVIDENCE: `git status --short` contains only GATES/docs/source verifier, the two action-snapshot integration files, three new attention files, and the one new migration. `git diff --quiet HEAD --` over `dashboard-request-context.ts`, the insights snapshot/client, both member-import UI files, and both member-import domain loaders exited 0; dashboard streaming and all widget UI files are also absent from the diff. `git diff --check` exited 0.
