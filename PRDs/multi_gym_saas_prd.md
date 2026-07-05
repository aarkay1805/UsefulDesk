# PRD: Multi-Gym SaaS — One Deployment, Many Gyms

> **Status:** Draft · **Owner:** Platform · **Last updated:** 2026-07-05
> **Context docs:** [india_gym_crm_pain_points.md](./india_gym_crm_pain_points.md) · `CLAUDE.md` · `AGENTS.md`

## 1. Purpose

Turn wacrm/UsefulDesk from a **fork-and-self-host template** (one deployment = one business) into a **hosted multi-tenant SaaS** where a single deployment serves many independent gyms, each self-onboarding, connecting their own WhatsApp number, and paying a subscription — with zero manual work from the platform operator per gym.

This PRD covers **only the platform/tenancy layer** required for that shift. The gym domain (members, plans, renewals, payments, attendance) already exists (migrations `031`–`034`) and is out of scope except where entitlements gate it.

## 2. Background — current state

The codebase is already partially multi-tenant, which is why this is a bridge, not a rebuild.

**Already built (reusable as-is):**
- **Tenancy:** `accounts` table; `profiles.account_id` maps users to one account; RLS `is_account_member(account_id, min_role)` on every table; roles `owner > admin > agent > viewer` (`account_role_enum`). Migration `017_account_sharing.sql`.
- **Account-per-signup:** `handle_new_user` mints a fresh account + `owner` role atomically on every signup. Open public signup at `/signup`. Locked invariant: **one account per user**.
- **Per-tenant WhatsApp storage:** `whatsapp_config` is one row per account (`UNIQUE(account_id)`, `UNIQUE(phone_number_id)`), holding the encrypted access token (AES-256-GCM), `waba_id`, `verify_token`, registration state.
- **Per-tenant inbound routing:** the shared webhook `POST /api/whatsapp/webhook` demuxes every inbound by `phone_number_id` → `whatsapp_config` → `account_id`. One URL serves all tenants.
- **Single-app signature model:** `verifyMetaWebhookSignature` checks a single global `META_APP_SECRET`. This is *correct* for SaaS **because all tenant WABAs subscribe to the one platform Meta app** — Meta signs every tenant's inbound with the same secret.

**Not built (the gap this PRD closes):**
- Self-serve **WhatsApp onboarding** (today: manual paste of token/waba/phone_number_id + 2FA PIN via Settings → the single-org path).
- **Billing / subscriptions** (none — no plan SKUs, no payment integration).
- **Entitlements / quotas** per plan (none — every account is unlimited).
- **Platform operator console** (none — RBAC is within-account only; no cross-tenant super-admin).
- **Tenant lifecycle states** (trial / past_due / suspended) and their gating.

## 3. Goals / Non-goals

**Goals**
- A gym owner can sign up, connect their WhatsApp number, and send their first renewal reminder **without any platform-operator involvement**.
- One Meta app, one deployment, one Supabase project serve all gyms with hard data isolation.
- Gyms are billed on a recurring subscription (INR-first) with plan-based limits enforced.
- The platform operator has a console to view, support, suspend, and meter tenants.

