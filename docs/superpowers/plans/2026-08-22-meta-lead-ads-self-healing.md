# Meta Lead Ads Self-Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Facebook and Instagram Lead Ads integration recover failed durable lead deliveries and repair missing Page `leadgen` subscriptions while surfacing safe, actionable operator diagnostics.

**Architecture:** A single cron-authenticated route runs lead-event recovery before Page-health recovery, with separate bounded workers and database leases. The signed webhook and recovery worker share one server-only lead-ingestion processor, while connect, manual health checks, and cron checks share one typed Meta Page-health service. An additive service-role-only migration owns leases, credential generations, retry schedules, incident notifications, and atomic phone-less counters.

**Tech Stack:** Next.js 16.3 App Router route handlers, React 19, TypeScript 6, Supabase Postgres/RLS/RPCs, Vitest 4, Meta Graph API v26.0, GitHub Actions cron, shared UsefulDesk UI and locale primitives.

**Spec:** `docs/superpowers/specs/2026-08-22-meta-lead-ads-self-healing-design.md`

## Global Constraints

- Work directly in `/Users/rajatkashyap/Desktop/projects/UsefulDesk` on `main`; do not create a branch or worktree.
- Preserve pre-existing edits in `PRDs/multi_gym_saas_prd.md` and `PRDs/roadmap.md`; integrate the roadmap correction without reverting the user's App Review update.
- Keep `NEXT_PUBLIC_META_LEADS_CONFIG_ID` as the production dark-launch gate and do not deploy, change Meta configuration, connect a real Page, or activate Production.
- Pin all browser and server Graph requests to the shared `v26.0` constant validated through Context7 against `/websites/developers_facebook_graph-api`.
- Use named arguments for Meta helpers, bearer authorization headers, ten-second abort timeouts for recovery diagnostics, maximum provider concurrency of three, event batch size 25, Page batch size 10, and route `maxDuration = 300`.
- Only authenticated owners/admins can connect, manually check, reconnect, or disconnect; all browser mutations require same-origin validation.
- Cron and recovery RPCs are service-role-only; Page tenancy remains globally unique and every mutation is scoped by `account_id`, lease owner, and credential generation.
- Never log or return access tokens, ciphertext, raw Meta responses, Page IDs, lead IDs, phone numbers, email addresses, or raw lead fields from recovery/diagnostic paths.
- Meta Lead Ads submissions do not create WhatsApp consent; UI and privacy copy must describe team follow-up without claiming WhatsApp permission.
- Do not edit a shared `src/components/ui/*` master; use `Badge`, `Button`/`GatedButton loading`, `Alert`, `Card`, and locale formatters as shipped.
- Follow strict red-green-refactor: add one behavior test, run it and observe the expected failure, add minimal production code, rerun the targeted test, then refactor only while green.
- Do not commit automatically from this dirty `main` checkout; use focused `git diff` checkpoints so the user's existing changes remain separable.
- Create and locally validate the migration, but apply it externally only through an available approved Supabase migration connector. If no such authorized connector is available, leave application pending and report it.

---

## File Map

- `src/lib/meta/graph-version.ts`: single Graph API version/base URL used by browser and server code.
- `src/lib/whatsapp/meta-api.ts`: typed Meta Graph errors and exact Lead Ads request helpers.
- `src/lib/meta/lead-ads-health.ts`: pure failure classification plus one-Page diagnosis/repair using injected provider calls.
- `src/lib/meta/lead-ingestion.ts`: server-only processor for an already-owned durable lead event.
- `src/lib/meta/lead-event-recovery.ts`: bounded recovery-batch claim and concurrent ingestion resume.
- `src/lib/meta/page-health-recovery.ts`: bounded Page-health claim, token decryption, diagnosis, and lease completion/failure.
- `src/lib/meta/recovery.ts`: two-phase orchestration and aggregate non-PII result shape.
- `src/app/api/meta/leads/{connect,health,recovery/cron,webhook}/route.ts`: authenticated connection/manual routes, cron endpoint, and signed delivery boundary.
- `src/components/settings/meta-leads-connect.tsx`: localized status, diagnostics, and reconnect/check/disconnect actions.
- `src/app/(dashboard)/notifications/page.tsx` and `src/types/index.ts`: generic Meta attention notification rendering and Settings deep link.
- `supabase/migrations/20260822100000_meta_lead_ads_self_healing.sql`: additive health/event leases, owned RPCs, notification incident logic, and atomic phone-less increment.
- `src/lib/meta/*.test.ts`, route tests, UI tests, and SQL contract tests: provider, worker, authorization, tenancy, lease, and incident coverage.
- `.github/workflows/ops-crons.yml`, `.env.local.example`, `docs/automations-and-cron.md`, privacy docs, changelog, and roadmap: operations and disclosure trail.

