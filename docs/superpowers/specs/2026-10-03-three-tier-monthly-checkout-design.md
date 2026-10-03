# Three-tier monthly first checkout

Date: 3 October 2026

Status: conversational design approved; written specification awaiting review.
Product implementation has not started. This specification authorizes no
Production activation, provider charge, refund, message or deployment.

## Intent and agreed scope

The owner of a gym business should be able to choose Starter, Growth or Ultimate
for its first monthly UsefulDesk purchase after the organization's shared trial
expires. The user selected monthly checkout for all three tiers and approved an
extension of the existing checkout using versioned offers, exact owner review,
verified payment and preservation of existing Starter billing.

Success means a reviewed first payment activates the selected tier, its included
branch allowance and one calendar month of access. A failed or unverified payment
activates nothing. A retry cannot create another order for an ambiguous receipt.
Existing Starter customers, the internal acceptance organization and gym-member
collections retain their identities, obligations and recovery behavior.

This is the web first-purchase flow for an expired, unsuspended trial. Active
trials retain their full deadline and features. Paid customers, complimentary or
manual access conversion, renewals, upgrades, downgrades, restarts, branch add-ons,
annual pricing, automatic debit and native Checkout are outside this change.

## Existing decisions to reuse

| Tier     | Listed monthly software price | Included active branches | Approved capability model                                                                                           |
| -------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Starter  | INR 799                       | 1                        | Standard renewal reminders and the existing gym core                                                                |
| Growth   | INR 1,499                     | 1                        | Starter plus custom reminder schedules, bulk campaigns, configurable automations, gym Payment Links and gym AutoPay |
| Ultimate | INR 3,999                     | 5                        | Growth capabilities                                                                                                 |

`src/lib/subscriptions/plans.ts` remains the application source of plan names,
prices, included branches and capabilities. The matching SQL contract must be
tested against it. This phase grants no purchased extra branch slots. Growth's
optional second branch and Ultimate's additional paid branches remain separate.

The 14-day trial is organization-wide, with five active branches. Archived and
read-only branches do not consume active capacity. Selecting a tier creates no
new trial. Do not invent member or staff caps, additional tier capabilities,
annual discounts or message overage fees.

Use the existing one-calendar-month-from-signed-capture-event term policy,
30-minute quote lifetime, and first-payment full-refund policy. The refund window
is through local calendar day 7, using the timezone frozen with the first payment;
the refund opportunity is once per organization. A confirmed full refund ends
paid access and stops renewal eligibility while preserving data and sign-in.
Pending or failed refund work does not end access.

## Chosen approach and preservation boundary

Extend the existing customer checkout with an explicit versioned monthly offer
contract. Reuse its quote/order/payment/grant ledgers, single-order claims,
signed intake, captured-payment verification, exception holds and recovery.

Alternatives considered were widening the original Starter checks in place or
building an independent billing service. The versioned extension makes the
new tier and amount authority explicit while reusing accepted settlement logic.

Existing offers, preparations, reviews and quotes remain on the original Starter
contract, which still requires Starter, INR 79,900 paise and its existing terms.
No historical row is relabeled, repriced or upgraded. The internal acceptance
merchant and organization binding remain pinned. The existing Starter signup
selection policy does not select customers for the new contract implicitly.

New records carry a distinct contract version and immutable catalog identity.
They support exactly the three catalog pairs: Starter/79,900, Growth/149,900 and
Ultimate/399,900 paise, with zero paid extra slots and INR currency. Those are
supported payable totals for this implementation, not a declaration that every
customer's tax and commercial facts have already been approved. An operator must
approve the exact total as payable and the corresponding tax/document treatment
before an offer can be opened. If the reviewed treatment requires a different
total, this contract refuses it; no guessed tax or price override is introduced.

The migration creates the contract structure closed and seeds no real customer,
commercial review, offer opening or payment authority. Mutable catalog changes
never rewrite an outstanding quote; a future price needs a new contract version.

## Preparation, selection and owner review

Preparation and owner approval remain different acts. A platform operator with
the existing platform-admin authorization prepares a versioned offer set for one
organization and billing branch, using the existing commercial evidence fields.
The record includes merchant, catalog version, permitted tier offers, exact
payable totals, tax and refund notes, actual owner, release/manifest references,
source access version and exact active-branch roster. No nonempty reference alone
counts as genuine commercial or provider acceptance evidence.

