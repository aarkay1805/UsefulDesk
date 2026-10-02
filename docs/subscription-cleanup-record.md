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

## Next code cleanup

1. Share the repeated disposable Docker/SQL execution helper across the acceptance
   runners, preserving explicit-container checks, fail-fast SQL and rollback checks.
2. Separate current operating instructions from dated rollout evidence. Keep one
   current summary with links to immutable release manifests and dated records.
3. Review duplicate Test/Live provider parsing and signature helpers for a small
   shared core while preserving explicit credentials, money gates and domain boundaries.

Keep Test routes, regression fixtures, migration history, delivery receipts and
financial recovery. Pausing a test project does not make this code obsolete;
Live renewals and other advanced billing flows still need isolated acceptance.
