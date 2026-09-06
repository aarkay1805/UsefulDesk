# UsefulDesk product access

UsefulDesk SaaS access belongs to `organizations`, independently of branch roles,
gym-member trials, gym invoices, and Razorpay mandates. The approved MVP is in
`PRDs/trial-access-mvp.md`.

## Source of truth

`private.organization_product_access` owns trial/manual/complimentary mode,
start/end timestamps, independent suspension, and an optimistic concurrency
version. `private.product_access_settings` owns the global staged-rollout switch,
14-day duration, and support contact details. All existing organizations, including
signups before enforcement activation, retain complimentary access. New verified
organization owners start one trial after rollout; unverified signups are pending.
Branch and staff creation never renew the trial.

`product_access_for_account` returns the authorized branch's organization snapshot.
A missing/malformed snapshot fails closed in web, native, and server code. The
migration must precede application deployment: there is deliberately no fallback
that bypasses access when the RPC is missing. Deadlines are evaluated from database
time, with client timers/focus rechecks improving the experience rather than
providing authorization.

## Administration

`/platform-admin` is independent of the customer dashboard and supports explicit
sign-in plus authenticator setup/challenge. Only private `platform_admins` grants
with an `aal2` session can list organizations, read history, or change access.
Customer owner/admin roles confer no platform authority. Initial provisioning uses
a verified existing Auth login, never a client-supplied claim. Revoking its private
grant removes platform access at the next RPC even if the JWT remains valid.

Actions are extend trial, activate a manual access term, suspend, and restore.
Every action requires a trimmed 3–1000-character reason and expected version.
The database locks the access row and appends the before/after audit atomically.
Restore removes suspension only: it does not extend an expired term. No action
charges money, refunds a payment, or cancels a gym-member mandate.

The support snapshot provides WhatsApp/email contacts. A scoped, deduplicated
support-request RPC is a fallback; internal requests can be read through the
MFA-protected `platform_admin_support_requests` RPC. The first UI uses the configured
WhatsApp contact; a support inbox is deferred.

## Boundaries

Membership discovery, own-profile recovery, branch switching, and bootstrap
metadata remain readable. Operational account/organization predicates and
restrictive RLS compose with the existing tenant checks. Selected-account caches,
owner SECURITY DEFINER operations, native realtime admission/publishing, API keys,
server contexts, send attempts/retries, flow/automation steps, push delivery, and
outbound crons also check access. Public lead forms become unavailable.

Incoming WhatsApp/Meta records and financial provider callbacks still persist and
reconcile. Outbound side effects are denied. On suspension or restoration/extension
of expired access, pending broadcasts/automation continuations/flow runs are
terminalized with history so missed jobs do not automatically replay. Workers
recheck current leases and flow-run status before continuing or attempting sends,
so an in-memory job cannot resume after its database execution was retired. A provider
request already accepted cannot be recalled; this is not a provider cancellation.

## Rollout and verification

Release configuration: both migrations are applied, all 11 existing organizations
have complimentary records, one explicitly authorized initial administrator and the
provided WhatsApp support number are configured. **Enforcement is disabled.**
The web/server release includes `/platform-admin`, the customer gate, and outbound
enforcement. The native gate is implemented in source; distributing an updated
mobile build and native device acceptance remain pending.

1. Verify the web release at `https://desk.usefulmade.com/platform-admin` using
   the authorized administrator login and authenticator.
2. Authenticator enrollment and the organization list were accepted locally by
   the administrator. Verify the production admin flow and distribute/test the
   updated native client before enabling enforcement.
3. Enable `private.product_access_settings.enforcement_enabled` through a privileged
   Supabase operation after confirming the intended rollout date. Existing records
   remain complimentary; new organizations then get verified-owner trials.
4. Observe access-denied errors and setup failures. Disabling the switch is the
   emergency access rollback; it does not erase trial/audit records or resume retired
   queues. Do not drop the schema while this application version is deployed.

Database acceptance: run `supabase/tests/organization_product_access.sql` with the
approved Supabase SQL tool. It uses a real database role to test RLS, verifies
identity discovery, verified-trial idempotency, exact expiry, MFA, stale updates,
manual activation, support dedupe, and queued-work retirement. All fixture changes
roll back. The separate Razorpay test project timed out during this task, so the
transaction assertions ran against the migrated project with no retained test rows.

Web/server checks: Vitest, TypeScript, ESLint, and a production Next build. Native
checks: gate/service/auth/account tests, scoped ESLint, and native TypeScript. The
administrator completed local authenticator enrollment and confirmed the real
organization list. Production admin-action and native-device acceptance are separate
from automated tests.
