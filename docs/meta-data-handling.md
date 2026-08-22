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

## Lead Ads permission descriptions

These descriptions are the canonical App Review answers. Keep the dependency-only scopes explicit: UsefulDesk does not expose campaign, ad, post, or comment management.

### `pages_show_list`

An owner or admin opens **Settings → Lead capture**, selects **Connect Facebook Page**, signs in through Facebook Login for Business, and chooses the Pages they administer. UsefulDesk exchanges the returned code server-side and calls `GET /me/accounts?fields=id,name,access_token,tasks` to obtain only the Pages granted in that flow. The Page ID and name identify the correct Page and tenant; the Page token is encrypted before storage. This avoids manual token entry and prevents one business from connecting another business's Page.

### `pages_manage_metadata`

UsefulDesk calls `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` to subscribe the selected Page to Lead Ads webhooks. It reads the same edge to verify the subscription, repairs a missing `leadgen` subscription during health checks, and calls `DELETE /{page-id}/subscribed_apps` when the customer disconnects the Page. This permission is necessary because Meta sends Lead Ads notifications only after the app is subscribed to the Page's `leadgen` field.

### `leads_retrieval`

Meta's signed Page webhook supplies a `leadgen_id`, not the submitted answers. UsefulDesk calls `GET /{leadgen-id}?fields=id,created_time,field_data,form_id,ad_id,campaign_id,platform,is_organic` with the selected Page's token. It maps the submitted name, phone, email, and custom answers into the gym's tenant-isolated lead record so staff can follow up. Duplicate deliveries are idempotent, unknown Pages are discarded, and a Lead Ads submission does not create WhatsApp consent.

### `pages_read_engagement`

This is a provider-required dependency in Meta's Lead Ads authorization contract. UsefulDesk uses Page-level reads only for the selected Page's identity, assigned tasks, and `has_lead_access` diagnostic so it can verify that the connecting user and app may retrieve that Page's leads and show an actionable connection-health state. UsefulDesk does not read, display, analyze, or export Page posts, comments, reactions, or other engagement content.

### `pages_manage_ads`

Meta requires this scope with `leads_retrieval` for the Lead Ads Page authorization flow. UsefulDesk requests it only while an owner or admin connects a Page and uses the resulting authorization to validate lead access and retrieve submissions for that Page. UsefulDesk does not create, edit, publish, pause, or delete ads and exposes no ad-management controls. The value to the customer is automatic, correctly scoped delivery of enquiries from the Page's existing Facebook or Instagram lead ads into its UsefulDesk CRM.

### `ads_management`

This is a provider-required dependency in Meta's current Lead Ads app-install and lead-access contract. UsefulDesk requests it only as part of the Page connection used to retrieve Lead Ads submissions. UsefulDesk does not create or modify campaigns, ad sets, ads, audiences, budgets, or bids, and it does not fetch advertising metrics. The permission enables the authorized Lead Ads connection; the product surface is limited to connecting the Page, checking connection health, receiving leads, and disconnecting the Page.

## Reviewer walkthrough

1. Sign in to the supplied UsefulDesk review account as an owner or admin.
2. Open **Settings → Lead capture**.
3. In **Facebook & Instagram lead ads**, select **Connect Facebook Page**.
4. Complete Facebook Login for Business and grant the supplied test Page.
5. Return to UsefulDesk and verify that the Page appears as **Connected**.
6. Submit a test lead from a lead form that asks for a phone number.
7. Open **Leads** and verify that the submission appears automatically with its form answers and Facebook or Instagram source.
8. Return to **Settings → Lead capture**, use **Check now**, then disconnect the Page after review if required.

## Controller and legal answers

- **Data controller:** UsefulMade, India (solo operator).
- **Government disclosures in the past 12 months:** none (0).
- **Government-request policy:** `docs/govt-requests-policy.md`.
- **Public disclosure source:** `docs/privacy-and-subprocessors.md`.
