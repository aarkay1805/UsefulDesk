# Data display latency audit — 8 September 2026

Audited checkout: `9144c02`. Scope: web entry, dashboard, member and contact details, inbox, finance/report loaders, broadcasts, shared option loaders; spot-check of native inbox loading. No application or database changes were made.

Evidence combines source tracing with read-only production `pg_stat_statements` and table statistics from the UsefulDesk project. Database statistics were observed at 13:30 UTC; the statistics reset timestamp is 29 June 2026. These are historical aggregates across deployments and callers, not a fresh browser benchmark. Maxima are not p95 values. Database execution time excludes network transfer, hydration, and rendering. No authenticated browser timing, load test, or query-plan benchmark was performed.

## Findings, in recommended order

### 1. P1 — A repeated access check blocks the entire app on cold entry

`src/lib/auth/dashboard-request-context.ts:72` awaits `requireProductAccess`, which returns an access snapshot. That result is discarded. `src/components/platform-access/product-access-gate.tsx:51` initializes its own snapshot to null, repeats `product_access_for_account` in its mount effect at line 89, and returns a full-screen loader at line 173 until it finishes. The gate wraps the dashboard shell and page content.

The cold path therefore includes server auth → bootstrap → server access check → browser hydration → browser access check → mounting client data loaders. Even already-streamed dashboard content is hidden behind the client gate. The extra check adds one browser/database round trip before operational screens can appear.

Recommendation: carry the server-validated, organization-bound access snapshot into the gate. Retain fail-closed behavior, expiry evaluation, and focus/periodic revalidation. Do not remove authorization or replace it with an unvalidated local cache.

### 2. P1 — Member identity waits for billing and other secondary data

`src/components/members/member-detail-view.tsx:397` first fetches the membership. At line 420 it then waits for attendance, period invoices, mandate, services, and generic billing together. Generic billing itself performs invoice headers followed by invoice lines at lines 449 and 461. Only at line 485 does it publish the membership to the UI; line 1027 keeps the profile in its loading state until that happens.

For a member with invoices, this puts three database dependency stages ahead of the first usable profile. The mandate query is described as noncritical in the code, but it still participates in the blocking `Promise.all`. A secondary query error also prevents the identity from appearing.

Recommendation: publish the authorized membership/contact result immediately, run independent reads concurrently, and give billing, visits, and services separate loading/error boundaries. Keep money and mandate-dependent actions blocked until their required authoritative data arrives. Paginate historical billing rather than loading all history just to open a profile.

### 3. P2 — Web inbox fetches complete lists and histories without application pagination

`src/components/inbox/conversation-list.tsx:114` fetches conversations with full contact/tag/membership joins. Filters and search run afterward in the browser at line 165. `src/components/inbox/message-thread.tsx:373` fetches every returned message column in ascending creation order, and line 414 loads all conversation reactions. Message groups are rendered in full at line 1252.

Cost grows with history: transfer, normalization, grouping, and DOM creation precede a usable thread. If the Data API imposes a row ceiling, the ascending message query can return older messages while omitting the newest; a server ceiling is not a pagination strategy. The live API ceiling was not verified.

Recommendation: load the newest bounded message page, fetch earlier pages on demand with stable timestamp/id cursors, page and filter conversations on the server, and request only displayed columns. Scope reaction hydration to loaded messages. Native inbox already uses repository page requests and offers a useful reference, though it was not comprehensively audited.

Current production table estimates are only 3 conversations and 47 messages. This is a code-confirmed scaling risk, not evidence that inbox volume explains today's production delay.

### 4. P2 — Returning to a tab hides an already-loaded conversation

`src/app/(dashboard)/inbox/page.tsx:365` increments the resync token on visibility restoration; reconnect also increments it. The thread fetch effect depends on that token, sets `loading=true` at `message-thread.tsx:371`, and line 1237 replaces the existing messages with a spinner. It repeats the full-history request described above.

Recommendation: distinguish initial/conversation-switch loading from same-conversation background refresh. Preserve existing messages during resync and reconcile fetched data with realtime events and pending sends. Switching to another conversation must still isolate the previous conversation's data.

### 5. P2 — Closed member dialogs start duplicate plan queries

Once a membership loads, `src/components/members/member-detail-view.tsx:1816` mounts two `RenewMembershipDialog` instances and one `ChangePlanDialog`, regardless of whether they are open. Each calls `useMembershipPlans(true)` unconditionally. `src/components/members/use-membership-plans.ts:21` fetches on each hook mount with no shared result or in-flight deduplication.

