# Gates: P2-1 reduce dashboard action snapshot work

Scope: Preserve the exact tenant-scoped dashboard action JSON contract while eliminating evidenced repeated computation in the smallest safe SECURITY INVOKER migration.

- [x] G1: focused dashboard SQL-contract, result-shape, ordering, limit, empty-result, and authorization tests pass
  CHECK: npm test -- --run src/lib/dashboard/action-snapshot-rpc.test.ts src/lib/dashboard/action-snapshot.test.ts src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts
  EXPECT: /Test Files\s+6 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  21:31:46 | Duration  184ms (transform 157ms, setup 0ms, import 342ms, tests 21ms, environment 0ms)

- [x] G2: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-1 typecheck passed"
  EXPECT: P2-1 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-1 typecheck passed

- [x] G3: the full repository lint passes
  CHECK: npm run lint && echo "P2-1 lint passed"
  EXPECT: P2-1 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-1 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G4: the final working-tree patch has no whitespace errors
  CHECK: git diff --check && echo "P2-1 diff check passed"
  EXPECT: P2-1 diff check passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-1 diff check passed

- [x] G5: the staged P2-1 patch has no whitespace errors
  CHECK: git diff --cached --check && echo "P2-1 staged diff check passed"
  EXPECT: P2-1 staged diff check passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-1 staged diff check passed

- [x] G6: repeated warm authenticated baseline and section-level EXPLAIN measurements identify the actual dominant internal work and retain an independently computed output hash
  EVIDENCE: Five fixed-argument warm owner plans averaged 402.003 ms with 153,733 shared hits, zero reads, and zero temp blocks; output hash was 497f1dbeb9d18e9eadee52d914e05081. The dues section alone measured 502.234 ms/148,586 hits while risk, collections, expiring count/preview, follow-ups, uncontacted, and attention were each 3.075-7.749 ms and at most 1,996 hits. Plan inspection showed invoice_line_balances rebuilt under 281 membership loops.

- [x] G7: one new idempotent migration after the current latest removes only evidenced repeated work while preserving SECURITY INVOKER, existing authenticated grants, fixed search_path, volatility, viewer access, selected-account isolation, timezone/today/now semantics, and all JSON defaults
  EVIDENCE: Migration 20260829020000 uses DROP POLICY IF EXISTS plus CREATE OR REPLACE VIEW, materializes the exact current-period projection once, and changes only membership_periods SELECT to the established row-bound initPlan helper. Production connector version 20260828155301 is live; pg_proc still shows the JSONB signature, stable/invoker, search_path="", postgres owner, and only postgres/authenticated EXECUTE. The view is security_invoker and its existing authenticated/service_role SELECT plus anon denial remain intact; live insert/update/delete policies retain their original role checks.

- [x] G8: live owner and viewer results match the before hash, rows, counts, ordering, limits, links, null/empty behavior, and archived-branch behavior; wrong-account and non-member probes remain denied
  EVIDENCE: Production owner and rollback-only viewer returned hash 497f1dbeb9d18e9eadee52d914e05081 with the same metric/count/attention values and row-id order. Current and reconstructed legacy membership_dues returned 281 rows, identical c710ead3eb7c53c45c169992c1375b50 hashes, and zero EXCEPT differences. Wrong-selected-account, non-member, and rollback-archived contexts resolved no authorized account and saw zero tenant rows; headerless legacy fallback retained the populated hash. An owned empty branch returned the complete zero/[]/null-free success shape, p_limit=1 bounded every queue/staff list while retaining counts, and 0/9 were rejected with 22023. No application/UI source changed, so the hash-stable ids retain their existing derived action links.

- [x] G9: repeated warm after measurements improve the dominant section and whole RPC without disk/temp/caching sleight of hand, and advisors show no new dashboard regression
  EVIDENCE: The final five post-migration warm plans averaged 33.361 ms/6,938 hits (91.7% faster and 95.5% fewer hits), with zero shared reads and zero temp blocks; three dues probes averaged 11.024 ms/1,866 hits. Production advisors returned 75 security and 152 performance notices with zero dashboard_action_snapshot or membership_dues finding; the three membership_periods matches are pre-existing unindexed-FK notices unrelated to this policy/view change.

- [x] G10: changelog and roadmap record only shipped P2-1 and retain finance overview full-dataset aggregation and broad invalidation as the next P2 finding
  EVIDENCE: Both documents record the migration, connector version, exact warm before/after figures, hash/row equivalence, preserved security boundary, and Finance Overview full-dataset aggregation plus broad invalidation as the next P2 finding.

- [x] G11: four explicit review passes find no remaining correctness, integration, portability, performance, evidence, scope, authorization, or documentation defect
  EVIDENCE: Pass 1 implemented the narrow view/policy change and focused contracts; pass 2 reconstructed the legacy dues query and proved all 281 rows/fields equal; pass 3 rechecked roles, tenant/header/archive boundaries, limits, ACLs, live definitions, advisors, and rollback fixtures; pass 4 added negative-check positive controls, audited docs/measurements/scope, and completed a clean six-file auth/dashboard suite, typecheck, lint, and diff check with no further change required.

- [x] G12: immediately before commit every runnable gate is reverified with --reverify, live numbers and invariants are rechecked, and the staged patch contains only P2-1 files
  EVIDENCE: Final live recheck retained output hash 497f1dbeb9d18e9eadee52d914e05081, errors=[], 281 dues rows, connector version 20260828155301, and a five-run 33.361 ms/6,938-hit mean with zero reads/temp blocks. The final --reverify reran and passed G1-G5; the staged patch lists only GATES.md, the migration, two focused tests, changelog, and roadmap.
