# Subscription rollout cleanup — 2 October 2026

The rollout no longer needs an always-running cloud acceptance database.
Production uses UsefulDesk (`fwqthstqrkrwtaehefks`); isolated cloud acceptance is
still useful before future renewal, refund or upgrade releases.

## Completed cleanup

- Removed 16 merged task branches locally and on GitHub. Every remote head matched
  its merged PR exactly; the one extra local merge commit was already in main.
  No open PR or other worktree depended on them. A verified private Git bundle
  preserves all removed refs outside the repository.
- Paused UsefulDesk Billing Staging (`otagotpezshybxkagtwv`); the provider confirms
  `INACTIVE`. Before pausing, the 187-table count audit found zero Auth users,
  organizations, accounts, financial transactions, document issues, selections
  and Storage objects. Cron was inactive and no Edge Function was deployed.
  Seed settings, schema metadata, the disabled cron-auth setup and historical
  synthetic access audit remain preserved.
- Production/local Supabase URLs and the production backup reference Production.
  The Production, Preview and Development environment exports contain no reference
  to either test project. Temporary protected environment exports were removed.
- Corrected `scripts/production-env-readiness.mjs`: customer-mode output no longer
  asserts that database-controlled capabilities are closed. Their reviewed database
  setting needs its own check. All environment flag restrictions remain enforced.

## Project disposition

| Project                                           | Disposition                         | Reason                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UsefulDesk                                        | Keep active                         | Live app, customers, payments and workers.                                                                                                                |
| UsefulDesk Billing Staging                        | Keep paused between acceptance runs | Current full-schema cloud acceptance target; restore and inspect it when needed.                                                                          |
| UsefulDesk Razorpay Test (`gxwhpraswnkosjibvquz`) | Preserve paused                     | Older snapshot with genuine Test evidence. The earlier dated inspection found 16 Auth users and 18 accounts; no new inspection or deletion was performed. |
| ekhata                                            | Unchanged                           | Separate project, outside this cleanup.                                                                                                                   |

Pausing preserves the project for later restoration. Permanent deletion also
removes provider-held backups; it needs an explicit project-specific decision
after private evidence/credential inventory and verified off-site export.
See [Supabase restoration](https://supabase.com/docs/guides/platform/upgrading#time-limits)
and [backup limitations](https://supabase.com/docs/guides/platform/backups).

## Completed code consolidation

Eight acceptance runners now share `scripts/lib/disposable-postgres.mjs`, retaining
their target kinds, fail-fast SQL, output comparisons, buffers, restore roles and
rollback/clone cleanup. The recovery runner also replays the current Starter
capability migration before its branch-limit fixture: the unchanged earlier runner
failed that expectation because its setup omitted the migration.

The [current operating summary](subscription-starter-rollout-next.md) now contains
completed status and owned next actions. The former mixed sequence is preserved in
the [dated archive](subscription-starter-rollout-history-2026-10-02.md); no release
manifest or financial evidence was removed.

`src/lib/subscriptions/provider-utils.ts` owns duplicated JSON-record, HMAC and
uncached timed request primitives. Test and Live modules retain credential/configuration,
identifier, merchant, economics, authority and money-gate checks plus their original
public interfaces and errors. No gym OAuth helper was merged into this path.

Verification brackets the refactor: the existing 301 payment/API tests pass before
and after; 20 shared-runner guard/failure/restore-role tests pass. All eight real
local runners pass, including rollback and separate-session concurrency proofs.
See the [runner guide](subscription-acceptance-runners.md) for target and lifecycle
details. No Production schema, environment, gate, money or customer action changed.

Keep Test routes, regression fixtures, migration history, delivery receipts and
financial recovery. Pausing a test project does not make this code obsolete;
Live renewals and other advanced billing flows still need isolated acceptance.
