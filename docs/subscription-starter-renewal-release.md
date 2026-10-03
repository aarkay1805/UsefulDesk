# Starter customer renewal — closed release packet

**2 October 2026: implementation and local acceptance complete. Production
installation, deployment and renewal opening are pending.** This packet covers
STEP 1 only. It authorizes no customer charge, refund, send or gate change.
Those are the original STEP 1 observations. On **3 October**, the exact source
was installed closed in isolated Billing Staging and passed connector rollback
and real Auth/PostgREST plus signed synthetic-webhook acceptance. All baseline
counts/settings and hard closure were restored before Staging was re-paused.
Production installation, app publication, genuine provider acceptance and
renewal opening remain pending; see the
[coordinated packet](subscription-coordinated-release-2026-10-03.md).

## Exact scope and deadline

The first intended customer is Justin, using his existing reviewed Starter
customer scope and ₹799 gross INR offer. His verified current term ends at
**2 November 2026, 17:54:56 IST** (`2026-11-02T12:24:56Z`). Complete the
separate release acceptance before that deadline; the owner can initiate a
renewal only after expiry. Payment creates one calendar month from its signed
capture time, with no automatic debit or early extension.

| Existing identity                  | Value                                  |
| ---------------------------------- | -------------------------------------- |
| Organization                       | `4c549182-7ad3-4f0b-8977-ff8ca79d2992` |
| Billing branch                     | `ffca6ffb-691b-4fa9-9b7f-481a22d00a2e` |
| Current owner                      | `34143181-5582-4bf0-b4ea-7ac25fb12906` |
| Original paid request              | `9e7cdc5f-f287-496a-a3cd-257ecaff6999` |
| Existing offer                     | `17824b7f-9735-4147-b969-27dd40658680` |
| Owner preparation/review reference | `c815eb04-99bf-4e0c-8e97-1884dbf1638b` |
| Existing merchant                  | `acc_TCJwBqanN9LTrK`                   |

Re-read these identities and current immutable customer-review binding during
acceptance. These dated facts do not grant standing permission for a new sale.
Existing first-sale invoice/receipt issuance and customer delivery are recorded
separately in [the issuance record](subscription-starter-document-issuance-record.md).

## Implementation contract

`20261002170000_starter_live_customer_renewals.sql` adds an unseeded, private,
immutable renewal release bound to an existing organization/customer review,
merchant and current owner. The record carries the exact release SHA, manifest
hash, authorization, provider acceptance and backup/recovery references. Text
references must be inspected by the release operator; database presence alone
proves no genuine acceptance. `owner_user_id` binds the existing owner and does
not claim a fresh owner acknowledgment.

Customer scopes gain `renewals_enabled = false` and a release reference. The
`subscription_customer_renewals_closed` check continues to prohibit opening.
Service can read the release; ordinary application roles cannot insert, update,
delete or truncate its authority. Revocation is one-way and closes renewals.
Original internal initiation and internal renewals retain their closed gates.

After a separately approved opening, the authenticated current owner reviews
the exact ₹799 amount and existing terms, then acknowledges the approved
standard reminder policy (7/3/1 days, after 09:00 in the gym timezone). A quote
freezes its predecessor, source access version, owner, review, release, roster
and reminder facts. An active term, stopped/refunded predecessor, suspension,
changed access, wrong organization, staff actor or overlapping quote is refused.
No higher tier, add-on, complimentary conversion or native Checkout is added.

The server resolves immutable customer renewal identity before reserving an
order, so a closed runtime gate leaves no stranded claim. Existing one-POST
creation, GET-only recovery, immutable binding and final claim check remain.
An expired quote with an unresolved order offers support/recovery instead of
another quote. Signed capture settlement retains original history and grants
one term once. Cancellation, stale access, release revocation, late capture and
changed branch roster hold captured money without granting access or refunding.
Replaying the original payment cannot replace the newer term.

Paid billing remains reachable by the owner even with first-purchase UI flags
off. Cancellation stops subsequent renewal and preserves paid access until its
existing end; it does not issue a refund. Existing closed first-payment refund
initiation and preserved financial recovery remain separate.

## Default-off installation and review boundary

Deploy this source with both new switches absent/false:

- `USEFULDESK_SAAS_LIVE_CUSTOMER_RENEWALS_ENABLED`: server renewal initiation;
  also requires existing customer scope/checkout support and database authority.
- `NEXT_PUBLIC_USEFULDESK_CUSTOMER_RENEWALS_UI`: build-time owner renewal UI;
  also requires the owner term RPC's separately authorized renewal availability.

The migration inserts no release, scope, offer, payment or access row and does
not remove the hard-closed constraint. Applying it through the approved
Supabase migration connector and deploying the reviewed app is a closed
installation, subject to its own release approval. Do not use `supabase db push`.
Read back schema, function bodies, ownership, empty search paths, RLS and ACLs.
An old app without the renewal identity field fails closed for new initiation;
install the migration before deploying the matching app.

