# Gates: P2-2 consolidate Finance Overview loading

Scope: Preserve the exact tenant-scoped Finance Overview contract while reducing proven full-dataset transfer/client aggregation and broad duplicate realtime refresh work.

- [ ] G1: focused Finance Overview result, SQL-contract, authorization, and data-path tests pass
  CHECK: npm test -- --run src/lib/finance/overview.test.ts src/lib/finance/overview-snapshot-contract.test.ts src/components/finance/finance-master-view.test.tsx src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts
  EXPECT: /Test Files\s+7 passed/
  EVIDENCE: pending

- [ ] G2: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-2 typecheck passed"
  EXPECT: P2-2 typecheck passed
  EVIDENCE: pending

- [ ] G3: the full repository lint passes
  CHECK: npm run lint && echo "P2-2 lint passed"
  EXPECT: P2-2 lint passed
  EVIDENCE: pending

- [ ] G4: the final working-tree patch has no whitespace errors
  CHECK: git diff --check && echo "P2-2 diff check passed"
  EXPECT: P2-2 diff check passed
  EVIDENCE: pending

- [ ] G5: the staged P2-2 patch has no whitespace errors
  CHECK: git diff --cached --check && echo "P2-2 staged diff check passed"
  EXPECT: P2-2 staged diff check passed
  EVIDENCE: pending

- [ ] G6: current end-to-end request graph, row counts, payload bytes, client computation, sequencing, and realtime invalidation are measured from identical authenticated fixtures
  EVIDENCE: pending

- [ ] G7: the smallest implementation preserves totals, charts, recent rows, immutable purpose grouping, identity/detail behavior, date/timezone semantics, refunds, expenses, projections, staff/branch scoping, loading/error/empty states, and durable filters
  EVIDENCE: pending

- [ ] G8: any database change is a new idempotent migration after the latest, SECURITY INVOKER with fixed search_path and existing authenticated/viewer access, selected-account isolation, no service-role browser path, and verified live definition/ACL/RLS/advisors
  EVIDENCE: pending

- [ ] G9: live owner/viewer fixtures and negative wrong-account, non-member, archived-branch, empty-account, current/historical month, refund, expense, projection, grouping/order/limit probes preserve the old output contract
  EVIDENCE: pending

- [ ] G10: repeated warm before/after evidence compares identical output hashes, requests, rows/payload, execution time, buffers/reads/temp, and client recomputation/refetch behavior
  EVIDENCE: pending

- [ ] G11: changelog and roadmap record only shipped P2-2 and retain member payments/follow-up full-dataset reads and count paths as the next residual finding
  EVIDENCE: pending

- [ ] G12: four explicit review passes find no remaining correctness, integration, portability, performance, evidence, scope, authorization, or documentation defect
  EVIDENCE: pending

- [ ] G13: immediately before commit every runnable gate is reverified with --reverify, all reported figures are remeasured, and the staged patch contains only P2-2 files
  EVIDENCE: pending
