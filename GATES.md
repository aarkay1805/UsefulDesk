# Gates: P1-1 dashboard timezone catalog scan fix

OWNS: GATES.md, supabase/migrations/20260828200000_avoid_dashboard_timezone_catalog_scans.sql, src/lib/dashboard/action-snapshot-rpc.test.ts, src/lib/dashboard/insight-aggregates-rpc.test.ts, docs/changelog.md, PRDs/roadmap.md

Scope: Remove repeated pg_timezone_names scans from exactly the three dashboard RPCs while preserving their public contracts, security, tenant isolation, and live behavior.

- [x] G1: focused dashboard RPC contract tests pass
  CHECK: npm test -- --run src/lib/dashboard/action-snapshot-rpc.test.ts src/lib/dashboard/insight-aggregates-rpc.test.ts
  EXPECT: /Test Files\s+2 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  18:38:04 | Duration  90ms (transform 22ms, setup 0ms, import 41ms, tests 4ms, environment 0ms)

- [x] G2: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P1-1 typecheck passed"
  EXPECT: P1-1 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P1-1 typecheck passed

- [x] G3: the full repository lint passes
  CHECK: npm run lint && echo "P1-1 lint passed"
  EXPECT: P1-1 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-1 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G4: the final patch has no whitespace errors
  CHECK: git diff --check && echo "P1-1 diff check passed"
  EXPECT: P1-1 diff check passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-1 diff check passed

- [x] G5: the new migration sorts after the prior latest migration and does not scan pg_timezone_names
  CHECK: node -e "const fs=require('node:fs');const p='supabase/migrations/20260828200000_avoid_dashboard_timezone_catalog_scans.sql';const files=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();if(files.at(-1)!==p.split('/').at(-1))throw Error('migration is not latest');const s=fs.readFileSync(p,'utf8');if(s.includes('pg_timezone_names'))throw Error('catalog scan remains');for(const n of ['dashboard_action_snapshot','dashboard_conversation_series','dashboard_lead_rating_inputs'])if(!s.includes('CREATE OR REPLACE FUNCTION public.'+n+'('))throw Error('missing '+n);console.log('P1-1 migration structure passed')"
  EXPECT: P1-1 migration structure passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-1 migration structure passed

- [x] G6: live Supabase definitions preserve signatures, return shapes, ownership, grants, tenant checks, and avoid pg_timezone_names
  EVIDENCE: Production catalog after connector migration 20260828130403 shows the same three signatures/results, STABLE SECURITY INVOKER, empty search_path, postgres owner, and exact pre-migration ACLs; each prosrc catalog_scan_position=0 and direct_resolver_position>0. All three authenticated invalid-zone probes retained SQLSTATE 22023 and their original messages. Security/performance advisors name none of the three functions.

- [x] G7: like-for-like authenticated live measurements show the catalog-scan fix without result regressions
  EVIDENCE: Authenticated Production EXPLAIN (ANALYZE, BUFFERS), same principal/account/arguments: action 1914.805 ms/15226 hits to 937.294 ms/15209; conversation 81.181 ms/1532 to 15.343 ms/1514; rating 242.173 ms/4580 to 159.048 ms/4562. Direct old catalog validation was 824.209 ms versus direct resolver 0.712 ms. Before/after hashes matched: action 497f1dbe..., conversation f758d7d4... (30 rows), rating c373dbc6... (3 rows).

- [x] G8: final scope and security review finds no unrelated changes or weakened authorization/RLS
  EVIDENCE: Final review on main found only this ledger, one new migration, two focused contract tests, changelog, and roadmap. Historical migrations and all callers are untouched. The new bodies were generated from the current definitions with only the three validation blocks replaced; static and live checks show no SECURITY DEFINER or p_account_id bypass, all functions remain STABLE SECURITY INVOKER with empty search_path, and live signatures/results/owners/ACLs match baseline. git diff --check passed.

- [x] G9: changelog and roadmap record only the shipped P1-1 fix
  EVIDENCE: docs/changelog.md and PRDs/roadmap.md each record the live migration, preserved contracts, and fixed-argument Production measurements; no unrelated roadmap state changed.
