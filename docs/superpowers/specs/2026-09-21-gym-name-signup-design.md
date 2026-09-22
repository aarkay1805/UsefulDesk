# Gym name signup and business identity completion

> Status: implemented; database migration and rollback verification passed; application rollout pending
> Date: 2026-09-21
> Scope: separate the person’s name from the initial gym, organization, legal entity, and branch identity across email signup, Google signup, and invitation signup

## Decision

Collect a required **Gym name** when a person creates a new UsefulDesk organization. Keep **Full name** exclusively as the person’s profile identity. The gym name seeds the new organization, its initial legal entity, the legal entity’s legal name, and the initial branch.

Email signup can provide both values to atomic Auth provisioning. Google ID-token authentication cannot attach custom signup metadata before the Auth user trigger runs, so Google first creates the existing atomic provisional tenant and then requires an owner-authorized business-identity completion step before that organization can enter the dashboard.

Invitation recipients do not enter a gym name because they are joining an existing business. Their automatically provisioned personal organization may remain incomplete and becomes subject to the same completion gate only if they later select it.

## Product outcomes

- A new owner’s personal name is never presented as the finished gym or legal-entity identity.
- Email and Google users must establish a gym name before operating a new organization.
- The initial organization, legal entity, and branch begin with one coherent business name.
- Existing organizations and existing Google users are not interrupted.
- Invitation recipients reach the organization they were invited to without being asked to name an irrelevant personal tenant.
- An interrupted Google flow has a deterministic recovery screen instead of leaving the user in a partially named dashboard.

## Non-goals

- A general-purpose legal-entity editor or organization-name editor.
- Creating, archiving, merging, or reassigning legal entities.
- Changing the selected branch’s country, currency, locale, or invoice profile during this flow.
- Renaming existing organizations during migration.
- Using Auth user metadata for authorization.
- Removing the atomic tenant created for every Auth user, including invitees.

## Terminology and naming contract

- **Full name** identifies the person and writes `profiles.full_name`.
- **Gym name** identifies the business being created.
- On initial provisioning, Gym name writes:
  - `organizations.name`;
  - `legal_entities.name`;
  - `legal_entities.legal_name`;
  - the initial `accounts.name` branch name.
- A later branch rename changes only `accounts.name`.
- The invoice profile’s `business_name` and `legal_name` remain branch-scoped invoice identity fields and are not a second legal-entity editing path.

Names are trimmed and must contain 1–80 Unicode code points. The client, API, and database enforce the same boundary. Whitespace-only names are invalid.

## Signup experience

### New organization signup

The existing signup card adds a required **Gym name** field with the supporting text:

`Used as your legal entity and first branch.`

The field appears for normal signups and is hidden when the page carries a valid invitation token. It uses the shared `Label`, `Input`, and validation presentation from `docs/ui-patterns.md`; no shared UI primitive changes are required.

For email signup:

1. The user enters Full name, Gym name, country, email, and password.
2. The client sends `full_name`, `gym_name`, and the existing localization metadata to Supabase Auth.
3. `handle_new_user` creates the complete tenant atomically and stamps the organization’s name setup as complete.
4. Email verification continues through the existing `/auth/callback` flow.

For Google signup from `/signup`:

1. The user enters a valid Gym name before the native Google button becomes available.
2. Google ID-token authentication creates the Auth user and provisional tenant atomically using the provider display name as the temporary fallback.
3. While the authenticated user remains on the signup page, UsefulDesk resolves the authenticated default branch and calls the completion endpoint with that explicit branch selection and the entered Gym name.
4. On success, normal post-login navigation continues.
5. If completion is interrupted or fails, the user is sent to the protected completion screen and cannot enter the dashboard for that provisional organization.

An existing Google user who authenticates from `/signup` is never renamed. For any authorized branch member, including an admin, agent, or viewer, the completion boundary reports that the selected organization is already complete and post-login navigation proceeds normally. Owner authorization applies only when an incomplete organization would be mutated.

### First-time Google authentication from `/login`

The login page does not ask existing users for a gym name. If a Google identity is genuinely new, atomic provisioning leaves its organization incomplete. The dashboard guard redirects that selected organization to `/complete-signup`, where the user supplies Gym name before continuing.

### Invitation signup

When a valid invitation token is present:

- Signup does not show or require Gym name.
- Email and Google authentication continue to `/join/<token>` exactly as today.
- Successful redemption selects the invited account. Its existing organization completion state governs dashboard access.
- The user’s unused personal organization may remain incomplete. If the user later selects that organization, the completion guard applies then.

## Completion screen

Add an authenticated `/complete-signup` page outside the normal dashboard shell so the shell can redirect to it without a loop.

The page contains:

