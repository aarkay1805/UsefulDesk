# Gates: P2-9 Finance invoice ledger pagination

Scope: Replace the Finance Invoices full-month seven-request waterfall with one selected-branch, server-filtered/sorted/paginated invoice-ledger RPC while preserving listing, action, export, realtime, authorization, and accounting semantics.

- [x] G1: authenticated August baseline independently records request stages, row and byte transfer, UI/query/action/export/realtime dependencies, and warm database plan metrics before implementation
  EVIDENCE: selected branch 50a9e8f9 has 550 August invoices/281 memberships; seven requests across five stages transferred 2,205 rows and 1,759,482 database-JSON bytes (1,883,134 captured browser bytes before HTTP overhead). The broad invoice query planned in 9.439 ms and executed in 19.052 ms warm with 2,418 hits, zero reads/temp; invoice/action/export/realtime dependencies were enumerated before edits.

- [x] G2: the migration and TypeScript boundary enforce a bounded SECURITY INVOKER selected-account ledger with empty search_path, authenticated-only execute, input validation, exact rows/counts/facets/summary, explicit columns, page clamping, and no account-id parameter
  CHECK: npm test -- --run src/lib/finance/invoice-ledger-contract.test.ts src/lib/finance/invoices.test.ts && echo "P2-9 ledger contract passed"
  EXPECT: P2-9 ledger contract passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration  215ms (transform 61ms, setup 0ms, import 164ms, tests 5ms, environment 0ms) | P2-9 ledger contract passed

- [x] G3: Finance Invoices component tests prove all filters/sorts/queues, default order, 25-row server pages, clamping, empty/loading/error/retry, stale-request safety, detail/payment actions, and no full-month client filtering or pagination
  CHECK: npm test -- --run src/components/finance/finance-invoices.test.tsx src/components/finance/invoice-detail-actions.test.tsx && echo "P2-9 invoice UI passed"
  EXPECT: P2-9 invoice UI passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration  3.11s (transform 340ms, setup 0ms, import 2.78s, tests 979ms, environment 1.48s) | P2-9 invoice UI passed

- [x] G4: export tests prove complete filtered/sorted CSV parity across more than one bounded server page, correct termination, no duplicate/missing rows, and no restoration of a full browser listing dataset
  CHECK: npm test -- --run src/lib/finance/invoice-export.test.ts src/lib/finance/invoices.test.ts && echo "P2-9 invoice export passed"
  EXPECT: P2-9 invoice export passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration  199ms (transform 88ms, setup 0ms, import 255ms, tests 8ms, environment 0ms) | P2-9 invoice export passed

- [x] G5: relevant Finance realtime, auth/capability, selected-account, multi-branch, navigation, and invoice action/document/payment/refund suites remain green
  CHECK: npm test -- --run src/components/finance/finance-master-view.test.tsx src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts src/lib/members/member-purchase-navigation.test.ts src/lib/finance/views.test.ts src/components/finance/invoice-document-actions.test.tsx src/components/finance/payment-link-actions.test.tsx src/lib/finance/invoice-detail-presentation.test.ts && echo "P2-9 integration passed"
  EXPECT: P2-9 integration passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Duration  2.56s (transform 677ms, setup 0ms, import 3.55s, tests 1.09s, environment 756ms) | P2-9 integration passed

- [x] G6: the new idempotent migration is applied only through Supabase migration tooling and live verification proves signature, owner, volatility, invoker/search_path, ACL, RLS/policies, publications, advisors, role/account isolation, archived/empty behavior, and input SQLSTATEs
  EVIDENCE: four forward-only migrations applied through Supabase migration tooling. Live metadata: owner postgres, stable, security_definer=false, search_path="", authenticated execute only. All 12 reached tables retain RLS/policies and realtime publication; advisors report no function-specific finding. Owner/admin list+export, agent/viewer list only, non-member/wrong/archived denied 42501, empty account returns zero; invalid inputs return 22023 and missing today 22004.

- [x] G7: rollback-only multi-page fixtures prove before/after row hashes, order, totals, facets, summaries, filters, sorts, clamping, export, payment/refund/allocation semantics, role isolation, and zero fixture residue
  EVIDENCE: existing 550-row cohort plus rollback-only role/archive fixtures: old/new default-order hash 19e75e67862683b31ac0fb93c6ff277a, 550 distinct rows, zero export-detail mismatches, identical summary, all 18 sort directions and 12 positive/zero filter-search-queue cases matched, page 99 clamped to page 21. Two export pages [500,50] shared one token. Target branch remains active with its original single owner membership.

- [x] G8: authenticated after-measurement proves one listing request and one dependency stage transfer only the 25-row page plus exact metadata, with decisive row/byte/client-work reduction and recorded warm execution, hits, reads, and temp
  EVIDENCE: one RPC/one stage returns 25 rows plus exact metadata in 72,671 database-JSON bytes: 95.9% below the measured 1,759,482 bytes and 96.1% below the supplied 1,883,134-byte capture. Warm plan 0.021 ms, execution 115.786 ms, 6,190 hits, zero reads/temp. Extra single-statement database work is decisively outweighed by eliminating six requests, four dependency stages, 2,180 transferred rows, and full-month browser work.

- [x] G9: changelog and roadmap record only P2-9's verified outcome, measurements, action-detail/export/realtime behavior, security boundary, remaining risk, and final stop recommendation
  EVIDENCE: appended P2-9-only entries record the invoker RPC/migrations, 25-row listing, bounded snapshot export, lazy action detail, retained realtime inputs, removed pricing-option refresh, payload result, DB tradeoff, no new index/compute, and stop recommendation.

- [x] G10: four review passes find no remaining domain/accounting, UI/integration, security/tenant, performance/index/evidence, portability, documentation, shared-checkout, or scope defect
  EVIDENCE: pass 1 reconciled all 550 invoice/payment/refund/allocation export rows, summaries, hashes, filters, and sorts; pass 2 passed 49 ledger/UI tests and 182 realtime/auth/action tests after correcting a stale-test harness; pass 3 rechecked live signature/ACL/RLS/publications/roles/SQLSTATEs/residue; pass 4 rechecked query/index evidence, no select-star/account parameter/definer/service-role path, docs, whitespace, shared-checkout hashes, and P2-9-only scope. No new index is supported by the zero-read plan and existing account-issued/join indexes.

- [x] G11: full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-9 typecheck passed"
  EXPECT: P2-9 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-9 typecheck passed

- [x] G12: full repository lint passes
  CHECK: npm run lint && echo "P2-9 lint passed"
  EXPECT: P2-9 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-9 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G13: working-tree and staged patches contain no whitespace errors
  CHECK: git diff --check && git diff --cached --check && echo "P2-9 diff checks passed"
  EXPECT: P2-9 diff checks passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-9 diff checks passed

- [x] G14: final --reverify passes every runnable gate, all figures are remeasured, the staged patch contains only P2-9 paths/hunks, and every user-owned baseline hunk/path remains unstaged and unmodified by P2-9
  EVIDENCE: final gate-check --reverify reruns all seven approved commands. The staged patch contains only the P2-9 ledger, UI/data/realtime tests, four forward migrations, GATES ledger, and two isolated documentation additions; recorded user-owned source paths and documentation hunks remain unstaged. A concurrent owner changed invoice-detail-dialog and removed the preview path; both external changes remain untouched and unstaged.