### Task 1: Shared Graph v26.0 and typed Lead Ads provider contract

**Files:**

- Create: `src/lib/meta/graph-version.ts`
- Create: `src/lib/meta/lead-ads-api.test.ts`
- Modify: `src/lib/meta/fb-sdk.ts`
- Modify: `src/lib/whatsapp/meta-api.ts`
- Test: existing `src/lib/whatsapp/meta-api.test.ts`

**Interfaces:**

- Produces: `META_GRAPH_VERSION = 'v26.0'`, `META_GRAPH_BASE_URL`, `MetaGraphError`, `getMetaUser`, `getPageLeadAccess`, `listPageSubscribedApps`, `getPageLeadgenSubscription`, and existing Lead Ads helpers with optional `signal`.
- `MetaGraphError` exposes `httpStatus`, `code`, `subcode`, `providerDetail`, and `retryable` without placing tokens in its message.

- [ ] **Step 1: Write failing provider-contract tests**

```ts
it('uses v26.0 and bearer headers for the exact lead access diagnostic', async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ has_lead_access: { data: [{ can_access_lead: true }] } })
  );
  await getPageLeadAccess({
    pageId: 'page',
    userId: 'user',
    appId: 'app',
    pageAccessToken: 'secret',
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://graph.facebook.com/v26.0/page?fields=has_lead_access.user_id(user).app_id(app)',
    expect.objectContaining({ headers: { Authorization: 'Bearer secret' } })
  );
});

it('preserves safe Meta error fields and marks 5xx retryable', async () => {
  fetchMock.mockResolvedValue(
    jsonResponse(
      {
        error: {
          message: 'Unavailable',
          code: 2,
          error_subcode: 99,
          error_user_msg: 'Try again',
        },
      },
      503
    )
  );
  await expect(
    getMetaUser({ userAccessToken: 'secret' })
  ).rejects.toMatchObject({
    name: 'MetaGraphError',
    httpStatus: 503,
    code: 2,
    subcode: 99,
    providerDetail: 'Try again',
    retryable: true,
  });
});
```

- [ ] **Step 2: Run the new tests and confirm RED**

Run: `npm test -- src/lib/meta/lead-ads-api.test.ts`

Expected: FAIL because the shared version module, typed error, and diagnostic helpers do not exist.

- [ ] **Step 3: Implement the minimal shared contract**

```ts
export const META_GRAPH_VERSION = 'v26.0' as const;
export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly providerDetail: string | null,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'MetaGraphError';
  }
}
```

Implement exact requests:

```ts
GET /me?fields=id
GET /{pageId}?fields=has_lead_access.user_id({userId}).app_id({appId})
GET /{pageId}/subscribed_apps?fields=id,subscribed_fields&limit=100
POST /{pageId}/subscribed_apps?subscribed_fields=leadgen
GET /{leadgenId}?fields=id,created_time,field_data,form_id,ad_id,campaign_id,platform,is_organic
```

- [ ] **Step 4: Run provider and existing Meta API tests and confirm GREEN**

Run: `npm test -- src/lib/meta/lead-ads-api.test.ts src/lib/whatsapp/meta-api.test.ts src/lib/whatsapp/meta-api.media.test.ts src/lib/whatsapp/meta-api.resumable.test.ts`

Expected: PASS with the browser SDK and server helpers both importing the same version.

