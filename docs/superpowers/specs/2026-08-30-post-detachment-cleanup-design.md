# Post-Detachment Cleanup Design

## Goal

Complete UsefulDesk's operational separation from `ArnasDon/wacrm` without
changing compatibility-sensitive identifiers, production data, Supabase
schedules, or business worker cadences.

## Repository identity

Active repository surfaces will identify the project as UsefulDesk, link to
`aarkay1805/UsefulDesk`, and use `https://desk.usefulmade.com` as the canonical
production domain. This covers README and contribution copy, package metadata,
GitHub issue and pull-request templates, CODEOWNERS, Dependabot reviewers,
security reporting, and conduct reporting. Historical changelog links remain
unchanged. Runtime identifiers such as `wacrm_live_`, browser-storage keys,
signature headers, migration comments, and provider registration fixtures
remain unchanged because renaming them can break installed clients or stored
state.

GitHub private vulnerability reporting is the canonical security contact.
Conduct reports route privately to the repository owner through the same
security-advisory channel with a conduct-specific subject, because the owner
does not publish an email address on GitHub and inventing an address would make
reports unreliable.

## Local safety and Vercel identity

The authenticated Vercel account contains the production `useful-desk`
project serving `desk.usefulmade.com` and a separate provider sandbox. The
worktree will be linked explicitly to `useful-desk`; the generated
`.vercel/project.json` remains local and ignored.

The upstream Git remote remains available only for intentional archival
fetches. It will be renamed `upstream-archive` and given the invalid push URL
`DISABLED`, so an accidental push cannot reach `ArnasDon/wacrm`.

## Invite fallback

`resolveInviteBaseUrl()` will fall back to
`https://desk.usefulmade.com` when neither `NEXT_PUBLIC_SITE_URL` nor an
accepted request host is available. A regression test will prove the fallback
before the implementation changes. The example environment documentation will
describe the same behavior.

## GitHub schedule freshness

GitHub's workflow files are valid and manual dispatches succeed, but scheduled
events have been skipped for hours. Supabase Cron is independently healthy:
both jobs are active, their last four hours of runs succeeded, and their 20
retained HTTP responses were all 200 without timeout or error. The failure is
therefore the best-effort GitHub scheduling layer, not the application workers.

A small Node script will query GitHub's Actions API for the latest successful
scheduled run of `ops-crons`, `renewals-cron`, and `Production backup` and
evaluate the existing runbook thresholds: 75 minutes, two hours, and 30 hours.
Unit tests cover fresh, stale, missing, and manual-dispatch-only histories.
`production-health` will run the checker in a separate job without changing
any schedule. When GitHub runs the health workflow after a gap, stale workflows
make the run red and use the existing Actions notification path.

This supplement cannot page during a total GitHub scheduler outage; it can
only report the outage when GitHub resumes. Closing that gap requires an
external monitor, which is explicitly out of scope because it adds a new
service/cost and alerting policy.

## Verification and rollout

Run the focused regression tests first, then the repository's full verify
command. Validate YAML and active-reference scans, inspect Git and Vercel local
metadata, apply the GitHub homepage setting, push the verified commit to the
canonical repository, and wait for CI and Vercel production deployment. Finish
with live `/login`, GitHub workflow, repository metadata, Vercel project, and
Supabase Cron health checks.
