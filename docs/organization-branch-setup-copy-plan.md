# Organization Branch Setup Copy — Corrected Implementation Plan

> Intended destination: `docs/organization-branch-setup-copy-plan.md`. The current non-mutating Plan Mode prevents saving it; when execution is enabled, save this document verbatim without changing application code.

## Summary

Replace the inline Add branch dialog with a four-step wizard that creates an isolated active/setup branch and optionally copies allowlisted configuration from an accessible active branch in the same organization.

Blank creation remains compatible. Operational records, staff access, credentials, provider state, storage objects, execution history, and historical authorship are never copied.

Rollout order is fixed: migration to Test, SQL acceptance, application acceptance, migration to Production, then application deployment.

## Database and security

- Generate one migration with `supabase migration new organization_branch_setup_copy`. The local CLI is currently absent, so provision an approved CLI outside repository dependencies. Apply through the configured Supabase migration connector; never use `db push`.
- Add nullable `accounts.setup_reviewed_at TIMESTAMPTZ` and `setup_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL`. Do not backfill existing accounts.
- Remove authenticated table-wide `accounts` updates. Grant column-level updates only for name, currency, localization, UPI, and onboarding-dismissal fields. Organization, legal-entity, owner, lifecycle, archive, readiness, and review fields become function-only.
- Update restore behavior to clear both review fields and set the restored branch to active/attention.
- A copy source must be accessible to the caller, same-organization, active, and unarchived. Readiness and review metadata are not copy prerequisites because an owner may intentionally operate a minimal CRM-only branch.
- Setup completion requires the selected branch to be active and to contain at least one active membership plan joined to an active pricing option. Revalidate this on every call.
- Repeated completion is a no-op only when the branch is already ready, reviewed, and still satisfies the prerequisite. Do not duplicate its audit event.
- Completion does not inspect or alter WhatsApp, payment, reminder, onboarding, staff, trainer-pricing, or provider readiness.

### Idempotency

Create `private.branch_creation_requests` with:

- Composite primary key `(actor_user_id, request_id)`.
- Organization, legal entity, nullable source account, nullable created account, normalized request JSON, fixed response JSON, and timestamps.
- Actor, organization, and created-account deletion cascade; source deletion sets the source reference null.
- RLS enabled with zero policies.
- All table privileges revoked from PUBLIC, `anon`, `authenticated`, and `service_role`.

Creation must insert-or-lock the request row before creating the account. A committed equal request returns the stored response; mismatched reuse returns conflict. A failed transaction leaves neither request nor branch. Deleting the created branch deletes its replay state.

### RPCs and grants

Add:

- `preview_organization_branch_setup(...) -> JSONB`
- `create_organization_branch_from_setup(...) -> JSONB`
- `complete_organization_branch_setup(...) -> JSONB`

Preserve `create_organization_branch(UUID, UUID, TEXT) -> UUID` exactly. It becomes a blank-mode wrapper, generates an internal request UUID, takes regional fields from `private.requested_account_id()`, and takes currency from the target legal entity.

All caller-facing functions:

- Are `SECURITY DEFINER`.
- Use `SET search_path=''`.
- Fully qualify tables, functions, types, and extension functions.
- Validate `auth.uid()`.
- Revoke EXECUTE from PUBLIC, `anon`, `authenticated`, and `service_role`, then grant only to `authenticated`.

Private helpers have no direct client or service-role EXECUTE grants.

Drop and recreate `my_branch_accounts()` to append review fields; its existing table return type cannot be changed with `CREATE OR REPLACE`.

## Validation and copy transaction

Use a fixed lock order: request, organization, legal entity, source account. After locking lifecycle rows, construct one normalized JSONB snapshot of all selected source configuration in one SQL statement. Validation, canonicalization, counts, warnings, and inserts must use that snapshot so concurrent source edits cannot produce a mixed copy.

Enforce:

- Name trimmed to 1–80 characters.
- Legal entity belongs to the organization and is not archived.
- Blank mode has no source or packs.
- Copy mode has an explicit source and at least one known, deduplicated pack.
- Known packs are `membership_catalog`, `lead_setup`, `reminders`, `automations`, and `flows`.
- Selecting automations or flows automatically selects and locks `lead_setup`.
- `membership_catalog` is ineligible when source currency differs from the target legal-entity currency.
- Maximum snapshot size is 8 MiB and maximum copied configuration rows is 10,000. Exceeding either limit makes creation ineligible; never partially copy a pack.

The account, caller owner membership, pack rows, request response, and audit event commit atomically.

The existing account-insert trigger will seed default expense categories. Report these as `systemSeeded`, not copied rows.

## Pack contracts

### Membership and catalog

Copy:

- Active membership plans, including required frozen legacy columns solely for schema compatibility.
- Active pricing options belonging to copied plans.
- Active catalog items and active catalog options.

Use fresh IDs and timestamps. Set caller authorship only on tables that support it. Do not copy memberships, periods, attendance, members, invoices, payments, trainers, trainer rates, or credits.

Warn for:

- Plans without an active pricing option.
- Trainer-required catalog items.
- Catalog options without a standard price.

