# Cron endpoints — operator runbook

Ten scheduled jobs keep the time-based features alive. None of them
run by themselves: each is a plain GET route that something external
must ping on a schedule. This page is the map.

| Endpoint                               | Does                                                                                                                                                                                             | Needed by                         | Schedule                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------- |
| `/api/follow-ups/cron`                 | Sends in-app bell notifications for follow-up tasks whose `remind_at` slot has arrived; an active dashboard rings while those notifications remain unread                                        | Follow-up reminders (Leads)       | every 15 min                                                         |
| `/api/automations/cron`                | Reclaims owner-leased automation runs parked on a **Wait** step, including expired `running` work                                                                                                | Automations with delays           | every 15 min                                                         |
| `/api/flows/cron`                      | CAS-times out the exact active snapshot abandoned mid-conversation (frees the one-active-run-per-contact lock)                                                                                   | WhatsApp flows                    | every 15 min                                                         |
| `/api/whatsapp/webhook`                | Recovers leased, failed, or pending durable WhatsApp webhook receipts; ordinary unauthenticated GETs remain Meta verification requests                                                           | Inbound WhatsApp durability       | every 15 min                                                         |
| `/api/v1/broadcasts/cron`              | Reclaims owner-leased public API broadcast recipients left pending by an interrupted `after()` drain                                                                                             | Public API broadcast durability   | every 15 min                                                         |
| `/api/renewals/cron`                   | Sends exact Marketing `gym_membership_renewal` / `gym_service_renewal` contracts after provider readiness; service sends require a current rate                                                  | Auto renewal reminders            | hourly at :41 database / :47 GitHub (after 09:00 account-local)      |
| `/api/payment-installments/cron`       | Sends exact Utility `gym_installment_reminder` while the second 40% remains due                                                                                                                  | Joining payment installments      | hourly at :41 database / :47 GitHub (7, 3, 1, and 0 days before due) |
| `/api/payments/razorpay/recovery/cron` | Recovers owner-leased events, links, refunds, and ordered recurring-charge exceptions; scans up to 20 due subscriptions against provider invoices; performs the daily OAuth token/readiness scan | Razorpay payment/OAuth durability | every 15 min                                                         |
| `/api/meta/leads/recovery/cron`        | Recovers up to 25 owned Meta lead events, then checks up to 10 due Pages and restores a missing `leadgen` subscription after lead access is verified; provider concurrency is capped at three    | Meta Lead Ads durability          | every 15 min                                                         |
| `/api/members/import-draft/cleanup`    | Claims expired author-private import drafts, deletes their private source objects, and removes their metadata idempotently                                                                       | Cross-device member import drafts | daily at 02:17 UTC                                                   |

All ten use claim or compare-and-set gates so overlapping schedulers do not
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

## Current schedulers: Supabase Cron + GitHub Actions

Supabase Cron is the database-owned execution path. Migrations
`20260827064004_database_owned_cron_scheduler.sql`,
`20260827070010_harden_database_cron_verifier.sql`, and
`20260827070201_activate_database_owned_cron_scheduler.sql` create, harden,
and activate two jobs:

- `usefuldesk-ops-cron` calls the seven high-frequency routes through
  `/api/database-cron?group=ops` at :08, :23, :38, and :53 each hour.
- `usefuldesk-renewals-cron` calls renewal and installment reminders through
  `/api/database-cron?group=renewals` hourly at :41.

The database generates a 256-bit secret internally, stores it only in Vault,
and retains only its SHA-256 digest in a private RLS-on/no-policy table. The
aggregator verifies it through a service-role-only RPC, then delegates to the
unchanged route-specific `AUTOMATION_CRON_SECRET` boundary. Never print, export,
or copy the Vault value into source or an operator command.

Two GitHub workflows independently ping the same production workers. They are
kept as a redundant execution path and the existing alert surface:

- [`.github/workflows/ops-crons.yml`](../.github/workflows/ops-crons.yml)
  — follow-ups + automations + flows + WhatsApp receipt recovery + public
  broadcast recovery + Razorpay recovery + Meta Lead Ads recovery at :11, :26,
  :41, and :56.
- [`.github/workflows/renewals-cron.yml`](../.github/workflows/renewals-cron.yml)
  — renewal and payment-installment reminders, hourly at :47. Accounts
  live in different timezones (migration 055); each route sends only
  after 09:00 local, and its sent ledger prevents duplicate messages.