Opening a profile therefore starts three equivalent active-plan reads for closed dialogs. The member table separately loads all plans. `useAccountStaff` similarly owns independent per-consumer requests.

Recommendation: mount action dialogs on demand and share branch-keyed plan/staff results with explicit invalidation after changes. This removes redundant work; its visible timing impact was not measured.

### 6. P2 — Broadcast details wait for the entire recipient response

`src/app/(dashboard)/broadcasts/[id]/page.tsx:169` fetches the broadcast, then line 178 fetches all returned recipients with full contacts. Loading clears only at line 191. Status filtering and recipient rendering happen entirely in memory at lines 199 and 520.

Recommendation: display the broadcast and its stored summary first. Fetch one recipient page independently with server-side status filtering and exact counts. Keep full export as a separate bounded page walk. The production recipient table currently has no rows, so this is a scaling risk rather than a measured current hotspot.

### 7. P2 — Opening the template picker adds a serial auth request

`src/components/inbox/template-picker.tsx:126` awaits `auth.getUser()` before querying approved templates at line 140, on every opening. The authenticated dashboard already provides user/account context, and the template read remains protected by RLS.

Recommendation: use established authenticated context for the UI precondition, keep authorization on the data/send paths, and deduplicate branch-scoped template reads. Template selection may legitimately need further member/invoice context; load those prerequisites independently where possible.

## Observed database execution history

These are representative PostgREST query entries, not totals grouped across all equivalent queries. Statement IDs allow a later audit to identify the same entries. Historical timings can include earlier function/view implementations.

| Read | Calls | Mean | Recorded maximum | Statement ID |
| --- | ---: | ---: | ---: | --- |
| Member period invoices by membership | 392 | 196.17 ms | 2,451.09 ms | `3144293551667194399` |
| Invoice balances by membership | 256 | 212.65 ms | 2,679.57 ms | `-5649508091726032130` |
| Equivalent membership invoice read, separate entry | 136 | 174.92 ms | 1,805.64 ms | `-3881974021333400497` |
| Invoice lines for a set of invoices | 392 | 103.41 ms | 1,278.71 ms | `8075513604804203851` |
| Dashboard action snapshot | 1,100 | 172.39 ms | 4,374.22 ms | `380877023080580179` |
| Finance overview snapshot | 41 | 149.59 ms | 348.07 ms | `3277943148227710076` |
| Branch performance snapshot | 17 | 311.82 ms | 764.15 ms | `7464315011769788355` |
| Lead listing snapshot | 76 | 49.18 ms | 256.44 ms | `2711028878558371005` |
| Product access check | 1,413 | 15.17 ms | 208.24 ms | `-1571259702897088721` |

Invoice balances and period invoices both derive from the invoice-line balance model. The member profile reads the period view, invoice view, and line view in one opening, repeating related aggregation work. The SQL definitions contain grouped payments/refunds/credits/adjustments. This makes them a query-plan investigation target; it does not prove a missing index or a particular scan strategy. Do not sum unrelated historical means/maxima and call the result a measured page-load time.

The statistics also contain one-off manual/report investigation queries lasting tens of seconds. Those were excluded from the user-facing request comparison.

## Existing improvements and remaining measurement gaps

- Dashboard auth is request-shared and bootstrapped into the browser. Dashboard action sections use one snapshot and Suspense; insights are deferred. The repeated product gate still delays visibility despite these improvements.
- Lead listing, finance overview, and branch reporting have consolidated snapshot loaders. Their historical measurements do not justify reverting those improvements.
- `vercel.json` specifies Singapore (`sin1`), matching the production database's Singapore region (`ap-southeast-1`). No configured application/database region mismatch was found; deployed function placement was not independently checked.
- `src/lib/dashboard/timing.ts` records auth, bootstrap, and action-snapshot stages, but not the complete browser interval until data becomes visible or the product-access stage.

Next validation should measure cold entry, member opening, conversation switching, and tab return under an authenticated representative account: time to first usable data, request dependency order, transferred bytes, long render tasks, and p50/p95 across repeated runs. Capture recent authenticated query plans for member billing before choosing database indexes or compute changes. Preserve tenant isolation and billing correctness throughout.

Recommended first implementation scope: findings 1 and 2. They directly delay core screens today; inbox pagination and duplicate-request cleanup follow. No implementation, migration, test run, or deployment was performed as part of this audit.
