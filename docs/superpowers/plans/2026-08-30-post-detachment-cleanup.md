# Post-Detachment Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish UsefulDesk's repository, deployment-link, invite-domain, and schedule-alert detachment from `ArnasDon/wacrm` while preserving production behavior.

**Architecture:** Keep the cleanup split into declarative repository identity, one tested runtime fallback, one tested read-only GitHub freshness checker, and local/external configuration changes. Reuse the existing production runbook thresholds and keep Supabase Cron and business schedules unchanged.

**Tech Stack:** Markdown/YAML/JSON, Node.js 20+, Vitest, GitHub Actions/API, Vercel CLI, Git.

**Spec:** `docs/superpowers/specs/2026-08-30-post-detachment-cleanup-design.md`

## Global Constraints

- Preserve historical `CHANGELOG.md` links and compatibility identifiers such as `wacrm_live_`, storage keys, signature headers, and provider fixtures.
- Do not modify production data, database migrations, Supabase Cron schedules, business worker schedules, or credentials.
- Canonical repository: `https://github.com/aarkay1805/UsefulDesk`.
- Canonical production domain: `https://desk.usefulmade.com`.
- Production Vercel project: `useful-desk`.
- GitHub freshness thresholds stay at ops 75 minutes, renewals 120 minutes, and backup 1,800 minutes.

---

### Task 1: Rebrand active repository surfaces

**Files:**

- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/CODEOWNERS`
- Modify: `.github/dependabot.yml`
- Modify: `.github/SECURITY.md`
- Modify: `.github/CODE_OF_CONDUCT.md`
- Modify: `.github/ISSUE_TEMPLATE/config.yml`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Modify: `.github/pull_request_template.md`

**Interfaces:**

- Consumes: product facts and canonical URLs from `AGENTS.md` and `docs/production-runbook.md`.
- Produces: active public repository metadata containing no upstream ownership or domain references.

- [ ] **Step 1: Replace public product and contributor copy**

  Describe UsefulDesk as the India-first, phone-first gym CRM, document local setup and production architecture from existing repository docs, and route contribution/support links to `aarkay1805/UsefulDesk`.

- [ ] **Step 2: Replace GitHub ownership and reporting metadata**

  Set CODEOWNERS and Dependabot reviewers to `aarkay1805`; route private reports to this repository's advisory page; remove the former maintainer email.

- [ ] **Step 3: Update package identity**

  Set the private package name to `usefuldesk`, author to `Rajat Kashyap`, homepage to `https://desk.usefulmade.com`, repository and bugs URLs to the canonical GitHub repository, then run `npm install --package-lock-only --ignore-scripts` so both lockfile roots match.

- [ ] **Step 4: Verify scoped detachment**

  Run:

  ```bash
  rg -n 'ArnasDon|wacrm\.tech|a\.donauskas@hostinger\.com' README.md CONTRIBUTING.md package.json package-lock.json .github
  ```

  Expected: no matches.

### Task 2: Change the invite fallback with TDD

**Files:**

- Modify: `src/lib/auth/invitations.test.ts`
- Modify: `src/lib/auth/invitations.ts`
- Modify: `.env.local.example`

**Interfaces:**

- Consumes: `resolveInviteBaseUrl(request: Request): string`.
- Produces: the canonical UsefulDesk production URL when request-derived hosts are unavailable.

- [ ] **Step 1: Write the failing regression test**

  Add a test that clears `NEXT_PUBLIC_SITE_URL` and `ALLOWED_INVITE_HOSTS`, passes a request without usable host headers, and expects `https://desk.usefulmade.com`.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `npm test -- --run src/lib/auth/invitations.test.ts`

  Expected: the new assertion receives `https://wacrm.tech`.

- [ ] **Step 3: Implement the minimal fallback change**

  Change only the final fallback constant and matching warning/example comment to `https://desk.usefulmade.com`.

- [ ] **Step 4: Run the focused test and confirm GREEN**

  Run: `npm test -- --run src/lib/auth/invitations.test.ts`

  Expected: all invitation tests pass.

### Task 3: Add tested GitHub schedule freshness alerting

**Files:**

