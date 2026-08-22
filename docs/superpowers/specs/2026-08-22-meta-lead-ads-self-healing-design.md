# Meta Lead Ads self-healing integration

**Date:** 2026-08-22

**Status:** Approved for implementation planning

**Scope:** Facebook and Instagram Lead Ads connection verification, Page
subscription repair, durable lead-event recovery, operator attention states,
Settings diagnostics, scheduling, security, rollout, and documentation.

## Objective

Turn the existing Meta Lead Ads capture path into a production-operable
integration that detects and repairs recoverable failures without waiting for
an administrator to notice missing leads.

UsefulDesk will automatically resume durable lead deliveries and restore this
app's missing `leadgen` Page subscription when the stored Page token and lead
access remain valid. It will surface an explicit reconnect action when Meta
requires fresh user authorization or a Page administrator must restore access.

The design preserves the shipped capture architecture. It does not rebuild
contact creation, field mapping, phone normalization, source attribution,
notes, automation dispatch, or tenant demultiplexing.

## Current foundation

The repository already provides:

- a dark-launched Settings connection card behind
  `NEXT_PUBLIC_META_LEADS_CONFIG_ID`;
- a separate Facebook Login for Business configuration for Page permissions;
- Page discovery through `/me/accounts` and `leadgen` subscription through
  `/{page-id}/subscribed_apps`;
- encrypted Page tokens in `meta_page_config` with a global unique `page_id`;
- an HMAC-verified Page webhook that resolves the tenant from `page_id`;
- lead retrieval from `leadgen_id`, Facebook/Instagram source attribution,
  phone normalization, field mapping, and actionable phone-less skips;
- an atomic contact-and-note capture RPC with retained creation and automation
  state; and
- durable `webhook_events` claims that make provider redelivery idempotent.

The missing operational layer is proactive recovery. A failed Meta event is
currently retried only if Meta redelivers it, while a missing Page subscription
or revoked permission is discovered only when an administrator opens Settings
or a later webhook fetch fails.

## Meta requirements and recovery boundary

The implementation uses the currently selected supported Graph API version,
with one shared version constant for the browser SDK and server requests.
Context7 resolved Meta's current documentation as Graph API v26.0 during design.
The implementation plan must validate every Lead Ads request against that
version before changing the production pin.

The Page connection contract is:

1. `pages_show_list` discovers Pages granted during Facebook Login for
   Business.
2. `pages_manage_metadata` permits installing this app on a Page through
   `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`.
3. `leads_retrieval` permits `GET /{leadgen-id}` and the Page
   `has_lead_access` diagnostic.
4. The connecting Meta user must retain an eligible Page task and, when Lead
   Access Manager is enabled, explicit lead access.

Primary references:

- `https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen`
- `https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps`
- `https://developers.facebook.com/docs/graph-api/reference/has-lead-access`

UsefulDesk may automatically:

- retry a failed or stale durable lead event;
- verify lead access and Page subscription with the stored Page token;
- install this same app's `leadgen` subscription when it is missing; and
- clear a stale local error after provider health is restored.

UsefulDesk must not attempt to:

- mint or refresh a revoked Page grant without Facebook Login;
- grant Page tasks or Lead Access Manager permissions;
- change App Review access or app mode;
- replace the app-level Page webhook callback or verify token; or
- infer WhatsApp consent from an ordinary Lead Ads submission.

Those cases require a human and produce an explicit **Reconnect Facebook** or
Meta-setup resolution.

## Architecture

Add one cron-authenticated endpoint:

`GET /api/meta/leads/recovery/cron`

It runs two bounded phases in priority order:

1. **Lead-event recovery** leases and resumes failed or stale Meta
   `webhook_events`. These events represent submitted leads and therefore run
   before connection maintenance.
2. **Page-health recovery** leases due `meta_page_config` rows, diagnoses Meta
   access and subscription, and performs a safe re-subscribe when possible.

