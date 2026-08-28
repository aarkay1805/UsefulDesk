# Gates: P2-2 consolidate Finance Overview loading

Scope: Preserve the exact tenant-scoped Finance Overview contract while reducing proven full-dataset transfer/client aggregation and broad duplicate realtime refresh work.

- [x] G1: focused Finance Overview result, SQL-contract, authorization, and data-path tests pass
  CHECK: npm test -- --run src/lib/finance/overview.test.ts src/lib/finance/overview-snapshot-contract.test.ts src/components/finance/finance-master-view.test.tsx src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts
  EXPECT: /Test Files\s+7 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  22:13:24 | Duration  3.67s (transform 894ms, setup 0ms, import 4.67s, tests 37ms, environment 1ms)

- [x] G2: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-2 typecheck passed"
  EXPECT: P2-2 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-2 typecheck passed

- [x] G3: the full repository lint passes
  CHECK: npm run lint && echo "P2-2 lint passed"
  EXPECT: P2-2 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-2 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G4: the final working-tree patch has no whitespace errors
  CHECK: git diff --check && echo "P2-2 diff check passed"
  EXPECT: P2-2 diff check passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-2 diff check passed

- [x] G5: the staged P2-2 patch has no whitespace errors
  CHECK: git diff --cached --check && echo "P2-2 staged diff check passed"
  EXPECT: P2-2 staged diff check passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-2 staged diff check passed

- [x] G6: current end-to-end request graph, row counts, payload bytes, client computation, sequencing, and realtime invalidation are measured from identical authenticated fixtures
  EVIDENCE: The authenticated August path was five parallel paged reads: 66 payments, one refund, 550 invoice rows, four projection memberships, and zero expenses (621 rows / 176,359 JSON bytes), followed by browser filtering, aggregation, chart construction, grouping, and sorting. It is now one RPC row / 8,698 bytes with no browser aggregation. Realtime changed from one six-table all-tab channel to active-tab dependency maps plus the existing 400 ms coalescer; Overview includes all 13 direct/view dependencies, Performance adds none, and unrelated Finance tabs do not refresh.

- [x] G7: the smallest implementation preserves totals, charts, recent rows, immutable purpose grouping, identity/detail behavior, date/timezone semantics, refunds, expenses, projections, staff/branch scoping, loading/error/empty states, and durable filters
  EVIDENCE: Independent legacy/snapshot hashes matched for financial totals (7d8557240a8de2482058b190f936ca03), invoice health (9a5aa6dbd3f61fa5cbc9236a30061d88), projection (feb37e7f8582bca1459b7de299268bd5), flow (86448ee4353cb446da8e4d7534bdc3d3), streams (6ed3c9614e6ec6d52f445f4b418642e7), and methods (5b4d6e88e1c198090078bf6730bedb70); recent identities matched. Snapshot normalization tests cover numeric strings and member detail fields. UI loading/error/empty/retry/export behavior and payment-purpose URL filters are unchanged; the active Performance/staff path remains independently owned.

- [x] G8: any database change is a new idempotent migration after the latest, SECURITY INVOKER with fixed search_path and existing authenticated/viewer access, selected-account isolation, no service-role browser path, and verified live definition/ACL/RLS/advisors
  EVIDENCE: Forward-only migrations 20260829030000, 20260829031000, and 20260829032000 were connector-applied as 20260828162238/163345/163809. Live function is stable, SECURITY INVOKER, search_path="", postgres-owned, authenticated EXECUTE only (anon/service_role false), and enforces authorized_selected_account_id. Every subscribed table is RLS-enabled, account_id-filterable, and published. Security/performance advisors contain zero snapshot, migration, or allocation-table findings.

- [x] G9: live owner/viewer fixtures and negative wrong-account, non-member, archived-branch, empty-account, current/historical month, refund, expense, projection, grouping/order/limit probes preserve the old output contract
  EVIDENCE: Owner and rollback-only viewer both returned August hash 0ab42f859ea229bbf19987a65dfd8c60 / 8,698 bytes. Historical July hash was ab8f9c88b6d12f933f9b77193e57ba4; empty selected account hash was 2ee9e6fcd9b07f4638668073ff2c36e6. Wrong selected account, non-member, and archived branch failed 42501. Rollback refund/expense/projection probes passed, including the cross-timezone DATE/timestamptz recent-order edge; five purpose groups, per-group limit five, and recent limit four were exact.

- [x] G10: repeated warm before/after evidence compares identical output hashes, requests, rows/payload, execution time, buffers/reads/temp, and client recomputation/refetch behavior
  EVIDENCE: Five warm authenticated legacy plans averaged 53.189 ms total and 4,750.4 shared hits per view load; five snapshot plans averaged 50.932 ms and 6,413.4 hits. Both had zero reads/temp. Database execution is neutral; the measured scaling win is 5 requests/621 rows/176,359 bytes to 1 request/1 row/8,698 bytes (95.1% fewer bytes), no client aggregation, and one coalesced recomputation per active dependency burst. Output hash remained 0ab42f859ea229bbf19987a65dfd8c60.

- [x] G11: changelog and roadmap record only shipped P2-2 and retain member payments/follow-up full-dataset reads and count paths as the next residual finding
  EVIDENCE: docs/changelog.md and PRDs/roadmap.md record only P2-2, its three connector versions and measured tradeoff, and name member payments/follow-up full-dataset reads and count paths as next.

- [x] G12: four explicit review passes find no remaining correctness, integration, portability, performance, evidence, scope, authorization, or documentation defect
  EVIDENCE: Pass 1 re-read the final loader/normalizer/component/SQL and found no remaining implementation or portability defect. Pass 2 repeated domain hashes and edge fixtures after correcting displayed-string recent ordering. Pass 3 rechecked invoker ACL, tenant denial, RLS, publication coverage, account filters, warm plans, and advisors after adding allocation dependencies. Pass 4 reviewed the scoped diff/docs/tests and passed 117 focused/auth tests, full typecheck, full lint, and whitespace checks with no remaining defect.

- [x] G13: immediately before commit every runnable gate is reverified with --reverify, all reported figures are remeasured, and the staged patch contains only P2-2 files
  EVIDENCE: Final owner/viewer hash, warm five-run plans, function ACL, RLS-filterable publication coverage, migration versions, and advisor scope were remeasured. The staged patch contains only eight P2-2 ledger/docs/component/test/migration paths; final --reverify runs immediately before commit.
