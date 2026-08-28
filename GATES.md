# Gates: P1-4 consolidate branch performance snapshot

OWNS: GATES.md, supabase/migrations/20260828233000_consolidate_branch_performance_snapshot.sql, src/lib/reports/reporting.ts, src/lib/reports/reporting.test.ts, src/lib/reports/branch-performance-snapshot-contract.test.ts, src/components/reports/owner-reports-view.tsx, src/components/reports/owner-reports-cache.ts, src/components/reports/owner-reports-cache.test.ts, docs/changelog.md, PRDs/roadmap.md

Scope: Replace the Finance Performance seven-read fan-out with one invoker/RLS-preserving branch snapshot RPC that shares computation and suppresses network/database work for an already-cached month/staff key.

Baseline exclusions (pre-existing, unrelated, never read or touched): src/components/ui/popover.tsx, src/components/ui/resolvable-action.tsx, src/app/preview/resolvable-action/**

Concurrent exclusion discovered after the initial baseline (unrelated, never diffed or touched): docs/ui-patterns.md. The unrelated Resolvable action changelog hunk that arrived with it must remain unstaged while the P1-4 changelog hunk is staged selectively.

- [x] G1: focused SQL-contract, result-normalization, cache, report, and authorization tests pass
      CHECK: npm test -- --run src/lib/reports/branch-performance-snapshot-contract.test.ts src/lib/reports/reporting.test.ts src/components/reports/owner-reports-cache.test.ts src/lib/auth/multi-branch-security-contract.test.ts
      EXPECT: /Test Files\s+4 passed/
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  20:02:22 | Duration  235ms (transform 119ms, setup 0ms, import 238ms, tests 17ms, environment 0ms)

- [x] G2: the full TypeScript typecheck passes
      CHECK: npm run typecheck && echo "P1-4 typecheck passed"
      EXPECT: P1-4 typecheck passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P1-4 typecheck passed

- [x] G3: the full repository lint passes
      CHECK: npm run lint && echo "P1-4 lint passed"
      EXPECT: P1-4 lint passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-4 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G4: the final patch has no whitespace errors
      CHECK: git diff --check && echo "P1-4 diff check passed"
      EXPECT: P1-4 diff check passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-4 diff check passed

- [x] G5: the latest migration defines one idempotent invoker snapshot RPC with fixed search_path, explicit owner/branch isolation, shared materialized inputs, preserved ACLs, and no service-role or RLS weakening
      CHECK: node -e "const fs=require('node:fs');const p='supabase/migrations/20260828233000_consolidate_branch_performance_snapshot.sql';const files=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();if(files.at(-1)!==p.split('/').at(-1))throw Error('migration is not latest');const sql=fs.readFileSync(p,'utf8');for(const s of ['CREATE OR REPLACE FUNCTION public.selected_branch_performance_snapshot(','SECURITY INVOKER','SET search_path = \'\'','AS MATERIALIZED','GRANT EXECUTE ON FUNCTION public.selected_branch_performance_snapshot(','TO authenticated'])if(!sql.includes(s))throw Error('missing '+s);for(const bad of [/SECURITY\s+DEFINER/i,/TO\s+service_role/i,/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i,/CREATE\s+POLICY/i,/ALTER\s+POLICY/i,/CREATE\s+INDEX/i])if(bad.test(sql))throw Error('forbidden P1-4 scope');console.log('P1-4 SQL contract passed')"
      EXPECT: P1-4 SQL contract passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-4 SQL contract passed

- [x] G6: live migration preserves owner, ACL, invoker, search_path, volatility, RLS and selected-branch behavior for correct owner, wrong account/non-member, and outside-account staff inputs
      EVIDENCE: Applied only through Supabase migration tooling as live version 20260828141834. The live definition hash is 44143c36bc454232476329f62cf4e279; owner=postgres, volatility=stable, SECURITY INVOKER, search_path='', and ACL matches the existing report-function pattern. Every base table remains RLS-enabled. Authenticated assertions passed for the correct owner, 42501 on a wrong-account owner and non-member, and zero/null selected-branch output for a staff UUID outside the account.

- [x] G7: identical all-staff and staff-filter live inputs preserve every normalized report/ad/expense value and action/export payload, including zero/empty data
      EVIDENCE: Authenticated legacy-complete versus snapshot JSON comparisons were exact for all staff (both md5=30544b149d8aa4c6d710aa2c4006df27) and owner staff filter (both md5=2d7b8c3c68264381141c968187d07f0d), with individual equality checks for metrics, attention, trend, plans/options, source labels/revenue, payment and collection methods, average sale, ads, and expenses. Empty-account checks preserved the zero/null/empty shapes. The component diff is confined to loading/cache code, so existing action and CSV-export consumers remain byte-identical; normalization tests cover their complete input payload.

- [x] G8: identical authenticated warm measurements show one database request with lower time and shared-buffer work than the seven-read baseline
      EVIDENCE: Post-P1-3 authenticated Aug-2026 all-staff baseline, five warm page-equivalent runs: 633.857 ms and 154,295 shared hits mean, seven database reads. Snapshot five-run mean: 559.005 ms and 151,171 hits, one read (11.8% time and 2.0% buffer reduction). Staff baseline: 612.745 ms and 152,446 hits across five reads; snapshot: 562.726 ms and 149,599 hits in one read (8.2% and 1.9% reductions). Final recheck retained the exact value hashes; a fresh warm plan was 623.732 ms/156,800 hits, consistent with per-run Nano variance and without changing the repeated-run comparison.

- [x] G9: an already-loaded month/staff key causes no network/database request while explicit retry still refreshes it
      EVIDENCE: Cache tests prove exact account/timezone/month/staff hits return needsPerformanceSnapshot=false, each key dimension misses independently, the effect guard precedes fetchReport, and Retry still calls fetchReport explicitly. The normal loader contract contains exactly one snapshot RPC call.

- [x] G10: Supabase security/performance advisors show no new P1-4 regression
      EVIDENCE: Before and after advisor inventories are unchanged: 75 security findings and 165 performance findings, with zero finding mentioning selected_branch_performance_snapshot. Final advisor recheck again returned zero snapshot-function findings.

- [x] G11: all four unlazy review passes find no correctness, integration, portability, performance, evidence, scope, or authorization defect
      EVIDENCE: Pass 1 traced every legacy output to a shared snapshot slice and found no missing value. Pass 2 compared populated all-staff, staff-filter, and empty live results exactly and found no normalization/integration mismatch. Pass 3 reviewed invoker/RLS/ACL/search_path, tenant and staff isolation, query sharing, warm plans, pg_stat evidence, and advisors with no defect. Pass 4 reviewed cache/race/retry/error/export behavior, focused/full checks, documentation, diff scope, and concurrent exclusions with no defect.

- [x] G12: changelog and roadmap record only shipped P1-4 and retain P1-5 as the next finding
      EVIDENCE: docs/changelog.md records the shipped snapshot, migration, preserved semantics, measured 7-to-1 result, and rollout gotcha; PRDs/roadmap.md records the same maintenance shipment and names P1-5 leads request/count/client-sort fan-out next. The concurrent Resolvable-action changelog hunk is excluded from P1-4 staging.

- [x] G13: immediately before commit every runnable gate is reverified, approvals remain understood, measurements are rechecked, and the staged patch is exactly the P1-4 ownership set with baseline exclusions unstaged
      EVIDENCE: Reverification reran G1-G5 successfully after final formatting and staging; all approved commands and called scripts remain inspected and understood. The live all-staff/staff hashes rechecked as 30544b149d8aa4c6d710aa2c4006df27 and 2d7b8c3c68264381141c968187d07f0d, a fresh safe warm EXPLAIN completed, and both advisors still name no snapshot finding. The index contains exactly the ten P1-4-owned files, with only the unrelated changelog hunk, docs/ui-patterns.md, the three baseline UI paths, and their preview directory left unstaged/untracked.
