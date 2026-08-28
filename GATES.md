# Gates: dashboard action snapshot database consolidation

OWNS: GATES.md, benchmark-results/2026-08-28-content-latency.md, scripts/verify-performance-fixes.mjs, scripts/verify-dashboard-action-snapshot.mjs, src/app/(dashboard)/dashboard/page.tsx, src/components/dashboard/dashboard-actions.tsx, src/components/dashboard/dashboard-actions.test.tsx, src/components/dashboard/dashboard-streaming.tsx, src/components/dashboard/dashboard-streaming.test.tsx, src/components/dashboard/gym-metrics.tsx, src/components/dashboard/follow-up-queue.tsx, src/components/dashboard/expiring-memberships.tsx, src/components/dashboard/uncontacted-leads.tsx, src/components/dashboard/needs-attention-card.tsx, src/app/api/dashboard/actions/route.ts, src/app/api/dashboard/actions/route.test.ts, src/lib/dashboard/action-snapshot.ts, src/lib/dashboard/action-snapshot.test.ts, src/lib/dashboard/action-snapshot-rpc.test.ts, src/lib/dashboard/types.ts, supabase/migrations/*_dashboard_action_snapshot.sql, docs/changelog.md, PRDs/roadmap.md

Scope: replace the remaining selected-branch dashboard action-widget database fan-out with one viewer-readable, no-store, bounded action snapshot while preserving server hydration, refresh/filter behavior, section states, localization, and all prior dashboard and member-import work.

- [x] G1: the action loader uses one selected-branch snapshot RPC that validates the account calendar day and bounded payload for GymMetrics, FollowUpQueue, ExpiringMemberships, UncontactedLeads, and Needs Attention
      CHECK: npm exec vitest run src/lib/dashboard/action-snapshot.test.ts src/lib/dashboard/action-snapshot-rpc.test.ts && node -e "console.log('dashboard action loader verification passed')"
      EXPECT: dashboard action loader verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration 154ms (transform 40ms, setup 0ms, import 103ms, tests 10ms, environment 0ms) | dashboard action loader verification passed

- [x] G2: the snapshot function is SECURITY INVOKER, selected-branch RLS scoped, viewer-executable only for authenticated callers, returns at most eight previews per queue, and preserves account-timezone day boundaries
      CHECK: npm exec vitest run src/lib/dashboard/action-snapshot-rpc.test.ts src/lib/dashboard/date-utils.test.ts src/lib/locale src/lib/memberships/stats.test.ts && node -e "console.log('dashboard action RLS and timezone verification passed')"
      EXPECT: dashboard action RLS and timezone verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration 190ms (transform 127ms, setup 0ms, import 267ms, tests 35ms, environment 0ms) | dashboard action RLS and timezone verification passed

- [x] G3: the five action widgets remain zero browser action requests after server hydration, exactly one private no-store request after mutation refresh, and filter changes make no request; the browser path remains reduced from the pre-snapshot fourteen-request baseline to one refresh boundary
      CHECK: npm exec vitest run src/components/dashboard/dashboard-actions.test.tsx src/components/dashboard/dashboard-streaming.test.tsx src/app/api/dashboard/actions/route.test.ts 'src/app/(dashboard)/dashboard/page.test.tsx' && node scripts/verify-dashboard-action-snapshot.mjs browser && node -e "console.log('dashboard browser request verification passed')"
      EXPECT: dashboard browser request verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=dashboard browser boundary verification passed | dashboard browser request verification passed

- [x] G4: measured source and live database evidence show the action data stage falls from at least twelve Supabase data requests and five streamed section stages to one snapshot data request and one fixed-label server stage, with one-row query plans and no temporary spill
      CHECK: node scripts/verify-dashboard-action-snapshot.mjs database
      EXPECT: dashboard database fan-out verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=dashboard action server stages: 5 streamed stages -> 1 fixed-label stage | dashboard database fan-out verification passed

- [x] G5: loading, empty, section error, bounded preview, staff identity, readiness deferral, refresh-after-mutation, and all follow-up chip states retain regression coverage
      CHECK: npm exec vitest run src/components/dashboard src/lib/dashboard src/lib/memberships/stats.test.ts src/hooks/use-auth.test.tsx && node -e "console.log('dashboard action behavior regression verification passed')"
      EXPECT: dashboard action behavior regression verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration 1.13s (transform 526ms, setup 0ms, import 1.78s, tests 491ms, environment 2.88s) | dashboard action behavior regression verification passed

- [x] G6: repository typecheck, lint, formatting, complete tests, and production build pass
      CHECK: npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && node -e "console.log('repository quality verification passed')"
      EXPECT: repository quality verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Not implemented: Window's scrollTo() method | Not implemented: Window's scrollTo() method

- [x] G7: changelog and roadmap record the bounded action snapshot and measured request/server-stage impact, and the migration is connector-applied with live metadata, viewer-equivalent authenticated probes, one-row/no-temp-spill query-plan evidence, and no Supabase advisor findings attributable to the function
      EVIDENCE: docs and benchmark record 12→1 data requests, 5→1 stages, and browser 0/1/0; connector versions Production 20260828112344+20260828112514 and Test 20260828112351+20260828112522 are live; both agent-member authenticated probes were viewer-authorized, selected-branch-only, and returned five sections with errors=[]; metadata is stable invoker/authenticated-only; plans returned one row with zero temp blocks in 126.660 ms Production and 122.191 ms Test; advisor scans found zero dashboard_action_snapshot-related notices.

- [x] G8: the final diff preserves all earlier dashboard auth/bootstrap, insights, attention, localization, and unrelated member-import/table UI edits; it contains no branch/worktree/commit operation and passes git diff integrity checks
      EVIDENCE: scripts/verify-performance-fixes.mjs source and git diff --check passed; request-scoped auth/bootstrap, insights aggregates, narrow attention RPC, locale helpers, member-import sources, and the user-owned TableSkeleton rollout remain present; full tests/build passed; status stayed on main at 9621cb0 in /Users/rajatkashyap/Desktop/projects/UsefulDesk, with no branch switch, worktree creation/use, or commit.
