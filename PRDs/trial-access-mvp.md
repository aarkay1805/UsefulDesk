# UsefulDesk trial access MVP

Approved scope: one 14-day trial per verified organization, shared by branches and staff; existing organizations retain complimentary access. After expiry the operational app becomes a Contact support surface. No checkout, automated SaaS billing, refunds, cancellation scheduling, impersonation, or analytics dashboard.

## Access model

Store an organization access record with mode trial/manual/complimentary, trial and manual access timestamps, independent suspension, and a concurrency version. Trial creation/verification is database-owned; invitation or branch creation never creates a new trial. Dates determine expiry at request time. Missing access fails closed when enforcement is enabled. Existing organizations are explicitly backfilled complimentary. Organizations created before enforcement is activated also retain complimentary access; only signups after the communicated rollout begin trials. A database-owned rollout switch starts disabled until verification and admin/support setup are complete.

Platform administrators are explicitly provisioned separately from account roles. Admin RPCs require a current private grant and MFA aal2, validate inputs, lock the target row, reject stale versions, and atomically append immutable before/after audit records. No client may grant itself access or edit access tables. Admin operations: extend trial, grant manual access through a date, suspend, restore. Restore does not extend an expired term.

## Customer and admin surfaces

The customer gate checks current access before mounting operational children, refreshes at expiry/focus, preserves sign-out, support, and organization switching, and exposes countdown during trial. Native must respect the same access boundary. A minimal platform page searches organizations and provides access controls with required reasons and exact resulting dates; it includes audit history and MFA setup/challenge. Support details are configured explicitly; a built-in support request can provide recovery if a contact channel is not configured.

## Enforcement

Membership discovery and profile recovery remain available. Operational RLS and SECURITY DEFINER capabilities, server request contexts, API keys, native clients, flow/automation execution, and outbound delivery respect the database access decision. Incoming WhatsApp/provider events and payment reconciliation continue; existing gym payment mandates are untouched. No missed outbound campaign is automatically replayed on restore.

## Implementation plan

1. Database foundation and pure access rules: migration, private admin/settings records, public scoped status and privileged audited actions. Verify exact deadline, suspension precedence, complimentary backfill, tampering, stale update, role and MFA failures.
2. Minimal platform admin and customer web gate: shared primitives, localized dates, search, access actions, audit and MFA. No shared UI master changes.
3. Enforce operational boundaries and native gate. Inventory RLS and definer paths; test retained membership selection and blocked service-role outbound work independently from provider reconciliation.
4. Verify focused tests, lint, typecheck, build, database transaction fixtures and browser flows. Update roadmap/changelog with actual rollout state. Enable only after safe verification and identified admin/support configuration.

## Acceptance

- New verified organization gets one 14-day trial; extra branches/staff inherit it.
- Existing organizations remain accessible after migration and rollout.
- Expired/suspended organizations cannot operate through old clients, RPCs, API keys or outbound jobs.
- Administrators can extend/activate/suspend/restore with an immutable reasoned history; non-admins and aal1 sessions cannot.
- Customer can contact support, sign out and switch organizations while blocked; extension restores access.
- Provider callbacks retain incoming records and reconcile money without cancelling gym-member mandates.
