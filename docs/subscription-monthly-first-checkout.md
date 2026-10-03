# Three-tier monthly first checkout — closed local delivery

**3 October 2026: Built locally, closed; cloud installation/deployment/activation
unperformed.** Tasks 1–9 passed independent task reviews. The final whole-change
review initially returned Needs fixes for F1 root recovery. One fix wave and one
scoped re-review are complete: **F1 ADDRESSED; scoped review Approved; closed
local source readiness Approved.** No new Critical/Important/Minor breakage or
out-of-scope issue was identified. Task 9's independent Spec Compliance and
Quality verdicts are Approved. M1 is deferred to separate nonblocking harness
cleanup under Ruling 18.
This record describes performed
local evidence, not a current Production inspection or authority to open sales.
The approved [design](superpowers/specs/2026-10-03-three-tier-monthly-checkout-design.md)
and [execution plan](superpowers/plans/2026-10-03-three-tier-monthly-checkout.md)
define the scope. No genuine new-catalog offer, customer commercial review,
provider capture/refund, document issuance, backup or rollout evidence was created.

## Exact contract and preserved history

`src/lib/subscriptions/plans.ts` remains the application packaging source.
`monthly-contract.ts` and the additive migration
`supabase/migrations/20261003010000_subscription_monthly_first_checkout.sql`
bind contract `monthly_first_v1` to catalog `monthly_inr_2026_10_v1`:

| Tier     | Total, INR paise | Display total | Included active branches | Paid extra slots |
| -------- | ---------------: | ------------: | -----------------------: | ---------------: |
| Starter  |            79900 |          ₹799 |                        1 |                0 |
| Growth   |           149900 |        ₹1,499 |                        1 |                0 |
| Ultimate |           399900 |        ₹3,999 |                        5 |                0 |

These are the only supported payable totals. Each actual customer's operator
review must approve its exact total and facts. A treatment requiring a different
total is refused; there is no price override or guessed tax. The sole implemented
document treatment is `usefulmade_unregistered_invoice_receipt_v1`, subject to
exact issuer/buyer/transaction review. It is not general legal or tax clearance.

The flow is a web first purchase after an unsuspended organization's shared trial
expires. It never shortens the existing 14-day trial or creates a new trial.
Paid/manual/complimentary conversions, renewals, upgrades, downgrades, restarts,
paid branch add-ons, annual pricing, automatic SaaS debit and native Checkout are
outside this new contract. Every new paid term returns `renewal_available: false`,
including monthly Starter. Original Starter renewal remains on its separate scope.

Original offers, preparations, reviews and quotes keep NULL additive identity
columns. The service resolver explicitly projects `starter_v1` / NULL catalog;
the original Starter amount stays 79900 INR paise. No historical row is relabeled,
repriced or upgraded. Home office internal acceptance, original Starter signup
selection, Justin's original sale/documents and original customer renewal retain
their own records. Genuine historical evidence in the
[Starter record](subscription-starter-customer-checkout.md) is not new-tier
acceptance. Gym-member payments, mandates and invoices remain separate.

## Preparation, owner review and one-time opening

An authenticated platform admin with MFA prepares an immutable offer set for one
organization and active billing branch. The set freezes merchant, actual owner,
release/manifest and existing evidence references, access version, sorted exact
active roster, commercial/source fingerprints and separately reviewed
`capability_readiness_reference`. It contains all three reviewed choices or a
subset; missing/unready choices expose a bounded reason and support action.
Nonempty evidence references alone never establish genuine acceptance.

Preparation leaves `opening_enabled` false. Its admin UI has **no opening switch**.
The distinct authenticated MFA-admin RPC
`platform_admin_authorize_monthly_opening(offer_set_id, expected_snapshot,
opening_review_reference, opening_reviewed)` requires a separate explicit opening
review and the exact current snapshot. This is actual implemented operator work,
not authority inferred from a preview or preparation success.

The actual organization owner selects and acknowledges one exact offer through
`monthly-review`. SQL `subscription_approve_monthly_review` freezes that selection
into the existing preparation/customer review and initially closed scope. The
separate service transaction `subscription_open_reviewed_customer_scope` uses
the authenticated **review author**, validates source/readiness and consumes the
set's opening authority once. A second real owner cannot replace the frozen
author by supplying another actor. Retrying approval/authorization after
containment cannot reopen payment. Quotes and retries remain bound to the same
selected offer and canonical request; a different selection needs reviewed
resolution of existing work. An expired quote without an order can be replaced
only for the same frozen offer after current-fact checks. An ambiguous existing
order prevents quote replacement.