- Create: `scripts/github-workflow-freshness.mjs`
- Create: `scripts/github-workflow-freshness.test.mjs`
- Modify: `.github/workflows/production-health.yml`
- Modify: `docs/production-runbook.md`
- Modify: `docs/automations-and-cron.md`

**Interfaces:**

- Produces: `evaluateWorkflowFreshness({ now, workflows, runsByWorkflow })`, returning one status per workflow with age and stale reason.
- Consumes: `GITHUB_REPOSITORY`, `GITHUB_TOKEN`, and GitHub Actions workflow-runs API responses.

- [ ] **Step 1: Write failing unit tests**

  Cover fresh scheduled successes, stale successes, no scheduled history, and histories where only a manual dispatch succeeded.

- [ ] **Step 2: Run the checker test and confirm RED**

  Run: `npm test -- --run scripts/github-workflow-freshness.test.mjs`

  Expected: module import or missing export failure.

- [ ] **Step 3: Implement the checker**

  Query the workflow-runs endpoint with `event=schedule`, select the latest completed success, compare its timestamp with the configured threshold, emit GitHub annotations for stale entries, and exit nonzero if any entry is stale.

- [ ] **Step 4: Run the checker test and confirm GREEN**

  Run: `npm test -- --run scripts/github-workflow-freshness.test.mjs`

  Expected: all freshness tests pass.

- [ ] **Step 5: Wire the checker into production-health**

  Add `actions: read`, keep the existing login job unchanged, and add an independent checkout/Node job that runs the script with the repository token. Update the runbooks with the detection behavior and total-GitHub-outage limitation.

- [ ] **Step 6: Prove the current stale condition is detected**

  Run:

  ```bash
  GITHUB_REPOSITORY=aarkay1805/UsefulDesk GITHUB_TOKEN="$(gh auth token)" node scripts/github-workflow-freshness.mjs
  ```

  Expected before GitHub resumes: nonzero with the stale workflow names; after fresh scheduled runs: zero.

### Task 4: Apply local detachment safety

**Files/settings:**

- Generate ignored local `.vercel/project.json` via authenticated Vercel CLI.
- Modify shared Git config remote names/URLs.
- Modify GitHub repository homepage.

**Interfaces:**

- Produces: local Vercel commands scoped to `useful-desk`; archival upstream fetch retained with pushes disabled; GitHub homepage set to the canonical domain.

- [ ] **Step 1: Link the production Vercel project**

  Run `npx --yes vercel@latest link --yes --project useful-desk --scope rajat-kashyaps-projects-9b7ec599`, then verify `projectName` is `useful-desk` without printing credentials.

- [ ] **Step 2: Disable upstream pushes**

  Rename `upstream` to `upstream-archive` and set its push URL to `DISABLED`. Verify `git remote -v` shows the archival fetch URL and invalid push target.

- [ ] **Step 3: Update GitHub homepage and security settings**

  Set the homepage to `https://desk.usefulmade.com`, enable issues for the package bug-report URL, and enable Dependabot security updates while preserving secret scanning and push protection.

### Task 5: Document, verify, and deploy

**Files:**

- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`

**Interfaces:**

- Consumes: verified results from Tasks 1-4.
- Produces: concise current-state documentation and a deployed canonical main commit.

- [ ] **Step 1: Record the shipped cleanup**

  Add terse entries describing repository identity, invite fallback, Vercel/Git safety, and the GitHub freshness supplement without copying historical upstream links.

- [ ] **Step 2: Run full local verification**

  Run `npm run verify`, `git diff --check`, the scoped upstream scan, workflow YAML parse, Vercel link inspection, Git remote inspection, and the live checker.

- [ ] **Step 3: Commit and push the verified change**

  Commit on the detached worktree and push the exact commit to canonical `main`, which triggers GitHub CI and Vercel production deployment.

- [ ] **Step 4: Verify external rollout**

  Wait for CI and deployment completion, then verify GitHub homepage/settings, CODEOWNERS/Dependabot content on `main`, Vercel production project/deployment, `/login` HTTP/title, manual production-health dispatch, and read-only Supabase Cron health.
