# UsefulDesk subscriptions — decision and implementation brief

**Status:** trial policy, the three tier names, branch allowances and expansion rules, Growth's Razorpay collection scope, the messaging split below, no UsefulDesk monthly message-count caps or message overage charges at launch, the provisional monthly INR prices below, and the base-tier change timing below are approved. Higher tiers inherit lower-tier capabilities. Other tier contents, annual pricing, tax treatment, and paid checkout are not approved or shipped. This brief supersedes the trial, plan-name, and entitlement proposals in `multi_gym_saas_prd.md` and the trial-duration recommendation in `docs/pricing-and-packaging-research.md`. The shipped access boundary remains `trial-access-mvp.md` until subscription work is deployed.

## Approved customer journey

1. A new verified organization owner starts the existing **one organization-wide 14-day trial**. Signup does not require a tier or payment method. Branches and invited staff share the same deadline; a new branch or a later plan choice never restarts it.
2. During the trial, the organization can use the features of all three tiers and have up to **five active branches**. Account roles, security checks, provider setup, WhatsApp template approval, and other operational prerequisites still apply. “Full access” does not promise that a disconnected WhatsApp or Razorpay account can send or collect.
3. At the trial deadline, operational access closes. The owner can still sign in, switch organizations, contact support, and reach a plan-selection and payment path. The approved customer-facing names are **Starter, Growth, Ultimate** — exactly three paid tiers.
4. Paid access begins only after the Usefulmade SaaS payment has been verified server-side and an organization entitlement has been committed. A browser return from checkout, screenshot, or pending payment cannot grant access. A failed checkout retains the plan-selection/support path and does not restart the trial.
5. Plan changes do not change or create a trial. Existing complimentary organizations keep their current access until a separate migration policy is explicitly approved.

The concrete owner/provider decisions and distinct manual/automated opening
criteria are recorded in [production readiness](../docs/production-readiness.md).
Passing code checks or the Test acceptance slices does not open either gate.

## What is live today

`private.organization_product_access` already owns trial, manual, and complimentary access; verified-owner trials last 14 days. Its web/native/server/RLS boundary denies operations at expiry while preserving identity recovery and support. The deployed web trial/expiry screens compare Starter, Growth, and Ultimate and retain **Contact support**, with purchase actions unavailable. Production has no actionable paid tier selection, SaaS checkout, SaaS payment ledger, automatic paid entitlement, or tier-specific enforcement. Do not advertise self-serve paid conversion before these are implemented and verified.

### Trial-flow benchmark (checked 27 September 2026)

