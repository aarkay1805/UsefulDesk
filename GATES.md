# Gates: P2-4 member follow-ups listing performance

Scope: Decide from authenticated Production evidence whether the Members → Follow-ups five-request page/count/facet fanout warrants consolidation, and if so ship exactly one bounded, behavior-preserving, selected-branch invoker data path.

- [x] G1: every Members Follow-ups listing path, rendered field, filter, search, sort, page, count/facet, realtime, mutation, identity, due-date, SQL, index, and RLS dependency is inventoried and the fix-or-defer decision is justified by measured absolute and scaling cost
  EVIDENCE: traced members page/view URL state, FollowUpLists, shared filter/search/staff/table-preference/reminder/completion paths, five ordinary reads plus numeric-search sixth read, explicit select-all, 400 ms Realtime reload, open/mine-team/assignee/author/date semantics, four source-table RLS policies, and all Follow-ups indexes; consolidation is justified because one bounded snapshot cuts both fanout and measured database work while the separate select-all action remains explicit

- [x] G2: focused Follow-ups result, filter/sort/due, exact total/facet, pagination/clamping, lifecycle, stale-response, realtime, loading/empty/error/retry, and rendered-behavior tests pass
  CHECK: npm test -- --run src/components/members/follow-up-lists.test.tsx src/lib/memberships/follow-up-filters.test.ts src/lib/memberships/member-follow-ups.test.ts src/lib/memberships/member-follow-ups-rpc.test.ts
  EXPECT: /Test Files\s+4 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  23:25:18 | Duration  1.46s (transform 142ms, setup 0ms, import 1.05s, tests 132ms, environment 582ms)

- [x] G3: focused authorization and selected-account regression tests pass
  CHECK: npm test -- --run src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts
  EXPECT: /Test Files\s+4 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  23:25:20 | Duration  140ms (transform 69ms, setup 0ms, import 172ms, tests 10ms, environment 0ms)

- [x] G4: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-4 typecheck passed"
  EXPECT: P2-4 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-4 typecheck passed

- [x] G5: the full repository lint passes
  CHECK: npm run lint && echo "P2-4 lint passed"
  EXPECT: P2-4 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-4 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G6: the working-tree and staged patches contain only P2-4 files and have no whitespace errors
  CHECK: git diff --check && git diff --cached --check && echo "P2-4 diff checks passed"
  EXPECT: P2-4 diff checks passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-4 diff checks passed

- [x] G7: authenticated Production profiling records the live five-request baseline, rows, payload, exact-count execution, total database time/hits/reads/temp, table scale, lifecycle duplication, and common predicate/order index fit before the fix-or-defer decision
  EVIDENCE: Production has 281 memberships, three follow-ups, and one matching open row; the legacy page plus four exact counts transferred 3,771 JSON bytes and five warm authenticated plans totalled 15.446 ms / 3,192 shared hits / zero reads or temp blocks (page 4.924/799, all 3.508/801, overdue 0.102/1, today 3.324/793, upcoming 3.588/798); numeric search added a sixth membership download, while sequence guards suppressed stale UI but did not abort work; existing account-status-due, assignee-status, and account-contact indexes cover the common predicates and live plans do not support another index

- [x] G8: identical before/after output hashes, counts/order, all filters/sorts/due buckets, pagination/clamping, and owner/viewer results pass alongside wrong-account, non-member, archived-branch, empty-scope, malformed-input, and bound negative controls
  EVIDENCE: rendered/action normalization matched legacy exactly at 47b20999fea40230f441e496e85887b5; rollback-only 31-row fixtures matched all eight sort directions, reason/current+unassigned/unassigned/mine filters, numeric search, every due bucket/facet, and page-99 clamp; owner/admin/agent/viewer returned the same result hash, while wrong selected account, random non-member, archived branch, and authorized empty branch returned the exact empty shape; null date, long search, bad scope/reason/bucket/sort/direction/page/size and null due-date controls failed with the expected SQLSTATE

- [x] G9: any database change is forward-only and idempotent, SECURITY INVOKER with fixed search_path and selected-account/RLS isolation, authenticated-only execution, and verified live signature, ACL, policies, grants, advisors, publication, and supported indexes
  EVIDENCE: forward-only idempotent migrations 20260829050000/051000 are live as connector versions 20260828173840/173922; exact live signature is stable invoker, postgres-owned, search_path="", authenticated execute true and PUBLIC/anon/service_role false; contacts/follow_ups/memberships/membership_plans retain RLS with one SELECT policy each, follow_ups publication is live, role/isolation negatives passed, advisors reported no new function finding, and pre-existing Follow-ups FK/unused-index notices were not acted on without plan/scale evidence

- [x] G10: the shipped implementation preserves the exact Follow-ups UI contract and materially reduces measured request fanout without disproportionate database work, broad transfer, redundant counts, cache staleness, or weaker authorization
  EVIDENCE: default row/count/order is unchanged while ordinary loads fall 5->1 requests (numeric search 6->1), payload 3,771->2,225 bytes, and five-warm database execution 15.446->13.064 ms with shared hits 3,192->2,739 and zero reads/temp in both; the RPC returns an explicit bounded row contract, exact contextual facets, and server-clamped page, aborts superseded work, keeps explicit select-all separate, and preserves existing loading/empty/toast/retry and 400 ms Realtime behavior

- [x] G11: changelog and roadmap record only the verified P2-4 outcome and name the next residual performance priority
  EVIDENCE: docs/changelog.md and PRDs/roadmap.md record the two live migration versions, measured before/after figures, exact/security controls, no-index decision, closure of stale P2-3 references, and Members -> Attendance full-roster plus sequential usage-count loading as the next residual

- [x] G12: four explicit review passes find no remaining correctness, integration, portability, performance/evidence, authorization, documentation, or scope defect
  EVIDENCE: pass 1 checked the RPC row contract against identity/avatar/reminder/completion/assignee/select-all consumers; pass 2 checked legacy equivalence, every filter/sort/bucket/page fixture, lifecycle and UI states; pass 3 checked forward migration portability, live signature/ACL/RLS/roles/isolation/publication/indexes/advisors; pass 4 checked tests, changelog/roadmap figures, migration ordering, e2f1485 ancestry, whitespace, and the exact P2-4-only file set; no remaining defect found

- [x] G13: immediately before commit every runnable gate is reverified with --reverify, every reported figure is remeasured, and the staged patch contains only verified P2-4 files
  EVIDENCE: final --reverify reran five approved checks and passed focused 4-file/24-test and 4-file auth suites, full typecheck, full lint, and staged/working diff checks; Production remeasurement reconfirmed 281 memberships / three follow-ups / one matching row, one 2,225-byte snapshot with exact 1/0/0/1 facets and equal normalized legacy/RPC hashes, fresh warm legacy 14.756 ms / 2,983 hits versus RPC 12.170 ms / 2,739 hits with zero reads/temp, and the staged file list contains only the 11 reviewed P2-4 paths
