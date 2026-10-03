# Coordinated billing release acceptance — 3 October 2026

Binding scope: `docs/subscription-starter-renewal-release.md`,
`docs/subscription-starter-signup-preparation.md`,
`docs/starter-whatsapp-reminder-acceptance.md`, and
`docs/production-hosting-review-2026-10-03.md` at source
`3ff4f3071e777b27b85ebd979f3db29232116c16`.

Rajat authorized proceeding with release preparation and isolated staging
acceptance. Work on local main in a managed worktree. Preserve the primary
checkout's independent invoice work. Production publication/installation will
be presented as an exact reviewed action. Customer sends, provider transactions,
renewal opening, refunds and hosting purchases retain their separate approvals.

## Task 1: Establish the release baseline

Verify source SHA and remote ancestry, install locked dependencies and run
lint, typecheck, all tests and the production build. Restore only Billing
Staging `otagotpezshybxkagtwv`, then inspect its actual catalog, migration
history, empty synthetic baseline and inactive jobs. Do not infer parity from
historical documentation.

Expected: local checks pass; restored application schema is identified;
no Production mutation, real-customer data copy or billing opening.

## Task 2: Install and accept exact source in staging

Compare actual staging definitions with the reviewed current source. Apply
only identified closed schema deltas through the approved migration connector.
Run the renewal and preparation rollback fixtures against the explicitly
empty staging target. Verify exact function bodies, RLS, grants and closure.
Label synthetic SQL settlement separately from genuine provider acceptance.

Expected: expiry-only renewal, access/tenant/owner isolation, replay and held
capture cases pass; original staging data and every job/gate remain preserved.

## Task 3: Accept real Auth and PostgREST boundaries

Create identifiable synthetic staging users only. Exercise actual Auth login
and PostgREST as owner, admin, staff and outsider, including cross-tenant
denial and private authority denial. Exercise signed app callback/webhook
routing against staging only, with external provider traffic blocked/mocked.
Clean up exactly those fixtures and verify zero synthetic residue.

Expected: real JWT/API checks pass; no live provider call or customer send.

## Task 4: Prepare the exact Production release packet

Refresh read-only Production schema/data/gate fingerprints and deployment
configuration without disclosing credentials. Identify exact closed migrations
and their hashes, build-time/runtime gate state, deployment source, encrypted
full-backup prerequisites, rollback and post-deploy smoke checks. Record
genuine renewal/provider and WhatsApp acceptance still pending. Restore
Billing Staging to its prior paused disposition after acceptance.

Expected: reviewable migration/deployment/backup action with concrete limits,
and no unapproved Production write, publish or purchase.

## Task 5: Review and record

Obtain one independent final review of the release packet and acceptance
evidence, resolve material findings, update changelog and roadmap, verify
documentation and git state, and commit directly to local main. Present only
the remaining exact external-action decision to Rajat.

Expected: all completed acceptance claims have actual evidence; unfinished
external acceptance is explicit; work and history are recoverable.

## Review focus

Inspect dependency order, exact source hashes, read-only Production boundaries,
closed jobs/gates, real versus synthetic evidence, tenant and role denials,
synthetic fixture cleanup, staging pause restoration, publish-triggered Vercel
deployment, backup coverage and rollback preservation of paid access.
