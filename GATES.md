# Gates: P2-3 member listing performance

Scope: Identify and fix exactly one highest-impact member payment or follow-up listing path without changing its product, financial, localization, or authorization contract.

- [x] G1: every member-facing payment, invoice/dues, follow-up, note/history listing and summary path is inventoried, measured, and the single selected P2-3 slice is justified against the deferred alternative
  EVIDENCE: The default Payments tab had two independently mounted loaders: payments-table fetched every non-cancelled membership with full contact/plan plus all positive dues, while payment-summary-tiles fetched the paid summary window plus the same dues again. Member detail loads one membership, 20 attendance rows, all membership-period invoices/services/invoice balances, then invoice lines; Record payment loads one due; Bulk record loads two id-bounded selected-member datasets, including explicit select-all only on user request. ContactNotesThread loads all notes plus follow-ups for one contact; MemberCommunication loads one conversation then 50 templates; the service-customer sheet loads one contact's services/invoices. Follow-up Lists pages rows but performs the page's exact count plus four exact facet counts (and a numeric-search membership resolution), with explicit select-all separately id-only. Live default Payments was four requests/314 rows/632,733 bytes for three dues; Follow-ups was five requests but only one open member row, so Payments is the coherent higher-impact P2-3 slice and Follow-ups is deferred.

- [x] G2: focused selected-slice result, pagination/count, data-path, and UI behavior tests pass
  CHECK: npm test -- --run src/components/members/payments-table.test.tsx src/lib/memberships/payment-dues.test.ts src/lib/memberships/member-payment-dues-rpc.test.ts src/lib/memberships/dues.test.ts src/lib/memberships/search.test.ts
  EXPECT: /Test Files\s+5 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  22:50:54 | Duration  1.31s (transform 153ms, setup 0ms, import 741ms, tests 127ms, environment 548ms)

- [x] G3: focused authorization and selected-account regression tests pass
  CHECK: npm test -- --run src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts
  EXPECT: /Test Files\s+4 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  22:50:56 | Duration  146ms (transform 68ms, setup 0ms, import 179ms, tests 10ms, environment 0ms)

- [x] G4: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-3 typecheck passed"
  EXPECT: P2-3 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-3 typecheck passed

- [x] G5: the full repository lint passes
  CHECK: npm run lint && echo "P2-3 lint passed"
  EXPECT: P2-3 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-3 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G6: the working-tree and staged patches contain only P2-3 files and have no whitespace errors
  CHECK: git diff --check && git diff --cached --check && echo "P2-3 diff checks passed"
  EXPECT: P2-3 diff checks passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-3 diff checks passed

- [x] G7: safely bounded authenticated live profiling records requests, rows, payload, execution, buffers, reads, temp, output hashes, current scale, and common predicate/order index fit before and after
  EVIDENCE: Production fixture scale was 281 memberships, 550 payments, 556 invoices, 27 paid rows in the summary window, and three positive dues. Legacy payloads were 281/630,562 bytes memberships, 3/237 bytes dues twice, and 27/1,697 bytes payments: four requests, 314 rows, 632,733 bytes. The RPC is one request with three rendered rows and 7,020 bytes (98.9% lower). Final sequential warm legacy totals were 33.193/32.646/36.100/32.925/34.624 ms (mean 33.898), each 6,150 hits; RPC was 31.939/28.776/27.026/30.426/28.467 ms (mean 29.327), each 6,483 hits. Both had zero reads/temp. Payment range uses idx_payments_account_paid; dues uses account indexes/materialized ledger work and a 25 kB in-memory quicksort. Legacy/RPC row hash is 2d12e1f25f0e7de03e2e62fa5e6eaf83; full RPC hash is 3fb140591779820041e35a8a088841a4.

