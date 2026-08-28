# Gates: P2-7 Members Realtime dependency-scoped reloads

Scope: Keep one tenant-filtered Members Realtime channel while coalescing each event into exactly the active listing reloads whose displayed data depends on its source table.

- [x] G1: source tracing and deterministic pre-fix instrumentation establish the complete table-to-view dependency matrix, request counts, debounce behavior, tab-switch semantics, duplicate-subscription behavior, and cleanup
  EVIDENCE: Traced all seven listing implementations, their views/RPCs, the shared readiness provider, member sheet, and the four-table page channel at HEAD 4c430ca. Temporary deterministic lifecycle instrumentation measured every original table/view pair before implementation: memberships, payments, attendance, and follow_ups each refetched all seven views (28/28), totaling 36 isolated database reads because Retention and All each performed two reload-key-bound reads. Bursts produced one global token bump after 400 ms; switching tabs before the timer moved that bump to the newly mounted unrelated view; one page channel was registered and removed on unmount. The temporary baseline passed 40 lifecycle tests before being replaced by the final dependency-matrix suite.

- [x] G2: focused dependency-matrix and React lifecycle tests prove every relevant table/view pair, unrelated-event suppression, one relevant refetch, 400 ms burst coalescing, tab switching before timer fire, one channel, and final cleanup
  CHECK: npm test -- --run 'src/app/(dashboard)/members/page.lifecycle.test.tsx' 'src/app/(dashboard)/members/page.performance.test.ts'
  EXPECT: /Test Files\s+2 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  00:47:19 | Duration  1.32s (transform 69ms, setup 0ms, import 363ms, tests 365ms, environment 544ms)

- [x] G3: existing member listings and sheet retain their request, loading, stale-response, retry, manual-refresh, and write-refresh behavior
  CHECK: npm test -- --run src/components/members/renewal-action-lists.test.tsx src/components/members/follow-up-lists.test.tsx src/components/members/payments-table.test.tsx src/components/members/members-table.test.tsx src/components/members/attendance-view.test.tsx src/components/members/member-detail-view.test.tsx src/components/contacts/contact-notes-thread.test.tsx
  EXPECT: /Test Files\s+7 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  00:47:21 | Duration  3.34s (transform 1.06s, setup 0ms, import 8.05s, tests 1.39s, environment 3.01s)

- [x] G4: selected-account, selected-branch, role, navigation, and member-sheet integration remain isolated and authorized
  CHECK: npm test -- --run src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts src/lib/members/member-purchase-navigation.test.ts
  EXPECT: /Test Files\s+5 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  00:47:25 | Duration  136ms (transform 99ms, setup 0ms, import 192ms, tests 12ms, environment 0ms)

- [x] G5: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-7 typecheck passed"
  EXPECT: P2-7 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-7 typecheck passed

- [x] G6: the full repository lint passes
  CHECK: npm run lint && echo "P2-7 lint passed"
  EXPECT: P2-7 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-7 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G7: working-tree and staged patches contain no whitespace errors
  CHECK: git diff --check && git diff --cached --check && echo "P2-7 diff checks passed"
  EXPECT: P2-7 diff checks passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-7 diff checks passed

- [x] G8: before/after request counts prove representative unrelated events are avoided while every relevant event still causes exactly one active-listing refetch
  EVIDENCE: The original four-table matrix fell from 28 view refetches / 36 database requests to 13 relevant view refetches / 15 requests, avoiding 15 unrelated refetches / 21 requests. Across all 15 published source tables x seven views, 43 relevant pairs refetch exactly once and 62 unrelated pairs issue no listing request; the measured request weights total 47 versus 135 for an equivalent global nonce. Rapid mixed bursts coalesce each affected active token once.

- [x] G9: one selected-account-filtered channel, selected-branch isolation, URL/back-forward behavior, provider/readiness reads, member sheet, loading/error state, stale-response suppression, writes, and unmount cleanup remain correct without database or authorization changes
  EVIDENCE: The page retains one member-lists channel and one 400 ms timer, rejects payloads carrying a non-selected account_id, accepts primary-key-only DELETE payloads, and leaves selected-branch RLS as the authoritative read boundary. URL-derived view selection and native back/forward behavior are unchanged; readiness remains two provider reads rather than joining Realtime reloads. Existing listing/sheet suites cover loading, error, retry, stale-response, and write paths. Manual writes immediately bump the active view and main sheet; Realtime follow_ups refresh only the independent timeline, while other relevant sources refresh main detail. Tab-switch tests prove fresh mount without a later duplicate, and unmount clears the timer, pending set, and channel. No migration, publication, RLS, cache, service-role, SECURITY DEFINER, or compute change exists.

- [x] G10: changelog and roadmap record only the verified P2-7 outcome and identify the next evidenced residual
  EVIDENCE: The staged P2-7-only hunks in docs/changelog.md and PRDs/roadmap.md record the dependency matrix, before/after measurements, lifecycle/security constraints, existing-publication status, and next residual (the Performance report cache re-fetching an already loaded key). The unrelated preset-gallery changelog hunk remains unstaged.

- [x] G11: four explicit review passes find no remaining correctness, integration, portability, performance/evidence, authorization, documentation, dirty-tree, or scope defect
  EVIDENCE: Pass 1 traced every listing/RPC/view and established the pre-fix network baseline. Pass 2 reviewed integration boundaries and found/fixed the hidden All-members pending-transfer refetch plus the sheet follow-up waterfall. Pass 3 reviewed lifecycle correctness and found/fixed a tab-switch-before-debounce duplicate that React batching had initially masked, then added separate-commit coverage. Pass 4 re-reviewed account/branch authorization, DELETE portability, URL/navigation, provider reads, one-channel cleanup, all 15 publication sources, documentation figures, staged scope, and the evolving concurrent dirty tree; no remaining P2-7 defect was found.

- [x] G12: final --reverify passes every runnable gate, reported figures are remeasured, the staged patch contains only P2-7 paths/hunks, and all five user-owned preset-gallery files remain unstaged and unmodified by P2-7
  EVIDENCE: Final --reverify reran G2-G7 successfully (focused matrix/lifecycle, seven listing/sheet suites, five auth/branch/navigation suites, full typecheck, full lint, and both diff checks); G1 and G8-G11 were manually re-audited. The request figures remain 36 -> 15 for the original four-table matrix and 135 -> 47 for the complete 15-table matrix. The staged set is exactly nine P2-7 paths, with only the P2-7 changelog hunk staged. The five user-owned preset-gallery paths remain unstaged: docs/changelog.md (50/0), template-manager.test.tsx (3/3), template-manager.tsx (124/83), template-contracts.ts (10/11), and template-presets.ts (0/2). A later concurrent message-bubble.tsx change (1/1) also remains untouched and unstaged.