- [ ] **Step 5: Inspect the focused diff**

Run: `git diff -- src/lib/meta/graph-version.ts src/lib/meta/fb-sdk.ts src/lib/whatsapp/meta-api.ts src/lib/meta/lead-ads-api.test.ts`

### Task 2: Additive service-only recovery migration

**Files:**

- Create: `supabase/migrations/20260822100000_meta_lead_ads_self_healing.sql`
- Create: `src/lib/meta/meta-lead-recovery-schema.test.ts`

**Interfaces:**

- Produces the Page-health columns and RPCs, owned event RPCs, atomic skip increment, notification type, and incident notification semantics from the spec.
- All worker RPCs require `service_role`; client RLS remains admin-only for Page config.

- [ ] **Step 1: Write failing SQL contract tests**

```ts
it('owns every recovery completion by lease and credential generation', () => {
  expect(sql).toMatch(
    /complete_meta_page_health_check[\s\S]*health_lease_owner = p_health_owner[\s\S]*credential_generation = p_credential_generation/
  );
  expect(sql).toMatch(
    /complete_meta_lead_webhook_event_owned[\s\S]*processing_owner = p_processing_owner/
  );
});

it('revokes worker RPCs from browser roles and grants only service_role', () => {
  for (const fn of workerFunctions) {
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}`);
    expect(sql).toMatch(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*TO service_role;`
      )
    );
  }
});
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run: `npm test -- src/lib/meta/meta-lead-recovery-schema.test.ts`

Expected: FAIL because the migration and functions do not exist.

- [ ] **Step 3: Implement the idempotent migration**

The migration must:

```sql
ALTER TABLE public.meta_page_config
  ADD COLUMN IF NOT EXISTS connected_meta_user_id TEXT,
  ADD COLUMN IF NOT EXISTS credential_generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_access_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_repair_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_health_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS consecutive_health_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_error_code TEXT,
  ADD COLUMN IF NOT EXISTS health_error_resolution TEXT,
  ADD COLUMN IF NOT EXISTS health_lease_owner UUID,
  ADD COLUMN IF NOT EXISTS health_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attention_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attention_notified_at TIMESTAMPTZ;
```

Drop/recreate the `user_id` foreign key as nullable `ON DELETE SET NULL`, add the partial due index, and implement:

```sql
claim_meta_page_health_batch(UUID, INTEGER, INTEGER, UUID DEFAULT NULL)
complete_meta_page_health_check(UUID, UUID, UUID, INTEGER, BOOLEAN, TEXT DEFAULT NULL)
fail_meta_page_health_check(UUID, UUID, UUID, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
claim_meta_lead_webhook_event_owned(TEXT, UUID, JSONB, UUID, INTEGER DEFAULT 300)
claim_meta_lead_webhook_recovery_batch(UUID, INTEGER, INTEGER)
complete_meta_lead_webhook_event_owned(TEXT, UUID, UUID, JSONB DEFAULT '{}')
fail_meta_lead_webhook_event_owned(TEXT, UUID, UUID, TEXT)
increment_meta_page_skipped_no_phone(UUID, UUID)
```

Claims use bounded `FOR UPDATE SKIP LOCKED`; event backoff is 1m/5m/15m/1h/6h; healthy Page checks schedule six hours; human-action failures schedule one day; transient failures use bounded backoff. `fail_meta_page_health_check` inserts `meta_leads_attention` once per active incident for current `owner`/`admin` profiles.

- [ ] **Step 4: Run schema tests and SQL parser checks and confirm GREEN**

Run: `npm test -- src/lib/meta/meta-lead-recovery-schema.test.ts src/lib/leads/meta-capture-retry.test.ts`

Run: `npx supabase db lint --local`

Expected: Vitest PASS. If no local Supabase instance is configured, record the exact CLI failure and retain the migration for approved connector application rather than using `db push`.

- [ ] **Step 5: Inspect migration invariants**

Run: `rg -n "SKIP LOCKED|credential_generation|processing_owner|REVOKE ALL|GRANT EXECUTE|meta_leads_attention|next_attempt_at|ON DELETE SET NULL" supabase/migrations/20260822100000_meta_lead_ads_self_healing.sql`

### Task 3: Diagnose and safely repair one Page

**Files:**

- Create: `src/lib/meta/lead-ads-health.ts`
- Create: `src/lib/meta/lead-ads-health.test.ts`

**Interfaces:**

- Produces `MetaLeadHealthResult`, `classifyMetaLeadHealthFailure(error)`, and `diagnoseAndRepairMetaPage(args)`.
- Result kinds: `healthy`, `repaired`, `transient`, `reconnect_required`, `meta_setup_required`, `local_setup_required`.

- [ ] **Step 1: Write failing diagnosis tests**

```ts
it('repairs only when lead access is true and leadgen is missing', async () => {
  const result = await diagnoseAndRepairMetaPage(
    deps({ canAccessLead: true, subscribed: false })
  );
  expect(result.kind).toBe('repaired');
  expect(provider.subscribe).toHaveBeenCalledOnce();
  expect(provider.listSubscriptions).toHaveBeenCalledTimes(2);
});

it.each([
  [
    new MetaGraphError('invalid token', 400, 190, null, null, false),
    'reconnect_required',
  ],
  [new MetaGraphError('server error', 503, 2, null, null, true), 'transient'],
  [new TokenDecryptionError(), 'local_setup_required'],
])('classifies %s as %s without attempting repair', async (error, kind) => {
  provider.getLeadAccess.mockRejectedValueOnce(error);
  await expect(diagnoseAndRepairMetaPage(deps())).resolves.toMatchObject({
    kind,
  });
  expect(provider.subscribe).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the health tests and confirm RED**

Run: `npm test -- src/lib/meta/lead-ads-health.test.ts`

Expected: FAIL because the health service does not exist.

- [ ] **Step 3: Implement minimal classification and repair**

```ts
export type MetaLeadHealthKind =
  | 'healthy'
  | 'repaired'
  | 'transient'
  | 'reconnect_required'
  | 'meta_setup_required'
  | 'local_setup_required';

export async function diagnoseAndRepairMetaPage(
  args: DiagnoseMetaPageArgs
): Promise<MetaLeadHealthResult> {
  const access = await args.provider.getLeadAccess({
    pageId: args.pageId,
    userId: args.connectedMetaUserId,
    appId: args.appId,
    pageAccessToken: args.pageAccessToken,
    signal: args.signal,
  });
  if (!access.canAccessLead) return metaSetupOrReconnect(access);
  const before = await args.provider.getLeadgenSubscription();
  if (before.subscribed) return healthyResult();
  await args.provider.subscribe();
  const after = await args.provider.getLeadgenSubscription();
  return after.subscribed ? repairedResult() : setupFailureResult();
}
```

Wrap each provider call in a ten-second `AbortController` deadline, surface provider `failure_resolution` safely, and never include identifiers or tokens in results.

- [ ] **Step 4: Run the health tests and confirm GREEN**

Run: `npm test -- src/lib/meta/lead-ads-health.test.ts src/lib/meta/lead-ads-api.test.ts`

Expected: PASS for all six outcome classes and read-after-write verification.

### Task 4: Extract owned lead ingestion and make webhook/recovery share it

**Files:**

- Create: `src/lib/meta/lead-ingestion.ts`
- Create: `src/lib/meta/lead-ingestion.test.ts`
- Modify: `src/app/api/meta/leads/webhook/route.ts`
- Modify: `src/app/api/meta/leads/webhook/route.test.ts`
- Modify: `src/lib/leads/meta-capture-retry.test.ts`

**Interfaces:**

- Produces exported `LeadgenValue`, `OwnedMetaLeadEvent`, and `processOwnedMetaLeadEvent({ admin, event, processingOwner })`.
- Consumes only a previously validated payload and owned claim; raw-body/HMAC/page-object validation remains in the route.

- [ ] **Step 1: Write failing processor tests**

```ts
it('completes a phone-less event once through the atomic counter RPC', async () => {
  const result = await processOwnedMetaLeadEvent(
    fixture({ mappedPhone: null })
  );
  expect(result).toEqual({ status: 'skipped_no_phone' });
  expect(calls).toEqual([
    'increment_meta_page_skipped_no_phone',
    'complete_meta_lead_webhook_event_owned',
  ]);
});

it('retains capture, dispatches automation once, enriches non-blockingly, and completes owned event', async () => {
  const result = await processOwnedMetaLeadEvent(
    fixture({ created: true, automationDispatched: false })
  );
  expect(result.status).toBe('processed');
  expect(automationDispatchCount).toBe(1);
});
```

- [ ] **Step 2: Run processor tests and confirm RED**

Run: `npm test -- src/lib/meta/lead-ingestion.test.ts`

Expected: FAIL because the extracted service does not exist.

- [ ] **Step 3: Implement the extracted processor**

Preserve this exact order:

```ts
resolve globally unique Page config and account
decrypt Page token and fetch leadgen payload
map fields and terminally skip phone-less lead through atomic RPC
normalize phone from account locale configuration
capture contact/note/original state atomically
dispatch and retain new_contact_created marker only when needed
apply goal tag as non-blocking enrichment
complete with exact processing owner
```

Typed provider credential/permission failures may mark Page health; database/contact/automation failures only fail the event and do not set a false Page credential incident.

- [ ] **Step 4: Refactor the webhook to create a UUID owner, call the owned claim RPC, then call the shared processor**

```ts
const processingOwner = crypto.randomUUID();
const claim = await admin.rpc('claim_meta_lead_webhook_event_owned', {
  p_event_id: eventId,
  p_account_id: accountId,
  p_payload: value,
  p_processing_owner: processingOwner,
  p_lease_seconds: 300,
});
await processOwnedMetaLeadEvent({
  admin,
  event: claimedEvent,
  processingOwner,
});
```

Unknown Pages remain safe 200 skips; invalid signatures remain 401; batch failure remains 500.

- [ ] **Step 5: Run webhook/processor tests and confirm GREEN**

Run: `npm test -- src/lib/meta/lead-ingestion.test.ts src/app/api/meta/leads/webhook/route.test.ts src/lib/leads/meta-capture-retry.test.ts`

Expected: PASS, including one note/automation/skip across retry and proof that route and recovery call the same processor.

### Task 5: Add bounded event and Page recovery workers plus cron route

**Files:**

- Create: `src/lib/meta/lead-event-recovery.ts`
- Create: `src/lib/meta/page-health-recovery.ts`
- Create: `src/lib/meta/recovery.ts`
- Create: `src/lib/meta/recovery.test.ts`
- Create: `src/app/api/meta/leads/recovery/cron/route.ts`
- Create: `src/app/api/meta/leads/recovery/cron/route.test.ts`

**Interfaces:**

- Produces aggregate `{ events: { claimed, processed, failed, busy }, pages: { claimed, healthy, repaired, attention, failed }, notes: SafeNote[] }`.
- Event worker claims at most 25; Page worker claims at most 10; both use worker UUIDs, five-minute leases, and a concurrency-three mapper.

- [ ] **Step 1: Write failing worker/orchestrator tests**

```ts
it('runs lead recovery before Page health and still runs Page health after an event batch failure', async () => {
  const order: string[] = [];
  const result = await runMetaLeadRecovery({
    runEvents: failingPhase(order),
    runPages: passingPhase(order),
  });
  expect(order).toEqual(['events', 'pages']);
  expect(result.ok).toBe(false);
});

it('never exceeds three concurrent provider operations', async () => {
  expect(await observedMaxConcurrency(runPageRecovery(tenRows))).toBe(3);
});
```

- [ ] **Step 2: Run worker tests and confirm RED**

Run: `npm test -- src/lib/meta/recovery.test.ts src/app/api/meta/leads/recovery/cron/route.test.ts`

Expected: FAIL because workers and route are absent.

- [ ] **Step 3: Implement bounded workers and aggregate-only results**

```ts
runMetaLeadEventRecovery({ admin, owner, limit: 25, leaseSeconds: 300 });
runMetaPageHealthRecovery({ admin, owner, limit: 10, leaseSeconds: 300 });
runMetaLeadRecovery({ admin });
```

Each item catches and records safe codes while retaining its lease failure through the owned RPC. Batch-level claim failures set the phase error but do not prevent the other phase.

- [ ] **Step 4: Implement cron authentication and status semantics**

```ts
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronSecretConfigured())
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  if (!isAuthorizedCronRequest(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runMetaLeadRecovery({ admin: supabaseAdmin() });
  return NextResponse.json(result.body, { status: result.ok ? 200 : 500 });
}
```

- [ ] **Step 5: Run worker/cron tests and confirm GREEN**

Run: `npm test -- src/lib/meta/recovery.test.ts src/app/api/meta/leads/recovery/cron/route.test.ts src/lib/cron/auth.test.ts`

Expected: PASS for 503/401/200/500, phase independence, batch limits, concurrency, and non-PII output.

### Task 6: Harden connect/disconnect and add manual Check now

**Files:**

- Modify: `src/app/api/meta/leads/connect/route.ts`
- Create: `src/app/api/meta/leads/connect/route.test.ts`
- Create: `src/app/api/meta/leads/health/route.ts`
- Create: `src/app/api/meta/leads/health/route.test.ts`
- Modify: `src/lib/auth/operational-route-guards-contract.test.ts`

**Interfaces:**

- Connect resolves Meta user, validates lead access, repairs/verifies subscription, and only then writes a healthy encrypted config with incremented generation.
- Manual health route accepts `{ config_id: UUID }`, force-claims only the caller's account row, and returns safe health fields.

- [ ] **Step 1: Write failing authorization/tenancy/compensation tests**

```ts
it.each(['POST', 'DELETE'])(
  '%s connect mutation rejects cross-origin requests',
  async (method) => {
    const response = await invokeConnect(
      new Request('https://desk.example/api/meta/leads/connect', {
        method,
        headers: {
          origin: 'https://attacker.example',
          'sec-fetch-site': 'cross-site',
        },
      })
    );
    expect(response.status).toBe(403);
  }
);
it('does not return connected when subscription verification fails', async () => {
  healthCheck.mockResolvedValueOnce({
    kind: 'meta_setup_required',
    code: 'lead_access_denied',
    resolution: 'Grant lead access in Meta.',
  });
  expect(await connectPage()).toEqual({
    connected: [],
    skipped: [{ name: 'Gym Page', reason: 'Grant lead access in Meta.' }],
  });
});
it('best-effort unsubscribes when provider subscription succeeds but database save fails', async () => {
  saveConfig.mockResolvedValueOnce({ error: new Error('write failed') });
  await connectPage();
  expect(unsubscribePageToLeadgen).toHaveBeenCalledWith({
    pageId: 'page-1',
    pageAccessToken: 'page-token',
  });
});
it('cannot force-check a config owned by another account', async () => {
  claimForcedConfig.mockResolvedValueOnce(null);
  expect(
    (await invokeHealth(sameOriginHealthRequest('foreign-config'))).status
  ).toBe(404);
});
```

- [ ] **Step 2: Run route tests and confirm RED**

Run: `npm test -- src/app/api/meta/leads/connect/route.test.ts src/app/api/meta/leads/health/route.test.ts src/lib/auth/operational-route-guards-contract.test.ts`

Expected: FAIL because same-origin guards, conclusive health save, compensation, and health route are absent.

- [ ] **Step 3: Implement connect/reconnect generation and compensation**

Call `requireSameOriginRequest(request)` before each authenticated mutation. For every granted Page, run the shared health provider checks before saving; an update increments `credential_generation`, clears leases/attention, stores `connected_meta_user_id`, and records healthy timestamps. If the DB write fails after a newly installed subscription, call `unsubscribePageFromLeadgen` best-effort and report a safe skipped reason.

- [ ] **Step 4: Implement exact-config manual health route**

```ts
const { accountId } = await requireSettingsAccess();
const claimed = await claimForcedConfig({ accountId, configId, owner });
if (!claimed) return activeLeaseOrNotFoundResponse();
const result = await checkClaimedPage(claimed);
return NextResponse.json(toSafeHealthResponse(result));
```

Never return `account_id`, token/ciphertext, raw provider payloads, Page IDs, or lead IDs.

- [ ] **Step 5: Run route/auth tests and confirm GREEN**

Run: `npm test -- src/app/api/meta/leads/connect/route.test.ts src/app/api/meta/leads/health/route.test.ts src/lib/auth/operational-route-guards-contract.test.ts src/lib/auth/csrf.test.ts`

Expected: PASS for capability, origin, compensation, same-account selection, generation, and active-lease behavior.

### Task 7: Render Settings health states and Meta attention notifications

**Files:**

- Create: `src/components/settings/meta-leads-health.ts`
- Create: `src/components/settings/meta-leads-connect.test.tsx`
- Modify: `src/components/settings/meta-leads-connect.tsx`
- Modify: `src/types/index.ts`
- Modify: `src/app/(dashboard)/notifications/page.tsx`
- Create: `src/lib/meta/meta-attention-notification.test.ts`

**Interfaces:**

- Produces a pure `resolveMetaLeadPageDisplay(page, now)` mapping to badge/copy/actions.
- Adds `meta_leads_attention` to `NotificationType` and deep-links it to `branchHref('/settings?tab=capture', accountId)`.

- [ ] **Step 1: Write failing display and notification tests**

```ts
it.each([
  [leasedPage, 'Checking'],
  [healthyPage, 'Healthy'],
  [repairedPage, 'Repaired'],
  [transientIncident, 'Needs attention'],
  [reconnectPage, 'Reconnect required'],
])('maps Page state to %s', (page, label) =>
  expect(resolveMetaLeadPageDisplay(page, now).label).toBe(label)
);

it('opens Meta attention notifications at the branch-scoped Lead capture settings section', () => {
  expect(notificationHref(metaAttention)).toBe(
    '/settings?tab=capture&branch=account-1'
  );
});
```

- [ ] **Step 2: Run UI/helper tests and confirm RED**

Run: `npm test -- src/components/settings/meta-leads-connect.test.tsx src/lib/meta/meta-attention-notification.test.ts`

Expected: FAIL because the display resolver and notification type/route do not exist.

- [ ] **Step 3: Implement health presentation with existing masters**

Fetch only safe health columns through caller RLS. Render canonical `Badge` variants, localized `fmt.dateTime` values for last checked/healthy/lead, structured resolution text, `GatedButton loading` for per-row **Check now**, **Reconnect Facebook** through the existing popup flow, and confirmed **Disconnect**. Replace hand-built `Loader2` action branches with the shared loading contract. Copy says the lead is ready for team follow-up and explicitly avoids inferring WhatsApp consent.

- [ ] **Step 4: Implement generic notification icon and deep link**

Add `meta_leads_attention: AlertTriangle` to `TYPE_ICON`; when clicked, mark read and route to Settings → Lead capture for that notification's account. Keep notification title/body generic and identifier-free.

- [ ] **Step 5: Run UI/notification tests and confirm GREEN**

Run: `npm test -- src/components/settings/meta-leads-connect.test.tsx src/lib/meta/meta-attention-notification.test.ts`

Expected: PASS for all five states, localized timestamps, action loading, admin gate, and Settings deep link.

### Task 8: Scheduler, environment, privacy, runbook, roadmap, and changelog

**Files:**

- Modify: `.github/workflows/ops-crons.yml`
- Modify: `.env.local.example`
- Modify: `docs/automations-and-cron.md`
- Modify: `docs/meta-data-handling.md`
- Modify: `docs/privacy-policy-useful-desk.md`
- Modify: `docs/privacy-and-subprocessors.md`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`

**Interfaces:**

- Scheduler calls `/api/meta/leads/recovery/cron` with `if: always()` and `curl --fail`.
- Runbook describes the tenth job, auth, 15-minute schedule, aggregate response, limits, and manual verification.
- Privacy docs consistently identify Vercel as the actual production host and disclose Lead Ads Platform Data and encrypted Page tokens.

- [ ] **Step 1: Add the tenth ops-cron step**

```yaml
- name: Recover Meta Lead Ads events and Page health
  if: always()
  run: |
    curl --fail --silent --show-error \
      -H "x-cron-secret: ${{ secrets.AUTOMATION_CRON_SECRET }}" \
      https://desk.usefulmade.com/api/meta/leads/recovery/cron
```

- [ ] **Step 2: Repair and update operator/privacy documentation**

Remove every committed `<<<<<<<`, `=======`, `>>>>>>>`, and quoted merge remnant. Keep Vercel as the production host evidenced by the roadmap's READY deployments. Add Lead Ads form answers, form/ad/campaign identifiers, platform source, Page identifiers, encrypted Page access tokens, and health diagnostics to Platform Data disclosures. State that Lead Ads capture creates no WhatsApp consent record.

- [ ] **Step 3: Update env and runbook**

Document exact permissions `pages_show_list`, `pages_manage_metadata`, `leads_retrieval`; `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_LEADS_CONFIG_ID`, `META_APP_ID`, `META_APP_SECRET`, `META_LEADGEN_VERIFY_TOKEN`, `ENCRYPTION_KEY`, and cron secret. Add the recovery curl and aggregate response example without real identifiers.

- [ ] **Step 4: Merge roadmap/changelog changes without reverting user work**

Replace the roadmap claim that setting one env var is the whole launch with the real gates: approved Lead Ads App Review, additive migration, deployed recovery route/scheduler, disposable Facebook and Instagram canaries, explicitly authorized Production canary, then env activation. Add a terse changelog entry naming migration, workers/routes/UI, scheduler, and the gotcha that external migration/canary/activation remain pending.

- [ ] **Step 5: Verify documentation consistency**

Run: `rg -n "<<<<<<<|=======|>>>>>>>|Hostinger|whole Lead Ads launch|that's the whole Lead Ads launch" docs/meta-data-handling.md docs/privacy-policy-useful-desk.md docs/privacy-and-subprocessors.md PRDs/roadmap.md`

Expected: no merge markers, no Hostinger production claim, and no env-only activation claim.

### Task 9: Full verification and completion audit

**Files:**

- Review all files changed by Tasks 1–8.

**Interfaces:**

- Produces fresh evidence for tests, lint, typecheck, build, migration contracts, security grep, and spec coverage.

- [ ] **Step 1: Run all focused Meta tests**

Run: `npm test -- src/lib/meta src/app/api/meta src/components/settings/meta-leads-connect.test.tsx src/lib/leads/meta-capture-retry.test.ts`

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run the full project test suite**

Run: `npm test`

Expected: all Vitest files pass with zero failures.

- [ ] **Step 3: Run static verification**

Run: `npm run lint && npm run typecheck && npm run format:check && npm run build`

Expected: every command exits 0. If the build requires unavailable external environment state, report the exact failure separately instead of treating lint/typecheck as a substitute.

- [ ] **Step 4: Audit security and privacy invariants**

Run: `rg -n "page_access_token|accessToken|leadgenId|pageId|console\.(log|warn|error)" src/lib/meta src/app/api/meta/leads`

Inspect each hit to prove secrets/identifiers are never logged or returned. Confirm all POST/DELETE routes call `requireSameOriginRequest`, all recovery RPC grants are service-role-only, and UI queries remain account-scoped/RLS-protected.

- [ ] **Step 5: Re-read the spec and account for every completion criterion**

Record local completion evidence for criteria 1–6, 8, and 9. Explicitly mark criterion 7 (disposable Facebook/Instagram and Production canaries), external migration application, deployment, scheduler execution, Meta configuration, and dark-launch activation as pending separate authorization.

- [ ] **Step 6: Inspect the final working tree without staging user changes**

Run: `git status --short && git diff --stat && git diff --check`

Expected: only intended implementation/documentation changes plus the two preserved pre-existing user edits; no whitespace errors.