**Non-goals (this phase)**
- Franchise / multi-branch within a single gym (that's Roadmap Phase 4; one account = one gym = one number here).
- Reselling / white-label sub-accounts.
- Migrating existing self-host forks into the SaaS.
- Replacing the gym domain layer (already built).
- WhatsApp marketing-message (ads) onboarding.

## 4. Personas

1. **Gym owner (tenant admin)** — signs up, connects WhatsApp, pays, runs renewals. Owns the account (`owner` role).
2. **Gym staff (agent/viewer)** — invited into the owner's account, works the shared inbox / member lists. Existing RBAC.
3. **Platform operator (super-admin)** — you. Cross-tenant: onboarding health, billing, support impersonation, suspension, usage metering. **New role, outside `account_role_enum`.**

## 5. Tenancy model

- **Tenant = `accounts` row.** Unchanged. One gym = one account = one WhatsApp number (`whatsapp_config.UNIQUE(account_id)`).
- **Isolation = RLS.** Every domain table already filters by `is_account_member(account_id)`. New tables in this PRD must follow the same pattern (copy from `017`).
- **Platform tables** (plans, subscriptions, usage, platform_admins) are **not** account-scoped in the tenant sense — they are read via service-role in server routes or gated by a super-admin check, never exposed to tenant sessions except the tenant's own subscription row.
- **Storage:** media buckets (`chat-media`) must remain account-pathed so one gym can't read another's uploads. Audit current upload paths (`uploadAccountMedia`) for tenant prefixing before GA.

## 6. Scope — capability map

| # | Capability | Build size | Depends on |
|---|-----------|-----------|-----------|
| 6.1 | WhatsApp Embedded Signup onboarding | **Large** | Meta App Review |
| 6.2 | Tenant lifecycle & status gating | Medium | — |
| 6.3 | Billing & subscriptions (INR) | Large | Razorpay |
| 6.4 | Plan entitlements & quota enforcement | Medium | 6.3 |
| 6.5 | Platform operator console (super-admin) | Medium | — |
| 6.6 | Usage metering (WhatsApp conversations) | Medium | 6.1 |
| 6.7 | Onboarding wizard & activation | Small | 6.1 |
| 6.8 | Compliance & data protection (DPDP) | Small–Med | — |

## 7. Feature spec — 6.1 WhatsApp Embedded Signup (the critical path)

**Problem:** the current onboarding (`POST /api/whatsapp/config`) requires the gym to hand-paste a system-user access token, `phone_number_id`, `waba_id`, and a 2FA PIN. That only works for someone with developer access to the platform's Meta app — impossible for a self-serve gym.

**Solution:** replace it with Meta **Embedded Signup** (Facebook Login for Business), so a gym connects its own WABA + number to the platform app via a popup.

### 7.1 Prerequisites (Meta — mostly done)
- Platform Meta app `1874296123566785` in **Live** mode.
- Business `27242553562081417` (UsefulMade) — **verified** ✅ (confirmed 2026-07-05).
- App Review **Advanced Access** for `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management` (in progress).
- **Facebook Login for Business** configured with an **Embedded Signup configuration** → yields a `config_id`.
- `META_APP_ID` added to env (currently only `META_APP_SECRET` is set).

### 7.2 Flow
1. Gym clicks **Connect WhatsApp** in onboarding.
2. Frontend launches the FB JS SDK `FB.login()` with `config_id` and `response_type: 'code'`, scopes `whatsapp_business_management,whatsapp_business_messaging,business_management`.
3. Gym, inside Meta's popup: selects/creates a WABA, adds/verifies a phone number, sets display name. Meta shares the WABA with the platform business On-Behalf-Of.
4. Popup returns an **authorization code** + a `message_event` payload carrying `waba_id` and `phone_number_id`.
5. **New server route** `POST /api/whatsapp/embedded-signup`:
   - Exchanges the code for a token: `GET /oauth/access_token?client_id=APP_ID&client_secret=APP_SECRET&code=CODE` → business-integration token scoped to the tenant's WABA under our app.
   - (Optionally exchange for / verify a long-lived token; business-integration system-user tokens from ES do not expire but confirm per Meta's current behavior.)
   - Registers the number: `POST /{phone_number_id}/register` (Cloud API hosting) — the ES path can auto-register; keep `registerPhoneNumber` as fallback.
   - Subscribes the WABA to the app: reuse `subscribeWabaToApp(waba_id, token)` (existing).
   - Encrypts the token (`encrypt()`), writes/updates `whatsapp_config` for the account: `phone_number_id`, `waba_id`, `access_token`, `registered_at`, `subscribed_apps_at`, `status='connected'`. Reuses the existing row shape.
6. Inbox is live — inbound routes through the existing webhook automatically.

### 7.3 App-level webhook (one-time, platform)
- The platform app's webhook must subscribe the **`messages`** field with callback `https://<platform-domain>/api/whatsapp/webhook` (the gap found during single-org debugging — an app with a callback but no subscribed fields delivers nothing).
- All tenants inherit this single app-level subscription; no per-tenant webhook wiring needed.

### 7.4 Changes vs today
| Piece | Today | After |
|-------|-------|-------|
| Token acquisition | manual paste | code→token exchange (ES) |
| `phone_number_id` / `waba_id` | manual entry | returned by ES |
| Number registration + PIN | manual | handled in ES |
| WABA→app subscribe | `subscribeWabaToApp` | unchanged (reused) |
| `whatsapp_config` write | `POST /config` | `POST /embedded-signup` |
| Webhook per tenant | n/a | unchanged — shared, demux by phone_number_id |

### 7.5 Keep the manual path
Retain `POST /api/whatsapp/config` behind a flag / advanced setting for edge cases (BYO test numbers, support recovery). ES is the default.

## 8. Feature spec — 6.2 Tenant lifecycle & status

Add a status machine to `accounts`:

`trialing → active → past_due → suspended → cancelled`

- **trialing:** default on signup; `trial_ends_at` = signup + N days (config, e.g. 14).
- **active:** valid paid subscription.
- **past_due:** payment failed; grace window (e.g. 7 days) with in-app banner; sending still allowed.
- **suspended:** grace elapsed or manual; **read-only** — inbox visible, outbound sends + broadcasts blocked, renewal cron skips the tenant.
- **cancelled:** subscription ended; login allowed, data export only.

**Gating points:** WhatsApp send route (`POST /api/whatsapp/send`), broadcasts, renewal reminder cron (`/api/renewals/cron`), automations send steps. Central helper `assertTenantCanSend(accountId)` checked server-side.

## 9. Feature spec — 6.3 Billing & subscriptions

- **Provider: Razorpay** (INR-native, UPI/cards/netbanking; India-first per product principles). Stripe as later option for non-India.
- **Platform plan SKUs** (distinct from gym `membership_plans`, which are the gym's own products): e.g. `Starter`, `Growth`, `Pro` — monthly/annual, INR.
- **New tables** (migration `035+`):
  - `platform_plans` — sku, name, price_inr, interval, limits (JSON: members, staff seats, monthly WA conversations, feature flags).
  - `subscriptions` — `account_id` (UNIQUE), `plan_id`, `status`, `razorpay_subscription_id`, `current_period_end`, `trial_ends_at`.
  - `billing_events` — append-only webhook log from Razorpay (idempotent by event id).
- **Razorpay webhook** route `POST /api/billing/webhook` (HMAC-verified, same discipline as Meta webhook): drives `subscriptions.status` + `accounts.status`.
- **Checkout:** hosted Razorpay subscription checkout from Settings → Billing; return URL activates.
- **Dunning:** Razorpay retries; on final failure → `past_due` → (after grace) `suspended`.

## 10. Feature spec — 6.4 Entitlements & quotas

- Entitlements derived from `subscriptions.plan_id → platform_plans.limits`.
- **Enforced limits (v1):**
  - **Monthly WhatsApp conversations** (metered — see 6.6) — soft cap → warn, hard cap → block new business-initiated conversations.
  - **Active members** — block new member creation past cap (upsell prompt).
  - **Staff seats** — block new invitations past cap.
  - **Feature flags** — e.g. AI assistant, Flows, API keys gated by tier.
- **Enforcement layer:** server-side `getEntitlements(accountId)` + guards in the relevant routes. Never trust client. Surfaced in UI as usage meters (reuse dashboard tiles).

## 11. Feature spec — 6.5 Platform operator console

- **New concept `platform_admins`** (table: `user_id`), checked by a `is_platform_admin()` SECURITY DEFINER helper. Separate from `account_role_enum` (which is intra-tenant).
- Routes under `/admin` (server-guarded), never exposed to tenants.
- **Views:** tenant list (status, plan, WA connection health, last activity, MRR), tenant detail, WhatsApp diagnostic (reuse `verify-registration` logic per tenant), usage, billing state.
- **Actions:** suspend/reactivate, extend trial, comp a plan, resend invite, **support impersonation** (audited, time-boxed, read-oriented), force WhatsApp re-subscribe.
- **Metrics:** signups, activation rate (connected WhatsApp), trial→paid conversion, churn, MRR, message volume.

## 12. Feature spec — 6.6 Usage metering

- Meter **WhatsApp conversations** (Meta's billable unit) per account per calendar month.
- Source: increment on outbound business-initiated sends + on Meta pricing webhooks (conversation category in status updates), keyed to `account_id`.
- **New table** `usage_counters` — (`account_id`, `period`, `metric`, `count`), upserted; drives quota checks (6.4) and cost reporting (6.5).
- Decide **pricing model:** (a) bundle N conversations in the plan then overage, or (b) pass-through Meta cost + margin. Recommend (a) for predictability; India utility-template pricing is low.

## 13. Feature spec — 6.7 Onboarding wizard

Linear, phone-first, "owner feels in control in 30 seconds" (product principle):
1. Sign up (email/password) → account minted.
2. **Connect WhatsApp** (Embedded Signup) — the activation moment.
3. Create first **membership plan** (reuse Settings → Membership plans).
4. Import members (reuse CSV import / `import-wizard`).
5. See the **Renewals** action list populate → send first reminder (needs approved `gym_renewal_reminder` template).
- Progress checklist on the dashboard; skippable; resumable. Activation = WhatsApp connected + ≥1 plan + ≥1 member.

## 14. Feature spec — 6.8 Compliance & data protection

- **India DPDP Act:** consent record for member contact; data export + deletion per account; data residency note (Supabase region).
- **WhatsApp Business / Commerce policy:** opt-in capture for template sends; honor STOP/opt-out; 24-hour window already enforced in the composer.
- **Tenant data isolation proof:** RLS test suite covering cross-tenant read/write attempts before GA.
- **Secrets:** per-tenant access tokens encrypted at rest (existing GCM). Rotating `ENCRYPTION_KEY` orphans all tokens — document as a break-glass procedure.

## 15. Data model changes (migrations `035+`)

New tables (all following the `017` RLS pattern; idempotent; reuse `update_updated_at_column()`):
- `platform_plans` (public-read of active SKUs; admin write).
- `subscriptions` (tenant reads own row; service-role/admin write).
- `billing_events` (service-role only).
- `usage_counters` (service-role write; tenant reads own).
- `platform_admins` (super-admin only).

Altered:
- `accounts`: add `status`, `trial_ends_at`, `plan_id` (denormalized current plan for fast gating).

No change to `whatsapp_config` schema — Embedded Signup reuses the existing columns.

## 16. Architecture changes summary

| Area | Change |
|------|--------|
| Onboarding | New `POST /api/whatsapp/embedded-signup`; new FB Login for Business front-end; keep `/config` as fallback |
| Webhook (inbound) | **No change** — shared route already demuxes by `phone_number_id`; ensure app-level `messages` subscription |
| Signature | **No change** — single `META_APP_SECRET` verifies all tenants |
| Billing | New Razorpay integration + `POST /api/billing/webhook` |
| Gating | New `assertTenantCanSend` / `getEntitlements` guards in send/broadcast/cron routes |
| Admin | New `/admin` surface + `is_platform_admin()` |
| Env | Add `META_APP_ID`, `META_ES_CONFIG_ID`, `RAZORPAY_*` |

## 17. Meta / WhatsApp requirements (status)

| Requirement | Status |
|-------------|--------|
| Platform Meta app, Live mode | app `1874296123566785` |
| Business Verification | ✅ verified |
| Advanced Access: messaging, management, business_management | ⏳ App Review in progress |
| Facebook Login for Business + ES config_id | ☐ to set up |
| App-level webhook `messages` field | ☐ one-time |
| Approved `gym_renewal_reminder` utility template | required for renewals |

## 18. Phased rollout

- **M1 — Onboarding (unblocks everything):** Embedded Signup end-to-end; app-level webhook `messages`; keep manual fallback. Exit: a brand-new gym self-connects and receives inbound.
- **M2 — Monetization:** platform plans, Razorpay subscriptions + webhook, trial→active→past_due→suspended states + send gating.
- **M3 — Entitlements & metering:** quotas, usage counters, in-app usage meters, overage handling.
- **M4 — Operator console:** admin views, suspension, impersonation, metrics.
- **M5 — Compliance & GA hardening:** DPDP export/delete, RLS cross-tenant test suite, storage path audit, dunning polish.

## 19. Success metrics

- **Activation rate:** % of signups that connect WhatsApp within 24h (target ≥ 60%).
- **Time-to-first-reminder:** signup → first renewal template sent (target < 15 min).
- **Trial→paid conversion** (target ≥ 20%).
- **Self-serve onboarding:** % of tenants onboarded with **zero** operator touch (target ≥ 95%).
- **Isolation incidents:** cross-tenant data leaks (target = 0, hard gate).

## 20. Risks & open questions

- **App Review delay** — the hard dependency for M1. Mitigation: submit early (in progress), keep manual path for pilots.
- **ES token lifecycle** — confirm business-integration token expiry/refresh behavior; design re-auth prompt if tokens can lapse.
- **Meta messaging limits / quality rating** — a shared app doesn't share limits (per-WABA), but a bad-actor tenant could harm the app's standing; need per-tenant quality monitoring + suspension.
- **Pricing model** — bundled vs pass-through conversation costs (Section 12) — decide before M2.
- **Existing self-host forks** — out of scope, but define the story if forks want to migrate in.
- **One-account-per-user invariant** — a person owning two gyms needs two logins today; acceptable for v1, revisit if common.
- **Storage isolation** — verify `chat-media` (and flow-media) paths are account-prefixed before GA.

## 21. Explicitly deferred

Branch/franchise multi-location, white-label, member mobile app, marketing-message onboarding, WhatsApp ads/`manage_events`, Stripe (non-India), reseller sub-accounts. Aligns with the roadmap's Phase 4+ and deferred list in `CLAUDE.md`.