### Lead setup

Copy:

- Stored lead field options.
- Tags.
- Custom fields, including `field_options`.
- Lead-form headline, intro, and consent text.

Remap tag and custom-field references. Assign caller authorship. A copied form receives a fresh 256-bit token encoded as 64 lowercase hexadecimal characters, `is_active=false`, and `revoked_at=now()`.

Do not copy contacts, notes, tag assignments, custom values, submissions, tokens, ownership, or consent history.

### Reminder timing

Copy only membership and service reminder offsets. Force both enabled flags false. If no source settings row exists, insert nothing.

### Automations

Before enabling this pack, change both automation round-robin rosters from `profiles.account_id` to active `account_memberships` with role owner/admin/agent.

Copy only whole definitions that pass canonical validation:

- Supported event triggers only; skip `time_based`.
- Skip `create_deal`, unknown steps, invalid configs, unresolved references, and definitions containing `time_of_day` until its runtime uses the account timezone.
- Remap tag and `custom:<uuid>` references.
- Rewrite specific conversation/lead assignment to round-robin.
- Rewrite specific follow-up assignment to lead-owner.
- Validate target lead-status keys.
- Rewrite timezone to the target timezone.
- Clear webhook URL, headers, and body into an activation-invalid draft.
- Preserve allowlisted template name, language, and string variables, but no template/provider row.

Create inactive definitions with reset counters/timestamps and caller authorship. Copy no logs or pending executions.

### Flows

Copy nonarchived, whole definitions only when their trigger, graph, entry key, edges, and references resolve:

- Support keyword and first-inbound triggers; skip manual.
- Skip `http_fetch`, unknown nodes, invalid graphs, and unresolved references.
- Remap tag references.
- Clear handoff assignments.
- Clear media URL and filename while preserving safe media type, caption, and graph edges.
- Canonicalize fallback policy to recognized keys and allowed values.

Create draft definitions with reset runtime state and caller authorship. Copy no runs, events, or storage. Media-cleared flows remain draft and receive an activation-blocked warning.

## Warnings and counts

Use a shared SQL/TypeScript registry for stable warning codes:

- `PACK_EMPTY`
- `PLAN_WITHOUT_ACTIVE_PRICE`
- `CATALOG_TRAINER_REQUIRED`
- `CATALOG_STANDARD_PRICE_MISSING`
- `LEAD_FORM_DISABLED`
- `REMINDERS_DISABLED`
- `AUTOMATION_SKIPPED_UNSUPPORTED_TRIGGER`
- `AUTOMATION_SKIPPED_UNSUPPORTED_STEP`
- `AUTOMATION_SKIPPED_INVALID_CONFIG`
- `AUTOMATION_SKIPPED_UNRESOLVED_REFERENCE`
- `AUTOMATION_ASSIGNMENT_RESET`
- `AUTOMATION_WEBHOOK_CLEARED`
- `AUTOMATION_TEMPLATE_REVIEW_REQUIRED`
- `FLOW_SKIPPED_UNSUPPORTED_TRIGGER`
- `FLOW_SKIPPED_UNSUPPORTED_NODE`
- `FLOW_SKIPPED_INVALID_GRAPH`
- `FLOW_SKIPPED_UNRESOLVED_REFERENCE`
- `FLOW_HANDOFF_CLEARED`
- `FLOW_MEDIA_CLEARED`

API warnings may include count, accessible source ID, and display name. Audit and idempotency records store only codes and counts.

`copied.totalRows` is the sum of inserted configuration rows only. Breakdown keys are:

- `membershipPlans`
- `planPricingOptions`
- `catalogItems`
- `catalogOptions`
- `leadFieldOptions`
- `tags`
- `customFields`
- `leadForms`
- `reminderSettings`
- `automations`
- `automationSteps`
- `flows`
- `flowNodes`

Exclude the account, membership, request, audit, and seeded expense-category rows.

## Authorization hardening

Add tested predicates:

- `canCompleteBranchSetup(role)` — admin or owner.
- `canEditAuthoredContent(role, actorId, authorId)` — agent-or-higher author only.
- `canDeleteAuthoredContent(role, actorId, authorId)` — agent-or-higher author, or admin/owner.

Rewrite automation/flow parent and child RLS:

- Inserts bind author to `auth.uid()`.
- Updates and activation/status changes are author-only.
- Deletes are author or admin/owner.
- Parent account and author are immutable.
- Child mutations derive authority from the parent.

Mirror the same checks in every service-role automation/flow mutation route, including create, edit, child replacement, activation/status, duplicate, and delete. Apply same-origin validation to all these browser mutations. Duplication creates caller-authored content.

Gate every corresponding UI affordance through the same predicates.

## Public API contracts

### `GET /api/branches`

Keep existing fields and add:

- Review fields to each branch.
- `legalEntities: Array<{id,name,defaultCurrency}>` for organization owners.
- `legalEntities: []` for other users.

Legal entities must be active even if no accessible branch currently references them.

### `GET /api/branches/setup-preview`