Offer sets may contain all three reviewed choices or a subset. A missing or
unready offer stays unavailable with a reason and a support resolution. The UI
must never turn a planned catalog price into a payable offer on its own.

An owner can change the selected tier before final approval. The review displays
the exact selected plan, amount, included branches, billing branch, tax note,
calendar-month term, no-automatic-debit statement and first-payment refund terms.
The acknowledgement starts unchecked and applies to that selected offer only.
Changing the selection clears it. Owner approval freezes the selected offer and
creates an initially closed, organization-bound review. A separate server
transaction consumes one-time opening authority, as in the existing flow.

Once the first quote exists, the selected offer cannot be rebound by changing a
client tier field or retrying approval. An expired quote without an order can be
replaced for the same reviewed contract after rechecking current facts. A plan
change after that binding needs a separately reviewed resolution of prior work;
the flow does not silently switch an existing payment to another tier.

Both HTTP and database boundaries require the actual organization owner. Admins,
agents, viewers and members of another organization cannot approve, quote or pay
on the owner's behalf. Use existing named authorization predicates and owner
helpers rather than inline role comparisons in application code.

## Branch roster and capability readiness

First checkout includes only the selected tier's base branches: one for Starter
or Growth and five for Ultimate. At least one active INR branch is required, and
the billing branch must be active and belong to the organization. All active
branches must meet the existing INR checkout eligibility rules; no currency or
geography is silently changed.

If the roster exceeds the selected allowance, the owner explicitly chooses
branches to archive using the existing conversion review presentation and
archive behavior. Do not enable the Test archive endpoint for Live traffic.
Provide an owner-authorized, scoped Live operation with the same preservation
rules: exact distinct branch IDs from the same organization, no billing-branch
archive, no removal of every active branch, and no deletion of history.

Archiving is a separately confirmed action before offer approval and payment;
it happens even if payment is later cancelled. The UI states this consequence.
After archiving, refresh preparation against the new roster and access version
before approving an offer. No stale preparation survives a roster change.

Quote, order claim and settlement recheck the exact roster and owner/access
version under the organization lock. Branch create or restore races cannot
produce a paid grant with an excessive or unreviewed roster. Later branch
changes use the existing database capacity enforcement.

New-contract opening requires the existing capability/branch-enforcement gate to
be enabled and its readiness separately reviewed. This implementation does not
enable that global gate. The grant and access snapshot report the selected tier;
existing capability predicates enforce the approved matrix in UI, routes, RLS
and background execution. Gym Payment Links and AutoPay still require the gym's
own ready merchant connection. No SaaS payment bypasses gym merchant readiness.

## Quote, payment and recovery data flow

1. Read an owner-scoped preview of the prepared offer set; select and acknowledge
   one exact offer. Freeze owner consent and consume scoped opening authority.
2. Create a server-owned immutable quote after rechecking the contract, commercial
   review, owner, expired trial, source access version, roster and enforcement
   readiness. A client amount is acknowledgement only. Starter also requires the
   existing approved 7/3/1-after-09:00 reminder reset acknowledgement. Growth and
   Ultimate preserve eligible custom schedules rather than resetting them.
3. Claim the canonical request in the database before provider I/O. Mint
   process-local payment authority from the service-only durable identity lookup.
   Its contract version, catalog tier, amount, merchant, organization and request
   must agree. Arbitrary amounts and forged or cloned authority objects fail.
4. Create at most one provider order per claim. An ambiguous POST uses GET-only
   receipt recovery; zero or multiple matching orders require review. Validate
   receipt, organization/request notes, amount, currency and immutable order ID.
   Recheck initiation authority after I/O before returning payable Checkout.
5. Signed webhook intake performs a fresh provider GET to verify captured state
   and the exact order, amount, currency and merchant. The existing service-only
   commit transaction writes payment evidence and the selected tier's grant/access
   together. A browser success callback or authorized-only payment grants nothing.
6. Identical delivery or reconciliation replays return their existing outcome.
   Conflicting, expired or changed-source captures persist a durable review hold
   with owner, status and next action; they do not grant access, create another
   order, automatically refund or loop forever through a failing commit.

