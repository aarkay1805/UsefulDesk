# Gates: P2-5 member attendance listing performance

Scope: Verify and, only if justified by authenticated Production evidence, consolidate the Members → Attendance full-roster plus sequential usage-count path into one bounded, behavior-preserving, selected-branch SECURITY INVOKER snapshot.

- [x] G1: every Attendance roster, membership, plan, attendance, usage-window/count, date/timezone, search, bucket, sort, page, realtime, mutation, SQL, index, and RLS dependency is inventoried and the fix-or-defer decision is justified by measured absolute and scaling cost
  EVIDENCE: traced the Members URL/view lifecycle, all-membership eligibility, inner contact/left plan joins, latest contact/day attendance map, account-local day bounds, current-day period/month/week/session usage, present/absent and plan facets, locale search/order, direct check-in plus fresh warning count and guarded check-out, avatar/reminder/follow-up actions, 400 ms Realtime reload, all four source-table SELECT/write policies, publication, foreign keys, and existing account/date, account/contact/date, membership/date, membership/contact, and plan/contact indexes; one bounded snapshot is justified by the 281-row/630,564-byte roster transfer and conditional third sequential request

- [x] G2: focused Attendance result, usage, date, bucket, search, sort, pagination/clamping, lifecycle, stale-response, realtime, loading/empty/error/retry, and action-contract tests pass
  CHECK: npm test -- --run src/components/members/attendance-view.test.tsx src/lib/memberships/attendance-snapshot.test.ts src/lib/memberships/attendance-snapshot-rpc.test.ts src/lib/memberships/attendance-limits.test.ts
  EXPECT: /Test Files\s+4 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  00:04:11 | Duration  1.36s (transform 143ms, setup 0ms, import 555ms, tests 307ms, environment 551ms)

- [x] G3: focused authorization and selected-account regression tests pass
  CHECK: npm test -- --run src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts
  EXPECT: /Test Files\s+4 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  00:04:13 | Duration  134ms (transform 70ms, setup 0ms, import 171ms, tests 9ms, environment 0ms)

- [x] G4: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-5 typecheck passed"
  EXPECT: P2-5 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-5 typecheck passed

- [x] G5: the full repository lint passes
  CHECK: npm run lint && echo "P2-5 lint passed"
  EXPECT: P2-5 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-5 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G6: the working-tree and staged patches contain only P2-5 files and have no whitespace errors
  CHECK: git diff --check && git diff --cached --check && echo "P2-5 diff checks passed"
  EXPECT: P2-5 diff checks passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-5 diff checks passed

- [x] G7: authenticated Production profiling records the live request graph, rows, payload, warm execution, hits/reads/temp, table scale, lifecycle duplication, and predicate/order index fit before the fix-or-defer decision
  EVIDENCE: authenticated browser hard reload confirmed the Attendance path's full memberships request and selected-day attendance request, with the conditional usage RPC dormant only because Production has 281 memberships, zero attendance rows, one roster plan, and zero currently usage-tracked plans; the legacy payload was 630,562+2=630,564 bytes, warm statements totalled 6.726 ms / 816 shared hits / zero reads or temp, and a rollback-only all-tracked roster made the usage path 6.054 ms / 1,070 hits; an independent initial-view hydration request loaded Renewals before Attendance and remains out of P2-5 scope; existing indexes match the actual account/date and membership/date predicates, with no measured case for another index

- [x] G8: identical before/after output hashes, counts/order, usage semantics, date boundaries, buckets/search/sorts/pages/clamping, and owner/viewer results pass alongside wrong-account, non-member, archived-branch, empty-scope, malformed-input, and bound negative controls
  EVIDENCE: current 25-row legacy/RPC normalization matches at 487e82d8a77df3261bd9dd4c3c40e1b0; a rollback-only 17-visit fixture (12 current: eight in/four out; five past) matches at b8ee5939c27c9329e46092b98a5e5ecf across all six sort directions, present/absent, numeric search, plan filter, page-10 clamp, current/past usage visibility, weekly used=1..2, and day boundaries; owner/admin/agent/viewer hashes match, wrong-account/non-member/archived return the exact empty contract, an authorized empty tenant stays empty, and null, invalid zone/bucket/sort/direction/page/size/filter bounds fail with the expected SQLSTATE; every fixture change rolled back and live attendance returned to zero