Before approval/payment, an over-cap owner must explicitly confirm the separate
`monthly-archive` action for exact active branch IDs. Billing branch and at least
one active branch remain; history is preserved. The UI states: “These branches
will be archived now, even if you do not finish payment. Their history stays
saved.” Archive increments access version and revokes the old preparation/offer
set. Refresh and **new operator preparation** are required afterward. No Test
archive endpoint is enabled for Live traffic.

Monthly opening also requires the existing global capability/branch gate to be
separately ready, reviewed and enabled. This implementation does not activate
that gate and does not assert its current Production state. Branch/capability
limits were proven with enforcement **enabled**; the existing disabled-gate
fallback is unchanged. A monthly initiation flag independently enables neither
the capability matrix nor branch limits. Growth/Ultimate gym Payment Links and
AutoPay still require each gym's ready merchant connection; WhatsApp sends retain
exact Approved/synced POSITIONAL contracts and ordinary authorization.

## Frozen identity through money, documents and refunds

The immutable chain is catalog → offer set → selected monthly offer/existing
approval → preparation/customer review → quote/request → bound order → verified
payment → term/grant → document/refund. Quote carries `monthly_offer_id`,
`offer_contract_version`, `catalog_version`, tier, exact total/currency, included
branches and zero extras. Order/payment/term/grant resolve through that request;
client amount is acknowledgement only. Unknown/incomplete versions fail rather
than falling back to original Starter at the same price.

The quote lasts 1800 seconds from its frozen review. Organization-first locks and
commercial-source NOWAIT locks detect buyer/setup/owner/roster changes even when
access version did not change. Claim precedes provider I/O. Process-local branded
authority is minted only from the service-only durable resolver; copied/forged
objects fail. Monthly order notes bind versions, tier and offer alongside request
and organization. Original provider notes retain their old contract.

At most one order POST is authorized per canonical claim. A lost response uses
GET-only receipt recovery; zero or multiple matches require review. Runtime and
durable authority plus wall-clock expiry are rechecked after provider I/O before
any payable response. A signed `payment.captured` event and fresh exact provider
GET verification are required for settlement. Its event timestamp starts **one
calendar month**; a browser SDK callback only shows verification pending and
reloads durable status. It never grants access.

Conflicting, late or changed-source uncommitted captures persist an owned hold
with status and next action, without a grant, second order or automatic refund.
An identical committed replay reads its existing result before mutable checks,
including after expiry, full refund or containment; it never restores access.

Owner status exposes frozen actual tier, amount, included branches, period and
held/refund facts with refresh/support recovery even with purchase flags closed.
The expired-trial root now discovers an existing exact monthly quote/bound order
or captured review hold through the owner-scoped read RPC independently of
presentation flags, and dispatches the existing monthly status component.
Organization, billing branch, authenticated actor or owner-status changes remount
the gate and cancel old discovery/status reads; root refresh uses its existing
nonce. A failed quote-discovery read cannot erase an already discovered
obligation. With no
obligation, the closed root retains comparison/support only. New offer selection,
approval, quote/order initiation and SDK Checkout retain their existing gates.
Documents use explicit original/monthly eligibility and the single private
`subscription_build_document_candidate` shared implementation. Existing
`subscription_issue_live_document_pair` retains its signature, global/fiscal
numbering lock, envelope/hash checks and issued-readback-before-current-facts
ordering. Original issued bytes/numbers are never overwritten or consumed again.

