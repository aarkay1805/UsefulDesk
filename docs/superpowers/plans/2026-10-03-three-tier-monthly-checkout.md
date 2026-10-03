# Three-tier monthly first checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an actual organization owner buy a reviewed first monthly Starter, Growth or Ultimate term after the shared trial expires, with verified payment and preserved existing billing obligations.

**Architecture:** Add an immutable monthly catalog and operator-prepared offer sets, then freeze one selected offer into the existing customer review, quote, order, payment and grant flow. Dispatch explicitly between the original Starter contract and the new monthly contract at SQL and provider boundaries. Keep initiation and presentation independently closed while signed intake, settlement and GET-only recovery retain durable authority.

**Tech Stack:** Installed Next.js 16.3 App Router, React 19.2, TypeScript, Supabase/Postgres, existing Razorpay Orders adapter, Tailwind v4, Base UI masters, Vitest/Testing Library and disposable Docker PostgreSQL acceptance runners. No dependencies added.

**Spec:** `docs/superpowers/specs/2026-10-03-three-tier-monthly-checkout-design.md` (approved by the user before this chat's handoff; the preserved dated header predates that written-spec approval).

## Global Constraints

- “This is the web first-purchase flow for an expired, unsuspended trial.”
- “Active trials retain their full deadline and features.”
- “Paid customers, complimentary or manual access conversion, renewals, upgrades, downgrades, restarts, branch add-ons, annual pricing, automatic debit and native Checkout are outside this change.”
- Exact new catalog: Starter/79,900 paise/1 branch, Growth/149,900 paise/1 branch, Ultimate/399,900 paise/5 branches; INR; zero paid extra slots. `plans.ts` remains the application source.
- “Existing offers, preparations, reviews and quotes remain on the original Starter contract, which still requires Starter, INR 79,900 paise and its existing terms.”
- “No historical row is relabeled, repriced or upgraded.” The internal merchant/organization binding and Starter signup selection remain original-contract authority.
- One calendar month from the signed capture-event timestamp; 1,800-second quote; full first-payment refund through local calendar day 7 using the first payment's frozen timezone; once per organization.
- “Both HTTP and database boundaries require the actual organization owner.” Reuse `canManageSubscriptionBilling`, `requireSubscriptionOwner` and SQL organization-owner helpers.
- “Archiving is a separately confirmed action before offer approval and payment; it happens even if payment is later cancelled.” Preserve history and refresh preparation afterward.
- “New-contract opening requires the existing capability/branch-enforcement gate to be enabled and its readiness separately reviewed. This implementation does not enable that global gate.”
- New flags: `USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED` and `NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI`, both false/unset by default. Existing audit modes reject either activation.
- “Closing initiation prevents new payable checkout responses, including retries.” Retain signed intake, settlement, scope inventory, five-item bounded/leased recovery and GET-only ambiguous recovery.
- No server actions, Zod, inline role checks, manual locale formatting, UI master changes or Test archive endpoint reuse for Live. Read `docs/ui-patterns.md` completely and `docs/ux-copy.md` before UI edits.
- Every new definer is postgres-owned, fully qualified with `search_path=''`, explicitly revoked then granted only to its intended role. New private authority tables use RLS and no browser table access or service direct DML/TRUNCATE.
- All commands use `/Users/rajatkashyap/.codex/worktrees/b868/UsefulDesk` explicitly. Continue on `main`; do not modify the independent primary checkout or create a branch/worktree for this handoff.
- “Deliver source, closed migration, tests and documentation for review. Do not push or deploy this feature, install a Production migration, seed a genuine offer, charge a buyer, issue a refund or send a WhatsApp message during implementation.” Do not resume cloud staging or automation.

## Review Focus

1. A delayed preparation/quote response from another organization, roster or selected tier must not restore checked consent or replace the current selection. Pin in Task 7.
2. Two real organization owners can exist: an owner who did not author the frozen review cannot take over its payment by supplying a different actor. Pin in Tasks 3 and 5.
3. A database lock wait or provider call can cross quote expiry or containment; an order may exist, but no newly payable response may escape the final recheck. Pin in Tasks 4 and 8.
4. A buyer/setup change can race settlement or document issuance without changing the access version; source locks and frozen commercial facts must still detect it. Pin in Tasks 3, 6 and 8.
5. An identical old capture/document retry after full refund, expiry or later containment must preserve its committed result and original bytes without restoring access or consuming another number. Pin in Tasks 3, 6 and 8.

---

## Baseline and file ownership

Fresh baseline: clean `main`, HEAD `71924e28306e4b5b1fd034056787e482033cf68f`, six local commits ahead of `origin/main`. Previous verification was 4,452 tests in 539 files plus lint, types and build; it is historical evidence, not verification of this change.

Planning checked the installed Next.js route-handler and environment-variable guides in `node_modules/next/dist/docs/01-app/`, and fetched current Supabase RPC/function permission guidance with `ctx7` (`library` then `docs /supabase/supabase`). Keep authenticated owner/admin RPC calls distinct from service-only opening/financial RPCs. Public Next.js switches are build-time presentation values. Re-read the applicable installed guides before product edits; fetch current library documentation for any additional API/configuration decision as required by `AGENTS.md`.

Current source implementations to extend are `20261002080000_starter_customer_checkout_scope.sql`, `20261002111500_starter_customer_owner_review.sql`, `20261002124500_starter_subscription_documents.sql`, `20261002132000_starter_live_capability_activation.sql`, `20261002170000_starter_live_customer_renewals.sql` and `20261003003000_starter_signup_preparation.sql`. Do not edit those historical migrations. Put overrides in the new additive migration, with original-contract branches retained verbatim where possible.

`20261003003000_starter_signup_preparation.sql` is the latest filename observed while planning. Task 1 must inspect again before creating `supabase/migrations/20261003120000_subscription_monthly_first_checkout.sql`; if a newer filename exists, choose a timestamp after it and update this plan and runner manifest together. All later references to “the monthly migration” mean that one final filename. Tasks touching it execute serially.

| File family                                                                                                                        | Responsibility                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/subscriptions/monthly-contract.ts` and `.test.ts`                                                                         | Pure catalog identity and client/server response validation; no payment authority                                              |
| The monthly migration                                                                                                              | Immutable catalog/offer sets, version dispatch, owner review/opening, scoped archive, quote/commit/document/refund enforcement |
| `src/components/platform-access/monthly-offer-preparation.tsx` and `.test.tsx`                                                     | Existing MFA platform-admin preparation for an explicitly chosen organization; no opening control                              |
| `src/lib/subscriptions/live-scope.ts`, `live-provider.ts`, `live-orders.ts`, `live-flow.ts`, `live-refunds.ts`, `live-recovery.ts` | Durable, process-local provider authority and existing financial I/O/recovery                                                  |
| New `monthly-review`, `monthly-quotes`, `monthly-archive` routes                                                                   | Strict new-contract owner HTTP inputs, preserving old route shapes                                                             |
| `subscription-monthly-review.tsx` and `.test.tsx`                                                                                  | Prepared choices, offer-specific consent, separate archive action and existing payment presentation                            |
| Existing customer/Live review, plan cards, conversion dialog, product access gate, Checkout client                                 | Shared presentation reused with explicit original/monthly modes and preserved paid status                                      |
| `scripts/verify-subscription-monthly-first-checkout*`                                                                              | Local full-schema rollback/replay and independent-session acceptance; no .env or cloud target                                  |
| `docs/subscription-monthly-first-checkout.md` and affected subscription docs                                                       | Final source/evidence/containment record and rollout limits                                                                    |

### Shared interfaces decided here

- New immutable identity: `contractVersion: 'monthly_first_v1'`, `catalogVersion: 'monthly_inr_2026_10_v1'`; the original resolver projects `contractVersion: 'starter_v1'` with `catalogVersion: null`. Historical SQL rows retain NULL new identity columns.
- `MonthlyCatalogIdentity = { contractVersion: 'monthly_first_v1'; catalogVersion: 'monthly_inr_2026_10_v1'; tier: SubscriptionTier; amountMinor: number; currency: 'INR'; includedBranches: number; paidExtraBranchSlots: 0 }`.
- `monthlyCatalogOffer(tier: SubscriptionTier): Readonly<MonthlyCatalogIdentity>` derives price/branches from `SUBSCRIPTION_PLANS`. `isMonthlyCatalogIdentity(value: unknown): value is MonthlyCatalogIdentity` accepts only the exact three pairs and version identifiers.
- SQL private tables: `subscription_monthly_catalog`, `subscription_monthly_offer_sets`, `subscription_monthly_offers`. Catalog rows define price/branches only. Sets freeze organization, billing branch, merchant, actual owner, source access version, sorted exact active-account IDs, commercial/source fingerprints, operator, release/manifest and existing evidence references plus a separately reviewed `capability_readiness_reference`. Offers freeze selected catalog identity, existing `approval_id` and customer tax/terms/refund/document notes; no mutable price field is authoritative. The supported `documentTreatment` identifier is `usefulmade_unregistered_invoice_receipt_v1`, subject to the exact customer review; it is not general tax clearance.
- Add nullable `offer_contract_version`/`catalog_version` to the existing offer approvals, and nullable `monthly_offer_id` to existing preparations, customer reviews and quotes. New quote identity also carries `offer_contract_version`/`catalog_version`. Constraints/triggers/FKs enforce all copied fields against the immutable selected offer; NULL takes the original Starter branch. Do not backfill historical rows. Order, payment, term and grant identities resolve through their immutable request/quote link.
- Only an explicitly authorized operator can make an offer set available for owner review; `opening_enabled` defaults false and has one-way `opened_at` consumption. Preparation UI never toggles opening. Owner selection materializes the selected existing preparation/review/scope atomically, initially closed; the existing independent server opening transaction dispatches by `monthly_offer_id`.
- `MonthlyOfferSetPreview` includes set ID, organization/billing IDs, both versions, source snapshot token, exact active branches, selected/frozen offer ID when present, and three ordered choices. Each choice is either `{ available: true; offerId; identity: MonthlyCatalogIdentity; taxNote; termsNote; refundNote; documentTreatment }` or `{ available: false; tier; reason }`. An over-cap ready offer remains reviewable but cannot be approved until explicit archives and fresh preparation.
- Keep public previews bounded to customer facts; private evidence references, fingerprints, operator drafts and financial identifiers are not product copy.

## Task 1: Establish the catalog contract and closed schema structure

**Files:** Create `src/lib/subscriptions/monthly-contract.ts`, `src/lib/subscriptions/monthly-contract.test.ts`, the monthly migration, `scripts/verify-subscription-monthly-first-checkout.mjs` and `scripts/verify-subscription-monthly-first-checkout.sql`. Reuse `plans.ts` without changing packaging. Modify `scripts/production-env-readiness.mjs` and `.test.mjs`.

**Interfaces:** Consumes `SubscriptionTier`/`SUBSCRIPTION_PLANS`. Produces the catalog interfaces above, guarded immutable catalog rows, nullable identity columns, private offer-set/offer tables and a rollback-only runner using `createDisposablePostgres(container, { kind: 'full' })`.

- [ ] **Step 1: Write failing catalog, closed-default and audit tests.**

  ```ts
  expect(
    ['starter', 'growth', 'ultimate'].map(
      (t) => monthlyCatalogOffer(t as SubscriptionTier).amountMinor
    )
  ).toEqual([79900, 149900, 399900]);
  expect(
    ['starter', 'growth', 'ultimate'].map(
      (t) => monthlyCatalogOffer(t as SubscriptionTier).includedBranches
    )
  ).toEqual([1, 1, 5]);
  expect(
    isMonthlyCatalogIdentity({
      ...monthlyCatalogOffer('growth'),
      amountMinor: 79900,
    })
  ).toBe(false);
  expect(
    isMonthlyCatalogIdentity({
      ...monthlyCatalogOffer('ultimate'),
      paidExtraBranchSlots: 1,
    })
  ).toBe(false);
  expect(
    isMonthlyCatalogIdentity({
      ...monthlyCatalogOffer('starter'),
      catalogVersion: 'future',
    })
  ).toBe(false);
  ```

  SQL asserts catalog equality with the TypeScript values, zero offers/sets/reviews/opening authority, unchanged legacy-row fingerprints, NULL legacy identity fields, immutable catalog economics, RLS/grants/definer ownership and migration replay. Audit tests cover both new names in every current audit mode, false/unset acceptance and true/malformed rejection; add no opening mode. Register the public monthly flag explicitly because the existing generic audit matcher recognizes SaaS/Live/subscription prefixes and will not discover its monthly prefix.

- [ ] **Step 2: Run the failures.** `npx vitest run src/lib/subscriptions/monthly-contract.test.ts scripts/production-env-readiness.test.mjs`; run the new runner against the explicit local full container. Expected: missing export/schema or new audit flag assertion fails, not fixture/setup failure.
- [ ] **Step 3: Implement the pure catalog, migration structure and runner manifest.** Inspect the latest migration first. Seed only the three immutable catalog definitions. Reuse the current full-schema Live/customer/owner/documents/capability/renewal/preparation source order and baseline absence checks. Default all new authority closed; reject unknown versions rather than choosing the current catalog implicitly.
- [ ] **Step 4: Run targeted tests and the structure runner.** Expect all assertions to pass, a second migration replay to succeed, baseline settings/counts/fingerprints restored and no installed Live/monthly schema after rollback. Run `node --test scripts/production-env-readiness.test.mjs` if this script suite is not collected by Vitest.
- [ ] **Step 5: Commit these explicit files locally.** `git commit -m "feat: add closed monthly checkout contract"` after staging only Task 1 files.

## Task 2: Prepare exact versioned offer sets without opening payment

**Files:** Extend the monthly migration and SQL runner fixture. Create `src/components/platform-access/monthly-offer-preparation.tsx` and `.test.tsx`; modify `src/components/platform-access/platform-admin.tsx` and `.test.tsx` to mount it in the existing organization detail surface after MFA.

**Interfaces:** Consumes Task 1 catalog. Produces authenticated/MFA-admin RPCs `platform_admin_monthly_offer_context(p_organization_id UUID, p_billing_account_id UUID) RETURNS JSONB` and `platform_admin_prepare_monthly_offers(p_organization_id UUID, p_billing_account_id UUID, p_expected_snapshot TEXT, p_offers JSONB, p_evidence JSONB, p_facts_reviewed BOOLEAN) RETURNS JSONB`, plus owner RPC `subscription_monthly_offer_preview(p_organization_id UUID, p_billing_account_id UUID) RETURNS JSONB`. Component signature: `MonthlyOfferPreparation({ organizationId }: { organizationId: string })`.

- [ ] **Step 1: Add failing preparation tests.** SQL cases assert all-three/subset sets, exact reviewed totals, no arbitrary tax/amount override, rejected duplicate tier/unknown evidence key, wrong branch/merchant, no buyer identity, missing capability-readiness reference, stale source and non-admin/non-MFA/service direct-call denial. Prepared sets create zero quotes/orders/owner approvals/grants and leave the full trial unchanged. Existing Starter signup selection creates zero monthly sets. UI tests assert unchecked “facts reviewed”, real tier-specific tax/terms fields, no invented references and no opening action.
- [ ] **Step 2: Run `npx vitest run src/components/platform-access/monthly-offer-preparation.test.tsx src/components/platform-access/platform-admin.test.tsx` and the monthly SQL runner.** Expect missing component/RPC or offer-freeze assertions to fail.
- [ ] **Step 3: Implement source-snapshot preparation and customer preview.** Reuse the current evidence-key meanings and private buyer/setup source checks, with bounded per-offer records and compare-and-check source token. Lock the organization and commercial sources in the established NOWAIT/retryable-`40001` pattern. Explicitly supersede an unconsumed stale set by revoking it and preparing fresh immutable rows; refuse replacement after a selected review/quote/order obligation exists. Operator preparation may precede natural expiry, but owner review/opening/payment require expiry. Opening eligibility requires the separately enabled `capabilities_enabled` gate and reviewed readiness. Preview exposes unavailable reasons, not a generated payable offer. Mount preparation for an explicitly selected organization; never widen the Starter automatic selector.
- [ ] **Step 4: Run Task 2 tests and original `starter-signup-queue`/platform-admin tests.** SQL must prove original work/preparation is untouched, missing/incomplete offers stay unavailable, unchanged natural expiry does not reset the trial, source changes require fresh preparation and all opening booleans remain false.
- [ ] **Step 5: Commit locally.** `git commit -m "feat: prepare reviewed monthly tier offers"` with only Task 2 files.

## Task 3: Freeze owner selection and enforce quote, roster and settlement authority

**Files:** Extend the monthly migration and `scripts/verify-subscription-monthly-first-checkout.sql`.

**Interfaces:** Consumes immutable sets/offers. Produces `subscription_approve_monthly_review(p_offer_set_id UUID, p_offer_id UUID, p_seen_amount_minor BIGINT, p_terms_accepted BOOLEAN) RETURNS JSONB`, `subscription_archive_monthly_branches(p_offer_set_id UUID, p_account_ids UUID[]) RETURNS JSONB` and `subscription_create_monthly_quote(p_request_id UUID, p_organization_id UUID, p_billing_account_id UUID, p_actor_user_id UUID, p_review_id UUID, p_offer_id UUID, p_seen_amount_minor BIGINT, p_provider_merchant_id TEXT) RETURNS JSONB`. Preserve exact signatures of existing `subscription_open_reviewed_customer_scope`, `subscription_claim_live_order`, `subscription_bind_live_order`, `subscription_commit_live_initial_payment`, replay/intake/inventory RPCs. Add monthly identity fields to their new-contract projections, not browser financial write access.

- [ ] **Step 1: Write failing SQL transaction tests.** For each tier, assert actual-owner review creates a closed scope bound to one offer; separate service opening consumes one authorization; quote amount/term/roster/version match; one verified capture grants the selected tier/base capacity/calendar month. Assert no grant from authorized-only/browser facts. Test active trial, suspended/non-INR branch anywhere in the active roster, paid/manual/complimentary/Test-granted organizations, missing capability gate and extra-slot requests are refused.

  Test another tenant/admin/agent/viewer and a second owner who did not author the review. After quote binding, a changed offer/tier/amount/request payload fails. An expired quote with no order can be replaced only for the same selected contract after all current checks; an ambiguous existing order prevents replacement. For each tier, assert the account access/capability snapshot equals `SUBSCRIPTION_PLANS[tier].capabilities` and the SQL capability predicate enforces that matrix. Growth/Ultimate entitlement cannot satisfy a missing gym merchant/mandate readiness prerequisite.

  Archive tests cover exact distinct same-organization active IDs, no billing-branch/all-branch archive, wrong set/owner and history preservation. The archived result changes the roster/source token and invalidates the old preparation; payment cancellation does not undo it. New source/owner/access/roster changes at quote, claim and commit are detected. Identical committed capture replay after refund remains verified without access restoration; conflicting/late/revoked-source capture becomes a durable owned review hold.

- [ ] **Step 2: Run the monthly SQL runner.** Expected: missing functions/version-aware guards or exact settlement assertions fail; original fixtures still pass before the new cases.
- [ ] **Step 3: Implement new-contract SQL dispatch.** Update original Starter guard/preparation/review/settings/quote-economics boundaries through additive overrides. Validate complete immutable identity, current owner and authored owner, expired source access, exact sorted roster and all-INR branch eligibility under the organization lock. The scoped archive path performs the existing preservation behavior and marks its set stale; it does not reuse the Test gate. Freeze the selected offer once; return existing review only for identical retry. Reuse the existing two-transaction owner review/opening flow and prevent reopening after containment. Apply Starter 7/3/1-after-09:00 reset only after its existing owner acknowledgement; preserve eligible custom schedules for Growth/Ultimate.

  Quote/claim/settlement must recheck commercial source fingerprints and readiness, not only access version. Capture replays are checked before mutable authority. Changed-source captures persist canonical payment/exception holds instead of triggering a guard error that recovery repeats forever. Keep request and provider order identity immutable; preserve original Starter renewal dispatch and explicitly refuse renewal for `monthly_first_v1`, including its Starter choice. Keep existing history, receipt listener and recovery leases/bounds.

- [ ] **Step 4: Run monthly SQL plus original pilot/customer/preparation/renewal fixtures against the new migration.** Expect correct grants/holds and unchanged original/gym fingerprints, no new renewals or slots, and restored closed baseline after rollback.
- [ ] **Step 5: Commit locally.** `git commit -m "feat: enforce reviewed monthly checkout transactions"` with the migration and SQL fixture only.

## Task 4: Bind provider authority to durable version and tier economics

**Files:** Modify `src/lib/subscriptions/live-scope.ts`, `live-provider.ts`, `live-orders.ts`, `live-flow.ts`, `live-recovery.ts` and related `.test.ts` files, including `live-customer-checkout.test.ts`. Add `src/lib/subscriptions/live-monthly-checkout.test.ts`. Extend monthly RPC projections in the migration as needed.

**Interfaces:** Extend frozen `LiveProviderAuthority` with `contractVersion`, `catalogVersion`, `catalogTier` and `monthlyOfferId`; original scope projects `'starter_v1'`, NULL catalog/offer and Starter/79900. Preserve `resolveLiveProviderAuthority(identity, config, admin)` and its WeakSet anti-forgery boundary. Add `liveMonthlyCheckoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean`, requiring existing customer scope/checkout support and the new literal server flag. Preserve provider adapter/settlement/recovery public signatures.

- [ ] **Step 1: Add failing adapter tests.**

  ```ts
  // Table-driven durable-RPC fixtures: valid original identity and all three monthly identities.
  expect(await resolveFor('monthly_first_v1', 'growth', 149900)).toMatchObject({
    catalogTier: 'growth',
    amountMinor: 149900,
  });
  await expect(
    resolveFor('monthly_first_v1', 'growth', 79900)
  ).rejects.toThrow();
  await expect(resolveFor('unknown', 'starter', 79900)).rejects.toThrow();
  ```

  Define `resolveFor` as a local test fixture using the actual resolver and mocked service RPC. Reject missing version/tier/offer, cloned/forged authorities, foreign merchant/org/request, caller economics different from authority, malformed recovery entries and gym metadata. Assert one durable claim precedes one POST; lost POST response is GET-only on retry; zero/multiple results need review. Test new flag closed before claim, during POST/GET and final recheck, including bound-order retries. Closing monthly UI/server initiation still permits signed capture and GET-only order/refund recovery for every monthly tier. Captured verification requires a fresh payment GET with captured status, exact payment/order/merchant/INR amount and signed event time; authorized status grants nothing.

- [ ] **Step 2: Run `npx vitest run src/lib/subscriptions/live-monthly-checkout.test.ts src/lib/subscriptions/live-customer-checkout.test.ts src/lib/subscriptions/live-provider.test.ts src/lib/subscriptions/live-orders.test.ts src/lib/subscriptions/live-flow.test.ts src/lib/subscriptions/live-recovery.test.ts`.** Expect failures on new authority validation/flag/amount cases.
- [ ] **Step 3: Implement explicit original/monthly authority dispatch.** Validate the immutable catalog pair through Task 1 helpers, then mint/freeze authority from the service RPC. Retain original internal identity checking and the original Starter renewal tuple. Validate authority against claim economics before any POST and against recheck before returning Checkout. Re-read the monthly initiation gate after provider I/O as well as database authority. New provider notes include contract version, catalog version, catalog tier and offer ID alongside existing request/organization notes; require those only for new-contract orders so original orders remain valid. Recovery rows carry durable contract identity and use the resolver; never widen the old 79900 condition to arbitrary amounts. Intake/recovery never depends on the monthly initiation/UI flags.
- [ ] **Step 4: Run the targeted suite and original refund/webhook/Checkout-client tests.** Expect the original one-POST, refund replay, recovery lease and shared-merchant routing cases to retain their outcomes. Mark all added provider fixtures synthetic.
- [ ] **Step 5: Commit locally.** `git commit -m "feat: bind monthly provider calls to reviewed contracts"` with explicit Task 4 files.

## Task 5: Add strict owner routes for monthly review, quotes and archives

**Files:** Create `src/app/api/subscriptions/monthly-review/route.ts` and `.test.ts`, `monthly-quotes/route.ts` and `.test.ts`, `monthly-archive/route.ts` and `.test.ts`. Modify `live-orders/route.ts` only as required to honor new durable authority; preserve original `live-customer-review`/`live-quotes` input shapes and tests.

**Interfaces:** Monthly review body: `{ organizationId, accountId, offerSetId, offerId, seenAmountMinor, termsAccepted: true }`; quote body: `{ organizationId, accountId, requestId, reviewId, offerId, seenAmountMinor }`; archive body: `{ organizationId, accountId, offerSetId, accountIds }`. No client actor/merchant/tier/extra-slot fields. Responses are `{ reviewed: true, reviewId, offerId }`, `{ quote }` with HTTP 202 and `{ result: { archived_count, preparation_stale: true } }`. Quoting/archiving use Task 3 RPCs; review commits the authenticated approval before separately calling `subscription_open_reviewed_customer_scope` with the actual authenticated user ID.

- [ ] **Step 1: Write failing route tests.** Assert both new/existing server gates, config, same-origin checks, rate limit and `requireSubscriptionOwner` occur before writes; no actor can be supplied. Test malformed/array/extra-key payload, duplicate/foreign archive IDs, wrong payable amount, unready/expired preparation, actual-owner/tenant mismatch, second-owner author mismatch and mismatched RPC output. A failure opening after saved review returns the existing support recovery message without pretending review/payment succeeded. Closed new gate returns 404 while original Starter routes still work under their own gates.
- [ ] **Step 2: Run `npx vitest run src/app/api/subscriptions/monthly-review/route.test.ts src/app/api/subscriptions/monthly-quotes/route.test.ts src/app/api/subscriptions/monthly-archive/route.test.ts`.** Expect missing-handler or strict-contract assertions to fail.
- [ ] **Step 3: Implement Node route handlers and exact response validation.** Reuse hand-rolled ID checks, CSRF, admin-action rate limits, error conversion, named owner helper and no-store responses. Validate `offerId`/identity returned by SQL, not a client catalog amount as authority. Map stale/closed/source-change errors to 409 with plain recovery copy; keep permission errors 403. Preserve ambiguous existing order and reviewed selection on retry.
- [ ] **Step 4: Run new routes plus original live customer review/quote/order/webhook/reconcile/recovery/refund route suites.** Expect zero provider I/O on invalid/closed requests and preserved original behavior. No test uses genuine provider credentials.
- [ ] **Step 5: Commit locally.** `git commit -m "feat: expose owner-scoped monthly checkout routes"` with Task 5 files.

## Task 6: Extend frozen documents, paid status and full first-payment refunds

**Files:** Extend the monthly migration and monthly SQL fixture. Modify `src/lib/subscriptions/live-refunds.ts` and `live-refunds.test.ts` only where contract-aware authority requires it. Preserve `refund-policy.ts`/`refund-outcome.ts` calculations and original document issuance/read-back function signatures.

**Interfaces:** Extend `subscription_live_owner_term` with new-contract identity, actual `tier`, `amount_minor`, `currency`, `period_start` and existing `paid_through_end`/refund/review state; return `renewal_available: false` for every new-contract tier. `private.subscription_document_candidate` dispatches explicit original/new contract eligibility, projecting frozen identity and base branches for the reviewed document. Existing claim/observe/commit/reconcile refund interfaces remain unchanged and resolve the immutable first request.

- [ ] **Step 1: Add failing document/refund/status tests.** For all three tiers, assert correct paid tier/amount/period; correct frozen invoice/receipt candidate; no document for missing issuer/buyer review, unverified/held capture, mismatched treatment or changed access/source; same issued bytes/number on exact retry after expiry/refund/closure; conflicting retry fails. SQL checks global numbering/financial-year rollover remain unchanged. Refund tests cover full 79900/149900/399900, local day 7/day 8 using frozen timezone despite locale changes, one claim per organization, pending/failed no access effect, exact confirmed refund ends access once, wrong/partial parent refusal, later-delivery replay and closed initiation with GET-only reconciliation. Original customer refund and document fixtures retain exact outcomes.
- [ ] **Step 2: Run `npx vitest run src/lib/subscriptions/live-refunds.test.ts src/lib/subscriptions/refund-policy.test.ts src/lib/subscriptions/refund-outcome.test.ts` and the monthly SQL runner.** Expected: monthly eligibility/status assertions fail before generalization.
- [ ] **Step 3: Implement contract-aware eligibility and projections.** Reuse existing document numbering lock, financial-year basis, private issuer/buyer snapshot, byte/hash constraints and read-back-before-current-facts ordering. New offers carry explicit reviewed document treatment; support only the existing reviewed unregistered-supplier document treatment in this version and make other treatments unavailable pending a new reviewed implementation. An offer whose treatment changes total outside the three pairs is refused. Do not infer invoice issuance from Checkout or turn the existing gym document workflow into SaaS issuance. Extend exact full-refund review eligibility to the bound new contract; retain customer refund runtime/database/review gates, request evidence and replay behavior. Tier selection supplies no additional refund allowance.
- [ ] **Step 4: Run Task 6 tests and original document/refund acceptance under the new migration.** Expect original document hashes/numbers and original post-refund access unchanged, correct higher-tier candidates and no renewal availability for new Starter/Growth/Ultimate.
- [ ] **Step 5: Commit locally.** `git commit -m "feat: support monthly tier status documents and refunds"` with Task 6 files.

## Task 7: Present prepared tier choices, exact review and safe recovery

**Files:** Create `src/components/platform-access/subscription-monthly-review.tsx` and `.test.tsx`. Modify `subscription-plan-cards.tsx` (add tests), `subscription-customer-review.tsx`/`.test.tsx`, `subscription-live-review.tsx`/`.test.tsx`, `subscription-customer-billing.test.tsx`, `subscription-conversion-review-dialog.tsx`/`.test.tsx`, `product-access-gate.tsx`/`.test.tsx`, and `src/lib/subscriptions/live-checkout-client.ts`/`.test.ts`.

**Interfaces:** `SubscriptionMonthlyReview({ organizationId, accountId, onChanged? })` reads Task 2 preview and invokes Task 5 routes. Extend plan cards with explicit `purchaseMode?: 'comparison' | 'test' | 'monthly'`, `offers?: MonthlyOfferSetPreview['choices']`, `selectedTier?: SubscriptionTier`; defaults preserve existing call sites. Add an explicit monthly customer mode to Live review and Checkout client, mutually exclusive with the original `starterCustomer` mode. Checkout client monthly input includes the Task 1 identity and uses the new public flag, selected plan label and exact server order amount. Conversion dialog gains optional `archiveConsequence?: string`; original callers keep their current copy.

- [ ] **Step 1: Write failing UI/client tests.** Test all/subset offer sets, missing/unready choices with support reason, correct chosen label/amount/base branches/billing branch/tax/month/no-auto-debit/refund facts, initially unchecked consent and selection resetting consent. An outdated async response after organization/branch/tier change cannot restore acknowledgement. The final POST carries only the selected offer; after review/quote binding tier switching is unavailable. Test separate archive confirmation, kept billing branch, consequence text and mandatory refresh/repreparation before approval. Each pressed async action spins/blocks duplicate activation. New monthly UI flag cannot open Test/internal/original flags. Paid monthly status remains reachable with both new flags closed; no renewal/upgrade/add-on/restart action appears. Checkout callback shows payment verification pending and never mutates access.

  ```ts
  // Example assertions in the actual rendered monthly review fixture.
  expect(
    screen.getByRole('checkbox', { name: /reviewed this Growth offer/i })
  ).not.toBeChecked();
  await user.click(
    screen.getByRole('checkbox', { name: /reviewed this Growth offer/i })
  );
  await user.click(screen.getByRole('button', { name: 'Choose Ultimate' }));
  expect(
    screen.getByRole('checkbox', { name: /reviewed this Ultimate offer/i })
  ).not.toBeChecked();
  ```

- [ ] **Step 2: Run `npx vitest run src/components/platform-access/subscription-monthly-review.test.tsx src/components/platform-access/subscription-plan-cards.test.tsx src/lib/subscriptions/live-checkout-client.test.ts`.** Expect missing component/mode/consent-reset assertions to fail.
- [ ] **Step 3: Implement prepared-offer presentation using existing masters.** Render Starter → Growth → Ultimate, only reviewed totals as payable, and base branches only in monthly mode; do not offer paid branch expansion. Use existing plan cards, conversion dialog, Alert/ResolvableAction, Checkbox/Label/Button/Select/Dialog primitives. Exact consequence copy: “These branches will be archived now, even if you do not finish payment. Their history stays saved.” Account locale supplies money/date/time; every DOM money value has `tabular-nums`. Keep acknowledgements keyed to organization, source snapshot and offer identity, and ignore cancelled/stale async loads. Mount the new purchase flow only for expired unsuspended trial owners with the new flag; select original/monthly paid presentation from durable returned contract identity even when flags close. Keep original Starter review and renewal UI compatible. Extract only the monthly selection unit; do not rebuild or redesign shared UI masters.
- [ ] **Step 4: Run all platform-access and Checkout-client tests, then inspect actual components in a synthetic local fixture at 320px, 390px and desktop.** Check keyboard selection/consent/dialog focus, archive consequence, long localized text/money, no horizontal overflow, paid/held/expired/refunded states and recovery control reachability. Record screenshots/outcomes outside private financial evidence; remove any temporary fixture route before commit. Synthetic browser inspection is not cloud Auth or genuine payment acceptance.
- [ ] **Step 5: Commit locally.** `git commit -m "feat: add reviewed monthly tier purchase experience"` with Task 7 files.

## Task 8: Prove SQL races, permissions and original-flow preservation

**Files:** Complete `scripts/verify-subscription-monthly-first-checkout.mjs`/`.sql`; create `scripts/verify-subscription-monthly-first-checkout-concurrency.mjs`. Modify `docs/subscription-acceptance-runners.md` for their local lifecycle/target contract.

**Interfaces:** Both runners accept only the existing `supabase_db_usefuldesk-subscription-full-<lowercase-alphanumeric-suffix>` target through `createDisposablePostgres`. Concurrency runner dumps/clones via argv-only Docker/psql, loads current full schema/migrations, uses independent sessions, drops the clone in `finally` and verifies the source baseline. No .env, provider call or cloud resolver.

- [ ] **Step 1: Write failing independent-session assertions.** Overlapping owner selection must freeze one offer; overlapping quote/order claims yield one canonical request and at most one create action. Archive/create/restore/owner/access changes versus quote/claim/capture cannot grant an unreviewed/excessive roster. Lock waits across the 30-minute boundary fail initiation. Capability-gate closure/opening revoke during claim blocks new payable responses while existing obligations remain. Buyer-profile authenticated upsert versus capture/document issuance either serializes valid facts or returns retryable conflict/owned hold, never silently grants/rewrites. Concurrent identical capture/refund/document calls commit once; conflicting replay refuses. Five-branch Ultimate restoration cannot create six active branches. Replaying the closed migration after synthetic activity preserves records and gate containment.
- [ ] **Step 2: Run the concurrency runner without its new enforcement to prove the regression assertions fail.** Use a clone and omit only the new migration in that negative-control run; expected failure is the targeted missing guard or invariant, not absent baseline. Store no changes in the source database.
- [ ] **Step 3: Implement the bounded fixture runner and fix only reproduced transaction defects.** Preserve established organization-first lock order, source NOWAIT handling, request claims, durable holds and recovery leases. SQL assertions inspect function permissions/search paths/RLS, exact catalog constraints and zero default authority. Capture pre/post whole-row fingerprints for original Starter review/signup/renewal/document/internal scope and gym member payment/mandate/document rows. Include dormant Test advanced upgrade/add-on/restart checks; new-contract paths cannot select those records. Run existing capability API/worker/RLS tests with all three new grant snapshots: Starter blocks custom schedules/campaigns/configurable automation/Payment Links/AutoPay, Growth and Ultimate allow their tier predicates while retaining ordinary permissions, product access, WhatsApp approval and each gym's merchant readiness.
- [ ] **Step 4: Run serially against the explicit local full target:**

  ```sh
  node scripts/verify-subscription-monthly-first-checkout.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0
  node scripts/verify-subscription-monthly-first-checkout-concurrency.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0
  node scripts/verify-starter-live-pilot-opening.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0 --preparation
  node scripts/verify-starter-live-renewals.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0
  node scripts/verify-subscription-live-recovery.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0
  node scripts/verify-subscription-capabilities-full.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0
  ```

  Start only this existing stopped local DB when needed. Verify baseline absence/current source requirements before each runner; do not make a real database fit by deleting records. The monthly runner composes original fixtures under the new source; standalone original runners prove unchanged source behavior. Use the existing Test fixture target only if the dormant advanced suite requires it. Stop any task-started containers afterward, preserving volumes. Expect all assertions, clone cleanup and source fingerprint checks to pass.

- [ ] **Step 5: Commit locally.** `git commit -m "test: prove monthly checkout races and preservation"` with runners, narrowly required fixes and runner documentation.

## Task 9: Finish documentation and verify the whole closed change

**Files:** Create `docs/subscription-monthly-first-checkout.md`. Update `docs/changelog.md`, `PRDs/roadmap.md`, `PRDs/usefuldesk-subscriptions.md`, `docs/subscription-starter-customer-checkout.md`, `docs/subscription-live-boundary.md`, `docs/subscription-financial-recovery-runbook.md`, `docs/subscription-customer-document-pack.md` and the plan checkboxes/evidence links.

**Interfaces:** Consumes actual Task 1–8 results; produces a reviewable local source/migration/test/evidence packet with no rollout authority. Correct current subscription product statements while preserving dated historical evidence and original Starter rollout records.

- [ ] **Step 1: Reconcile the approved spec against the final diff.** Pin every spec section to its implementing test/task; inspect the five Review Focus cases and original/new contract dispatch. Remove any unintentionally actionable renewal/upgrade/add-on/restart or trial change. Review the final identity chain from commercial offer through payment, document and refund. Under the selected execution method, perform the required independent task/whole-branch review and resolve substantive findings before final verification.
- [ ] **Step 2: Write final documentation from performed evidence.** State implemented catalog/version/tier authority, exact supported document treatment, scoped archive consequence, capability-readiness dependency, initiation/UI containment, retained GET recovery and all actual local results. Mark this feature **Built locally, closed; cloud installation/deployment/activation unperformed** in roadmap/changelog. Remove or revise its corresponding pending first-checkout entry and inaccurate current “higher-tier contents unapproved” claims; do not rewrite historical entries or imply later billing scope is approved. Preserve genuine internal/Starter evidence separately from synthetic new-tier fixtures.
- [ ] **Step 3: Run changed-file formatting and complete required verification.** Use explicit changed-file paths with `npx prettier --check`; run `npm run verify` (lint, typecheck, all Vitest tests and production build), `node --test scripts/production-env-readiness.test.mjs scripts/lib/disposable-postgres.test.mjs`, and `git diff --check`. Expect all to pass. If code changes after a failure/review, repeat the affected checks and the required final suite; do not record prior results as final results.
- [ ] **Step 4: Commit the delivery documentation locally.** `git commit -m "docs: record closed three-tier monthly checkout"` with explicit doc files. Confirm clean `git status --short`, final local commits, no temporary UI fixtures, and no task-started local containers running. Do not push.
- [ ] **Step 5: Report the implemented behavior, actual verification counts/results and remaining rollout limits.** Link the new operating record and relevant source. Genuine commercial/provider acceptance, approved cloud migration connector installation, publication, global capability readiness/activation and exact per-customer offer opening remain separate reviewed actions. Customer refund initiation stays separately closed. No genuine charge/refund/message or staging resume is claimed.

## Plan self-review and execution gate

Spec coverage: versioned economics/legacy preservation (1, 3, 4); operator preparation and selection (2, 3, 5, 7); actual owner/roster/archive/readiness (2, 3, 5, 7, 8); quote/order/capture/replay/holds/recovery (3, 4, 8); status/document/refund (6, 7, 8); gates/copy/locale/UI (1, 4, 5, 7); local SQL/provider/UI/preservation/full verification and documentation (1–9). No known spec requirement is left for rollout implementation.

Interfaces use the same new version identifiers, `monthly_offer_id`, offer-set/offer/review/request bindings and route bodies throughout. Review Focus cases each have an owning test step. Tasks share the additive migration serially; no independent agent may edit it concurrently. This is one first-purchase project, not separate renewal/advanced-billing projects.

**Execution state:** plan written and self-reviewed; human plan review and execution-method selection pending. Product implementation has not begun.

Recommended method: **Subagent-driven**, because nine dependent payment/authorization tasks change durable financial authority, and an independently checked task boundary can catch a mistake before the next layer builds on it. **Native** remains available: implement task-by-task in this chat with the executing-plans skill, followed by the required fresh whole-branch reviewer. Preserve the user's chosen method after review. Neither choice authorizes cloud or money actions.
