# Gym name signup and business identity completion

> Status: awaiting written-spec review
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
3. While the authenticated user remains on the signup page, UsefulDesk calls the authenticated completion endpoint with the entered Gym name.
4. On success, normal post-login navigation continues.
5. If completion is interrupted or fails, the user is sent to the protected completion screen and cannot enter the dashboard for that provisional organization.

An existing Google user who authenticates from `/signup` is never renamed. The completion boundary reports that the selected organization is already complete and post-login navigation proceeds normally.

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
- users whose selected organization is already complete go to the safe post-login destination;
- users with a pending selected organization remain on the form.

The Gym name is not placed in a query string. Before Google authentication, the signup page stores the value in `sessionStorage` for same-tab recovery. Successful completion removes it. The completion screen consumes that value when available and safely falls back to an empty input after the tab state is lost or cleared.

## Data model

Add nullable `organizations.name_setup_completed_at TIMESTAMPTZ`.

- Migration backfills every existing organization with the migration timestamp. Existing tenants are therefore treated as intentional, even when their historic name originated from a person’s signup name.
- New email-created organizations with valid `gym_name` metadata receive `now()` during provisioning.
- New organizations provisioned without `gym_name`, including first-time Google users and invitation signups, receive `NULL`.

The timestamp is the database authority for whether the selected organization may enter the dashboard. It is not derived by comparing names, because users and migrations may legitimately produce equal personal and business names.

No authorization decision reads `raw_user_meta_data`. Signup metadata is input to the trusted provisioning trigger only; membership tables and the organization row remain the authorization sources.

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

1. resolves `auth.uid()` and the requested/selected branch;
2. verifies branch ownership and organization ownership with the existing membership predicates;
3. locks the selected account, its legal entity, and organization in a fixed order;
4. validates that the organization is still incomplete;
5. verifies that the provisional organization still has exactly one branch and one legal entity, preventing this setup operation from becoming an implicit multi-branch rename;
6. trims and validates the requested name;
7. updates the organization name, selected account name, legal-entity name, and legal-entity legal name;
8. stamps `name_setup_completed_at`;
9. writes `organization_audit_log` with operation `organization.name_setup_completed`, including the previous organization, legal-entity, and branch names plus the final name;
10. returns a fixed success payload.

Retry behavior is explicit:

- If the organization is already complete and the organization name, branch name, legal-entity name, and legal-entity legal name all equal the requested normalized name, return success without a second audit event.
- If it is already complete with different values, return an `already_complete` result without mutating anything. This protects an existing Google user who signs in from the signup page.
- Any unexpected multi-branch or multi-entity pending organization returns a conflict for operator investigation rather than performing a broad rename.

The function is `SECURITY DEFINER` only because it coordinates rows that normal selected-branch RLS may not update together. It has a fixed `search_path`, checks `auth.uid()` and both owner relationships internally, revokes `PUBLIC` and `anon`, and grants only `authenticated` execution.

## API boundary

Add a focused authenticated completion endpoint. It:

- requires a same-origin mutating request;
- loads the current account context;
- applies the existing admin-action rate limit;
- accepts only `{ gymName: string }`;
- enforces the 1–80-character validation before the RPC;
- maps authorization, validation, conflict, and unexpected database errors to the established `{ error }` response shape;
- never uses the service-role client for the completion mutation.

The endpoint returns one of:

- `completed`: the provisional organization was finalized;
- `already_complete`: no mutation was necessary.

Both are safe post-login outcomes. A validation, authorization, or infrastructure error keeps the user in the completion experience.

## Dashboard guard

Extend the authenticated dashboard bootstrap data with `organization.name_setup_completed_at`. Before rendering the dashboard shell:

- a selected organization with a non-null timestamp proceeds normally;
- a selected organization with a null timestamp redirects to `/complete-signup`;
- `/complete-signup`, Auth routes, and `/join/<token>` remain outside this redirect to avoid loops and preserve invitation redemption.

This is a user-flow guard, not a replacement for API/RLS authorization. The completion RPC remains independently authorized, and existing operational APIs keep their current authorization boundaries.

## Google authentication integration

`GoogleAuthButton` gains an optional signup-completion input rather than embedding signup-form state or business rules.

- Login uses the component with no Gym name and keeps its current behavior.
- Normal signup passes the validated Gym name.
- Invitation signup passes no Gym name and keeps direct invitation navigation.
- After `signInWithIdToken`, a supplied Gym name is sent to the completion endpoint before avatar seeding and post-login navigation finish.
- `already_complete` is treated as success without renaming.
- A failed completion does not silently open the dashboard; it navigates to `/complete-signup` or presents a retry path that reaches the same screen.

The native Google button is not rendered until the normal signup’s Gym name is valid. A shared disabled button-shaped placeholder communicates what is required without attempting to cancel a Google popup after it opens.

## Authorization and privacy

- Only the selected branch owner who is also the organization owner may complete a provisional organization.
- The client-side field gate is convenience only; API and RPC checks are authoritative.
- User-editable Auth metadata never grants authority.
- The completion request contains only the business name and does not expose it in URLs, logs, or analytics payloads.
- The audit event is organization-scoped and records only relevant names and actor identity.
- Existing legal-entity update RLS remains unchanged; this completion RPC is not a reusable legal-entity editor.

## Error and recovery behavior

- Empty or too-long Gym name: inline error; no request from the client and matching 400/RPC validation when bypassed.
- Google completion network failure: preserve the authenticated session and route to the completion screen for retry.
- Already-complete existing user: continue without mutation or warning.
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
- `already_complete` allows an existing Google user to continue without mutation.
- Completion failure reaches the protected recovery screen.
- Login remains unchanged for existing users.
- A newly created Google organization is redirected by the dashboard guard until completed.
- Invitation Google signup skips business completion and reaches invitation redemption.

### Database and API

- Email provisioning stores the personal and business names in their intended tables.
- Missing Gym name creates an incomplete but atomic provisional tenant.
- Existing organizations are backfilled complete.
- Only the branch owner plus organization owner can complete setup.
- Validation, fixed grants, fixed search path, and anonymous denial are verified.
- Completion updates the organization, one legal entity, and one branch atomically.
- Same-name retries do not duplicate the audit event.
- A completed organization with a different requested name is not mutated.
- Concurrent requests yield one mutation.
- Pending multi-branch/multi-entity organizations fail closed.

### Navigation and UI verification

- Dashboard shell redirects only incomplete selected organizations.
- Completion and invitation paths cannot redirect-loop.
- Desktop and phone-width checks cover signup validation, disabled Google state, completion loading/error states, and successful navigation.
- Repository lint, typecheck, full tests, and production build pass before completion.

## Rollout and verification

1. Apply the migration through the approved Supabase migration connector before deploying application code.
2. Verify the column backfill, updated trigger, function ownership, fixed search path, and execution grants.
3. Run a rolled-back production transaction probe for email-style complete provisioning, Google-style provisional provisioning, completion, idempotent retry, audit insertion, and unauthorized rejection.
4. Deploy the application after the database boundary is available.
5. Verify an email signup, a first-time Google signup, an existing Google login, and an invitation signup without creating real downstream operational data.
6. Update `docs/changelog.md` and `PRDs/roadmap.md` in the implementation change.

No real customer messages, payment actions, or third-party business mutations are part of verification.