| Product                                                               | Publicly documented signup and trial                                                                                                   | What happens at the boundary                                                          |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Gymdesk](https://gymdesk.com/pricing)                                | One 30-day trial, no card, with every feature. Its paid tiers vary by active member count, while features stay available across tiers. | Paid size is based on active members; the private conversion screen was not verified. |
| [Teamup](https://calendar.teamup.com/kb/managing-subscription-plans/) | Choose a particular paid plan's three-day trial while creating a calendar; the trial has that plan's features.                         | Without billing details, the calendar reverts to the free Basic plan.                 |
| [Mindbody](https://www.mindbodyonline.com/business/pricing)           | Public sales flow starts with a personalized demo and plan discussion, not a documented self-serve trial.                              | A comparable self-serve trial paywall is not publicly documented.                     |

UsefulDesk follows the plan-agnostic trial pattern: **Start 14-day trial** is the signup action; no tier selection or card comes first. During the trial, the owner sees the current trial and the three future plans. At expiry, the recovery screen compares exactly **Starter, Growth, Ultimate**, explains active-branch capacity, and permits owner plan selection only when a verified payment path is actually ready. “Autopilot” was an exploratory label, not a fourth tier or a UI card. A selected plan does not itself grant access. The shipped comparison keeps support as its recovery action until the conversion path is complete.

### Local base-payment integration draft (default off)

The **local, default-off Test flow** now lets an expired organization owner review all branches, explicitly archive selected branches when the chosen base tier has fewer slots, choose Starter/Growth/Ultimate, create one Usefulmade Razorpay Test order, open Test Checkout, and confirm a captured Test payment. The server verifies Checkout HMAC or a raw-body webhook HMAC, then fetches the payment from the separate Usefulmade Test merchant before the service-only database commit. A browser callback alone never grants access. The local-only migration draft `20260927200000_subscription_monthly_base_foundation.sql` stores intent, payment, and first paid grant evidence privately; its disabled gate and exact merchant/order/payment/amount checks atomically grant the first monthly Test term. It also drafts active-branch create/restore limits, owner-only expired-trial branch review/archive, and an organization-first restore lock. The client and all routes require non-Production Test flags; Production has no new checkout or entitlement behavior. On 28 September, real Usefulmade Test Checkout failure/retry/capture reached one verified first-term commit in an existing disposable local schema fixture. SQL replay/isolation/capacity and concurrent slot checks passed; duplicate webhook route checks used synthetic signatures. Browser-loss recovery now resumes the canonical claimed intent, and ambiguous order creation looks up a unique receipt with matching organization notes. The draft retains restore’s existing product-access predicates. Full application-schema and genuine provider webhook-delivery acceptance remain pending; see [the acceptance record](../docs/subscription-test-acceptance.md). This is **not** a customer-payable quote or a saleable subscription: the local renewal/cancellation/refund slices below still need full application and provider acceptance; upgrades, add-ons, paid feature gates, and tax/commercial readiness remain open.

For a disposable local acceptance run, apply the draft migration only to that database, then set its private singleton `enabled=true` with the exact Usefulmade Test merchant account ID. Set `USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED=true`, `USEFULDESK_SAAS_RAZORPAY_MODE=test`, the separate `USEFULDESK_SAAS_RAZORPAY_TEST_KEY_ID`, `USEFULDESK_SAAS_RAZORPAY_TEST_KEY_SECRET`, `USEFULDESK_SAAS_RAZORPAY_TEST_WEBHOOK_SECRET`, `USEFULDESK_SAAS_RAZORPAY_TEST_MERCHANT_ID`, and `NEXT_PUBLIC_USEFULDESK_TEST_BILLING_UI=true` in the local runtime. Point the Test merchant webhook to `/api/subscriptions/test-webhook`. Verify success, failed payment, browser loss, duplicate and delayed webhook, cross-organization rejection, branch restore limits, and ambiguous order recovery with Test fixtures before any wider rollout. The initial Test Checkout creates a one-month grant; the separate owner-initiated renewal path below is not automatic recurring billing.

### Local renewal and refund transactions (default off)

After the first Test payment, `POST /api/subscriptions/renewal-change` accepts an
owner's lower target tier and exact archive choices, or a null target for
end-of-term cancellation. Scheduling changes no access or branches. This slice
keeps schedules immutable; edits/undo require a later reviewed flow.
`POST /api/subscriptions/test-renewals` prepares one owner-initiated order at or
after the current paid-through boundary. The same Test confirmation/webhook
verifier commits a captured payment, and a signed `payment.failed` plus fresh
provider GET can grant the single fixed 72-hour grace. It never gives grace to a
first checkout or cancelled renewal. The existing organization access row carries
the deadline; a pending order grants nothing. Payment, exact owner-authorized
archives, lower tier, and the next access window commit together under the
organization lock. Stale access versions, changed rosters/roles, wrong merchant,
and conflicting payment replays are rejected without partial effects.

The **Test-only term convention** keeps the next end at the previous paid-through
end plus one calendar month. Late verification starts access at verification;
it does not retrospectively reopen a gap after grace. Orders beyond that next
end remain review-held. Confirm this convention in the paid billing UX/commercial
review before rollout. There is no SaaS provider recurring schedule to cancel in
this Orders-only adapter, and it never touches gym-member mandates.

`POST /api/subscriptions/test-refund-claims` persists the server receipt before
provider I/O, verifies the immutable first Test payment via GET, then reserves
one full-amount claim using its saved billing timezone and Razorpay payment
`created_at` timestamp. The original receipt survives provider outages and later
processing; a browser retry returns the existing claim. The payment date is day
zero, and requests through local day seven qualify. This endpoint **does not
issue a refund, confirm settlement, cancel renewal, or end access**.

The separate `POST /api/subscriptions/test-refunds` now executes that saved claim
behind both `USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED=true` and the disposable
private `refunds_enabled=true` switch. It records the attempt before one provider
POST. Uncertain retries use GET only; zero/multiple matches need review, never a
second automatic refund. Fresh refund/payment GETs must prove exact full settled
amount, original payment, merchant credentials, receipt, and organization/request
notes before the access/renewal-stop transaction. Pending/failed observations
preserve access. An unrelated platform correction is not overwritten: processed
provider evidence remains stored for review. Existing claimed refunds can still
be reconciled through the signed Test webhook when the execution switch is off,
provided the base Test billing gate remains on.

The local owner billing panel shows paid-through time, recent payments,
owner-initiated renewal, cancellation confirmation, refund amount/effect review,
and post-refund plan comparison plus the existing sign-in/support boundary.
Repayment after refund is support-held; plan selection does not restart a trial
or create a grant. This Orders-only adapter has no SaaS recurring schedule to
cancel. Genuine Test refund `rfnd_ThQRsoOgXZ08eH` settled the first ₹799 payment;
disposable PostgreSQL confirmed access end and renewal stop once, preserving the
branch. All gates were restored off. Full application/native/RLS recovery and
genuine provider webhook delivery still require acceptance.

Renewal, refund-claim, and refund-execution drafts
`20260928110000_subscription_test_renewals.sql`,
`20260928120000_subscription_test_refund_claims.sql`, and
`20260928140000_subscription_test_refund_execution.sql` were applied only to the
existing disposable minimal schema. SQL boundary/replay/permission and
concurrency checks pass. Genuine Test refund settlement is verified above;
renewal provider acceptance, incoming provider webhooks and full application
acceptance remain pending. The billing panel mounts only in the gated local
Test flow. Production and local application billing flags remain off. Upgrades stay closed pending quote expiry/repricing;
paid slots stay closed pending add-on cancellation/refund/proration/renewal
rules; tier enforcement stays uninstalled pending the standard reminder schedule
and comprehensive server/database/send-boundary acceptance. No additional tier
contents or usage limits are inferred.

### Advanced billing Test implementation — 29 September 2026

The local-only, default-off draft now records immutable owner reviews for an
upgrade, paid slot, or restart; freezes one payable quote only when the private
commercial gate is approved; claims one recoverable Test order; and commits a
freshly verified captured payment with the corresponding tier, slot, or fresh
term. Stale captured money is saved for review without an entitlement change.
`20260929080000` through `20260929160000` also preserve first-payment/refund
history across restart and require an exact owner choice for paid slots at
renewal. The renewed base order includes each retained slot; chosen slot
cancellations and branch archives commit at the paid boundary. Late captured
renewals and processed first refunds that conflict with later paid charges are
held for support review without silently changing access. The Test owner
billing panel displays the frozen amount before advanced Checkout. Synthetic
full-schema SQL verification passed inside a rolled-back disposable transaction;
no advanced provider charge or Production migration occurred. Quote lifetime,
add-on terms, restart, Starter cadence, and tax/receipt policy still need owner
approval before the default-off switches can open payment. Genuine provider,
native, concurrency, and outage acceptance remain pending.

### Dark Usefulmade Live billing draft — 29 September 2026

The local draft adds a separate Usefulmade Live merchant configuration and
service-only mode/merchant/pilot-bound quote, order, payment, grant, refund and
webhook evidence. The Live order path claims one reviewed quote before provider
creation and uses exact-receipt GET recovery after an uncertain POST. A signed
Live webhook is stored before acknowledgment; fresh captured-payment GET and
the organization-locked initial settlement can grant access or preserve stale
funds for review. The full first-payment refund draft verifies the original
payment and exact settlement, and holds later-charge/access races for review.
The named capability predicate recognizes Live grants for the shared RLS and
web/native account snapshot. A protected recovery endpoint revisits held
signed events. Checkout rechecks current gates and eligibility even for a
bound order. The term uses signed capture-event time rather than webhook
processing time. An owner-only read-only panel shows an already frozen exact
INR quote and can save Starter reminder acknowledgment; the grant transaction
normalizes Starter schedules before access changes. No quote writer or payable
UI exists. Later capability activation also audits Live Starter schedules and
unattempted custom reminder claims. These paths are not deployed.
Database constraints keep new Live orders and refunds impossible to enable in
this draft; all runtime/intake/settlement switches default off. No Live
credentials or money were used. Rolled-back synthetic full-schema SQL passed;
approved offer/tax/term references, approval of Starter's standard cadence and genuine provider acceptance
remain required before a pilot.

### Capability-boundary draft — 28 September 2026

The local draft `20260928160000_subscription_capability_boundary.sql` now
mirrors the approved capability names in the existing authorized product-access
snapshot and a database predicate. It guards new campaigns, configurable
automations, Payment Links and AutoPay setup; server workers recheck the snapshot,
and web payment controls/editors explain restrictions. Starter downgrades retire
pending campaigns and automation waits atomically. The draft preserves standard
reminder permission and existing financial reconciliation. It is not installed;
its separate `capabilities_enabled` switch is false. The 29 September continuation
adds a database and settings boundary for custom renewal offsets, a claim and
pre-send check for standard reminders, and a pre-provider AutoPay recheck.
Activation still needs the owner's Starter cadence and review of existing custom
schedules; complete UI/native/send-boundary acceptance and rollout remain open.
Commercial proposals and the precise unfinished work are in
`PRDs/roadmap.md` under **Subscription product continuation**. They are proposals,
not approved terms, payable quotes, or permission to enable billing.

## Approved branch packaging

| Tier     | Branches included | Expansion rule                                                                                 |
| -------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| Starter  | 1                 | No branch add-on. For a second branch, choose Growth plus its paid add-on, or choose Ultimate. |
| Growth   | 1                 | One paid additional branch; maximum 2 branches total.                                          |
| Ultimate | 5                 | Additional branches are paid add-ons. No unlimited included branches.                          |

The branch counts are product packaging decisions, not cost-validated conclusions. **Only active branches consume a plan or paid extra-branch slot.** An archived branch keeps its history and frees its slot; restoring it consumes a slot again and must be refused when no verified capacity is available. A read-only branch is not active and does not consume a slot. The shared 14-day trial allows **five active branches**, matching Ultimate’s included allowance. Trial creation and restore both consume an active slot; a sixth active branch is unavailable during trial. No existing branch is automatically archived or deleted if an organization is already over the limit.

**Approved conversion rule:** if a gym chooses a paid tier with fewer slots than its active trial branches, the owner explicitly chooses which branches to archive, or chooses a tier and verified add-ons that cover all active branches. Preserve every branch and its history; never auto-select, auto-archive, or delete branches. Conversion stays blocked until the selected active count fits verified capacity. The local Test owner recovery flow now offers exact branch selection and rechecks capacity in the database, but remains unapplied and unverified against a disposable database.

## Approved provisional monthly INR pricing

| Tier     | Monthly software price | Included branches | Extra-branch software price            |
| -------- | ---------------------: | ----------------: | -------------------------------------- |
| Starter  |                   ₹799 |                 1 | No add-on; upgrade to expand.          |
| Growth   |                 ₹1,499 |                 1 | One at ₹499/month; maximum 2 branches. |
| Ultimate |                 ₹3,999 |                 5 | ₹499/month for each additional branch. |

Growth with its one paid extra branch is **₹1,998/month in listed software charges**. Ultimate with six branches is **₹4,498/month in listed software charges**. These are accepted provisional launch/pilot monthly prices, not a cost-validated margin or a live checkout offer. No annual price or discount has been approved. Tax treatment and the exact customer-payable amount remain unresolved; do not label these prices “plus GST” or “GST included.” No quote, payment request, or charge may bypass the existing closed commercial-readiness gate. An extra-branch slot becomes usable only after Usefulmade verifies its payment and commits the paid entitlement; pending or failed payments grant no capacity. Archiving a branch frees active-branch capacity but does not automatically cancel or refund a purchased add-on. The default-off Test draft implements actual-term proration, renewal with the base, and exact-roster cancellation; owner approval of those terms and the add-on refund policy remains open. Market comparators are advertised offers, not proof of UsefulDesk's costs or customer willingness to pay.

## Approved base-tier changes

- An upgrade takes effect only after Usefulmade verifies payment and commits the higher organization entitlement. Charge only the positive difference between the two listed base-tier monthly software prices for the remaining actual current paid period. Calculate in INR paise using the period's real start/end instants and round half-up to one paise. Pending or failed payment leaves the existing tier in place; a payment confirmed after that paid period cannot activate the stale quote. The customer-payable quote still requires an approved tax treatment and commercial readiness.
- A downgrade is scheduled for the next renewal. Keep the existing tier through its paid-through end. At renewal, commit the lower tier only with a verified renewal payment and an active-branch roster that fits the lower tier's verified capacity. Any owner-selected archives must actually be applied in the same organization-locked transaction; selecting branch names in a dialog alone grants nothing. Until the new term is committed, no lower-tier paid access is inferred.
- Cancellation is scheduled for the next renewal boundary. Keep access through the existing paid-through end; do not renew after it. Any early-ending exception needs a separate decision. Purchased-slot cancellation is separately owner-reviewed at paid renewal in the disabled Test draft.

## Approved failed paid-renewal grace

If a renewal payment for an existing paid organization fails, keep its **current tier and existing verified branch capacity for 72 hours** after the stored paid-through instant. The window is the half-open interval from `paidThroughEnd` to `paidThroughEnd + 72 hours`; it is fixed to that original boundary, so later failed retries cannot extend it. Do not grant an unpaid tier upgrade or new paid branch slot during grace. A matching server-verified renewal payment commits the next paid term and returns paid access from verification; if verification arrives after the grace deadline, access is closed in the intervening gap. A scheduled downgrade remains on the old tier during grace and still needs verified payment plus the owner-authorized post-archive roster before the lower tier begins. This grace applies only to a failed renewal of an existing paid grant. First checkout, trial expiration, and an intentional end-of-term cancellation receive no grace. Manual pilot terms currently use their separate settlement-verified procedure; an unsettled manual term is not automatically treated as a failed paid renewal.

## Approved subscription refund policy

- The first verified UsefulDesk subscription payment can be requested for a **full refund** within seven calendar days, once per customer organization. Use the request's recorded receipt timestamp for eligibility, even if processing happens later. The first payment's local date is **day 0**; the request is timely through **23:59:59.999 on local day 7**, and local day 8 is late. Freeze an IANA billing timezone from the paying account's resolved locale on that first payment record; a later account or device timezone change cannot move the window. The full amount is the actual first Usefulmade SaaS payment, including any software add-on on that same payment, not a partial-month calculation or a gym-member collection. One organization may reserve only one first-payment refund claim; retrying the same request returns that claim.
- Later renewals have no routine partial-month refund. A normal cancellation prevents the next renewal and preserves access through the paid period. Correct duplicate or incorrect Usefulmade SaaS charges separately. Review accidental renewals and serious service failures individually, without limiting applicable legal rights.
- This policy covers UsefulDesk subscription fees only. Charges paid directly to Meta or another provider remain with that provider's process. **After a matching provider-confirmed full first-payment refund, cancel renewal and end paid operational access at confirmation.** Preserve the gym's data and sign-in, including support and plan-selection recovery; never delete or auto-archive branches. A pending, failed, partial, or unverified refund changes neither paid access nor renewal. The local pure model checks eligibility and outcome; the separately gated Test adapter can issue and verify a Test refund. Neither authorizes a live refund or changes Production access.

## Approved collection packaging

Growth includes Razorpay Payment Links and automatic recurring collection through AutoPay; Ultimate inherits both. Starter's proposed collection path is manual payment recording. The gym-member collection features require each gym's own eligible, connected Razorpay merchant, provider approval, and the applicable mandate readiness. Existing provider gates continue to decide whether an individual gym can use them. Razorpay charges the gym under its merchant terms; those fees are not bundled into or subsidized by UsefulDesk's software subscription. This packaging does not establish that Usefulmade has zero operating cost: support, event processing, storage, and any Usefulmade-funded messages remain unquantified. Usefulmade's separate SaaS merchant cannot be used for gym-member collections.

## Approved messaging packaging

Starter includes automatic renewal reminders on a standard schedule; Growth and Ultimate inherit them. Growth adds custom reminder schedules, bulk campaigns, and configurable automation rules; Ultimate inherits those too. The standard schedule's exact days and times remain to be chosen. Starter is not barred from every automatic send merely because custom schedules and configurable automations belong to Growth. Every send still requires a connected WhatsApp account, the relevant Approved and synced template contract, and the existing send-readiness checks. Meta messaging charges remain payable by the gym separately from UsefulDesk, and none of the tiers has a UsefulDesk monthly message-count cap or message overage charge at launch.

## Candidate feature shape — pending approval

| Tier     | Customer job            | Candidate distinction to validate                                                                                                                     |
| -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starter  | Run the daily gym desk  | Members, attendance, renewals, manual payments, and shared Chats. Automatic renewal reminders on a standard schedule are approved above.              |
| Growth   | Follow up at scale      | Starter plus proposed lead pipeline, flows, services, and deeper finance. AI drafts, if included, use the gym's own provider key.                     |
| Ultimate | Manage several branches | Growth plus proposed consolidated reporting and owner exception views. Automatic collection is already part of Growth, subject to merchant readiness. |

The candidate feature table is **not** a saleable feature matrix. Payment Links, AutoPay, and broader Razorpay merchant rollout retain their separate readiness gates despite the approved Growth/Ultimate tier placement. The three cards must state only generally available, tested features and show any prerequisite plainly. Ultimate does not imply unlimited capacity or hands-off, guaranteed collection. No unlimited-staff, GST-invoice, or autonomous-collection promise is approved. Whether members are capped at all, which other features belong in each tier, and staff limits remain open.

## Money and entitlement boundaries

- Usefulmade charges a gym for UsefulDesk through **Usefulmade's SaaS merchant account**. A gym charges its members through the **gym's own merchant account**. Keep credentials, customer/payment references, invoices, refunds, webhook events, accounting, and reconciliation separate. A gym-member payment cannot activate a UsefulDesk subscription.
- SaaS billing belongs to the organization, while branches/accounts inherit its entitlement. Named capability predicates must be used by UI and API callers and mirrored by RLS/SECURITY DEFINER checks. A hidden button alone never enforces a tier.
- Provider callbacks are authenticated and durably deduplicated. Entitlement transitions use verified provider state plus local billing records and must tolerate retries, delayed or out-of-order events, failed payments, refunds, cancellation, and recovery. Do not replace the current access model with an account-level `status` shortcut.
- Trial expiry and paid entitlement boundaries must also protect native clients, public API keys, automations, scheduled sends, broadcasts, and direct database access. Inbound WhatsApp/provider events and gym-member financial reconciliation continue under the existing access containment rules.
- WhatsApp charges incurred by the gym and Razorpay fees on the gym's collections are distinct from UsefulDesk's software price. The gym bears Razorpay merchant fees under its own terms. Meta messaging charges apply separately to the gym under its own WhatsApp billing terms; Usefulmade does not bundle or subsidize them. Usefulmade's support, event-processing, storage, and any future funded messaging costs have not been measured for this package.
- **At launch, Starter, Growth, and Ultimate have no UsefulDesk monthly message-count cap and no UsefulDesk message overage charge.** This is separate from Meta's pricing, free service allowance, quality rules, and sending limits. Retain technical rate limits, abuse controls, and usage monitoring. Public copy may say “No UsefulDesk monthly message cap” and “Meta messaging charges apply separately”; never promise free messages or unlimited delivery capacity. Historical 1,000/5,000/25,000 tier counts are not approved.
- **GST status and preparation choice confirmed by the owner on 2026-09-27:** Usefulmade is currently not GST-registered, and the owner chose to prepare subscription billing without adding GST. The owner reports that Usefulmade operates in Punjab, is their only business, has zero current business turnover, and that UsefulDesk is the only intended income-producing product. These statements are planning facts, not a determination that subscription payments can be collected without registration. Local billing drafts therefore add ₹0 GST to listed software amounts; they are not customer-payable quotes. Before any paid pilot, confirm the relevant PAN-wide financial-year turnover, customer geography, possible compulsory-registration circumstances, and accounting treatment with a qualified tax adviser. Do not publish a GST-inclusive/exclusive claim or call the service exempt or zero-rated. SaaS receipts are separate from gyms' member invoices.

## Proposed screen flow

- Public pricing: three ascending cards in Starter → Growth → Ultimate order, with the approved provisional monthly INR prices, a short feature comparison, explicit approved usage limits, and separate provider charges once tax and the remaining offer terms are settled. Do not show an annual option until its price and terms are approved. Growth may carry a **Recommended** label; do not claim **Most popular** without customer data. A trial CTA leads to the same signup flow from every card. Selecting a card for browsing may preserve interest, but it does not limit the trial.
- Branch expansion: when a paid Starter gym tries to add a second branch, show a contextual upgrade prompt offering Growth **plus its ₹499/month paid extra-branch add-on** or another suitable tier such as Ultimate. State that Growth alone includes one branch. Show the exact customer-payable amount and billing effect before confirmation; until tax and billing mechanics are approved and enforcement ships, do not offer an actionable paid upgrade.
- Trial: show the exact end date and a clear route to compare plans. Before expiry, explain which capabilities the gym has used that require a higher tier; do not silently remove work or delete data when a lower tier is chosen.
- Expired trial: three plan choices, exact payable amount/term/tax treatment, checkout, support, sign-out, and organization switching. Suspension and payment failure must have their own accurate reason and recovery action; they are not described as trial expiry.
- Awaiting payment: show that access is being confirmed, with a retry/check path. A checkout return never changes the entitlement on its own.
- Paid: Settings → Billing shows the current tier, paid-through date, billing history, a reviewed prorated upgrade quote, and scheduled downgrade/cancellation details when a verified billing system and the remaining offer terms are ready.

### Contextual paywall reference and proposed adaptation

**Verified Figma behavior:** Figma can present a seat request when someone attempts an action their seat cannot perform, such as creating an unavailable file type; manual requests go to admins. Its admin review shows request context and the cost of a new paid seat, and its checkout includes a review step before purchase. Sources: [Make a seat request](https://help.figma.com/hc/en-us/articles/360040453433-Make-a-seat-request), [Approve or decline seat upgrade requests](https://help.figma.com/hc/en-us/articles/1500003870721-Approve-or-decline-seat-upgrade-requests), [Upgrade or downgrade your plan](https://help.figma.com/hc/en-us/articles/360046216313-Upgrade-or-downgrade-your-plan).

**UsefulDesk adaptation:** At a blocked action, explain the specific plan limit in a dismissible prompt and show the suitable tier or add-on. For Starter's second branch, say that Starter includes one branch, Growth also includes one and needs its paid additional-branch option for two total, while Ultimate includes five. Show the exact payable amount, billing term, and any approved tax/provider charges before a separate purchase confirmation. Only the organization owner or an explicitly authorized billing admin may confirm a purchase; other staff can ask that person to review it. Dismissing the prompt returns to the existing work. A limit or downgrade must not silently delete existing records; access to existing work follows the already approved trial and product-access policy. This is a UX proposal for UsefulDesk, not a claim that Figma uses this exact branch flow or that a paid paywall has shipped here.

## Decisions still needed before paid implementation

1. Final feature matrix and enforceable team/member/usage limits; choose the standard renewal-reminder days and times, implement the approved owner-choice conversion flow for a trial with more active branches than a lower tier, and confirm which Ultimate capabilities are saleable at launch.
2. Annual prices/discounts, branch-add-on cancellation/refund/proration and renewal rules, any founding-customer terms, whether non-India accounts can subscribe, and any provider charges beyond the already separate gym-paid Meta and Razorpay fees.
3. Access treatment for exceptional corrections beyond the approved full first-payment refund, any early-cancellation exception, quote expiry/repricing, and treatment of existing complimentary and manually paid organizations in an eventual automated billing rollout.
4. Qualified tax/accounting confirmation for Usefulmade's circumstances and the resulting quote, receipt, and invoice format. Never put a GST amount on an unregistered-supplier document.
5. Live merchant readiness and explicit authorization for a controlled real-money SaaS pilot after test-mode success/failure/retry/refund acceptance.

## Implementation order

**Code foundation (plan comparison deployed; Test billing remains local and disabled):** `src/lib/subscriptions/plans.ts` now defines the approved tier names, monthly listed software prices, branch allowance arithmetic, and the six approved capability predicates. The product-access gate has a plan comparison during the trial and after trial expiry, and keeps Production purchase actions unavailable while the commercial gate is closed; a separate non-Production flag shows local Test prices and Checkout after expiry. `BranchExpansionPrompt` is built and tested as a dismissible explanation; it is not mounted on branch creation until a verified organization tier and paid extra-branch slots exist. The pure model now counts active branches and projects both create and restore against the same allowance, including the approved five-active-branch trial limit. Complimentary and existing manual organizations retain their current branch behavior. `src/lib/subscriptions/branch-slots.ts` models pending, failed, and verified add-on orders, idempotent confirmation, and capacity from verified purchases only. Its `server_verified_payment` event is an input contract for a future trusted verifier, not live provider verification; no caller uses it to activate access today. `src/lib/subscriptions/conversion.ts` and `SubscriptionConversionReviewDialog` provide an organization-scoped owner-choice preview that refuses an over-cap conversion until the owner selects active branches to archive or verified slots cover them. In the local Test flow, the dialog submits explicitly selected branch IDs to the owner-only expired-trial archive RPC. The SQL migration has only been applied to a disposable local fixture; no live branch is changed. `src/lib/subscriptions/billing-transitions.ts` adds pure paise-exact base-tier proration and pending/verified upgrade plus scheduled downgrade/cancellation projections. `src/lib/subscriptions/renewal-grace.ts` models the fixed failed-paid-renewal window, preserves the old tier during grace, refuses cancelled renewals, and requires a trusted verified event for the next term. `src/lib/subscriptions/refund-policy.ts` evaluates the first-payment request using a frozen account billing timezone and reserves one organization claim without issuing a refund. `src/lib/subscriptions/refund-outcome.ts` models the confirmed full-refund access end and required renewal stop; pending/failed events are harmless and exact confirmed replays are idempotent. `src/lib/subscriptions/no-gst-billing.ts` prepares review-only monthly and prorated-upgrade amounts with a visible unregistered no-GST mode and ₹0 GST; it cannot issue a quote or charge. The pure billing and refund models use trusted-input events. The separate local Test adapter verifies the first captured provider payment and calls the draft entitlement transaction; its later local slices implement owner-initiated renewals and full first-payment refunds as described above. No Production paid tier is assigned, charged, refunded, or enforced by these local files.

**Database enforcement design for the next slice:** keep any paid entitlement beside `private.organization_product_access`, keyed by organization, with server-verified Usefulmade payment evidence and an explicit effective term. Never infer a grant from a pricing-card click or checkout return. Trial, complimentary, and existing manual access must preserve their current capabilities. Once active, mirror each named capability in a database predicate used by the relevant RLS policies and SECURITY DEFINER RPCs, with API/UI checks only as early feedback. Both `create_organization_branch_from_setup` and the legacy `create_organization_branch` path ultimately insert an active branch; `restore_branch` changes an archived branch to active. The existing setup-copy create RPC locks the organization row before its insert, while restore currently locks the target account first and has no organization lock. Before paid enforcement, both paths must serialize on the same organization row, count `accounts.branch_status = active` after acquiring that lock, and compare the proposed active count against five for a live trial, or against included branches plus **verified** extra slots from a private organization grant for a paid term. Trial capacity is organization-wide, never tied to the pricing card a gym clicked. The future billing write must verify the Usefulmade merchant, provider order/payment state, organization, currency, amount and immutable purchased quantity before committing a grant; unique purchase and provider-payment keys plus an idempotent transaction must keep duplicate or delayed callbacks from adding slots twice. Pending/failed orders contribute zero, and archiving changes the active count without mutating the paid add-on record. Change restore to take the organization lock before the target account lock; make a database trigger on active inserts and transitions to active the final check so direct writes and old clients cannot bypass either RPC. Keep the RPC check for clear errors and idempotent replay, and test simultaneous create/create, create/restore, and restore/restore transactions. A blocked restore must leave its archived history untouched. Trial, complimentary, and legacy manual terms retain their current branch behavior; a missing paid grant fails closed once paid enforcement is enabled. A future conversion transaction must take the organization lock, re-read the active roster and verified slots, check the owner's exact selected branch IDs and roles, then apply only those archives with the paid entitlement; it must reject stale rosters and leave history untouched on failure. Do not activate this check until that conversion transaction, actual provider-verification and paid-entitlement storage, and remaining billing terms are implemented and tested. For a trial already above its limit, preserve every branch and block only new active-branch transitions; never auto-archive or delete history. Gate custom schedules, bulk campaigns, automation activation, gym Payment Links, and AutoPay at their server/database write or send boundaries; retain provider readiness and existing product-access checks. No message-count gate is added. Keep this entire paid-enforcement rollout disabled until database, native/API, and recovery tests pass.

The future billing transaction must tie each base-tier upgrade quote to its organization, current entitlement version, actual period, requested time, target tier, exact INR amount, and one verified Usefulmade payment. Reject stale quotes after a changed period or tier; never grant an upgrade from a pending or failed event. At renewal, hold the organization lock while checking the scheduled downgrade or cancellation, current paid-through end, verified renewal evidence, and post-archive branch capacity. A failed paid renewal must retain the original paid-through end and compute its single 72-hour grace deadline from that immutable instant; a retry cannot reset it. While in grace, server/database gates must retain the previous tier and verified branch capacity but deny any unpaid tier or branch expansion. Apply a verified renewal entitlement and any owner-authorized downgrade archives atomically; duplicate callbacks must leave the same term and tier. A cancellation stops renewal at the stored end without revoking the paid term early and never enters grace. Quote expiry/repricing and other unresolved billing terms still block live enforcement.

For a first-payment refund, the Test transaction now follows these invariants; the full application/native acceptance remains pending. It must verify the immutable first Usefulmade SaaS payment and its organization, full captured amount, payment timestamp, and saved billing timezone; record the original refund request timestamp; and enforce a unique first-payment claim per organization. A duplicate request must read back the same claim rather than start another provider refund. Check merchant/provider refund status and ledger idempotency before any money movement. After matching provider confirmation of the **full** refund, atomically end only that organization's paid entitlement at confirmation and stop its future renewal, including any provider-side recurring schedule; retries must apply this once. Pending, failed, partial, or mismatched events do not end access. Preserve all account, branch, and member rows plus authentication. Reuse the existing blocked-access recovery boundary for sign-in and support. The local Test web panel now adds plan comparison for refunded paid organizations; Production remains support-only; restart Checkout is implemented only in the disabled local Test draft and needs genuine provider acceptance. Apply the same outcome in native, API, scheduled jobs, and RLS before enabling refunds. Corrections and individual reviews are separate audited paths, never an automatic partial-month refund on a later renewal.

1. Approve the tier matrix and commercial/tax policies. Reconcile the older `multi_gym_saas_prd.md`, pricing research, and commercial operations note with those decisions.
2. Add organization-level plan and SaaS billing records beside the current access row; implement named tier capabilities and database enforcement with migration/test acceptance. Preserve complimentary and manual terms during rollout.
3. Add the three-card trial/expiry/billing experience and separate Usefulmade checkout/webhook integration. Payment confirmation, not a return URL, activates access.
4. Exercise provider Test mode success, failure, duplicate/delayed/out-of-order webhook, renewal, cancellation, refund, and recovery cases. Verify tenant isolation, backend gates, native/API behavior, and that gym-member ledger/mandates are untouched.
5. Run a controlled, explicitly authorized live pilot before publishing paid promises broadly. Update `docs/changelog.md` and `PRDs/roadmap.md` when the feature actually ships.