- [x] G9: any database change is forward-only and idempotent, SECURITY INVOKER with fixed search_path and selected-account/RLS isolation, authenticated-only execution, and verified live signature, ACL, policies, grants, advisors, publication, and supported indexes
  EVIDENCE: forward-only idempotent migrations 20260829060000/061000/062000 are live as connector versions 20260828181428/181556/181829; exact live 13-argument signature is postgres-owned, stable, invoker, search_path="", authenticated execute true and PUBLIC/anon/service_role false, with no account-id input, timezone-catalog scan, or pre-page row JSON; memberships/contacts/membership_plans/attendance retain RLS and four policies each, all four remain in Realtime, role/isolation negatives passed, and advisors contain no new-RPC finding; two pre-existing Attendance FK index hints do not match this read path, while live account/date, account/contact/date, and membership/date indexes cover it

- [x] G10: the shipped implementation preserves the exact Attendance UI/action contract and materially reduces request fanout and transfer without disproportionate database work, cache staleness, lifecycle duplication, or weaker authorization
  EVIDENCE: default loads fall 2->1 requests and 281->25 roster rows (usage-tracked path 3->1), JSON transfer falls 630,564->43,691 bytes, and the fresh same-session warm snapshot is 6.433 ms / 39 shared hits / zero reads or temp versus the 6.726 ms / 816-hit legacy statements; the explicit result preserves consumed membership/contact/plan/action fields, exact facets/order/total, usage labels, empty/loading/error states, direct fresh-count warning and guarded mutations, viewer gating, abortable stale work, and uncached 400 ms Realtime refresh

- [x] G11: changelog and roadmap record only the verified P2-5 outcome and name the next residual performance priority
  EVIDENCE: docs/changelog.md and PRDs/roadmap.md record the three live connector versions, measured request/row/byte/plan figures, exact/security/fixture controls, no-index decision, and the independently observed Members deep-link default-Renewals lifecycle request as the next residual priority

- [x] G12: four explicit review passes find no remaining correctness, integration, portability, performance/evidence, authorization, documentation, or scope defect
  EVIDENCE: pass 1 compared the original roster/date/latest-visit/usage/action contract with every RPC field and consumer; pass 2 reviewed UI lifecycle, page clamping, filters/sorts, stale abort, Realtime, viewer actions, and added missing component-boundary interaction coverage; pass 3 reviewed forward-repair idempotency, live function source/signature/ACL/RLS/roles/isolation/publication/indexes/advisors and corrected an over-broad migration-source assertion; pass 4 rechecked measured documentation, migration ordering, 6c5e7be ancestry, formatting, whitespace, and the exact P2-5 path list while preserving concurrent preset-gallery work; a final improvement pass found no remaining defect

- [x] G13: immediately before commit every runnable gate is reverified with --reverify, every reported figure is remeasured, and the staged patch contains only verified P2-5 files
  EVIDENCE: final --reverify reran five approved checks and passed the focused 4-file/31-test and 4-file auth suites, full typecheck, full lint, and staged/working diff checks; fresh Production remeasurement reconfirmed 281 memberships / zero attendance / one plan, one 25-row/43,691-byte snapshot with 0/281 facets and exact 487e82d8a77df3261bd9dd4c3c40e1b0 row hash, plus a primed 6.433 ms / 39-hit / zero-read/temp plan; the staged list contains only the 11 reviewed P2-5 paths, while the concurrent preset-gallery changelog hunk and three related settings/template paths remain preserved and unstaged
