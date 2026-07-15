# Meta App Review — Data Handling

_Last reviewed: 2026-07-15. Keep this in sync with the code it describes — it is the answer sheet for Meta's App Review data-handling questionnaire and a standing map of where Platform Data flows._

> **Platform Data** = data obtained via the Meta / WhatsApp Business API: customer phone numbers, WhatsApp message content, WhatsApp profile names, WABA / phone-number IDs, WhatsApp access tokens, and the Meta app secret.

---

## 1. Third-party data processors / service providers

| # | Vendor | Meta-sourced data it touches | Where configured | Relationship |
|---|--------|------------------------------|------------------|--------------|
| 1 | **Vercel** (serverless hosting) | All Platform Data **in transit**; env secrets (`META_APP_SECRET`, `ENCRYPTION_KEY`, Supabase keys); application / function logs | Production host of `desk.usefulmade.com` (deployed from GitHub `main`). Domain registrar is GoDaddy — DNS only, processes no Platform Data, not a subprocessor. | **Subprocessor** (separate company) |
| 2 | **Supabase** (Postgres, Auth, Storage) | Phone numbers, message content, profile names, WABA / phone IDs, **WhatsApp access tokens (AES-256-GCM encrypted at rest)**, chat media | `src/lib/supabase/*`; tables `contacts`, `conversations`, `messages`, `whatsapp_config`, `meta_page_config` | **Subprocessor** (separate company; primary datastore) |
| 3 | **Meta / WhatsApp (Graph API)** | Everything — origin + destination of sends, tokens, media | `graph.facebook.com` in `src/lib/whatsapp/meta-api.ts` | Data **source** (Meta itself) |
| 4 | **OpenAI** _(optional, per-account, BYO-key)_ | **WhatsApp message content** — recent conversation text sent for AI reply drafting + embeddings | `src/lib/ai/providers/openai.ts`, `src/lib/ai/context.ts` | Separate company; customer-elected, customer's own key |
| 5 | **Anthropic** _(optional, per-account, BYO-key)_ | Same — message content for AI drafting | `src/lib/ai/providers/anthropic.ts` | Separate company; customer-elected, customer's own key |
| 6 | **Razorpay** _(optional — UPI payments / auto-pay)_ | Customer **name + phone number + email** for payment mandates (NOT message content or tokens) | `src/lib/payments/razorpay.ts`, `src/app/api/payments/razorpay/**` | Separate company; per-account credentials |
| 7 | **User-configured outbound webhooks** _(optional, per-account)_ | **Message content** (`message.received` text), `contact_id`, WhatsApp message IDs — POSTed to arbitrary account-set URLs | `src/lib/webhooks/deliver.ts` (SSRF-guarded, `src/lib/webhooks/ssrf.ts`) | Arbitrary third parties chosen by the account owner |
| 8 | **Cloudflare (Turnstile)** _(optional)_ | CAPTCHA token + requester IP on the public lead form — **no** WhatsApp data | `TURNSTILE_SECRET_KEY` | Separate company; minimal data |
| 9 | **GitHub Actions** (cron pinger) | **None** — hits cron routes with a shared secret; no data payload | `.github/workflows/*-cron*.yml` | Scheduler only |

**No analytics or observability third parties.** No Sentry, Datadog, PostHog, Segment, Mixpanel, or Vercel Analytics in application code. No Redis / queue. No AWS / GCP / Azure. Fonts are self-hosted at build time (no runtime Google request).

**Vendors that receive the most sensitive data:** #4, #5, and #7 receive **message content**; #6 receives contact PII. #4 / #5 / #7 are per-account, customer-activated, and off by default. Disclose (or disable for the review window) per the data controller's decision.

---

## 2. Data flow summary (end-to-end)

**Ingestion.** Inbound WhatsApp messages arrive at `POST /api/whatsapp/webhook`, HMAC-SHA256-verified against `META_APP_SECRET` before any processing. Outbound sends go through `sendMessageToConversation` → Graph API. Separate ingestion paths: the public lead form (`/f/<token>`) and the Meta Lead Ads webhook (`/api/meta/leads/webhook`).

**Storage.** All persisted in **Supabase Postgres**, tenant-isolated by Row-Level Security. WhatsApp access tokens and Page tokens are **AES-256-GCM encrypted** (`ENCRYPTION_KEY`); the Meta app secret lives only in the host environment, never in the database. Media is in Supabase Storage; private receipts use short-lived signed URLs (never persisted).

**Processing.** Runs on **Vercel** (serverless functions). Message content leaves the system only when an account opts into the AI assistant with its own OpenAI / Anthropic key, or configures an outbound webhook.

**Third parties in the flow.** Supabase (store), Vercel (compute / transit), Meta Graph API (source / destination); optionally OpenAI / Anthropic (message content), Razorpay (contact PII), user-set webhooks (message content), Cloudflare Turnstile (spam gate).

**Retention / deletion.**
- **Meta Data Deletion Request Callback** — `POST /api/meta/data-deletion` (HMAC-verified; returns `{ url, confirmation_code }`). Public status page at `/data-deletion`. See the changelog entry "Data deletion — Meta callback + account erasure (migration `066`)".
- **Account-level erasure** — `DELETE /api/account` (owner-only) permanently deletes the account and cascades all Platform Data (contacts, conversations, messages, encrypted tokens, media, member logins). Owner UI in Settings → Members.
- Per-record deletes (contacts, notes, media) are available throughout. There is no fixed retention TTL — data persists until deleted by the account or via the flows above.

---

## Controller & legal answers

- **Data controller:** UsefulMade, India (solo operator).
- **Government disclosures, past 12 months:** None. Volume: 0.
- **Government-request policy:** see `docs/govt-requests-policy.md`.
- **Subprocessor disclosure decision:** all vendors above are disclosed, including the opt-in message-content ones (OpenAI / Anthropic / user webhooks) and the contact-PII vendor (Razorpay). Public-facing text: `docs/privacy-and-subprocessors.md`.
