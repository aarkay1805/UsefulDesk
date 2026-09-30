# Starter Live pilot opening — review candidate

**Prepared and verified on empty staging; Production remains intake-only.** This package prepares the
selected Home office internal acceptance path. It does not open payments, seed
an offer, establish a customer sale, issue an invoice, send a WhatsApp message,
or establish genuine Live provider acceptance.

Production's installed 26-source dark schema, Live configuration and approved
intake-only webhook remain on PR #20 main `5920fa78`; every money/capability/
policy/advanced/Test switch is false, and no Live SaaS transactions or grants
exist. PR #21 contains implementation `33df55bfe56495cfe24682cf67ea71ccd05f409f`
and staged evidence `c3031efaf56868470c846ec0a5485dd301dc744e`. That candidate
is closed and installed on staging only. Its final Production release and
installation/opening authorization remain pending; see the
[release review](subscription-release-review.md) and
[latest read-only preflight](subscription-rollout-preflight.md).

## Exact candidate

- Merchant: `acc_TCJwBqanN9LTrK`.
- Organization: `8826d9aa-03f2-4ad7-ae91-0553052131f8`; one active INR branch.
- Starter: ₹799 gross (`79900` minor units), one calendar month from signed
  capture, 30-minute reviewed quote.
- Existing complimentary access remains until verified captured settlement.
  An eligible fully processed first-payment refund ends paid access; it does
  not restore complimentary access.
- Initial-term acceptance only. Renewals remain hard-closed. Native Checkout,
  advanced add-ons, broader merchants/organizations and global capability
  activation remain separate scope.

The candidate migration
`20260930164040_starter_live_pilot_opening_preparation.sql` replaces universal
initiation refusal with exact pilot constraints and operator-selected immutable
opening-review evidence. It seeds no review/offer and changes no switch. Owner,
release/manifest, authorization, provider-preflight, tax/receipt and backup
references must describe actual reviewed evidence. A nonempty reference cannot
prove its contents. Provider preflight is a prerequisite to controlled Live
acceptance; genuine Live capture/refund proof follows that run and cannot be
invented as a prerequisite already satisfied.

The selected organization and supplier share a proprietor. Record any controlled
run as internal technical acceptance, without a self-invoice or claim of a
customer sale. The conditional ordinary customer invoice/receipt remains in the
private issuer draft; actual buyer geography, applicable registration and final
wording must be determined before issuing a genuine customer offer.

## Configuration phases

The explicit environment audit modes never authorize activation:

| Phase                              | Audit                        | Permitted Live switches                                                                                              |
| ---------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Current intake only                | `--allow-live-intake-only`   | Signed intake only; every money/UI flag closed.                                                                      |
| Reviewed first Starter pilot       | `--allow-live-starter-pilot` | Exact-bound intake, quotes, orders, refunds, settlements, refund reconciliation, review UI and Checkout UI together. |
| Recovery after stopping initiation | `--allow-live-recovery-only` | Exact-bound intake, settlements and refund reconciliation; quotes/orders/refunds and review/Checkout UI closed.      |

Test/acceptance flags and opaque safety switches stay blocked. The database
separately binds the selected approval/review and approved 7/3/1 after-09:00
reminder policy. Global capability activation requires its own reviewed
acceptance. Keep in-flight evidence and reconciliation available when stopping
new quote/order/refund initiation; an application rollback cannot undo money.
Already bound captures/refunds can reconcile after initiation closes, but closing
complimentary conversion causes a later first conversion capture to be held as
`review_required`, preserving complimentary access. No implemented resolver
promotes that held payment later. An uncertain
provider POST with no saved provider ID remains an operator-owned exception:
perform the approved GET lookup for its exact receipt/request, verify and durably
bind the result before reconciliation. The candidate adds no automatic recovery
API for an unbound claim, and initiation endpoints refuse retries with their
runtime flags off.

Use the [controlled acceptance walkthrough](subscription-live-acceptance-walkthrough.md)
for actual provider/send evidence and the
[financial recovery runbook](subscription-financial-recovery-runbook.md) for
held or uncertain effects. The [customer document pack](subscription-customer-document-pack.md)
contains conditional, unissued drafts for a genuine buyer; it does not turn this
same-proprietor run into a sale or invoice.

## Required verification and activation sequence

1. Review the code, database candidate and immutable evidence requirements;
   run focused regressions, rollback-only opening SQL, existing full-schema
   acceptance and required repository verification. Pin the final release and
   migration hashes. Record actual results below.
2. Verify the cloud staging schema and default-closed install under the
   authorized staging preparation. Use the approved migration connector;
   never `supabase db push`. Inspect RLS, grants, constraints and the no-write
   state, then rollback disposable acceptance data. No Live credentials or
   real provider transactions belong in staging.
3. Complete the actual renewal-template prerequisite. The 30 September
   read-only inspection found the owner branch connected/registered/subscribed.
   `gym_service_renewal` matches the canonical Approved POSITIONAL contract;
   `gym_membership_renewal` previously retained older body/footer/buttons
   and only four variables, so current feature readiness refused it. Prior
   deliveries of that older template do not prove current-contract delivery.
   The owner explicitly authorized submission of the exact canonical membership
   replacement; it was submitted and shows **In review**, with five variables,
   no footer and one “Help me renew” reply button. Meta approval/sync and a specifically
   selected, authorized acceptance recipient remain before actual delivery.
