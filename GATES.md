# Gates: P1-5 consolidate Leads listing and board reads

OWNS: GATES.md, supabase/migrations/20260829010000_consolidate_leads_listing.sql, src/app/(dashboard)/leads/page.tsx, src/lib/leads/listing.ts, src/lib/leads/listing.test.ts, src/lib/leads/listing-contract.test.ts, src/hooks/use-table-prefs.ts, src/hooks/use-table-prefs.test.ts, docs/changelog.md, PRDs/roadmap.md

Scope: Replace the Leads table/board count, filter-resolution, client-sort, and row-hydration fan-out with one selected-branch RLS-preserving invoker listing contract and a deduplicated lifecycle.

Baseline exclusions (pre-existing or concurrent, never modify/format/stage): docs/ui-patterns.md, src/components/ui/popover.tsx, src/components/ui/resolvable-action.tsx, src/app/preview/resolvable-action/**. Any unrelated docs/changelog.md hunk remains unstaged through partial/index-safe staging.

- [x] G1: focused SQL-contract, normalization, query-count, filter/sort parity, lifecycle/cache, quick-filter, and authorization tests pass
      CHECK: npm test -- --run src/lib/leads/listing-contract.test.ts src/lib/leads/listing.test.ts src/hooks/use-table-prefs.test.ts src/lib/leads/quick-filters.test.ts src/lib/auth/roles.test.ts
      EXPECT: /Test Files\s+5 passed/
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  20:50:09 | Duration  148ms (transform 116ms, setup 0ms, import 257ms, tests 14ms, environment 0ms)

- [x] G2: the full TypeScript typecheck passes
      CHECK: npm run typecheck && echo "P1-5 typecheck passed"
      EXPECT: P1-5 typecheck passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P1-5 typecheck passed

- [x] G3: the full repository lint passes
      CHECK: npm run lint && echo "P1-5 lint passed"
      EXPECT: P1-5 lint passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-5 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G4: the final working-tree patch has no whitespace errors
      CHECK: git diff --check && echo "P1-5 diff check passed"
      EXPECT: P1-5 diff check passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-5 diff check passed

- [x] G5: the staged P1-5 patch has no whitespace errors
      CHECK: git diff --cached --check && echo "P1-5 staged diff check passed"
      EXPECT: P1-5 staged diff check passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P1-5 staged diff check passed

- [x] G6: the latest idempotent SQL defines one stable SECURITY INVOKER listing RPC with fixed search_path, explicit selected-account validation, authenticated-only ACL, allowlisted modes/sorts, bounded ordinary table/board modes, and no service-role or policy weakening
      EVIDENCE: Live pg_proc shows stable invoker execution, search_path="", postgres ownership, and only postgres/authenticated EXECUTE; live pg_policies shows one selected-account SELECT plus equivalent split agent write policies for each child table; service_role EXECUTE failed with 42501.

- [x] G7: table and board use the same RPC contract for tag/custom intersection, all server/person/tag/custom sorts, exact total, four facets, and rendered tag/custom hydration without exact PostgREST counts, resolver fan-out, full-ID client sorting, or tag waterfalls
      EVIDENCE: Source review and listing-contract regression tests prove one coordinated active RPC, one shared SQL cohort, bounded page hydration, and absence of every named legacy fan-out token; table/board fixture identities matched.

- [x] G8: page/search/filter lifecycle tests prove a scope change reaches page zero without an old-page request, preferences/custom metadata gate the first list request, simultaneous identical loads share one RPC, and superseded different requests abort
      EVIDENCE: listing.test.ts and use-table-prefs.test.ts cover render-derived page zero, exact request-key visibility, readiness gating, one-call same-key coalescing, different-key abort, and microtask-delayed real-unmount cancellation without defeating Strict replay.

- [x] G9: live authenticated verification preserves selected-account viewer access, wrong-account/non-member denial, RLS, grants/ACL, owner/invoker/search_path/volatility, lead-origin and pending-assignment fields, empty/zero output, table/board limits, and rejects invalid parameters
      EVIDENCE: Production owner and rollback-only viewer calls succeeded; wrong selected account and non-member failed 42501; invalid mode/board 501/foreign custom sort failed 22023; service_role lacked EXECUTE; page 999 returned rows=[] with total=1; auto/pending fixture rows retained exact ownership fields.

- [x] G10: safe rollback fixtures and live rows prove all quick filters including NULL lead_status, multi-dimension tag/custom intersections, all sort families/directions/null placement, pagination, search, detailed filters, board/table parity, select-all identities, and CSV values
      EVIDENCE: Non-persisting Production fixture returned expected no-followup/unassigned/mine/new-today ids, one beta+Silver+score intersection, every allowlisted sort in both directions, page-two ids, equal board/table id order, equal ids/export order, hydrated tag/custom CSV values, and pending/auto fields; live combined search/owner/assignee/creator/new/source/gender/date/mine filters returned the sole expected lead. Numeric blanks were re-probed last in both directions after correction.

- [x] G11: identical safe warm measurements record before/after database-call count, execution time, shared-buffer hits, result identities/hashes, and relevant pg_stat history without claims based on the nearly empty live lead set
      EVIDENCE: Rollback-only 5,000-contact/1,000-membership five-run fixture: legacy seven-call mean 2,609.779 ms / 1,523,659 hits / hash 564674a9570ef0a9c487424886205620; RPC one-call mean 89.073 ms / 46,032 hits / hash 45c22d7c695ed7c194e54599de03f220. Historical anti-join pg_stat remains 6,157 calls at 72.470 ms and is not presented as post-P1-3 latency.

- [x] G12: Supabase security and performance advisors show no new P1-5 regression
      EVIDENCE: Post-migration Production advisors returned 75 security and 152 performance notices, with zero mentioning lead_listing_snapshot, contact_tags, contact_custom_values, or either new index; existing unrelated notices remain out of scope.

- [x] G13: changelog and roadmap record only shipped P1-5 and name re-running the P0/P1 performance audit as the next step
      EVIDENCE: P1-5 entries record the shipped contract, lifecycle behavior, live connector versions, measured rollback fixture, and next audit; the unrelated ResolvableAction changelog hunk remains outside P1-5 staging.

- [x] G14: all four unlazy review passes find no correctness, integration, portability, performance, evidence, scope, authorization, or preserved-dirty-path defect
      EVIDENCE: Pass 1 fixed numeric-null ordering and stale request-key visibility; pass 2 added real-unmount cancellation while retaining Strict replay coalescing; pass 3 rechecked SQL/RLS/ACL/performance/integration and fixture rollback; pass 4 added a positive control and wording polish, followed by a clean no-change review.

- [x] G15: immediately before commit every runnable gate is reverified with --reverify, measurements and live invariants are rechecked, and the staged patch contains only P1-5 files/hunks plus GATES.md
  EVIDENCE: First final --reverify reran and passed G1-G5; live recheck reconfirmed invoker/stable/search_path/ACL, two connector applications, four exact child-policy commands, zero fixture remnants, the authenticated one-row hash, and historical 6,157-call/72.470 ms evidence; cached diff lists only the ten P1-5 paths and the changelog's unrelated hunk remains unstaged.
