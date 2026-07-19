# Cron endpoints — operator runbook

Four scheduled jobs keep the time-based features alive. None of them
run by themselves: each is a plain GET route that something external
must ping on a schedule. This page is the map.

| Endpoint | Does | Needed by | Schedule |
|----------|------|-----------|----------|
| `/api/follow-ups/cron` | Sends in-app bell notifications for follow-up tasks whose `remind_at` slot has arrived; an active dashboard rings while those notifications remain unread | Follow-up reminders (Leads) | every 15 min |
| `/api/automations/cron` | Resumes automation runs parked on a **Wait** step | Automations with delays | every 15 min |
| `/api/flows/cron` | Times out flow runs abandoned mid-conversation (frees the one-active-run-per-contact lock) | WhatsApp flows | every 15 min |
| `/api/renewals/cron` | Sends the `gym_renewal_reminder` WhatsApp template to members expiring at each configured offset | Auto renewal reminders | hourly at :30 (sends after 09:00 in each account's timezone) |

All four are idempotent and dedupe claim-first — an overlapping or
doubled run never double-sends. Renewals has its own deep-dive:
[renewal-reminders.md](renewal-reminders.md).

### Follow-up reminder ringing

The cron remains the delivery source of truth. Once it inserts an unread
`follow_up_reminder`, every signed-in dashboard client for that recipient
follows the same delivery-relative schedule: ring for one minute, pause for
five minutes, repeat for up to one hour. Marking the notification read stops
the ringtone through Realtime. Web Audio must first be unlocked by a pointer
or keyboard interaction; a locked browser stays visual-only and never plays a
missed pulse late. The schedule is resolved from timestamps on every wake, so
background-tab timer throttling does not shift later ring/pause windows.

## Auth

Every route accepts the shared secret two ways
([`src/lib/cron/auth.ts`](../src/lib/cron/auth.ts), constant-time
comparison):

- **`x-cron-secret: <secret>`** — for pingers that can set custom
  headers (GitHub Actions, cron-job.org, curl).
- **`Authorization: Bearer <secret>`** — what native Vercel Cron sends
  (it can't set custom headers; it injects the reserved `CRON_SECRET`
  env var as a bearer token).

The secret is `AUTOMATION_CRON_SECRET`; `CRON_SECRET` is accepted as an
equivalent so a native-Vercel setup needs no extra provisioning. No
secret configured → routes answer `503 cron not configured`.

## Current scheduler: GitHub Actions

Two workflows ping production (`desk.usefulmade.com`):

- [`.github/workflows/ops-crons.yml`](../.github/workflows/ops-crons.yml)
  — follow-ups + automations + flows, every 15 min (best-effort; GitHub
  may stretch this to ~25 min under load, which is fine — reminder
  slots are hourly).
- [`.github/workflows/renewals-cron.yml`](../.github/workflows/renewals-cron.yml)
  — renewals, hourly at :30. Accounts live in different timezones
  (migration 055); each run only processes accounts past 09:00 local,
  and the sent-ledger keeps it to one send per day per member.

Why not native Vercel Cron: the Hobby plan allows only 2 cron jobs at
once-per-day granularity — useless for the 15-minute jobs. GitHub
Actions is free, plan-independent, and can send the custom header.

### Setup (one-time)

1. Generate a secret: `openssl rand -hex 32`.
2. Vercel → Project → Settings → Environment Variables →
   `AUTOMATION_CRON_SECRET` = that value → **redeploy**.
3. GitHub repo → Settings → Secrets and variables → Actions →
   `AUTOMATION_CRON_SECRET` = the same value.
4. Test from the Actions tab: run **ops-crons** and **renewals-cron**
   manually (workflow_dispatch) — every step must be green.

### Verify by hand

```bash
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/follow-ups/cron
# → { "due": n, "notified": n, "skipped_claimed": 0, "failed": 0, "notes": [] }
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/automations/cron
# → { "processed": n }
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/flows/cron
```

`401` → secret mismatch (Vercel env vs repo secret). `503` → env var
not set in Vercel or not redeployed since.

## If the project moves to Vercel Pro

Native crons become viable (40 jobs, minute granularity). Add
`CRON_SECRET` (same value) to Vercel env — its cron invocations then
authenticate automatically — and create `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/follow-ups/cron", "schedule": "*/15 * * * *" },
    { "path": "/api/automations/cron", "schedule": "*/15 * * * *" },
    { "path": "/api/flows/cron", "schedule": "*/15 * * * *" },
    { "path": "/api/renewals/cron", "schedule": "30 3 * * *" }
  ]
}
```

Then delete the two GitHub workflows (or leave them — doubled pings are
harmless, just noisy).
