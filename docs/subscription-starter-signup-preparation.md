# Selected-gym Starter preparation — 3 October 2026

**Built, installed closed and deployed in Production as `c9da8c47`.**
The approved [coordinated release](subscription-coordinated-release-execution-2026-10-03.md)
published this form on 3 October; the post-deploy 07:36 UTC preservation check
and signed-in platform-admin view still show zero selected gyms/work rows.
Actual per-customer review, owner approval, scoped opening and payment remain separate.

## Current disposition

At **2026-10-02 19:34:12.968467 UTC** (3 October, 01:04 IST), Production had
**zero selected gyms and zero preparation work rows**. There is no customer
whose buyer/setup or commercial review can truthfully be filled in now.
Rajat owns the next review when an actual selected registration appears.
The existing prospective selection policy continues to preserve each normal
14-day trial. Natural passage to expiry does not rewrite a reviewed snapshot.
An extension, suspension or edited trial record requires a fresh review.

The MFA platform-admin page now includes **Prepare new gym businesses**.
`src/components/platform-access/starter-signup-queue.tsx` uses shared UI masters
and account locale formatting. The server derives actual review/payment stages;
operators maintain assignment, work status, next action and incomplete references.
No commercial reference or consent checkbox starts with an invented fact.

## Operator procedure

1. Open Platform admin and complete MFA. Review the actual selected gym and its
   active branch, verified owner, buyer details, setup and active plan prices.
   Missing facts stay visible; save partial work with an assigned current operator
   and a concrete next step. A changed revision or source snapshot refuses a stale save.
2. Inspect actual authorization, buyer/billing geography, supplier financial year,
   tax/receipt treatment, refund/support policy, merchant readiness, provider
   acceptance, backup/recovery, exact offer, customer tax/terms text and reviewed
   release SHA/migration manifest. Nonempty references are a checklist, not proof
   or standing clearance. Do not fabricate PAN-wide turnover, GST status, address,
   customer approval, payment or provider acceptance.
3. Save the actual review as **In review**, then explicitly confirm that the buyer,
   setup and every reference were inspected. **Freeze preparation** atomically
   creates one exact Starter offer and private immutable operator preparation:
   **79900 paise gross, INR, one active branch, one calendar month from verified
   capture, 1800-second quote**, and the approved 7/3/1-after-09:00 reminder policy.
   It creates no owner review, scope, quote, order, payment or access grant.
   Opening remains false and the existing trial is unchanged.
4. The release operator separately reviews the actual release and expiry before
   authorizing owner review. The actual authenticated owner then approves the
   terms/amount and reminders in their own account. The existing independent
   one-time service opening and verified signed-payment path remain required.
   This preparation form cannot approve on the owner's behalf or open checkout.

Frozen commercial evidence and source fingerprints cannot be rewritten through
the form. Assignment, work status and next step remain editable for handoff or
blocked work. Changed buyer/setup/owner/reminder/merchant facts make a tracked
preparation stale and stop new authority; refer replacement review to the release
operator rather than using an untracked preparation to bypass the boundary.
Bookkeeping timestamps/editor attribution alone do not invalidate commercial facts.
A legitimate verified transition to paid access also preserves that commercial review.

Source locks protect owner approval, scoped opening, quote creation and verified
payment insertion through commit. New source rows/moves serialize on the organization;
existing-source contention returns retryable SQLSTATE `40001` instead of a lock cycle.
Refresh and review before retrying. Signed webhook intake commits separately;
settlement failures receive HTTP 503 and financial recovery retries with its existing
five-minute backoff. Actual changed facts produce an owned review-required payment
hold with no access grant. Containment still permits original signed obligations to
settle when their reviewed facts remain valid. Paid retries retain their original result.

## Closed installation and preservation

Source: `supabase/migrations/20261003003000_starter_signup_preparation.sql`.
SHA-256: `7bc301a2d07015fced3b2f4b8549fe9c0a1635ac9bad39e5b81dc735abff7f71`.
Approved Supabase connector installation: Production history **20261002193254**,
name `starter_signup_preparation`; the stored statement SHA-256 exactly matches source.

Before/after observations at **19:31:10.277582 / 19:33:40.327600 UTC** preserved
all **33** financial/access/customer/gym relation counts and whole-row fingerprints.
The read-only recheck is `scripts/subscription-starter-preparation-preservation.sql`.
The new private work table has RLS; browser roles have no table access, service has
SELECT only and no mutation/TRUNCATE. The three public RPCs require the existing
MFA-admin predicate; private helpers deny ordinary-role execution. Definers are
postgres-owned with empty search paths. Draft references and next-step text stay
private; owner-readable audit entries contain only bounded metadata and fingerprints.

Installation seeds no work or commercial authority and changes no existing gates,
trials, paid terms, invoice/receipt originals, plan prices or customer records.
The separate customer-renewal schema remains absent in Production; this release
only verifies compatibility against its closed source locally. Higher tiers,
upgrades, add-ons, native Checkout and customer refund initiation remain separately gated.

## Acceptance

- **4,409 tests / 538 files**, lint, typecheck and production build pass.
- `verify-starter-live-pilot-opening.mjs <full-container> --preparation` replays
  the preparation migration twice and composes current pilot, owner, document,
  selection and closed-renewal sources in a rollback-only disposable database.
  It verifies missing facts, MFA/tenant/service denial, stale writes, exact closed
  preparation, unchanged 14-day trial, genuine synthetic owner approval, stale
  buyer capture hold, exact verified/replayed calendar-month grant, containment,
  stable paid state and closed/fresh renewal authority.
- `verify-starter-preparation-concurrency.mjs <full-container>` uses independent
  sessions in a disposable clone: overlapping saves/freezes, the real authenticated
  `save_invoice_profile` upsert and fresh retry, changed-buyer capture/no grant,
  and actual document issuance against that authenticated save. Clones are removed.
  The exact upsert deadlock regression fails without NOWAIT and passes with it;
  the earlier changed-buyer settlement race also failed before the boundary fix.
- Synthetic browser inspection at desktop, 389px and 320px verifies scroll access,
  wrapping and no horizontal overflow. The temporary local fixture route is removed.
- Independent source review has no remaining Critical/Important finding after
  privacy, bookkeeping, capture coverage and lock-order corrections.

These checks do not establish a genuine future buyer's commercial clearance,
cloud Auth/API session, provider redelivery or payment. No future gym was activated.
Deploy the reviewed app source to expose the operator form, then follow the actual
per-customer procedure when the queue receives a real registration.