- [x] G8: identical owner/viewer outputs and negative wrong-account, non-member, archived-branch, empty-scope, boundary, ordering, total/count, filter, limit/page, and error probes preserve the selected listing contract
  EVIDENCE: Owner and rollback-only viewer returned identical full/row hashes 3fb140591779820041e35a8a088841a4 and 2d12e1f25f0e7de03e2e62fa5e6eaf83. Wrong selected account, random non-member, and rollback-only archived branch returned zero rows/counts/money; an authorized empty branch returned the complete empty shape. NULL date raises 22004; 201-char search, negative/oversize pages, multiple buckets, invalid sort and direction raise 22023. Name/member-ID/phone search, plan/overdue/due-today filters, exact total/facets, page 0/1/clamp, 2-row limit, and all five sorts in both directions matched legacy identities. Owner role and active branch state were verified restored after rollback probes.

- [x] G9: any database change is forward-only and idempotent, SECURITY INVOKER with fixed search_path and selected-account/RLS isolation, authenticated-only execution, and verified live signature, ACL, policies, grants, advisors, publication, and index state
  EVIDENCE: Forward-only migrations 20260829040000 and 20260829041000 were connector-applied as 20260828170652/170827; the second repairs SQL-expression qualification without editing applied history. Live signature is exact, stable, SECURITY INVOKER, postgres-owned, search_path="", with authenticated execute true and anon/service_role/PUBLIC false. No account-id input, service role, or cache exists. membership_dues is security_invoker; all nine source tables are RLS-enabled with selected-account read policies; four existing mutation dependencies remain published; fitted payment/membership/period indexes remain present. Security/performance advisors report zero member_payment_dues findings; pre-existing unrelated FK/index notices were not expanded. No compute setting changed.

- [x] G10: the implementation preserves exact page/sheet ordering, totals, filters, loading/empty/error states, member identity, locale/timezone/money semantics, financial correctness, capabilities, and refresh behavior while materially reducing proven work
  EVIDENCE: The shared snapshot returns the same full Membership/contact/plan row JSON and membership_dues collectible balances, paid-status gross collections, account-timezone day/week/month windows, outstanding total, plan options, urgency facets, exact filtered total, and deterministic legacy ordering. Legacy and RPC rows and summaries compared equal (today 0, week 84,700, month 238,321, outstanding 4,700). Existing URL view, 25-row pagination, filters, locale fmt.date/fmt.money, identity/avatar/actions, viewer affordances, loading/empty/two-error messages, mutation reload coalescing, and Realtime subscriptions are unchanged. One AbortController/sequence guard prevents stale lifecycle responses; React coverage proves initial and reload request counts and stale suppression.

- [x] G11: changelog and roadmap record only shipped P2-3 and name the unselected independent member listing path as the next residual finding
  EVIDENCE: docs/changelog.md and PRDs/roadmap.md record only P2-3, both forward migrations/connector versions, identical output and measured request/row/byte/plan evidence, and name member Follow-ups exact-count/facet fanout as the next residual.

- [x] G12: four explicit review passes find no remaining correctness, integration, portability, performance/evidence, authorization, documentation, or scope defect
  EVIDENCE: Pass 1 re-read component/client/SQL integration after the live portability repair and removed one unused type import; no remaining implementation defect. Pass 2 rechecked hashes, totals, every sort/filter/page/error boundary and added stale-response coverage; 28 focused tests pass. Pass 3 rechecked the live definition, invoker/ACL/RLS/selected-account matrix, publication/index state, migrations and advisors; no attributable defect. Pass 4 reviewed every changed/untracked path, docs and HEAD/origin scope: exactly 12 P2-3 paths on preserved 6b605da, with no concurrent or unrelated change.

- [x] G13: immediately before commit every runnable gate is reverified with --reverify, every reported figure is remeasured, and the staged patch contains only verified P2-3 files
  EVIDENCE: Final live remeasurement retained 281 memberships/550 payments/556 invoices/27 window payments/three dues, 314 legacy rows/632,733 bytes versus three RPC rows/7,020 bytes, equal row hash 2d12e1f25f0e7de03e2e62fa5e6eaf83, full RPC hash 3fb140591779820041e35a8a088841a4, and totals 0/84,700/238,321/4,700. Final five-run means are 33.898 ms/6,150 hits legacy and 29.327 ms/6,483 hits RPC with zero reads/temp. The exact 12-path P2-3 patch is staged from unchanged 6b605da; final --reverify runs immediately before commit.