The production environment audit rejects both new switches in all existing
accepted modes, including first-customer checkout. A later opening needs an
explicitly reviewed renewal audit mode and scoped activation migration/receipt
which removes the hard-closed constraint and binds only accepted real release
authority. Neither is supplied as an executable opening shortcut here.

The [source manifest](subscription-starter-renewal-manifest.tsv) hashes the
implementation, regressions and local SQL acceptance files. Baseline parent is
`9473819bf1a979118409d9ecfad6d3148edee6bf`; identify the committed release by the
commit containing this packet. Recompute the manifest against that exact tree
and record its SHA-256 in the eventual genuine renewal release. This packet's
20-source manifest SHA-256 is
`c0727bf30b2d21184ec477a8b90eb1b321e57628db8f5065a1e06d5143282151`.

## Local evidence and repeatable acceptance

All checks used this managed worktree and an explicitly disposable local full
database. They loaded no application environment file or cloud credentials.

```sh
npm run lint
npm run typecheck
npm test
npm run build
node scripts/verify-starter-live-renewals.mjs <full-container>
node scripts/verify-starter-renewal-concurrency.mjs <full-container>
```

The rollback runner applies the source twice, verifies the hard closure,
removes it only inside synthetic rolled-back fixtures, and checks expiry-only
quote/replay, role/tenant isolation, order recovery, shutdown settlement, five
capture holds, original replay and immutable term history. Existing internal
pilot, customer checkout, capabilities and post-refund manual preservation
assertions also pass. No Live schema survives rollback.

The concurrency runner creates and removes its own local clone. Independent
sessions prove one quote per predecessor, one provider-create claim, both
capture/cancellation lock outcomes and shutdown versus pending initiation.
Source accounts/users/gym-payment/mandate counts and absent Live schema remain
unchanged. See [runner boundaries](subscription-acceptance-runners.md).

The application suite passes **4,395 tests in 536 files**; lint, TypeScript and
the production build pass. Targeted failures were observed before the renewal
changes, including gate-before-claim and paid billing with purchase flags dark.
Independent Superpowers review found no outstanding Critical/Important issue
after those two fixes. Browser inspection used the actual shared component
with synthetic local responses at desktop, 390px and 320px; amount review,
reminder gating and expired ambiguous-order containment are visible without
horizontal overflow. This is not authenticated cloud or provider acceptance.

## Remaining genuine acceptance before opening

1. **Isolated cloud step complete, 3 October:** exact source installed closed,
   real Auth/PostgREST owner/admin/staff/outsider/cross-tenant boundaries and
   signed synthetic-webhook routing accepted. All baseline counts/settings and
   hard closure were restored before Staging was re-paused. See the
   [coordinated evidence](subscription-coordinated-release-2026-10-03.md).
   This does not establish genuine provider delivery or a deployed callback.
2. Record a fresh reviewed deployment/environment fingerprint and full backup
   with usable restore/recovery evidence. Compare before/after Justin's original
   payment, term, documents, owner/review/merchant, all customer gates and
   unrelated gym/tenant/financial data. Confirm standard reminders and one
   branch remain enforced; no renewal quote exists before actual expiry.
3. Obtain explicit authorization for a selected genuine provider acceptance
   transaction and any separately intended refund. Prove exact ₹799 signed
   capture, one new term, authentic replay, provider-create ambiguity/GET
   adoption, shutdown recovery and mixed gym/SaaS isolation. Synthetic SQL and
   previous first-sale evidence do not prove those renewal outcomes. The prior
   skipped authentic redelivery remains unproven until actually accepted.
4. Inspect current genuine buyer/supplier/tax/refund-support terms and current
   owner/review binding. Preserve the existing unregistered supplier's gross
   price and document wording unless a new actual review changes it. Record
   operator authorization and acceptance references without manufacturing
   owner approval. Justin must review each new amount/reminder choice himself.
5. Present the exact opening transaction, release SHA/manifest, accepted
   organization and rollback/containment checks for separate authorization.
   Only then install its scoped activation source and reviewed audit mode,
   create the real immutable release, bind it and enable the matching database
   and runtime/build switches. Verify all other scopes remain closed.

Rajat/release operator owns these remaining steps. This packet schedules no
automation, sends no message and requests no payment from Justin.

## Containment and existing obligations

Close customer renewal/quote/order initiation and runtime/UI switches to stop
new checkout. Preserve immutable reviews, releases, quotes, orders, receipts,
payments, terms and documents. Keep customer identity resolution, signed intake,
settlement and scoped GET financial recovery available for existing obligations.
A simple initiation shutdown still permits an already matching signed capture
to settle. Revoking release authority is stronger: it retains captured money in
an owned review hold and grants no access. Do not revoke evidence as a routine
shutdown test or promote/refund a hold automatically. Use the existing
[financial recovery runbook](subscription-financial-recovery-runbook.md).
