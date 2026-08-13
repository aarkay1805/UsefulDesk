# Cron endpoints — operator runbook

Eight scheduled jobs keep the time-based features alive. None of them
run by themselves: each is a plain GET route that something external
must ping on a schedule. This page is the map.

| Endpoint                               | Does                                                                                                                                                      | Needed by                         | Schedule                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| `/api/follow-ups/cron`                 | Sends in-app bell notifications for follow-up tasks whose `remind_at` slot has arrived; an active dashboard rings while those notifications remain unread | Follow-up reminders (Leads)       | every 15 min                                                          |
| `/api/automations/cron`                | Reclaims owner-leased automation runs parked on a **Wait** step, including expired `running` work                                                         | Automations with delays           | every 15 min                                                          |
| `/api/flows/cron`                      | CAS-times out the exact active snapshot abandoned mid-conversation (frees the one-active-run-per-contact lock)                                            | WhatsApp flows                    | every 15 min                                                          |
| `/api/whatsapp/webhook`                | Recovers leased, failed, or pending durable WhatsApp webhook receipts; ordinary unauthenticated GETs remain Meta verification requests                    | Inbound WhatsApp durability       | every 15 min                                                          |
| `/api/v1/broadcasts/cron`              | Reclaims owner-leased public API broadcast recipients left pending by an interrupted `after()` drain                                                      | Public API broadcast durability   | every 15 min                                                          |
| `/api/renewals/cron`                   | Sends separately configured membership and service renewal templates at each configured offset; service sends require a current sellable rate             | Auto renewal reminders            | hourly at :30 (sends after 09:00 in each account's timezone)          |
| `/api/payment-installments/cron`       | Sends `gym_installment_reminder` while the second 40% of a joining checkout's full combined invoice remains due                                           | Joining payment installments      | hourly at :30 (7, 3, 1, and 0 days before the account-local deadline) |
| `/api/payments/razorpay/recovery/cron` | Recovers owner-leased pending/failed/stale Razorpay events in bounded batches and performs the once-daily OAuth token-due scan                            | Razorpay webhook/OAuth durability | every 15 min                                                          |

All eight use claim or compare-and-set gates so overlapping schedulers do not
overwrite newer state. Delayed automations and public broadcasts remain
at-least-once across the narrow crash window after an external step succeeds
but before its completion is recorded. Deep dives:
[renewal reminders](renewal-reminders.md) and
[payment installments](payment-installments.md).

Automation `send_webhook` steps may call only public, deliverable HTTP(S)
targets. The runner applies the shared SSRF guard immediately before fetch,
does not follow redirects, and aborts after ten seconds; blocked destinations
remain visible through the existing failed-step automation log semantics.

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
  — follow-ups + automations + flows + WhatsApp receipt recovery + public
  broadcast recovery + Razorpay recovery, every 15 min (best-effort; GitHub
  may stretch this to ~25 min under load, which is fine — reminder
  slots are hourly).
- [`.github/workflows/renewals-cron.yml`](../.github/workflows/renewals-cron.yml)
  — renewal and payment-installment reminders, hourly at :30. Accounts
  live in different timezones (migration 055); each route sends only
  after 09:00 local, and its sent ledger prevents duplicate messages.

Refund review is a hard reminder hold. Refund-aware balance views expose
`collectible_balance=0` while a provider-confirmed refund lacks a safe complete
classification/allocation, and the joining-installment worker also filters
`requires_refund_review=false`. Do not bypass that hold or infer line targets
for an external partial refund.

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
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/whatsapp/webhook
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/v1/broadcasts/cron
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/renewals/cron
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/payment-installments/cron
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/payments/razorpay/recovery/cron
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
    { "path": "/api/whatsapp/webhook", "schedule": "*/15 * * * *" },
    { "path": "/api/v1/broadcasts/cron", "schedule": "*/15 * * * *" },
    { "path": "/api/renewals/cron", "schedule": "30 * * * *" },
    { "path": "/api/payment-installments/cron", "schedule": "30 * * * *" }
  ]
}
```

Then delete the two GitHub workflows (or leave them — doubled pings are
harmless, just noisy).