- title: **Name your gym**;
- concise explanation that the name is used for the legal entity and first branch;
- one **Gym name** input, prefilled from ephemeral signup state when available;
- primary action: **Continue to UsefulDesk**;
- inline validation and an in-control loading state;
- a retryable page-level error when completion fails.

On load:

- unauthenticated users go to `/login`;
- users whose selected organization is already complete go to `/dashboard?branch=<accountId>` for that same authorized branch;
- users with a pending selected organization remain on the form;
- a failed lookup or missing completion-state field shows a retryable access/loading error, never an assumed incomplete state.

### Branch selection through completion

Branch selection is tab-local URL state, not a change to `profiles.account_id`. Preserve it through the entire flow:

- The dashboard guard redirects to `/complete-signup?branch=<accountId>`, using the branch it has already authorized.
- The completion page validates an explicit `branch` query value and resolves it against the caller's memberships. A malformed or inaccessible explicit branch fails closed; it must never fall back to the profile's default branch.
- A bare `/complete-signup` request resolves the authenticated profile's default branch, verifies membership, and redirects to the canonical URL with that branch before rendering the form.
- Extend the proxy's trusted branch-header forwarding to `/complete-signup` explicitly, while keeping the page outside the dashboard route group and its redirect guard. Continue stripping caller-authored branch headers. The completion page uses the same authorized bootstrap selection as the dashboard.
- Completion requests carry the same branch in the endpoint's `?branch=<accountId>` query. The API parses and validates that value directly and calls `getCurrentAccount(accountId)`; it does not infer selection from a Referer or a caller-authored header. The JSON body remains `{ gymName: string }`.
- Both `completed` and `already_complete` navigate to `/dashboard?branch=<accountId>` for the request's branch. Retry, refresh, and recovery links retain that same selection. Invitation authentication continues directly to `/join/<token>` and does not enter this flow.
- Normal Google signup resolves the profile's default branch after authentication, validates it against branch memberships, and uses that explicit branch for completion, recovery, and success navigation. If that lookup fails, the bare completion page can retry default-branch resolution without guessing an account.

The Gym name is not placed in a query string. Before Google authentication, the signup page stores the value in `sessionStorage` for same-tab recovery. Successful completion removes it. The completion screen consumes that value when available and safely falls back to an empty input after the tab state is lost or cleared.

## Data model

Add nullable `organizations.name_setup_completed_at TIMESTAMPTZ`.

- Migration backfills every existing organization with the migration timestamp. Existing tenants are therefore treated as intentional, even when their historic name originated from a person’s signup name.
- New email-created organizations with valid `gym_name` metadata receive `now()` during provisioning.
- New organizations provisioned without `gym_name`, including first-time Google users and invitation signups, receive `NULL`.

The timestamp is the database authority for whether the selected organization may enter the dashboard. It is not derived by comparing names, because users and migrations may legitimately produce equal personal and business names.

No authorization decision reads `raw_user_meta_data`. Signup metadata is input to the trusted provisioning trigger only; membership tables and the organization row remain the authorization sources.

### Completion-state read boundary

Extend the existing `SECURITY DEFINER` `my_branch_accounts()` projection with `organization_name_setup_completed_at`, sourced from `organizations.name_setup_completed_at`. Retain its caller-membership filter, fixed search path, and authenticated-only execution grants. All branch roles may read this scalar for their own branches; organization table SELECT RLS remains owner-only.

Dashboard bootstrap and the completion page take the state from the selected branch's RPC result, not from a direct organization query or an embedded organization join. Preserve three distinct outcomes: a timestamp means complete, an explicit SQL `NULL` means pending, and an RPC error, missing selected row, or missing/invalid field means state unavailable. Unavailable state must not render the dashboard or the name form; expose the existing access error or a retryable lookup error as appropriate. Do not coalesce an omitted field to `NULL` during response mapping.

## Provisioning trigger

Update `public.handle_new_user()` without weakening its atomic invariant.

- Continue resolving the person’s display name from provider `full_name` or `name` and require one.
- Read and trim optional `gym_name` metadata.
- If `gym_name` is valid, use it for the organization, legal entity, legal name, and initial branch, and mark setup complete.
- If `gym_name` is absent, use the person’s display name as the provisional tenant name and leave setup incomplete.
- If `gym_name` is present but invalid, fail provisioning rather than silently falling back.
- Preserve all current localization metadata validation, memberships, profile creation, ownership, and transactional behavior.

Invitation state is not trusted by the trigger. The client simply omits `gym_name` for invitation signup, leaving a recoverable personal tenant while the invitation redemption remains the authoritative join boundary.

## Transactional completion boundary

Add one database-authoritative completion RPC and invoke it through a same-origin API route.

The RPC:

