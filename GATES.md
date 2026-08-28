# Gates: P1-2 collapse All-members directory fan-out

OWNS: GATES.md, supabase/migrations/20260828210000_member_customer_directory_page.sql, src/components/members/members-table.tsx, src/lib/memberships/filters.ts, src/lib/memberships/filters.test.ts, src/lib/memberships/search.ts, src/lib/memberships/member-directory.ts, src/lib/memberships/member-directory-rpc.test.ts, src/lib/memberships/search.test.ts, docs/changelog.md, PRDs/roadmap.md

Scope: Preserve the All-members contract while replacing repeated expensive directory reads and client-side numeric lookup with one bounded, tenant-isolated SECURITY INVOKER database call.

- [x] G1: focused member-directory query, filter, sort, search, and regression tests pass
      CHECK: npm test -- --run src/lib/memberships/member-directory-rpc.test.ts src/lib/memberships/search.test.ts src/lib/memberships/filters.test.ts src/lib/memberships/customer-directory.test.ts src/components/members/members-table.test.tsx
      EXPECT: /Test Files\s+5 passed/
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  19:07:20 | Duration  139ms (transform 96ms, setup 0ms, import 182ms, tests 12ms, environment 0ms)

- [x] G2: the full TypeScript typecheck passes
      CHECK: npm run typecheck && echo "P1-2 typecheck passed"
      EXPECT: P1-2 typecheck passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P1-2 typecheck passed

- [x] G3: the full repository lint passes
      CHECK: npm run lint && echo "P1-2 lint passed"
      EXPECT: P1-2 lint passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-2 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G4: the final patch has no whitespace errors
      CHECK: git diff --check && echo "P1-2 diff check passed"
      EXPECT: P1-2 diff check passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-2 diff check passed

- [x] G5: the migration is latest, idempotent, SECURITY INVOKER, and the client has no directory select-star, exact-count fan-out, or full-directory numeric resolver
      CHECK: node -e "const fs=require('node:fs');const p='supabase/migrations/20260828210000_member_customer_directory_page.sql';const files=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();if(files.at(-1)!==p.split('/').at(-1))throw Error('migration is not latest');const sql=fs.readFileSync(p,'utf8');for(const s of ['CREATE OR REPLACE FUNCTION public.member_customer_directory_page(','SECURITY INVOKER','GRANT EXECUTE ON FUNCTION public.member_customer_directory_page'])if(!sql.includes(s))throw Error('missing '+s);if(/SECURITY\\s+DEFINER/i.test(sql))throw Error('security definer forbidden');const table=fs.readFileSync('src/components/members/members-table.tsx','utf8');if(table.includes(\"from('member_customer_directory')\")||table.includes('from(\\\"member_customer_directory\\\")'))throw Error('direct directory read remains');if(table.includes(\"count: 'exact'\")||table.includes('count: \\\"exact\\\"'))throw Error('exact count remains');const search=fs.readFileSync('src/lib/memberships/search.ts','utf8');if(search.includes(\"from('member_customer_directory')\")||search.includes('from(\\\"member_customer_directory\\\")'))throw Error('directory numeric resolver remains');console.log('P1-2 static contract passed')"
      EXPECT: P1-2 static contract passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-2 static contract passed

- [x] G6: live Supabase function signature, grants, SECURITY INVOKER context, fixed return shape, filters, errors, and tenant isolation are verified
      EVIDENCE: Production connector migration 20260828132439; pg_proc reports the exact 11-argument signature returning jsonb, stable volatility, prosecdef=false, empty search_path, owner postgres, and EXECUTE only for postgres/authenticated. The view remains security_invoker=true with its prior authenticated/service_role SELECT grants and no LATERAL. An unrelated authenticated UUID sees zero rows/counts/facets; the selected principal sees only account 50a9e8f9-d7e5-44d2-ba04-c367509b981e. RPC rows expose exactly the original 31 view keys/types. Invalid status input was rejected, and live source retains SQLSTATE 22004/22023 validation. Active/expired/frozen/cancelled/trial/service, fee, follow-up, churn, plan, numeric, and non-numeric probes all matched independent RLS-visible queries.

- [x] G7: authenticated live before/after measurements use identical tenant, filters, sort, page size, and cache-aware repetitions; row identities, total, and all facets match
      EVIDENCE: Same Production user/account, 2026-08-28, empty search/filters, expiry ASC, page 0, size 25. Before authenticated page plan: 1102.691 ms/13,524 hits; exact count: 192.907 ms/3,178 hits. Pre-change pg_stat means for the page plus three facet statements total 2491.898 ms (4 requests). After five warm authenticated RPC plans: 753.559/756.822/760.917/734.932/741.808 ms, mean 749.608 and median 753.559 (1 request; mean 69.9% lower), each 15,500 hits. The exact 25 contact IDs, total 281, and churn/fee/follow-up counts 0/3/1 matched; all six sort orders also matched direct queries.

- [x] G8: Supabase security/performance advisors and authenticated EXPLAIN verification reveal no P1-2 regression
      EVIDENCE: Post-migration Production security and performance advisors contain zero findings related to member_customer_directory or member_customer_directory_page. Authenticated EXPLAIN (ANALYZE, BUFFERS) completed on the direct view and RPC; the direct 25-row view improved from 1102.691 ms/13,524 hits to 738.808 ms/10,825 hits, and the one-call RPC completed repeatedly without temp-spill or authorization errors. No compute change was made.

- [x] G9: four unlazy review passes find no correctness, integration, portability, performance, evidence, scope, or authorization defect
  EVIDENCE: Pass 1 traced the old page/search/facet/select/export contract into one RPC and preserved the 31-column normalizer shape. Pass 2 removed dead customer-directory query helpers and corrected stale load-error state/comments. Pass 3 compared every supported sort plus status/plan/fee/churn/follow-up/search semantics against live independent RLS queries and reviewed the repeated plans. Pass 4 reviewed the formatted full diff for idempotency, invoker/grant/tenant boundaries, validation, pagination/export behavior, source-test coverage, documentation accuracy, and the strict P1-2 file scope; no defect remains.

- [x] G10: changelog and roadmap record only the shipped P1-2 fix
      EVIDENCE: docs/changelog.md and PRDs/roadmap.md record the one-call RLS-preserving directory snapshot, live connector version, matched behavior, measured delta, and P1-3 boundary; no unrelated roadmap item changed.

- [x] G11: immediately before commit all runnable gates are reverified, the approved commands are unchanged and understood, and the staged patch is exactly the P1-2 scope
      EVIDENCE: Immediately before staging, G1-G5 were re-run from their exact approved commands: five focused files passed, full typecheck passed, full lint passed, diff check passed, and the static migration/client regression contract passed. The staged diff check is clean and its exact 11 paths are the P1-2 ledger ownership set: ledger, changelog, roadmap, table, directory helper/test, retired directory-only filter/search helpers/tests, and the one new latest migration.