4. For the exact Production opening review, refresh backup, deployment,
   environment and scheduling evidence. Present the real review/offer facts,
   selected switches and access consequences for approval. No offer/review row
   is seeded until the references and human authorization are real.
5. A human completes any real payment. Verify the bound order/receipt, signed
   capture, provider GET facts, durable dedupe, term/access result and shared
   gym routing. Verify failure/late-capture holds without manufacturing a
   Production event. Capture missing evidence as pending rather than calling
   Test or locally signed samples genuine Live delivery.
6. Present a reviewed first-payment full-refund request with the exact amount,
   original payment, request time, policy and access consequences. Verify
   processed provider facts, signed delivery and refund/access recovery. Stop
   new initiation, keep reconciliation available, and close any uncertain
   effect with an owner and next action.

## Validation record

Repository verification passed: ESLint, TypeScript, 4,183 tests in 522 files and
the optimized Production build. The audit suite passed 117 focused tests.
Current deployed intake-only acceptance is
recorded separately in
[the installation record](subscription-production-install-record.md#approved-intake-only-activation-1615-utc).
The capture/refund adapter now verifies that the provider-returned order ID
matches the saved bound order; changed IDs, receipts and request notes are
refused before any refund POST. Focused adapter/flow/receiver checks passed
52 tests in seven files before integrating the opening/audit candidate.

The guarded local opening runner passed all six assertion sections and replayed
the candidate twice for idempotency. The three existing Live boundary/renewal/
complimentary suites and the existing capability suite passed independently.
All local fixtures rolled back and left no Live schema installed.

On 30 September at 16:50 UTC, the approved migration connector installed only
the closed candidate on empty `UsefulDesk Billing Staging`
(`otagotpezshybxkagtwv`). Repository filename:
`20260930164040_starter_live_pilot_opening_preparation.sql`; connector history:
`20260930165031_starter_live_pilot_opening_preparation`, entry 57. The source
SHA-256 is `c2c05979cd04bf7c815a7d22e3d131d6747970ae54cf3de983822f0abecada62`.
This mapping records the existing connector/repository history divergence;
do not repair it using `db push`.

The 16:50 UTC execution record reports an assembled opening/capability fixture
passing on cloud staging inside
`BEGIN/ROLLBACK` (only psql meta-commands removed; fixture SHA-256
`c2d6b0215339aba403910b10681b3b657cfe0124e0256fd1806458049209f953`).
Release review cannot reproduce that hash from current pinned candidate bytes:
the current psql-stripped fixture is
`384c0bdc331f98cf35f9176c3c82aac1c2f7debdb1a322c34df6f2db4d146ebf`.
The historical execution is retained, but its exact fixture-byte attribution is
unresolved. The fresh exact-source replay below supplies current cloud acceptance;
do not substitute its hash for the historical execution. After
rollback: zero Auth users, accounts, organizations, offers, opening reviews,
orders, payments, refunds, events, paid grants and active cron jobs; all Live/
Test/capability switches false, merchant/pilot/review bindings null. All private
Live tables have RLS, operator writes and service SELECT only; anon/authenticated
access and service direct DML/TRUNCATE are denied.

The capability fixture proves unchanged access for valid nonpilot manual,
trial and complimentary organizations; paid Starter permits only standard
renewal reminders, with authenticated snapshots, visible-row custom-schedule
write refusal, and expiry/refund revocation. Because `NOW()` is transaction-fixed
while settlement uses wall time, a nested savepoint aligns only the exact
synthetic grant/access start for active reads. It restores the immutable-grant
trigger before assertions, proves mutation refusal, and rolls back to the exact
original grant/access/settings. That clock fixture is not provider settlement
evidence. Production still has five organizations (one manual, two trial, two
complimentary), no paid grants and capabilities disabled; refresh their actual
state before considering any separate capability activation.

### Exact-source staging replay, approximately 17:45 UTC

The owner-authorized rollback-only staging preparation replayed the current
candidate fixture through the approved SQL connector. The complete payload
SHA-256 is `a9bd010e4d58b74cbabf97c34302fa0129a991f1c1f3c3cd17d6a9547764f0f9`;
the psql-stripped fixture SHA-256 is
`384c0bdc331f98cf35f9176c3c82aac1c2f7debdb1a322c34df6f2db4d146ebf`.
All assertions passed. The 17:46:07 UTC postcheck found zero Auth users,
accounts, organizations, financial/event/offer/review/grant rows; all flags false,
merchant/pilot/review bindings null, cron inactive, and the immutable-grant trigger
restored. This supplies exact-current-source cloud SQL acceptance while preserving
the historical 16:50 hash discrepancy. It creates no Live provider evidence,
Production install, activation or customer document. See the
[release review](subscription-release-review.md) and
[read-only preflight](subscription-rollout-preflight.md).

### Earlier scoped advisor check

Security advisors introduced no WARN/ERROR finding. The sole added INFO is the
private opening-review table with RLS and no ordinary-user policy, intentional
deny-by-default ([Supabase linter reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).
Existing warnings remain at baseline; this is a scoped change review, not a
claim that the entire project has no advisory warnings.

Production installation/opening approval, final release SHA, approved/synced
membership template and authorized real delivery, genuine Live capture/refund
and shared-route proof remain pending. Local/staging synthetic fixtures do not
close those release gates.
