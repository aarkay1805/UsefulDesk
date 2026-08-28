# Gates: P2-6 Members deep-link lifecycle performance

Scope: Initialize the Members listing synchronously from durable App Router search params so only the requested lazy data-fetching child mounts, while preserving URL, history, branch, permission, loading, and Realtime behavior.

- [x] G1: the pre-fix Members URL/view lifecycle, every listing child fetch, lazy mount, stale-request behavior, page Realtime subscription, navigation/history path, and selected-branch dependency are traced with before counts
  EVIDENCE: at c20f905 the page committed local view='renewals', mounted the static RenewalActionLists, and started one 50-row memberships page read before the empty-dependency URL effect selected any non-Renewals deep link; the renewal load has a cancelled state-write guard but no AbortSignal, so the authenticated P2-5 browser observation's extra request was started=1, aborted=0, completed=1 while its result was ignored after unmount; the requested Attendance/Payments/Follow-ups lazy child then started its one bounded RPC, while All members starts its own directory/staff/plan/preferences/assignment dependencies; useReminderReadiness independently starts two shared reads; the page opens one member-lists channel with four table handlers and a 400 ms reload nonce; changeView mutates only view via replaceState, preserving branch/query state, and createClient resolves branch headers from the durable URL

- [x] G2: focused React/router lifecycle tests prove direct deep links mount and fetch only Attendance, Payments, Follow-ups, All members, or Renewals; missing/invalid values fall back to Renewals; in-app switching and back/forward mount only the URL-selected child; stale children unmount; and the page owns exactly one Realtime subscription
  CHECK: npm test -- --run 'src/app/(dashboard)/members/page.lifecycle.test.tsx' 'src/app/(dashboard)/members/page.performance.test.ts'
  EXPECT: /Test Files\s+2 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  00:21:53 | Duration  965ms (transform 57ms, setup 0ms, import 330ms, tests 110ms, environment 473ms)

- [x] G3: relevant existing member-list lifecycle, loading, stale-response, action, and data-path tests pass
  CHECK: npm test -- --run src/components/members/renewal-action-lists.test.tsx src/components/members/follow-up-lists.test.tsx src/components/members/payments-table.test.tsx src/components/members/members-table.test.tsx src/components/members/attendance-view.test.tsx
  EXPECT: /Test Files\s+5 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  00:21:55 | Duration  1.22s (transform 383ms, setup 0ms, import 1.95s, tests 793ms, environment 1.67s)

- [x] G4: relevant selected-account, branch, role, and member navigation authorization tests pass
  CHECK: npm test -- --run src/lib/auth/roles.test.ts src/lib/auth/selected-account-rls-contract.test.ts src/lib/auth/multi-branch-security-contract.test.ts src/lib/auth/branch-lifecycle-contract.test.ts src/lib/members/member-purchase-navigation.test.ts
  EXPECT: /Test Files\s+5 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=Start at  00:21:56 | Duration  123ms (transform 86ms, setup 0ms, import 149ms, tests 11ms, environment 0ms)

- [x] G5: the full TypeScript typecheck passes
  CHECK: npm run typecheck && echo "P2-6 typecheck passed"
  EXPECT: P2-6 typecheck passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=> tsc --noEmit | P2-6 typecheck passed

- [x] G6: the full repository lint passes
  CHECK: npm run lint && echo "P2-6 lint passed"
  EXPECT: P2-6 lint passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-6 lint passed | [BABEL] Note: The code generator has deoptimised the styling of /Users/rajatkashyap/Desktop/projects/UsefulDesk/.agents/skills/impeccable/scripts/live-browser.js as it exceeds the max of 500KB.

- [x] G7: working-tree and staged patches contain no whitespace errors
  CHECK: git diff --check && git diff --cached --check && echo "P2-6 diff checks passed"
  EXPECT: P2-6 diff checks passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=0e0bf4a400d3/23 entries; output=P2-6 diff checks passed

