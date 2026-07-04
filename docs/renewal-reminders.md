# Auto renewal reminders — operator runbook

Automated WhatsApp renewal reminders (Phase 2). A daily job finds
memberships approaching expiry and sends the `gym_renewal_reminder`
template — the manual **Remind** button, on a schedule.

## How it works

```
GitHub Action (daily 09:00 IST)
  └─ GET https://desk.usefulmade.com/api/renewals/cron   (header: x-cron-secret)
       └─ for each account with renewal_reminder_settings.enabled = true
            ├─ readiness gate: WhatsApp connected AND gym_renewal_reminder APPROVED
            ├─ for each offset in days_before (e.g. 7, 3, 1):
            │    target end_date = IST today + offset
            │    find active memberships expiring exactly then
            ├─ claim-first dedupe via UNIQUE(membership_id, end_date, days_before)
            └─ send template via engineSendTemplate (same params as manual button)
```

- **Dedupe:** one row per (membership, expiry, offset) in
  `renewal_reminders_sent`. A member gets at most one message per offset
  per expiry. Renewing moves `end_date` → fresh cycle automatically.
- **Idempotent:** re-running the cron the same day sends nothing new.
- **IST-first:** all date math is Asia/Kolkata (`src/lib/memberships/expiry.ts`).
- **Cap:** 200 sends per invocation; overflow waits for the next run.

Key code: [`route`](../src/app/api/renewals/cron/route.ts) ·
[`lib`](../src/lib/memberships/renewal-reminders.ts) ·
[`settings UI`](../src/components/settings/renewal-reminders-settings.tsx) ·
migration [`033`](../supabase/migrations/033_renewal_reminders.sql).

## Status (as of setup)

| Piece | State |
|-------|-------|
| Migration 033 (tables + RLS) | ✅ applied to prod |
| `/api/renewals/cron` deployed | ✅ (401 without header, 200 with) |
| `AUTOMATION_CRON_SECRET` (Vercel) | ✅ set + redeployed |
| GitHub Action scheduler | ✅ green |
| `gym_renewal_reminder` approved | ⬜ **blocked on Meta Business account** |
| Account opt-in | ⬜ off by default |
| Members with expiry dates | ⬜ business data |

## Finishing it (when Meta is ready)

### 1. Approve the template
Settings → Templates → create **`gym_renewal_reminder`** (Utility), submit to
Meta, wait for **APPROVED**. It needs exactly **4 body params**, in order:

| Param | Value | Example |
|-------|-------|---------|
| `{{1}}` | member name | Anil |
| `{{2}}` | plan name | Quarterly |
| `{{3}}` | expiry date | 2026-07-11 |
| `{{4}}` | fee | ₹2,700 |

Example body:
> Hi {{1}}, your {{2}} membership expires on {{3}}. Renew now for {{4}} to
> keep training. Reply here to confirm.

Until APPROVED, the cron silently skips the account (readiness gate).

### 2. Turn it on
App → Settings → **Renewal reminders** → toggle on → pick days (default
7 / 3 / 1) → Save. Off by default per account.

### 3. Verify a real send
```bash
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/renewals/cron
```
Returns `{ sent, failed, skipped_already_sent, accounts_considered, notes }`.
- Seed a test member expiring in exactly 7 days first, so `sent > 0`.
- Run twice → second run `skipped_already_sent` climbs, `sent = 0` (dedupe).
- Check `renewal_reminders_sent` has a row with `wa_message_id` filled.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `401 Unauthorized` | header value ≠ `AUTOMATION_CRON_SECRET`. Check Vercel env + GH repo secret match. |
| `503 cron not configured` | env var not loaded → set in Vercel, **redeploy**. |
| 200 but `sent: 0`, `accounts_considered: 0` | no account has `enabled = true`. |
| 200 but account skipped | WhatsApp not connected, or template not APPROVED for that account. |
| `sent: 0` with members expiring | check offsets vs today's IST date; only exact `today + offset` matches. |

## Ops

- **Secret** lives in two places, must match: Vercel env `AUTOMATION_CRON_SECRET`
  and GitHub repo secret `AUTOMATION_CRON_SECRET`. Shared with `/api/automations/cron`.
- **Schedule:** [`.github/workflows/renewals-cron.yml`](../.github/workflows/renewals-cron.yml),
  daily 03:30 UTC. Manual run via Actions tab → Run workflow.
- **Domain:** `desk.usefulmade.com` (alias `useful-desk.vercel.app`).