1. resolves `auth.uid()` and the explicitly requested branch;
2. verifies that the caller has access to that branch using the existing membership predicates; unauthenticated callers and non-members are rejected before completion state is exposed;
3. locks the selected account, its legal entity, and organization in a fixed order;
4. checks the locked organization's completion timestamp; if already complete, returns `already_complete` immediately without mutation or an audit event, regardless of the caller's branch role, requested name, or the completed organization's branch/entity count;
5. for an incomplete organization, verifies branch ownership and organization ownership with the existing membership predicates, then verifies that the provisional organization still has exactly one branch and one legal entity, preventing this setup operation from becoming an implicit multi-branch rename;
6. trims and validates the requested name;
7. updates the organization name, selected account name, legal-entity name, and legal-entity legal name;
8. stamps `name_setup_completed_at`;
9. writes `organization_audit_log` with operation `organization.name_setup_completed`, including the previous organization, legal-entity, and branch names plus the final name;
10. returns a fixed success payload.

Retry behavior is explicit:

- If the organization is already complete, return `already_complete` without changing any names or writing a second audit event. This is a successful retry whether the requested name matches or differs, and also protects existing Google users of every branch role who sign in from the signup page.
- Any unexpected multi-branch or multi-entity pending organization returns a conflict for operator investigation rather than performing a broad rename.

The function is `SECURITY DEFINER` only because it coordinates rows that normal selected-branch RLS may not update together. It has a fixed `search_path`, checks `auth.uid()` and branch membership before any result, and checks both owner relationships internally before any mutation. It revokes `PUBLIC` and `anon` and grants only `authenticated` execution.

## API boundary

Add a focused authenticated completion endpoint. It:

- requires a same-origin mutating request;
- requires a valid explicit `branch` query value and loads that account context through `getCurrentAccount(accountId)`, independently verifying branch access;
- applies the existing admin-action rate-limit bucket without imposing an admin/owner role gate on the endpoint; the RPC distinguishes the member-authorized no-op from the owner-authorized mutation;
- accepts only `{ gymName: string }`;
- enforces the 1–80-character validation before the RPC;
- maps authorization, validation, conflict, and unexpected database errors to the established `{ error }` response shape;
- never uses the service-role client for the completion mutation.

The endpoint returns one of:

- `completed`: the provisional organization was finalized;
- `already_complete`: no mutation was necessary.

Both are safe post-login outcomes. A validation, authorization, or infrastructure error keeps the user in the completion experience.

## Dashboard guard

Extend the authenticated dashboard bootstrap data with the selected branch's `organization_name_setup_completed_at` from `my_branch_accounts()`, following the completion-state read boundary above. Before rendering the dashboard shell:

- a selected organization with a non-null timestamp proceeds normally;
- a selected organization with an explicit null timestamp redirects to `/complete-signup?branch=<accountId>` for the authorized selection;
- unavailable completion state shows an access or retryable lookup error; it is never treated as null or complete;
- `/complete-signup`, Auth routes, and `/join/<token>` remain outside this redirect to avoid loops and preserve invitation redemption.

This is a user-flow guard, not a replacement for API/RLS authorization. The completion RPC remains independently authorized, and existing operational APIs keep their current authorization boundaries.

## Google authentication integration

`GoogleAuthButton` gains an optional signup-completion input rather than embedding signup-form state or business rules.

- Login uses the component with no Gym name and keeps its current behavior.
- Normal signup passes the validated Gym name.
- Invitation signup passes no Gym name and keeps direct invitation navigation.
- After `signInWithIdToken`, a supplied Gym name is sent to the completion endpoint with the explicitly resolved branch before avatar seeding and post-login navigation finish.
- `already_complete` is treated as success without renaming.
- A failed completion does not silently open the dashboard; it navigates to `/complete-signup?branch=<accountId>` or presents a retry path that reaches the same selected branch's screen.

The native Google button is not rendered until the normal signup’s Gym name is valid. A shared disabled button-shaped placeholder communicates what is required without attempting to cancel a Google popup after it opens.

## Authorization and privacy

- Only the selected branch owner who is also the organization owner may complete a provisional organization.
- Any authorized branch member may read their branch's completion state and receive `already_complete` for an already-completed organization. Neither read grants permission to rename anything.
- The client-side field gate is convenience only; API and RPC checks are authoritative.
- User-editable Auth metadata never grants authority.
- The completion request contains only the business name and does not expose it in URLs, logs, or analytics payloads.
- The audit event is organization-scoped and records only relevant names and actor identity.
- Existing legal-entity update RLS remains unchanged; this completion RPC is not a reusable legal-entity editor.

## Error and recovery behavior

