# Gates: P2-8 Performance report exact-key cache reuse

Scope: Reuse fresh, exact, user/account/input-scoped Performance snapshots across report lifecycles while deduplicating in-flight loads, bounding memory, and preserving explicit refresh, freshness, output, authorization, and navigation behavior.

- [x] G1: deterministic pre-fix lifecycle instrumentation proves the residual duplicate RPC counts for first load, completed revisit, same-key rerender, rapid A→B→A, Retry, input changes, Strict Mode/remount, and unmount
  EVIDENCE: The pre-fix React lifecycle probe passed three tests against HEAD 49eea3c before implementation. First load issued one snapshot call and a same-key rerender stayed at one, but exact-key unmount/remount reached two. Strict Mode started two identical August calls; rapid August→July→August reached four total calls. Retry intentionally moved one failed call to two. Source tracing confirmed account/timezone/month/staff dependencies each reran the effect, cleanup only advanced the stale-response sequence, and the component-owned cache was destroyed on Finance-tab unmount.

- [x] G2: focused cache and React lifecycle tests prove first load, exact completed hit, in-flight dedupe, explicit refresh bypass, TTL expiry/invalidation, normalized keys, user/account isolation, A→B→A ordering, bounded eviction, Strict Mode/remount reuse, and unmount cleanup
  CHECK: npm test -- --run src/components/reports/owner-reports-cache.test.ts src/components/reports/owner-reports-view.lifecycle.test.tsx
  EXPECT: /Test Files\s+2 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  01:15:43 | Duration  1.40s (transform 128ms, setup 0ms, import 475ms, tests 582ms, environment 310ms)

- [x] G3: report snapshot normalization, output contracts, staff/date/timezone semantics, and consolidated RPC contract remain unchanged
  CHECK: npm test -- --run src/lib/reports/reporting.test.ts src/lib/reports/branch-performance-snapshot-contract.test.ts
  EXPECT: /Test Files\s+2 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  01:15:45 | Duration  206ms (transform 63ms, setup 0ms, import 191ms, tests 10ms, environment 0ms)

- [x] G4: relevant auth, selected-account, branch isolation, navigation, and Finance-route suites remain green
  CHECK: npm test -- --run src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts src/lib/members/member-purchase-navigation.test.ts src/lib/finance/views.test.ts src/components/finance/finance-master-view.test.tsx
  EXPECT: /Test Files\s+7 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  01:15:46 | Duration  2.40s (transform 492ms, setup 0ms, import 2.58s, tests 17ms, environment 0ms)

- [x] G5: full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-8 typecheck passed"
  EXPECT: P2-8 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-8 typecheck passed

- [x] G6: full repository lint passes
  CHECK: npm run lint && echo "P2-8 lint passed"
  EXPECT: P2-8 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-8 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G7: working-tree and staged patches contain no whitespace errors
  CHECK: git diff --check && git diff --cached --check && echo "P2-8 diff checks passed"
  EXPECT: P2-8 diff checks passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-8 diff checks passed

- [x] G8: before/after request counts prove fresh completed and in-flight exact-key reuse eliminates redundant snapshot RPCs without changing loading behavior or explicit Retry
  EVIDENCE: Deterministic component counts moved completed exact-key remount from two total snapshot calls to one, Strict Mode first load from two calls to one, and rapid A→B→A from four calls to two (one per distinct key); same-key rerender remains one and Retry remains one explicit additional forced call. Authenticated CDP observation against localhost measured exactly one cold POST to selected_branch_performance_snapshot, zero POSTs for fresh Overview→Performance revisit with the report visible and no loading skeleton, and one post-TTL POST; the separately observed OPTIONS request was a browser CORS preflight, not database work.

- [x] G9: freshness, security, and lifecycle review proves conservative invalidation, no cross-user/account/key reuse, bounded memory, stale-response safety, and no RLS/database/compute change
  EVIDENCE: The cache key is normalized JSON over user id, selected account/branch id, timezone, month, and staff-or-all; scope mismatch returns no entry and the next load clears completed/pending state. Twelve-entry LRU bounds completed plus pending references. Exact pending promises dedupe, forced refresh replaces the pending token, and only the newest token may populate cache; component request ids suppress stale/error/loading callbacks after key change or unmount. With FINANCE_REALTIME_TABLES.performance empty, a conservative 30-second completion TTL improves on the prior component-lifetime freshness: fresh activation reuses, expired remount/back-navigation shows the existing skeleton and refreshes once, while stale bytes are never presented as current. RLS/browser Supabase access and the existing selected-branch RPC are untouched; no service role, SECURITY DEFINER, SQL, migration, shared server cache, or compute change exists.

- [x] G10: changelog and roadmap record only the verified P2-8 outcome, cache tradeoff, measurements, and next evidenced residual
  EVIDENCE: docs/changelog.md and PRDs/roadmap.md record P2-8's root cause, user/account/input key, 30-second TTL, 12-entry LRU, dedupe/Retry/loading semantics, deterministic and authenticated browser counts, unchanged output/RLS/database/compute, and the remaining legitimate ~624–636 ms cache-resident/CPU-bound snapshot cost. They identify no further evidenced request-lifecycle residual rather than inventing a new finding.

- [x] G11: four explicit review passes find no remaining correctness, integration, portability, performance/evidence, authorization, documentation, dirty-tree, or scope defect
  EVIDENCE: Pass 1 traced the component cache, Finance routing, auth/locale/staff inputs, loader, Retry, request sequencing, and no-Realtime boundary, then reproduced remount/Strict/A→B→A counts. Pass 2 reviewed React/App Router integration and found/fixed expired entries disappearing on incidental rerender plus expired back-navigation rendering without the loading state; both gained lifecycle tests. Pass 3 reviewed cache algorithms/security and found/fixed completion double-counting during LRU trim, dynamic clock behavior, forced-refresh ordering, pending eviction/repopulation, and user/account scope isolation. Pass 4 re-read code/tests/docs, authenticated-browser POST evidence, normalization/RPC/auth/navigation suites, full type/lint, diff scope, and the concurrent a2f1da8/member-profile changes; no remaining P2-8 defect was found.

- [ ] G12: final --reverify passes every runnable gate, figures and output equality are remeasured, the staged patch contains only P2-8 paths/hunks, and all six user-owned dirty files remain unstaged and byte-identical to the recorded baseline
  EVIDENCE: pending

ABANDON: G12 While P2-8 was in progress, concurrent commit a2f1da8 swept the six pre-existing user-owned dirty files and the then-current P2-8 baseline into main. Restoring their original unstaged state would require rewriting or reverting a commit that this task explicitly must preserve. The concurrency event, hashes, and replacement final-scope gate are recorded for handoff.

- [x] G13: final --reverify passes every runnable gate, figures and output equality are remeasured, the staged patch contains only the remaining P2-8 paths/hunks, and later unrelated member-profile edits remain unstaged and unmodified by P2-8
  EVIDENCE: Final `--reverify` reran G2-G7 successfully: 14 focused cache/lifecycle tests, the two report normalization/RPC-contract files, the seven auth/branch/navigation/Finance files, full typecheck, full lint, and both diff checks passed. The index contains exactly GATES.md, PRDs/roadmap.md, docs/changelog.md, and the four owner-report cache/view source and test files. The six later member-profile files remain unstaged with their pre-stage SHA-256 hashes unchanged; the concurrently managed untracked preview page disappeared outside this task during the final check. No P2-8 command staged, formatted, reset, or edited those unrelated paths.
