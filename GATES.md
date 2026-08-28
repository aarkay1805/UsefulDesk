# Gates: P2-8 Performance report exact-key cache reuse

Scope: Reuse fresh, exact, user/account/input-scoped Performance snapshots across report lifecycles while deduplicating in-flight loads, bounding memory, and preserving explicit refresh, freshness, output, authorization, and navigation behavior.

- [ ] G1: deterministic pre-fix lifecycle instrumentation proves the residual duplicate RPC counts for first load, completed revisit, same-key rerender, rapid A→B→A, Retry, input changes, Strict Mode/remount, and unmount
  EVIDENCE: pending

- [ ] G2: focused cache and React lifecycle tests prove first load, exact completed hit, in-flight dedupe, explicit refresh bypass, TTL expiry/invalidation, normalized keys, user/account isolation, A→B→A ordering, bounded eviction, Strict Mode/remount reuse, and unmount cleanup
  CHECK: npm test -- --run src/components/reports/owner-reports-cache.test.ts src/components/reports/owner-reports-view.lifecycle.test.tsx
  EXPECT: /Test Files\s+2 passed/
  EVIDENCE: pending

- [ ] G3: report snapshot normalization, output contracts, staff/date/timezone semantics, and consolidated RPC contract remain unchanged
  CHECK: npm test -- --run src/lib/reports/reporting.test.ts src/lib/reports/branch-performance-snapshot-contract.test.ts
  EXPECT: /Test Files\s+2 passed/
  EVIDENCE: pending

- [ ] G4: relevant auth, selected-account, branch isolation, navigation, and report-route suites remain green
  CHECK: npm test -- --run src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts src/lib/members/member-purchase-navigation.test.ts src/app/'(dashboard)'/reports/page.test.tsx
  EXPECT: /Test Files\s+6 passed/
  EVIDENCE: pending

- [ ] G5: full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-8 typecheck passed"
  EXPECT: P2-8 typecheck passed
  EVIDENCE: pending

- [ ] G6: full repository lint passes
  CHECK: npm run lint && echo "P2-8 lint passed"
  EXPECT: P2-8 lint passed
  EVIDENCE: pending

- [ ] G7: working-tree and staged patches contain no whitespace errors
  CHECK: git diff --check && git diff --cached --check && echo "P2-8 diff checks passed"
  EXPECT: P2-8 diff checks passed
  EVIDENCE: pending

- [ ] G8: before/after request counts prove fresh completed and in-flight exact-key reuse eliminates redundant snapshot RPCs without changing loading behavior or explicit Retry
  EVIDENCE: pending

- [ ] G9: freshness, security, and lifecycle review proves conservative invalidation, no cross-user/account/key reuse, bounded memory, stale-response safety, and no RLS/database/compute change
  EVIDENCE: pending

- [ ] G10: changelog and roadmap record only the verified P2-8 outcome, cache tradeoff, measurements, and next evidenced residual
  EVIDENCE: pending

- [ ] G11: four explicit review passes find no remaining correctness, integration, portability, performance/evidence, authorization, documentation, dirty-tree, or scope defect
  EVIDENCE: pending

- [ ] G12: final --reverify passes every runnable gate, figures and output equality are remeasured, the staged patch contains only P2-8 paths/hunks, and all six user-owned dirty files remain unstaged and byte-identical to the recorded baseline
  EVIDENCE: pending
