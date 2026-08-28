# Gates: P1-3 cache selected-account RLS checks

OWNS: GATES.md, supabase/migrations/20260828230000_cache_selected_account_rls_checks.sql, src/lib/auth/selected-account-rls-contract.test.ts, docs/changelog.md, PRDs/roadmap.md

Scope: Preserve UsefulDesk tenant and role authorization while caching row-independent selected-account access context once per statement for the measured hot listing SELECT-policy path.

- [x] G1: the P1-3 SQL contract and existing authorization regression tests pass
  CHECK: npm test -- --run src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts src/lib/auth/authored-content-ui-contract.test.ts src/lib/auth/roles.test.ts
  EXPECT: /Test Files\s+5 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  19:27:59 | Duration  143ms (transform 108ms, setup 0ms, import 178ms, tests 12ms, environment 0ms)

- [x] G2: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P1-3 typecheck passed"
  EXPECT: P1-3 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P1-3 typecheck passed

- [x] G3: the full repository lint passes
  CHECK: npm run lint && echo "P1-3 lint passed"
  EXPECT: P1-3 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-3 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G4: the final patch has no whitespace errors
  CHECK: git diff --check && echo "P1-3 diff check passed"
  EXPECT: P1-3 diff check passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-3 diff check passed

- [x] G5: the latest migration is idempotent, keeps explicit row-account comparison, and does not introduce table grants, definer listing APIs, or write-policy changes
  CHECK: node -e "const fs=require('node:fs');const p='supabase/migrations/20260828230000_cache_selected_account_rls_checks.sql';const files=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();if(files.at(-1)!==p.split('/').at(-1))throw Error('migration is not latest');const sql=fs.readFileSync(p,'utf8');for(const s of ['CREATE OR REPLACE FUNCTION private.authorized_selected_account_id(','account_id = (SELECT private.authorized_selected_account_id())','id = (SELECT private.authorized_selected_account_id())'])if(!sql.includes(s))throw Error('missing '+s);for(const bad of [/GRANT\s+(SELECT|ALL)\s+ON/i,/SECURITY\s+DEFINER[\s\S]*member_customer_directory_page/i,/CREATE\s+POLICY[\s\S]*FOR\s+(INSERT|UPDATE|DELETE)/i])if(bad.test(sql))throw Error('forbidden P1-3 scope');console.log('P1-3 static contract passed')"
  EXPECT: P1-3 static contract passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-3 static contract passed

- [x] G6: live helpers and optimized policies preserve owners, ACLs, search_path, volatility, RLS state, selected-account semantics, branch archival behavior, roles, and tenant isolation
  EVIDENCE: Production connector migration 20260828135003. pg_proc reports private.authorized_selected_account_id(account_role_enum) -> uuid, STABLE, SECURITY DEFINER, owner postgres, fixed search_path pg_catalog/public/private, and EXECUTE only for postgres/authenticated/service_role. Exact pg_policies and pg_get_expr output for all 15 replacements is a permissive row id/account_id equality to a SELECT initPlan, with each prior public/authenticated role retained and exactly one same-role SELECT policy. Every base table remains RLS enabled/not forced and member_customer_directory remains security_invoker=true. Live owner/admin/agent/viewer rollback probes matched the old role decisions; missing header selected the profile default, invalid header and wrong/non-member selection returned zero rows, archived rollback returned zero rows, and all correct selections returned zero cross-tenant rows. Authored/write policies and roles.ts were unchanged.

- [x] G7: identical authenticated before/after member-directory and representative-listing plans preserve identities, counts, and hashes while reducing repeated membership/account/profile work
  EVIDENCE: Same Production user/account, 2026-08-28, empty filters, expiry ASC, page 0, size 25. Five warm RPC plans improved from 654.017/731.441/665.772/671.842/686.755 ms (mean 681.965, median 671.842, 12,611 hits) to 42.664/44.741/43.056/43.169/46.559 ms (mean 44.038, median 43.169, 6,916 hits), 93.5% lower mean. Three direct default-page runs moved from a captured 118.881-143.377 ms range/1,715 hits to 8.368-8.963 ms/1,671 hits; direct count mean moved 127.879 -> 8.080 ms (1,715 -> 1,668 hits). The representative memberships+contacts+plans renewal listing mean moved 159.050 -> 3.995 ms (2,582 -> 642 hits). The full RPC hash ac2906fdeef3556db0fb47262e79f78c, row hash e64ec7286ef317ad1056d9763c67210d, page hash 125e15b9685855d24d8b838ccc7373ad, 281 total, and renewal hash 45bd0891661fc2dfd5a2d1ae1b4f213d all matched. Authenticated EXPLAIN shows initPlans/one-time filters and account-id index conditions instead of per-row is_account_member filters, with no reads, writes, or temp spill.

- [x] G8: Supabase security/performance advisors show no new P1-3 regression or unexpected multiple-policy widening
  EVIDENCE: Immediately before and after DDL, Production advisor totals were identical: security 75 (19 no-policy info, 7 search-path, 2 extension, 2 anon-definer, 44 authenticated-definer, 1 leaked-password) and performance 165 (67 unindexed-FK, 11 auth_rls_initplan, 45 unused-index, 42 multiple-permissive). There are zero findings naming the new helper or any of the 15 replaced policies, and live pg_policy grouping reports exactly one same-role SELECT policy per optimized table. No compute change occurred.

- [x] G9: all four unlazy review passes find no correctness, integration, portability, performance, evidence, scope, or authorization defect
  EVIDENCE: Pass 1 traced the invoker directory through accounts, contacts, memberships, plans, services, invoice/line/payment/allocation/refund/adjustment dependencies, and follow-ups, then replaced the complete measured 15-policy path. Pass 2 proved the helper's selected-header/profile fallback, membership role ordering, archived-branch check, and row equality against the old helper for owner/admin/agent/viewer and denial cases. Pass 3 reviewed repeated plans, exact result hashes, RLS/ACL/function catalogs, advisor deltas, one-policy counts, remaining row-dependent SELECT inventory, and 30 auth test files/244 tests; no correctness, widening, or evidence defect remained. Pass 4 reviewed the formatted full diff for migration ordering/idempotency, fixed search_path, grants, write-policy exclusion, documentation numbers, strict five-file scope, and P1-4 boundary; no further polish was warranted.

- [x] G10: changelog and roadmap record only the shipped P1-3 fix and retain P1-4 as the next finding
  EVIDENCE: docs/changelog.md and PRDs/roadmap.md record the 15-policy selected-account initPlan optimization, connector version, unchanged authorization surface, exact live measurements/hashes, deliberately unexpanded policy boundary, and P1-4 owner performance-report fan-out next; no unrelated roadmap item changed.

- [x] G11: immediately before commit every runnable gate is reverified, approvals remain understood, measurements are rechecked, and the staged patch is exactly the P1-3 ownership set
  EVIDENCE: G1-G5 were re-run from their exact approved commands immediately before staging: five focused files passed, full typecheck passed, full lint passed, diff check passed, and the static migration contract passed. A fresh authenticated five-run warm RPC recheck averaged 44.971 ms/6,916 hits after one discarded warm-up outlier; payload/row hashes and the 281 total still match, advisors remain exactly 75 security/165 performance, and the live catalog still reports one helper plus 15 optimized policies. The staged diff check is clean and its exact five paths are this ledger, changelog, roadmap, focused SQL-contract test, and latest migration. Concurrent unrelated unstaged popover/resolvable-action/preview changes appeared after the initially clean checkout and remain untouched and excluded.