- [x] G8: before/after mount, request-start, completion/abort, loading-flash, and Realtime subscription/refetch counts are independently compared and prove the unintended default request is avoided
  EVIDENCE: for Attendance, Payments, Follow-ups, and All members direct links, listing children fall 2->1, unintended renewal reads 1->0, unintended started/aborted/completed counts fall 1/0/1->0/0/0, and sequential default/requested loading surfaces fall 2->1; Renewals remains 1 child/1 request; shared readiness reads remain 2 and page Realtime remains 1 subscription/4 handlers; the 11 focused tests record exactly one requested parent-boundary fetch probe for all five direct-link targets, no Renewals DOM on the four non-default links, one logical stale completion ignored after an intentional in-app switch, no refetch for an unrelated query-param change, and one channel removal on unmount, while the five existing child suites verify each real listing's own request contract

- [x] G9: exact routing and UX remain unchanged for canonical default, valid/invalid view, direct/in-app/back/forward navigation, selected branch and other query params, tab labels/order, permissions, lazy loading, loading/error states, focus/accessibility, and responsive behavior
  EVIDENCE: useSearchParams now selects only a validated MEMBER_VIEWS value during render and otherwise returns Renewals; native replaceState still changes only view, remains replace-not-push, and the lifecycle suite preserves branch/source params while exercising real jsdom back/forward entries with different branches; all seven labels/order, line Tabs, GatedButton capability checks, dynamic import boundaries/loaders, child loading/error/empty/action states, member-sheet/new-member URL behavior, focus semantics, classes, and responsive markup are byte-unchanged; no database, Supabase client, RLS, role, cache, or tenant code changed

- [x] G10: changelog and roadmap record only the verified P2-6 client outcome and identify the next evidenced residual priority
  EVIDENCE: docs/changelog.md and PRDs/roadmap.md record the render-time URL source, 2->1 listing mounts, avoided 50-row renewal read, exact routing/history/subscription preservation, client-only scope, focused lifecycle coverage, and the original audit's still-live broad Members Realtime nonce as the next residual; the changelog entry is separated from the concurrent preset-gallery hunk by the full unchanged P2-5 section

- [x] G11: four explicit review passes find no remaining correctness, integration, portability, performance/evidence, authorization, documentation, dirty-tree, or scope defect
  EVIDENCE: pass 1 traced c20f905's URL/effect/lazy-child/fetch/Realtime graph and implemented the complete render-time URL source plus direct-link matrix; pass 2 re-read routing and member-sheet integration as a domain expert, found the now-exposed set-state-in-effect lint defect, and replaced only that existing sheet synchronization with the repository's cancellable microtask pattern; pass 3 hunted performance/evidence/portability defects against bundled Next 16.3 and Context7 guidance, extended coverage for unrelated-param no-refetch and channel cleanup, and passed focused lint/typecheck plus 11 lifecycle, 22 member-list, and 93 auth/navigation tests; pass 4 rechecked exact UI/permission/branch/history semantics, documentation claims, whitespace, staged paths and both changelog hunks, preserving the five concurrently evolving preset-gallery files entirely unstaged; a final improvement pass found no remaining defect

- [x] G12: immediately before commit every runnable gate is reverified with --reverify, every reported figure is remeasured, the staged patch contains only P2-6 paths/hunks, and the original four plus the concurrently added fifth preset-gallery change remain unstaged and unmodified by P2-6
  EVIDENCE: final --reverify reran all six approved checks and passed the 2-file/11-test lifecycle suite, 5-file/22-test member-list suite, 5-file/93-test auth/navigation suite, full typecheck, full lint, and staged/working diff checks; fresh source and staged-diff review reconfirmed non-default listing mounts 2->1, extra renewal starts/aborts/completions 1/0/1->0/0/0, shared readiness 2->2, and page Realtime 1 channel/4 handlers->1/4; staged paths are exactly GATES.md, PRDs/roadmap.md, the separate P2-6 docs/changelog.md hunk, page.tsx, page.performance.test.ts, and page.lifecycle.test.tsx; unstaged work is exactly the concurrent preset changelog hunk plus template-manager.test.tsx, template-manager.tsx, template-contracts.ts, and template-presets.ts (176 insertions/99 deletions), with template-contracts.ts added by its owner while P2-6 was in progress
