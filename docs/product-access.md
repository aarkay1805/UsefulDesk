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

Release configuration: both migrations are applied and all 11 existing organizations
have access records. Ten retain complimentary access; VBF is the explicitly authorized
14-day trial pilot ending 21 September 2026 at 00:11 IST. One explicitly authorized
initial administrator and the provided WhatsApp support number are configured.
**Enforcement was activated in Production on 20 September 2026 at 13:02:42 IST.**
The web/server release includes `/platform-admin`, the customer gate, and outbound
enforcement. The native gate is distributed in standalone Preview build 2 and the
guarded accessible-device acceptance is complete.

1. Verify the web release at `https://desk.usefulmade.com/platform-admin` using
   the authorized administrator login and authenticator.
2. Authenticator enrollment and the organization list were accepted locally by
   the administrator. Production MFA/admin-action acceptance passed on 20 September
   2026: VBF was suspended and immediately restored through `/platform-admin`, both
   immutable audit entries were verified, its version advanced from 2 to 4, its trial
   deadline stayed exact, and rollout bypass kept operational access available.
   The updated native client was then distributed and tested before enforcement
   was enabled.
3. Completed on 20 September 2026: enabled
   `private.product_access_settings.enforcement_enabled` through a guarded privileged
   Supabase operation. The ten existing complimentary records retained access, VBF
   remained the authorized trial pilot, and new organizations now get verified-owner
   trials.
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
organization list. The production admin-action round-trip passed without extending
the trial. Android build 2 installed and cold-launched without Metro on a local
API 36 ARM64 emulator on 20 September 2026. After manual authentication, a cold
restart restored Inbox and normal access with no trial/recovery banner, matching
the complimentary allowed account during the pre-activation, disabled-enforcement
checkpoint. Diagnostics confirmed Preview, version 0.1.0 / build 2, the intended
Production hosts, Rajat Kashyap
organization, Owner role, and Ready status. Account exposed alternate branch choices
and sign-out without invoking either. The blocked Contact support surface could not
be reached without a forbidden access-state mutation and remains covered by focused
tests. The accessible emulator path passed and was explicitly accepted for this
activation as the Android substitute because the physical device is permanently
broken.

The build-2 iOS acceptance on the same date passed on the paired iPhone Air after
the owner unlocked it. With no Metro listener, a foreground terminate-and-launch of
EAS build `3c4684ca-1169-4a8c-86df-5fb6009849cd` restored the authenticated Rajat
Kashyap Inbox and normal operational access. Diagnostics confirmed Preview,
version 0.1.0 / build 2, the intended Production hosts, Rajat Kashyap organization,
Owner role, and Ready status. A reversible switch to Panchkula mounted its Inbox
and switching back restored the original branch. Account exposed sign-out, but it
was not invoked. Production read-only evidence showed enforcement disabled, Rajat
Kashyap complimentary and allowed, and VBF as the sole active trial ending 21
September 2026 at 00:11 IST. The blocked-access support surface was intentionally
not manufactured through an entitlement or enforcement mutation and remains
covered by the focused automated native tests rather than production device use.

The guarded Production activation preflight at 13:00 IST re-read all 11 access
rows: ten were complimentary, VBF was the sole active trial, none were suspended
or expired, all Rajat Kashyap organizations were complimentary and allowed, and
VBF remained unsuspended at version 4 with the unchanged database deadline
`2026-09-20T18:41:32.676609Z`. Rajat Kashyap and VBF had zero active
broadcasts, pending recipients, automation executions, or flow runs. The prior
24 hours had 120/120 successful cron runs and 30/30 HTTP 200 worker responses,
with no queued HTTP work; the current READY Vercel deployment had 53 HTTP 200s
and no error/fatal logs.

One atomic privileged update rechecked those invariants and changed only
`private.product_access_settings.enforcement_enabled` from false to true at
`2026-09-20T07:32:42.127637Z`. Independent verification found enforcement active,
all ten complimentary organizations allowed, VBF allowed only by its unchanged
active trial, zero denied access rows, unchanged protected queues, and no new
access audit or support-request row. The exact build-2 Android APK then cold-launched
on the accepted API 36 ARM64 emulator, restored the authenticated complimentary
Rajat Kashyap session directly to Inbox, rendered normal conversations, and produced
no app/React Native crash match. Diagnostics again confirmed Preview/build 2, the
Production API and Supabase hosts, Rajat Kashyap organization, Owner, and Ready.
The first post-activation operations and renewal cron runs both succeeded and their
two database HTTP responses were 200; the current web deployment accumulated 14
HTTP 200s, no 4xx/5xx response, and no error/fatal log after activation. No trial,
subscription, message, support, payment, or provider action was performed, and
rollback was not required.