- Empty or too-long Gym name: inline error; no request from the client and matching 400/RPC validation when bypassed.
- Google completion network failure: preserve the authenticated session and route to the completion screen for retry.
- Already-complete existing user: continue without mutation or warning, including admin, agent, and viewer members.
- Missing, malformed, or inaccessible API branch selection: reject without falling back to another account. A malformed or inaccessible explicit page selection shows an access error.
- Completion-state lookup failure or omitted field: show an access or retryable lookup error; do not open the name form or dashboard.
- Lost signup-page state after refresh: completion screen requests the name again.
- Invitation redemption failure: preserve the existing join error behavior; if the user later enters their personal organization, the completion guard handles it.
- Authorization mismatch or structurally unexpected pending organization: block completion, show a generic recoverable support message, and retain database evidence.
- Concurrent completion requests: row locks serialize them; one mutation and one audit event win, and the retry receives the idempotent success result.

Client errors use `getErrorMessage`; pending buttons use the shared `Button` loading contract. The form remains usable on phone-width screens and with keyboard/screen-reader navigation.

## Testing and acceptance

### Signup UI

- Normal email signup requires Gym name and sends distinct `full_name` and `gym_name` metadata.
- Trimming and 80-code-point behavior match the server.
- Invitation signup hides Gym name and omits `gym_name` metadata.
- The Google button remains unavailable until Gym name is valid on normal signup.
- Existing signup error, email verification, country, and password behavior remains intact.

### Google authentication

- Normal signup completes the provisional organization before navigation.
- `already_complete` allows an existing Google user to continue without mutation for owner, admin, agent, and viewer roles, including users who are not organization owners.
- Completion failure reaches the protected recovery screen.
- Login remains unchanged for existing users.
- A newly created Google organization is redirected by the dashboard guard until completed.
- Invitation Google signup skips business completion and reaches invitation redemption.

### Database and API

- Email provisioning stores the personal and business names in their intended tables.
- Missing Gym name creates an incomplete but atomic provisional tenant.
- Existing organizations are backfilled complete.
- Only the branch owner plus organization owner can complete setup.
- Completed organizations return `already_complete` to authorized admin, agent, and viewer members before owner-only mutation checks, even when names differ or the organization has multiple branches/entities.
- Non-members cannot read completion state or receive `already_complete`; non-owners cannot mutate pending organizations, and possessing only one of the two required owner relationships is insufficient.
- The endpoint accepts authorized staff callers for the completed no-op; the rate-limit bucket does not introduce an admin/owner authorization gate.
- The completion-state projection returns the actual timestamp or explicit null for every branch role and exposes no branches outside the caller's memberships; organization SELECT RLS remains unchanged.
- Missing or malformed explicit API branch selection is rejected; a valid but unauthorized selection is denied without default-branch fallback.
- Validation, fixed grants, fixed search path, and anonymous denial are verified.
- Completion updates the organization, one legal entity, and one branch atomically.
- Same-name retries do not duplicate the audit event.
- A completed organization with a different requested name is not mutated.
- Concurrent requests yield one mutation.
- Pending multi-branch/multi-entity organizations fail closed.

### Navigation and UI verification

- Dashboard shell redirects only incomplete selected organizations.
- Completed organizations remain accessible to admin, agent, and viewer members through the membership-authorized completion-state projection.
- RPC failures, missing selected rows, and missing/invalid completion fields render an access or retryable lookup error, never a pending form or an unlocked dashboard.
- After invitation redemption, selecting an incomplete personal branch carries that branch through the guard, completion-page refresh, API mutation, network retry, and final dashboard destination; the invited organization remains unchanged.
- With two tabs selecting different branches, completing one does not change the other's selection or the profile's default account.
- Malformed or inaccessible explicit completion-page branches fail closed; a bare completion URL canonicalizes only the authenticated default branch after membership validation.
- Completion and invitation paths cannot redirect-loop.
- Desktop and phone-width checks cover signup validation, disabled Google state, completion loading/error states, and successful navigation.
- Repository lint, typecheck, full tests, and production build pass before completion.

## Rollout and verification

1. Apply the migration through the approved Supabase migration connector before deploying application code.
2. Verify the column backfill, updated trigger and branch-state projection, function ownership, fixed search path, and execution grants.
3. Run a rolled-back production transaction probe for email-style complete provisioning, Google-style provisional provisioning, completion, idempotent retry, audit insertion, staff completion-state reads and completed no-ops, and unauthorized rejection.
4. Deploy the application after the database boundary is available.
5. Verify an email signup, a first-time Google signup, an existing Google login, and an invitation signup without creating real downstream operational data.
6. Update `docs/changelog.md` and `PRDs/roadmap.md` in the implementation change.

No real customer messages, payment actions, or third-party business mutations are part of verification.