One endpoint reuses the existing `ops-crons` scheduler and shared constant-time
cron authentication. The phases live in separate library functions and have
independent result counts, leases, tests, and failure handling. A failure in
one phase does not prevent the other phase from running, but the route returns
500 when either phase has a batch-level failure so the scheduler remains visibly
red.

Per run, lead-event recovery claims at most 25 events and Page-health recovery
claims at most 10 configurations. Provider work uses at most three concurrent
operations and a ten-second timeout per diagnostic or repair request. These
bounds keep the route within its 300-second maximum while allowing overlapping
cron invocations to remain harmless.

Healthy Pages are due every six hours. Transient failures use retry backoff.
Connections requiring human action are rechecked once per day so an access
change made in Meta can recover without another UsefulDesk write.

## Database design

Add an idempotent migration whose filename sorts after the repository's current
latest migration at implementation time.

### `meta_page_config` health state

Add:

- `connected_meta_user_id TEXT` — the Meta user used by
  `has_lead_access.user_id(...).app_id(...)`;
- `credential_generation INTEGER NOT NULL DEFAULT 1` — incremented only when a
  Page token is connected or replaced;
- `health_checked_at TIMESTAMPTZ`;
- `last_healthy_at TIMESTAMPTZ`;
- `lead_access_verified_at TIMESTAMPTZ`;
- `subscription_verified_at TIMESTAMPTZ`;
- `last_repair_at TIMESTAMPTZ`;
- `next_health_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
- `consecutive_health_failures INTEGER NOT NULL DEFAULT 0`;
- `health_error_code TEXT`;
- `health_error_resolution TEXT`;
- `health_lease_owner UUID`;
- `health_lease_until TIMESTAMPTZ`;
- `attention_started_at TIMESTAMPTZ`; and
- `attention_notified_at TIMESTAMPTZ`.

The existing `status` remains the owner-facing lifecycle field:

- `connected` means the latest conclusive check is healthy;
- `error` means the latest conclusive check needs attention; and
- `disconnected` remains compatible with existing rows even though normal
  disconnect deletes the configuration.

An unexpired health lease renders as **Checking** without adding a second
persisted status vocabulary. `last_error` remains the concise owner-facing
message; `health_error_code` and `health_error_resolution` make recovery and UI
behavior structured.

Change the local audit `user_id` foreign key to nullable `ON DELETE SET NULL`.
An account integration must not disappear merely because the teammate who
connected it later loses their Auth identity.

Add a partial due-check index over `next_health_check_at` and
`health_lease_until` for connected/error rows.

### Page-health RPCs

Create service-role-only functions:

- `claim_meta_page_health_batch(p_health_owner, p_limit,
p_lease_seconds, p_force_config_id DEFAULT NULL)`;
- `complete_meta_page_health_check(...)`; and
- `fail_meta_page_health_check(...)`.

The claim uses `FOR UPDATE SKIP LOCKED`, validates limits, stamps a five-minute
owner lease, and returns only the fields the server worker needs. Completion
and failure compare `id`, lease owner, unexpired lease, and
`credential_generation`. A reconnect increments the generation and clears any
lease, so a stale worker cannot overwrite the new credential's state.

The failure function classifies the next check and opens an attention incident
only for a conclusive human-action failure. The first transition into an
incident creates notifications atomically; later cron runs do not repeat them.
A healthy completion clears the current incident markers but does not delete
historical notifications.

### Durable event recovery RPCs

Keep the existing Meta claim/complete/fail functions for rollback compatibility.
Add owned variants rather than changing their signatures in place:

- `claim_meta_lead_webhook_event_owned(...)`;
- `claim_meta_lead_webhook_recovery_batch(p_processing_owner, p_limit,
p_lease_seconds)`;
- `complete_meta_lead_webhook_event_owned(...)`; and
- `fail_meta_lead_webhook_event_owned(...)`.

The functions reuse the existing `webhook_events.processing_owner`,
`processing_started_at`, and `next_attempt_at` columns. Failure schedules:

- first failure: one minute;
- second: five minutes;
- third: fifteen minutes;
- fourth: one hour; and
- later failures: six hours.

The batch returns only unprocessed `gateway='meta'`, `type='leadgen'` events
whose retry is due or whose five-minute processing lease is stale. Identity,
tenant, and immutable payload checks remain unchanged.

## Meta API boundary

Add one shared Graph version module consumed by `fb-sdk.ts` and
`meta-api.ts`. Extend the existing typed Meta error handling so a
`MetaGraphError` retains HTTP status, provider code, subcode, and actionable
provider detail while remaining compatible with current `Error` consumers.

Add named-argument helpers for:

- resolving the connecting Meta user ID;
- reading Page `has_lead_access` for the exact Meta user and app;
- listing Page subscribed apps and `subscribed_fields`; and
- diagnosing whether this app is subscribed to `leadgen`.

No helper returns or logs an access token. Diagnostic timeouts abort rather
than holding a recovery lease until the route limit.

Meta failures are classified as:

- **repairable:** token works, lead access is true, but this app lacks the
  `leadgen` subscription;
- **transient:** timeout, network failure, Meta 5xx, or retryable rate limit;
- **reconnect required:** invalid/revoked token or the connecting Meta user no
  longer has usable Page access;
- **Meta setup required:** the app lacks `leads_retrieval`, Lead Access Manager
  denies access, or App Review/app-mode configuration is insufficient; and
- **local setup required:** token decryption fails because the configured
  encryption key no longer matches.

Only the repairable class performs an automatic provider mutation. It POSTs
the idempotent subscription and then reads `subscribed_apps` again before
declaring success.

## Lead ingestion extraction and recovery

Extract the signed webhook route's per-lead processing into a server-only
service that accepts the validated `LeadgenValue`, an already-owned event
claim, and the admin client. The HTTP route continues to own raw-body reading,
signature verification, JSON validation, Page-object filtering, and HTTP
status semantics.

The extracted processor retains the current order:

1. resolve the globally unique Page configuration and tenant;
2. decrypt the Page token and fetch `leadgen_id`;
3. map fields and handle the phone-less terminal skip;
4. normalize the phone using the account locale configuration;
5. atomically capture contact, one enquiry note, and original creation state;
6. dispatch `new_contact_created` only when required and retain its marker;
7. apply goal tagging as non-blocking enrichment; and
8. complete the owned event.

The webhook handler claims with a fresh owner and calls this same processor.
The recovery worker receives already-leased rows from the recovery-batch RPC
and calls it directly. This prevents HTTP replay and keeps one ingestion
implementation.

An event failure remains recorded on `webhook_events`. It updates Page health
only when the typed provider failure proves a credential or permission problem;
ordinary contact/database/automation failures do not falsely label the Page
connection broken.

The phone-less counter becomes an atomic database increment. A skipped event
is terminal and must not be replayed into repeated increments.

## Connection and manual diagnostics

The existing connect route will use the same Page-health service before it
reports success:

1. exchange the Facebook Login code;
2. obtain the long-lived user token and connecting Meta user ID;
3. list the granted Pages and Page tokens;
4. verify `has_lead_access` for the user/app;
5. subscribe to `leadgen` if needed;
6. read the subscription back; and
7. save a healthy encrypted configuration with a new credential generation.

A Page is not returned in `connected` merely because its token was saved. If
Meta subscription succeeds but the database write fails, the route attempts a
best-effort unsubscribe so it does not leave a silent provider-side orphan.

Both POST and DELETE require settings capability and same-origin validation.
The global one-Page/one-account constraint remains the authoritative tenancy
boundary.

Add `POST /api/meta/leads/health` for an admin/owner **Check now** action. It
uses the same exact-config lease with `p_force_config_id`; it does not bypass an
active cron lease. The response contains health fields and safe provider
resolution text, never ciphertext, tokens, tenant IDs from another account, or
raw Meta responses.

## Settings and notifications

Extend the existing Meta Lead Ads card without introducing or editing a UI
master component.

Each Page renders one of:

- **Checking** — a live health lease exists;
- **Healthy** — latest access and subscription checks passed;
- **Repaired** — the latest check restored a missing subscription;
- **Needs attention** — a transient failure crossed the notification threshold;
  or
- **Reconnect required** — Meta or local credentials cannot be repaired.

The row shows last checked, last healthy, and last lead timestamps using the
account locale layer. Error copy uses the structured provider resolution. The
actions are **Check now**, **Reconnect Facebook**, and the existing confirmed
**Disconnect**. Async actions use the shared Button/GatedButton `loading`
contract.

Add `meta_leads_attention` to the notification type constraint and render it
as a generic system notification that opens Settings → Lead capture in the
same branch. The database sends it to current account owners/admins only after
three consecutive transient failures or immediately for a conclusive
reconnect/setup failure. One incident produces at most one notification per
recipient.

The Settings copy must not claim that capture itself grants WhatsApp consent.
The lead is ready for team follow-up; WhatsApp sending continues to use its
existing separately audited consent gates.

## Security and tenancy invariants

- Only authenticated owners/admins can connect, check, reconnect, or disconnect
  a Page.
- Cron and recovery RPCs are service-role-only.
- Every Page remains globally unique across accounts; every recovery query and
  completion carries the resolved `account_id`.
- The stored Page token remains AES-256-GCM encrypted and is decrypted only in
  server-only code.
- Neither logs nor notifications contain tokens, raw lead fields, phone
  numbers, email addresses, Page IDs, or lead IDs.
- HMAC verification remains mandatory before an HTTP delivery can create or
  claim an event.
- Recovery never treats an unknown Page delivery as belonging to a fallback
  account.
- Reconnect generation and owner leases prevent stale workers from overwriting
  newer tenant state.
- Automatic provider mutation is limited to idempotently installing this app's
  `leadgen` subscription on an already-authorized Page.
- Lead Ads submissions do not create WhatsApp consent records unless a future,
  separately approved design captures exact consent text and evidence.

## Scheduling and observability

Add the recovery endpoint to `.github/workflows/ops-crons.yml` after the
existing high-priority recovery steps. `if: always()` ensures an unrelated cron
failure does not skip it, while `curl --fail` keeps the workflow red on a batch
failure.

The JSON response is aggregate-only:

- events claimed, processed, failed, and busy;
- Pages claimed, healthy, repaired, attention, and failed; and
- structured non-PII notes.

Application logs use stable prefixes and safe codes. Operators can correlate a
failure through database IDs in privileged database tooling, but public cron
output and ordinary logs do not emit provider or customer identifiers.

Update `docs/automations-and-cron.md` with the tenth job, authentication,
schedule, manual verification, and recovery limits.

## Testing

### Pure and provider-contract tests

- shared Graph version is used by browser and server paths;
- Meta error parsing preserves safe codes and classifies retryability;
- Meta user, `has_lead_access`, subscribed-app, subscribe, and lead-fetch
  requests use exact versioned paths, fields, methods, and bearer headers;
- repair runs only when lead access is true and `leadgen` is missing;
- token, permission, setup, local-decryption, transient, and healthy outcomes
  map to exact health results.

### Route and worker tests

- connect, health, disconnect, and cron authorization and same-origin rules;
- a Page owned by account A cannot be read, repaired, or claimed by account B;
- a subscription failure cannot produce a success response;
- an orphaned provider subscription is compensated after a database failure;
- webhook and cron invoke the same ingestion service;
- failed events follow backoff and resume without duplicate contacts, notes,
  skips, or automations;
- a current reconnect generation wins over stale worker completion;
- overlapping cron/manual checks lease once;
- transient failures notify only after three consecutive checks;
- conclusive human-action failures notify immediately and once per incident;
- recovery clears current attention without deleting notification history.

### Database contract tests

- health and event claims use bounded `SKIP LOCKED` leases;
- completion/failure require the exact owner and credential generation;
- functions are revoked from PUBLIC, anon, and authenticated and granted only
  to service_role;
- RLS remains admin-only for `meta_page_config` and cross-tenant Page uniqueness
  remains enforced;
- deleting the connecting Auth user retains the account integration with a null
  audit user;
- phone-less increments are atomic and terminal.

### End-to-end acceptance

Using a disposable Page, Facebook form, associated Instagram professional
account, and one explicitly authorized UsefulDesk test account:

- Facebook and Instagram leads enter the correct tenant with correct source,
  `received_via='meta'`, unassigned ownership, normalized phone, and one note;
- repeat enquiry and webhook replay semantics remain correct;
- a forced transient failure is recovered internally even without another Meta
  delivery;
- removing only the Page subscription is detected and repaired;
- revoking the token or Lead Access Manager permission produces one actionable
  admin/owner notification and never fabricates a repair;
- restoring external access makes the next check healthy;
- disconnect removes the Page subscription/config while preserving captured
  leads; and
- another tenant cannot observe or claim the Page.

## Rollout and rollback

1. Apply the additive migration through the approved Supabase migration tool
   in Test and verify schema, policies, grants, leases, and rollback-only tests.
2. Deploy code with `NEXT_PUBLIC_META_LEADS_CONFIG_ID` still unset in
   Production.
3. Run the complete disposable-Page acceptance in Test/staging.
4. Apply and verify the migration in Production.
5. Deploy the recovery endpoint and manually invoke it before adding the
   scheduler step.
6. Add the GitHub Actions cron step and observe aggregate recovery output.
7. Run one explicitly authorized production canary Page.
8. Set `NEXT_PUBLIC_META_LEADS_CONFIG_ID` and redeploy only after the canary is
   healthy.

Rollback is layered:

- removing the GitHub Actions step disables proactive recovery without
  affecting normal signed webhook ingestion;
- hiding the public config ID prevents new UI connections but does not stop
  existing Pages;
- a hard stop disconnects/unsubscribes connected Pages before hiding the card;
- additive columns and owned RPCs remain in place, so the prior application can
  run against the migrated schema; and
- durable-event migrations are not rolled back after lead evidence exists.

Forward fixes are preferred after activation. Existing contacts, notes,
notifications, and processed webhook evidence are never deleted as rollback.

## Documentation completion

The same implementation updates:

- `.env.local.example` with the exact Lead Ads permissions and runtime values;
- `docs/automations-and-cron.md` with recovery operations;
- `docs/meta-data-handling.md`, `docs/privacy-policy-useful-desk.md`, and
  `docs/privacy-and-subprocessors.md` to remove committed merge remnants,
  identify the actual production host, and disclose Lead Ads Platform Data;
- `docs/changelog.md` with shipped locations and operational gotchas; and
- `PRDs/roadmap.md` to replace the inaccurate env-only launch claim with the
  actual activation evidence and remaining external blockers.

## Completion criteria

The self-healing integration is complete only when:

1. current Meta contracts are version-pinned and covered by tests;
2. failed/stale durable lead events recover independently of provider
   redelivery;
3. missing `leadgen` subscriptions repair automatically and verify afterward;
4. token, Page-task, Lead Access Manager, app-review, and local-key failures
   stop safely with actionable, deduplicated owner/admin attention;
5. reconnect, disconnect, manual checks, cron overlap, and tenant boundaries
   pass automated and database tests;
6. the scheduler and operator runbook are live;
7. Facebook and Instagram canaries pass in the intended environment;
8. privacy and Meta App Review documentation matches the deployed data flow;
   and
9. the feature remains dark until explicit production activation.