The provider resolver dispatches explicitly on original versus new contract.
Removing the current 79,900-paise check without a durable tier/version binding is
not an implementation of this design. Never select financial authority from a
webhook's tenant field alone or from gym-member collections metadata.

Closing initiation prevents new payable checkout responses, including retries.
It does not erase obligations or disable signed intake, settlement and GET-only
recovery for an existing order. Changed or revoked commercial authority holds an
uncommitted capture; an identical already-committed replay preserves its result,
including after a confirmed full refund. Recovery retains batch bounds and leases.

## Billing status, documents and refunds

Owner billing status displays the actual paid tier, period, paid amount and any
review state. Existing customers continue to see their existing status even when
new checkout is hidden or paused. Add no automatic renewal action for the new
contract. Existing Starter renewal behavior remains on its original scope.

Generalize the document eligibility boundary explicitly for the new contract so
each tier's first verified payment can produce its correct frozen document under
the reviewed issuer/document treatment. Preserve original documents, numbering,
financial-year boundaries and read-back idempotency. Do not imply invoice issuance
merely from Checkout success or fabricate missing customer or issuer facts.

Extend contract-aware refund eligibility and confirmed-refund processing for the
new first purchases, using the existing full first-payment policy and recovery.
Refund initiation still needs the separately enabled customer refund switch,
scoped database authorization and exact refund review. No refund switch or real
refund is opened by this feature. Tier selection creates no new refund allowance.

## UI and rollout switches

Reuse plan cards, customer review, Live review, conversion review and existing
UI masters. Keep original Starter-specific rendering available for its original
contract. New tier selection is a customer purchase experience, not the internal
Live pilot selector or the Test payment presentation.

Use account locale formatters for visible money, dates and times, with
`tabular-nums` for money. Tier changes reset acknowledged review state. Async
buttons show their own pending state and prevent duplicate activation. Product
copy describes the selected plan and the next action without internal ledger,
contract or deployment details. No shared UI master alteration is required.

Add independently closed initiation and UI switches:

- `USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED`: new-contract first quote/order
  initiation, additionally requiring existing customer scope/checkout support,
  Live configuration, signed intake/settlement and exact database opening.
- `NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI`: new-contract web selection and
  review. This public value supplies no payment authority.

Both are false or unset by default. Existing environment audit modes reject
their activation; deployment with both closed is supported. Do not add an opening
audit mode that implies authority to sell every tier. Durable new-contract scope
resolution and recovery use existing customer scope support and remain available
when the new initiation/UI switches close.

## Required verification and delivery

- Unit and route tests: catalog/contract mismatch, malformed or forged authority,
  exact owner and tenant checks, closed gates, acknowledgement reset, selection
  constraints, stale offers, status and correct plan/amount sent to Checkout.
- Disposable full-schema SQL acceptance: all three first purchases; one/five
  branch limits; explicit archive preservation; active-trial, non-INR, paid and
  suspended refusals; concurrent claims and roster/access/owner changes; exact
  and conflicting replay; late captures; verified refunds; document idempotency;
  permissions, RLS, search paths and closed migration defaults.
- Provider adapter tests: single POST, lost response, GET-only recovery, ambiguous
  results, exact captured verification and containment during I/O. Mocked provider
  acceptance is labeled synthetic; it is not genuine Live payment evidence.
- Preservation checks: original Starter offers/customer and internal binding,
  Starter renewals, post-refund late deliveries, existing Test advanced flows and
  gym-member payments/mandates remain valid and isolated.
- UI checks: narrow and desktop layouts, keyboard selection/review, branch archive
  consequence, locale rendering, paid status and recovery actions.
- Run appropriate targeted checks and the repository's required full verification;
  check formatting and diff cleanliness. Update `docs/changelog.md`,
  `PRDs/roadmap.md`, the subscription PRD and affected checkout documentation with
  the implemented contract and verified limits. Record no unperformed acceptance.

Add an idempotent migration after the latest migration present at implementation
time. Test it locally against disposable fixtures and verify replay. Cloud
installation, release and activation are separately reviewed actions; if requested,
apply through the approved Supabase migration connector, never `db push`.

Deliver source, closed migration, tests and documentation for review. Do not push
or deploy this feature, install a Production migration, seed a genuine offer,
charge a buyer, issue a refund or send a WhatsApp message during implementation.