Accept `legalEntityId`, `startMode`, optional `sourceAccountId`, and repeated `pack` parameters.

Return:

- Source and target currencies.
- Source status, readiness, and review marker.
- Overall and per-pack eligibility with stable reason codes.
- Exact counts and skipped-definition counts.
- Warnings and a static exclusion inventory.

Use a dedicated user-keyed 60-per-minute preview limit. Preview does not depend on the branch name.

### `POST /api/branches`

Legacy input remains `{name, legalEntityId}` and uses blank creation. New input is:

```ts
{
  requestId: string
  name: string
  legalEntityId: string
  startMode: 'blank' | 'copy'
  sourceAccountId?: string
  packs: BranchSetupPack[]
}
```

Return existing fields plus:

```ts
{
  accountId: string
  readinessState: 'setup'
  replayed: boolean
  setupReviewedAt: null
  copied: { totalRows: number; breakdown: CopyBreakdown }
  systemSeeded: { expenseCategories: number }
  warnings: BranchSetupWarning[]
  credentialsCloned: false
}
```

Return 201 for new creation and 200 for replay.

Legacy compatibility means same-origin browser compatibility. Originless HTTP scripts become 403; direct database callers retain compatibility through the exact legacy RPC.

### Completion

`POST /api/organization/branches/[accountId]/complete-setup` accepts only:

```ts
{
  configurationReviewed: true;
}
```

The path account must equal the selected branch context. Return the review timestamp, reviewer, readiness, and whether the call was already complete.

All mutation routes require same-origin validation. Map validation to 400, permission/origin to 403, conflict to 409, limiter to 429, and unexpected errors to a generic 500 without raw SQL messages.

## Wizard and readiness UX

Extract `BranchCreationDialog` and use existing Dialog, Label, Input, Select, Radio/Checkbox or Chip, Badge, Button, Alert, and Tooltip masters. Use `DialogTitle size="lg"` and do not add page-specific master overrides.

Steps:

1. Branch name and legal entity.
2. Blank versus explicit source.
3. Packs and authoritative preview.
4. Review and create.

Behavior:

- Fetch `/api/branches` when opened.
- Show ineligible sources disabled with remediation reasons.
- Default to blank when no eligible source exists.
- Preselect eligible nonempty packs.
- Lock `lead_setup` when automations or flows are selected.
- Disable membership/catalog on currency mismatch.
- Debounce preview, abort old requests, and ignore out-of-order results.
- Generate one request UUID per fresh attempt.
- Guard submit with both a ref and disabled UI state.
- After success, retain the created account ID before switching branches.
- If switching fails, show Retry switch; never POST creation again.
- Reset request ID only after closing/resetting a completed or abandoned attempt.

Do not surface readiness badges or a setup-review card. Legacy review metadata and the completion endpoint remain for compatibility, but they do not gate branch creation, copying, switching, or ordinary CRM use.

## Onboarding alignment

Keep onboarding and readiness independently stored and mutated.

Change the onboarding plan signal to the same active-plan-plus-active-pricing-option condition used by setup completion. The onboarding checklist must not write readiness.

Replace “renewals, reminders and payments are ready” with language stating only that the core checklist is complete and integrations should still be reviewed.

Correct all six-step documentation and UI references to seven steps.

## Tests and acceptance

- Add direct dev dependencies for Testing Library, user-event, and jsdom. Keep Node as Vitest’s default; use a jsdom project or per-file environment for interaction tests.
- Unit/component coverage: normalization, pack dependencies, warning registry, active unreviewed source selection, stale preview ordering, double-submit, replay, switch retry, and dismissed onboarding.
- API coverage: legacy/new compatibility, same-origin failures, cross-organization source and legal entity, inactive source, active unreviewed/attention source, currency mismatch, pack dependencies, size limits, replay/conflict, completion permissions, and generic error handling.
- Test-project SQL acceptance must set authenticated JWT/header context and prove:
  - Protected account fields cannot be directly changed.
  - Caller and tenant validation.
  - Authorship RLS and child inheritance.
  - ID remapping and source immutability.
  - Allowlist/exclusion enforcement.
  - Automation/flow sanitization and skips.
  - Exact counts and warning storage.
  - Function grants and empty search paths.
  - Request/source/target deletion behavior.
  - Coherent snapshot behavior.
  - Existing expense-category trigger behavior.
  - Full rollback after a transaction-scoped forced failure.
- Run the SQL acceptance separately after applying the migration to Test; do not include rollback-only tests in the migration.
- Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`, followed by Supabase security and performance advisors.
- Test application acceptance before Production. Apply the migration to Production before deploying code that requires new RPC fields.

## Documentation and rollout assumptions

- Save this plan as `docs/organization-branch-setup-copy-plan.md`.
- On shipment, add only a terse entry to `docs/changelog.md` and update Phase 4 Built/Left status in `PRDs/roadmap.md`.
- Document that blank creation remains available while any accessible active branch can be a copy source without a review marker.
- Do not backfill review markers and do not record a fixed latest-migration number.
- Do not add a feature flag; schema-first deployment and passing Test acceptance are the release gate.
