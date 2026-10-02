# Prospective Starter gym-business selection — 2 October 2026

Rajat explicitly selected **every new gym business account registering for UsefulDesk
from now on**. This supersedes the small named-batch selection; it does not refer to
members added inside a gym. The selection checkpoint is 13:43:55.607014 UTC.
At that checkpoint there had been no new organization in the previous two hours;
the latest existing organization was created at 04:15 UTC. No existing organization
is included by this policy.

The private migration `20261002140000_starter_future_signup_selection.sql`
(SHA-256 `1b0b3faed112e624158eb0824abf3ebe725d09f564779949517528d8461dbce0`)
is installed in Production as history `20261002135858`. It creates no policy,
selection, commercial offer, owner review, scope, quote, order, payment or grant.
The explicit human-authorized prospective policy is activated separately after
the reviewed release lands. Source/schema installation preserved all 22 checked
financial/access/customer relations; only the observation timestamp differed.

New organization inserts record an immutable organization UUID/time and the
selection authorization. New branches and individual gym members do not create
organizations and do not enter the queue. Selection never changes the organization's
trial or enables payment. Personal details and gym names are not stored in the
selection history; the live admin queue joins current organizations. Existing
business erasure remains available, and erased organizations leave the live queue.

**Owner: Rajat. Next action: deploy the reviewed preparation form; review the next actual registration.**
The [3 October preparation workflow](subscription-starter-signup-preparation.md)
saves partial work with an assigned operator, status and next step and freezes an
exact Starter offer/operator preparation while opening stays closed. It exposes
missing actual buyer/setup and commercial references to an MFA platform admin.
The fresh **2026-10-02 19:34:12.968467 UTC** Production observation has zero selected
gyms and zero work rows; this is a dated observation, not a permanent empty queue.

`platform_admin_starter_signup_queue(limit, offset)` uses the existing platform-admin
predicate including MFA (`aal2`). Its ledger-derived stages include commercial review,
closed preparation, owner review, effective checkout opened/paused and payment verified.
Raw flags do not imply current checkout availability. Changed reviewed facts stop new
authority, while bookkeeping and legitimate paid transitions preserve commercial review.
Keep the full normal trial; a release operator separately authorizes owner review after
actual expiry. The real authenticated owner approves terms/amount/reminders in their
own account, and verified genuine payment alone grants the paid term. Selection and
a saved checklist are not standing tax clearance or customer consent. Renewals/refund
initiation, higher tiers/add-ons/native Checkout and messages keep their existing gates.

Both queue tables deny browser writes and service-role mutation/TRUNCATE. Historical
selection and policy economics are immutable; an operator can disable/revoke selection
even if the original approver has left the platform-admin roster. That stops new
selection, retains history and does not rewrite existing financial obligations.

Acceptance: full disposable rollback/replay suite and empty-Staging composed suite
passed. Tests cover new versus old registrations, no offer/review/scope/money authority,
MFA/private access, immutable history, effective global/owner containment, and the
genuine-owner business erasure path. The erasure and global-shutdown regressions
failed against the earlier Staging candidate and pass with the final source.
A fresh independent review found three Important issues; all were fixed and the
follow-up review found no remaining Critical or Important issues.