The independent
[Production backup workflow](../.github/workflows/production-backup.yml) does
not call an application endpoint. It exports Supabase directly, encrypts the
result, and copies it to Cloudflare R2. Its credentials, activation checks, and
restore drill live in the [backup runbook](backups.md).

Production availability, alert thresholds, escalation ownership, and rollback
live in the [production runbook](production-runbook.md). GitHub documents that
scheduled events can be delayed or dropped, so neither a historically green
GitHub run nor a successful database dispatch proves the other scheduler is
current. Monitor both paths.

Refund review is a hard reminder hold. Refund-aware balance views expose
`collectible_balance=0` while a provider-confirmed refund lacks a safe complete
classification/allocation, and the joining-installment worker also filters
`requires_refund_review=false`. Do not bypass that hold or infer line targets
for an external partial refund.

Razorpay subscription source reconciliation is deliberately conservative. A
mandate is polled at most once per 24 hours in a provider-mode-scoped,
owner-leased batch of 20. The scan requires the subscription `paid_count` to
equal a complete chronological set of paid invoices and requires each missing
invoice to match a captured provider payment. A provider charge absent from
UsefulDesk becomes a durable `provider_charge_missing_webhook` review item; the
scan does not create a payment, allocate an invoice, or renew a membership.
Only an existing `charge_sequence_mismatch` whose `paid_count` is now exactly
next is replayed automatically, inside the same database transaction as its
ledger write.

The Razorpay recovery route keeps phase failures isolated so later phases can
still run, but returns `503` with the complete aggregate JSON when any phase's
`failed` counter is nonzero. The GitHub workflow uses `curl --fail`, so that
response makes the run red while preserving the body for diagnosis. A `200`
means every phase completed without an isolated failure; it does not mean work
was necessarily claimed.

Why not native Vercel Cron: the Hobby plan allows only two cron jobs at
once-per-day granularity, which cannot sustain the worker cadence. The one
daily member-import draft cleanup remains the deliberate exception declared in
`vercel.json`; it uses Vercel's bearer `CRON_SECRET` authentication.

### Setup (one-time)

1. Vercel → Project → Settings → Environment Variables → set one strong
   64-hex `AUTOMATION_CRON_SECRET` → **redeploy**.
2. GitHub repo → Settings → Secrets and variables → Actions →
   `AUTOMATION_CRON_SECRET` = the same value.
3. Apply the database-owned scheduler migrations through the approved Supabase
   migration connector. The database creates its separate secret itself.
4. Test from the Actions tab: run **ops-crons** and **renewals-cron**
   manually (workflow_dispatch) — every step must be green.
5. Inspect Supabase Cron history and `net._http_response`; both database jobs
   must be active and their latest aggregator response must have HTTP 200 with
   `failed: 0`.

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
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/meta/leads/recovery/cron
# → { "events": { "claimed": n, "processed": n, "failed": n, "busy": n },
#     "pages": { "claimed": n, "healthy": n, "repaired": n, "attention": n, "failed": n },
#     "notes": [{ "phase": "pages", "code": "..." }] }
curl -sS -H "x-cron-secret: <SECRET>" https://desk.usefulmade.com/api/members/import-draft/cleanup
```

`401` → secret mismatch (Vercel env vs repo secret). `503` with
`cron not configured` → env var not set in Vercel or not redeployed since.
`503` with a Razorpay aggregate result → inspect its nonzero `failed` counter
and matching `notes` entry.

Database-owned scheduler diagnostics are read-only:

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN ('usefuldesk-ops-cron', 'usefuldesk-renewals-cron');

SELECT status_code, timed_out, error_msg, created
FROM net._http_response
ORDER BY created DESC
LIMIT 20;
```

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
    {
      "path": "/api/payments/razorpay/recovery/cron",
      "schedule": "*/15 * * * *"
    },
    { "path": "/api/meta/leads/recovery/cron", "schedule": "*/15 * * * *" },
    { "path": "/api/renewals/cron", "schedule": "30 * * * *" },
    { "path": "/api/payment-installments/cron", "schedule": "30 * * * *" }
  ]
}
```

Then delete the two GitHub workflows (or leave them — doubled pings are
harmless, just noisy).