There is **no SaaS TypeScript PDF renderer or download endpoint**. The existing
operator-private reviewed PDF workflow persists the final envelope/hash/readback
through SQL. Use the explicit monthly template in the
[customer document pack](subscription-customer-document-pack.md#monthly-catalog-document-template--unissued).
Synthetic PDF envelope assertions do not inspect rendered financial content;
genuine new-catalog issuer/buyer/tax/provider review and final PDF content review
remain unperformed.

Full first-payment refunds remain once per organization, through local calendar
day 7 (payment date day 0) using the first payment's **frozen billing timezone**.
Later locale changes cannot change eligibility. The exact original full amount
must match review, claim, provider refund and fully refunded parent payment.
Pending/failed refunds leave access unchanged; confirmed full refunds end paid
access once while preserving data/sign-in. Original bytes and capture replay
remain preserved. Customer refund initiation is separately closed and still
needs its own runtime/database authorization and exact refund review.

## Containment and remaining release gates

Both new switches default false/unset:

- `USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED`: monthly quote/order initiation,
  also requiring existing customer scope/checkout support, Live configuration,
  signed intake/settlement and the exact opened database scope.
- `NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI`: monthly web selection/Checkout;
  supplies no financial authority.

Existing environment audit modes reject either activation. Closing initiation
blocks new payable responses, including retries. Preserve durable scope support,
signed intake, settlement, listener identity and GET-only existing-obligation
recovery. The existing scanner retains five-item bounds and leases; containment
does not erase an issued order or revoke already committed payment history.
See the [financial recovery runbook](subscription-financial-recovery-runbook.md).

Release requires separate source review, approved cloud migration connector
installation (never `db push`), deployment with closed flags, genuine commercial/
provider/document acceptance, separately reviewed global enforcement readiness/
activation, and exact per-customer one-time opening. No cloud staging resume,
Production read/migration, push/deploy, provider/network payment action,
WhatsApp/automation or genuine offer/evidence creation occurred in this project.

## Durable acceptance and spec coverage

| Approved spec section                   | Implementing source and performed evidence                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intent/agreed scope; existing decisions | `monthly-contract.ts`/test, `plans.ts`, monthly SQL foundation and tier fixtures; Tasks 1, 3, 7 prove exact prices/base branches, expired-trial-only eligibility, unchanged trial and no later actions.                              |
| Chosen approach/preservation            | Additive monthly migration explicit original dispatch; `live-monthly-checkout.test.ts`; Task 8 original full-schema runs and fingerprints, historical identity NULL assertions, Test advanced isolation and gym-ledger preservation. |
| Preparation/selection/owner review      | `monthly-offer-preparation.tsx`/test, monthly preparation SQL; `monthly-review/route.test.ts`, monthly transaction/tier fixtures and rendered MonthlyReview tests; Tasks 2, 3, 5, 7.                                                 |
| Branch roster/capability readiness      | Monthly archive route/component tests, all-tier SQL and monthly capability fixture; independent create/restore/owner/roster races; actual owner/agent/viewer RLS and API/worker matrix; Tasks 3, 5, 7, 8.                            |
| Quote/payment/recovery data flow        | `live-monthly-checkout.test.ts`, original provider/order/flow/recovery/webhook suites and all-tier transaction/concurrency runners; Tasks 3–5, 8 cover one POST, exact notes, containment, holds and GET recovery.                   |
| Billing status/documents/refunds        | Monthly migration term projection/shared document candidate; all-tier document/refund SQL, unchanged refund suites and monthly adapter tests; Tasks 6–8 cover frozen treatment/period/timezone, full amounts and terminal replay.    |
| UI/rollout switches                     | Environment audit/monthly routes/client tests, actual rendered plan/monthly/live/customer components and synthetic browser checks; Tasks 1, 4, 5, 7.                                                                                 |
| Required verification/delivery          | Monthly rollback/replay and concurrency runners plus six serial local acceptance commands; Task 8 and final Task 9 repository verification below; this record and updated product docs.                                              |

The five adversarial Review Focus cases have these specific performed checks:

1. Actual rendered delayed organization/branch responses and tier consent reset;
   deferred review/quote refresh retains frozen selection/review/request UUID,
   stale or different preparation cannot unlock it (Task 7 reviewed fix).
2. SQL two-owner quote-author/source holds and monthly route author-denial tests
   retain the actual author through service opening/payment (Tasks 3, 5, 8).
3. Observed independent quote-row lock wait crosses expiry; revoked capability/
   opening claim races and mocked provider post-I/O containment refuse payable
   responses. Deferred SDK expiry constructs no window (Tasks 4, 7, 8).
4. Real authenticated buyer upsert versus capture/document locks yields valid
   serialization or retryable 40001/owned hold; unchanged access version does
   not bypass frozen commercial facts (Tasks 3, 6, 8).
5. Concurrent exact capture/document/refund calls commit once; conflicting replay
   refuses. After full refund/containment, exact retries preserve payment,
   document bytes/numbers and ended access (Tasks 3, 6, 8).

Task 8's negative control omitted only the monthly migration from an otherwise
complete original baseline and failed specifically for a missing source-lock
guard. GREEN independent sessions passed with **16 distinct mock order creates,
3 mock refund creates, zero provider network**, per-request duplicate-create
refusal, clone cleanup and all public/private/auth source fingerprints unchanged.
Near-expiry evidence compresses the last seconds of an exact 1800-second
synthetic quote; it is not a 30-minute wall-clock run.

All six serial full-container commands in
[the acceptance runner record](subscription-acceptance-runners.md) passed:
monthly rollback/replay, monthly concurrency, original pilot preparation,
original renewals, Live recovery and full capabilities. Historical rows compare
all pre-existing columns; only added nullable identity columns are excluded from
that fingerprint and independently asserted NULL. Actual authenticated all-tier
RLS and capability/API/worker checks retain ordinary permissions, WhatsApp
readiness and gym merchant readiness. Original six Test reviews remained.

Task 7's final rendered/browser evidence covers 320px, 390px and 1280px, keyboard
selection/consent/archive focus, long text and ar-EG INR formatting, no horizontal
overflow, 33 paid/held/expired/refunded/recovery state-width outcomes including
closed flags, plus focused frozen-refresh/support rerenders. Synthetic screenshots
are outside private financial evidence; temporary fixtures/routes/server/tab
were removed. This does not prove remote Auth, native or genuine provider behavior.

**Task 9 verification before final review (3 October, `d694053f`):**
`npm run verify` exited 0: full ESLint,
TypeScript, **548 files / 4898 tests** (28.95s) and successful Next.js production
build (**141/141 generated pages**). The explicit corrected command
`npx vitest run scripts/production-env-readiness.test.mjs scripts/lib/disposable-postgres.test.mjs`
exited 0: **2 files / 322 tests** (296ms). All nine changed documentation files
pass explicit Prettier check; `git diff --check` passes. No source changes were
needed during delivery. Existing nine non-failing jsdom scrollTo diagnostics
remain; actual browser checks cover the changed UI controls.

**Final F1 fix verification (3 October, `baaef0816fe4d103111c0e0f36852ccb5611ef21`):** the actual `ProductAccessGate` plus
production Live/Customer status children reproduce the bound pending order and
held capture disappearing with all purchase flags closed (14 tests: 8 failed /
6 passed before the fix). Final expanded recovery suite passes 18 tests, including
refresh/support, no new selection/POST/Checkout, null/malformed discovery,
organization/account/owner/actor cancellation, failed root reads, original
Starter and manual paid/expired/refunded/internal compatibility. Root pair:
**2 files / 44 tests**; covering platform-access and original/monthly billing/SDK:
**17 files / 214 tests**. Final `npm run verify` exits 0 with lint/types,
**549 files / 4916 tests** and **141/141 production pages**. Both explicit script
Vitest files pass **322 tests**. Changed-file Prettier and diff checks pass.
No SQL/provider source, UI master or jsdom harness changed. The final run emitted
10 non-failing scrollTo diagnostics (M1); the earlier Task 9 run emitted nine.
An earlier full run in this wave emitted 12; isolated new-file and covering
checks emitted none.
This is the unchanged harness-noise class, with no asserted cause for the count
difference. No additional browser/SQL acceptance was run:
this fix changes discovery/dispatch, retaining the prior status layouts and
Task 8 evidence. It proves local synthetic root reachability, not genuine
financial/provider/remote-Auth acceptance.

Final local Docker inspection confirms both permitted full/Test containers
stopped with named volumes preserved. Task 8 verified no remaining monthly clone
and stable source fingerprints before stopping; Task 9 and the final fix wave
did not restart either DB.
Port 4177 has no listener and temporary Task 7 fixture paths are absent. No
task-started UI process/route/fixture remains; unrelated ignored scratch was
left untouched.

The [plan execution record](superpowers/plans/2026-10-03-three-tier-monthly-checkout.md#execution-record-and-rulings)
retains task commits, review outcomes and binding execution rulings with their
reasons/costs. All 18 current rulings, including the eight final declined-scope
decisions and M1's separate-cleanup disposition, are preserved verbatim in that
durable plan ledger. Task 9 independent Spec Compliance and Quality reviews are
Approved. The broad review's F1 Needs fixes finding was addressed by the single
`baaef081` fix wave; the single scoped re-review verified F1 closure and found no
new Critical/Important/Minor breakage or out-of-scope issue. Closed local source
readiness is Approved; no blocking finding remains.

This final delivery record is metadata only. Source/tests remain unchanged since
verified and reviewed `baaef0816fe4d103111c0e0f36852ccb5611ef21`: root 44 tests,
covering 214, full 549 files/4916 tests, lint/types/141-page build and explicit
script 322 tests. The scoped reviewer inspected the supplied fix diff and
retained logs, without rerunning suites or performing cloud/provider/database
acceptance. Four-document Prettier and staged/current diff checks are the only
new validation for this metadata step. Local approval supplies no publication,
installation, deployment, activation, genuine sale/refund/document or rollout
authority; the separate release gates and private operator PDF boundary above
remain in force.
