# Meta App Review — Data Handling

_Last reviewed: 2026-08-22. Keep this answer sheet synchronized with the code and the public privacy text._

**Platform Data** includes data obtained through Meta and WhatsApp APIs: WhatsApp phone numbers, profiles, message content and media; WABA, phone-number and Page identifiers; Lead Ads form answers and form/ad/campaign identifiers; platform source; encrypted WhatsApp and Page access tokens; connection-health diagnostics; and the Meta app secret.

## 1. Third-party data processors and service providers

| #   | Vendor                                             | Meta-sourced data it touches                                                                         | Relationship                                 |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | **Vercel**                                         | All Platform Data in transit; environment secrets; bounded application/function logs                 | Production application host and subprocessor |
| 2   | **Supabase**                                       | Contacts, Lead Ads answers and identifiers, messages, encrypted credentials, health state, and media | Primary datastore/Auth/Storage subprocessor  |
| 3   | **Meta Platforms / WhatsApp**                      | Source and destination for WhatsApp and Lead Ads data, credentials, and media                        | Platform Data source                         |
| 4   | **OpenAI** _(optional, per-account, BYO key)_      | Recent WhatsApp conversation text for drafting and embeddings                                        | Customer-elected provider                    |
| 5   | **Anthropic** _(optional, per-account, BYO key)_   | Recent WhatsApp conversation text for drafting                                                       | Customer-elected provider                    |
| 6   | **Razorpay** _(optional)_                          | Customer name, phone number, and email for payments; no message content or Meta tokens               | Payment subprocessor                         |
| 7   | **User-configured outbound webhooks** _(optional)_ | Event-specific message/contact data sent to an account-selected URL                                  | Customer-selected recipient                  |
| 8   | **Cloudflare Turnstile** _(optional)_              | CAPTCHA token and requester IP for the public form; no WhatsApp content                              | Spam-protection subprocessor                 |
| 9   | **GitHub Actions**                                 | No Platform Data payload; sends a cron secret to recovery routes                                     | Scheduler only                               |

GoDaddy is the domain registrar/DNS provider only and does not process Platform Data for the application. There are no application analytics or observability vendors such as Sentry, Datadog, PostHog, Segment, or Mixpanel.

## 2. Data flow summary

**Ingestion.** WhatsApp and Meta Lead Ads webhook POSTs are HMAC-SHA256 verified with `META_APP_SECRET` before processing. The Lead Ads route accepts only `page`/`leadgen` deliveries, resolves the globally unique Page to one tenant, and durably claims each lead before fetching its form answers. Unknown Pages are acknowledged without assigning or storing their submissions.

**Storage.** Supabase Postgres stores tenant-isolated contacts, notes, source and form/ad/campaign identifiers, durable event/retry state, and Page-health diagnostics. WhatsApp and Page access tokens are AES-256-GCM encrypted with `ENCRYPTION_KEY`; the Meta app secret remains only in Vercel environment configuration. Media is stored in Supabase Storage.

**Processing.** Vercel runs webhook, API, and scheduled recovery functions. Lead recovery and Page-health responses/logs are aggregate and identifier-free. Message content leaves the service only for an account-enabled AI provider or outbound webhook. Lead Ads form answers are used to create or enrich the gym's lead record and are not sent to those optional WhatsApp-content integrations merely because the lead was captured.

**Consent boundary.** A Meta Lead Ads submission creates no WhatsApp consent record. A supplied phone number makes the lead available for the gym team to follow up only under its own lawful basis and the separately audited WhatsApp consent rules.

**Retention and deletion.** Platform Data persists until the account deletes records or its account. `DELETE /api/account` performs owner-authorized account erasure. Meta's signed data-deletion callback is `POST /api/meta/data-deletion`, with status at `/data-deletion`.

## Controller and legal answers

- **Data controller:** UsefulMade, India (solo operator).
- **Government disclosures in the past 12 months:** none (0).
- **Government-request policy:** `docs/govt-requests-policy.md`.
- **Public disclosure source:** `docs/privacy-and-subprocessors.md`.
