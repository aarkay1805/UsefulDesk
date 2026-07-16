@AGENTS.md

# UsefulDesk — India-first gym CRM

A mature multi-tenant **WhatsApp CRM** (`wacrm` v0.7.0) with a **gym domain layer** built on top. The comms foundation (WhatsApp send + templates, broadcasts, automations, shared inbox, RBAC, public API) was already best-in-class; members / plans / memberships / renewals / payments / attendance were added on top and now ship. Market analysis: `PRDs/india_gym_crm_pain_points.md`.

**The wedge (still the north star):** know who's expiring → remind on WhatsApp → collect on UPI → assign follow-up → track the conversation.

**Feature filter — every feature must answer:** does it save the owner time, recover lost leads, collect renewals, or retain members? If not, defer.

**Principles:** phone-first · WhatsApp-native (not an add-on) · renewal-first · **action lists over dashboards** · offline-tolerant · every exception has an owner + status + next action · don't force a member app · the owner feels in control in 30 seconds.

---

## Read the doc your task touches — not all of them

| Doc | Read when |
|---|---|
| [docs/ui-patterns.md](docs/ui-patterns.md) | touching **any UI** — canonical components, tokens, forms, tables, animation |
| [docs/gym-domain.md](docs/gym-domain.md) | touching **members, plans, memberships, billing, payments, auto-pay, attendance** |
| [docs/changelog.md](docs/changelog.md) | archaeology — *why* a past decision was made |
| [PRDs/roadmap.md](PRDs/roadmap.md) | what's built, what's next, what's deliberately deferred |
| [docs/renewal-reminders.md](docs/renewal-reminders.md) · [docs/automations-and-cron.md](docs/automations-and-cron.md) · [docs/public-api.md](docs/public-api.md) | those subsystems |
| [PRDs/](PRDs/) | product specs (autopay, lead transfer, imports, multi-gym SaaS) |

Don't preload them "just in case" — that's what made this file bloat in the first place.

## Doc maintenance rule (non-negotiable)

> **⚠️ Budget: this file stays under ~150 lines / ~2.5k tokens.** It is auto-loaded into **every** session before the user types a word, so every line here is a permanent per-session token tax — paid by UI tasks, billing tasks, and typo fixes alike. If you're adding and it won't fit, something already here is stale: **prune, don't append.** (It hit ~24k tokens once. That's what the split fixed.)

- Ship a feature → append to `docs/changelog.md` (terse: what shipped, where the code lives, gotchas a future session must know).
- Establish a **rule / invariant / canonical component** → add ONE line here or to the relevant `docs/` file.
- Plan or defer work → `PRDs/roadmap.md`, not here.
- **CLAUDE.md only grows when a RULE changes.** Never paste feature narrative here. Prune stale lines; don't stack contradictions.

---

## Architecture

- **Stack:** Next.js 16 (App Router; middleware is renamed `proxy` → `src/proxy.ts`), React 19, TypeScript, Supabase (Postgres + Auth + Storage + RLS), Tailwind v4, Base UI / shadcn primitives (`src/components/ui/`), Motion (`motion/react`). **No zod** — validation is hand-rolled. Vitest, colocated `*.test.ts` in `src/lib`.
- **No `"use server"` actions.** Backend = `src/app/api/**/route.ts` handlers, or direct Supabase browser-client calls from client components, secured by Postgres RLS.
- **Tenancy:** tenant = an `accounts` row; users belong to one via `profiles.account_id`. RBAC `owner > admin > agent > viewer` (`account_role_enum`), enforced by the RLS helper `is_account_member(account_id, min_role)` and mirrored in `src/lib/auth/roles.ts` + `useAuth()`. **Copy the RLS pattern from `supabase/migrations/017_account_sharing.sql`.**
- **Role capabilities:** every "who can do X" check is a **named predicate** in `src/lib/auth/roles.ts` (+ a test in `roles.test.ts`), mirrored by an RLS policy. Adding a capability = one predicate + one policy. **No inline role comparisons at call-sites.**
- **Authored content** (notes, comments, activity remarks) belongs to its **author**: only the author may edit; the author **or an admin/owner** may delete (moderation). Enforce in **BOTH** layers — RLS *and* UI (gate the affordance via a `roles.ts` predicate). **Never a UI-only gate.**
- **Migrations:** sequential + idempotent in `supabase/migrations/` (enums in a `DO $$ IF NOT EXISTS` block, `CREATE TABLE/INDEX IF NOT EXISTS`, drop-then-create policies, reuse `update_updated_at_column()`). Latest = `069`. **Apply via the Supabase MCP `apply_migration`** against project `UsefulDesk` (`fwqthstqrkrwtaehefks`), then verify with a `pg_policies`/schema query. ⚠️ `supabase db push` **fails** on a migration-history mismatch with the MCP-applied timestamped file — always use MCP. Keep new files sequentially numbered.
- **Lead origin (`received_via`) is immutable and load-bearing.** Human origins (`manual`/`import`/NULL) render the owner; everything else renders an "Auto · <channel>" pill and is **ownership-LOCKED** (`050`/`052` refuse a transfer) — assign via the approval-gated `requestLeadAssignment` instead. **Auto-captured leads land `assigned_to = NULL`** (no round-robin exists; setting it fires `notify_lead_assigned` at someone who never agreed to own the lead). Any new capture path: pass `receivedVia` to `findOrCreateContact`, fire `new_contact_created` yourself (nothing else does), and **write a `contact_notes` row on dedupe too** — otherwise a repeat enquiry from a known number is invisible.
- **Public (unauthenticated) endpoints:** token in the URL **path**, a `SECURITY DEFINER` RPC returning a **fixed shape** (a public endpoint leaks exactly what it selects), per-IP `checkRateLimit` *before* the DB, and a service-role write (RLS denies anon). On a public **write**: honeypot → **200, never 400** (a 400 tells the bot which field is the trap); identical success body whether the row was created or deduped (else it's a membership oracle); Turnstile fails **closed** in prod. The in-memory rate limiter is per-lambda — a speed bump, not a wall.

### Localization (never bypass)

Every account carries its own regional config on `accounts`: `country_code, locale, timezone, date_order, time_format, week_start, phone_country_code, measurement_system, default_currency`.

- **Geography lives ONLY in `src/lib/locale/config.ts`** (`COUNTRY_PRESETS` — one row per country). Adding a country = adding a preset.
- **ONE formatting surface:** `buildFormatters(resolveAccountLocale(row))` → `fmt.date / dateShort / time / dateTime / number / money / moneyShort / today()`. Client: `useLocale()` (`src/hooks/use-locale.ts`). Server/cron: build it from the account row.
- **Never** hand-roll `toLocaleDateString` / `toLocaleString` / `Intl.NumberFormat` / `format(date-fns)` for gym-domain output, and **never** write `'en-IN'` / `'Asia/Kolkata'` / `if (country === …)` at a call-site.
- **Instants:** `todayInTz` · `hourInTz` · `dayStartInTz` (day-start queries) · `dateAtNoonInTz` (stamping a picked day into a timestamptz, e.g. `payments.paid_at`) · `timeInTzToUtc` / `hhmmInTz` (reminder slots). `istToday()` survives only as the India-default fallback for pure-lib `today` params — components always pass `fmt.today()`.
- **Scope = regional formatting, NOT string translation.** UPI is gated by `upiAvailableFor(currency)` — an INR-only *rail*, i.e. a currency condition, not a geo conditional.

### Gotchas that bite

- **RLS-blocked writes are silent.** A `.delete()`/`.update()` blocked by RLS returns **no error and zero rows**. On destructive ops, chain `.select('id')` and treat an empty result as failure — otherwise the UI toasts success while the row survives.
- **Lint:** `react-hooks/set-state-in-effect` is enforced. Never call a setState-wrapping function directly in `useEffect`. Load data with an inline `(async () => { … })()` IIFE + a `cancelled` guard; expose manual refetch as a **nonce bump**.
- Error toasts go through `getErrorMessage` (`src/lib/errors.ts`).

---

## Reuse, don't rebuild

- **WhatsApp send:** `sendMessageToConversation` (`src/lib/whatsapp/send-message.ts`). `POST /api/whatsapp/send` takes `contact_id` + `message_type:'template'` and **find-or-creates the conversation** (so it reaches members with no thread).
- **Contact dedupe:** `findExistingContact` / `isUniqueViolation` (`src/lib/contacts/dedupe.ts`).
- **Media:** `uploadAccountMedia('chat-media', file)` (`src/lib/storage/upload-media.ts`). Private receipts: `uploadPrivateAccountMedia` + signed URLs — **never persist a signed URL**.
- **Money / dates / numbers:** the locale layer above. `formatCurrency(value, currency, locale?)` (`src/lib/currency.ts`) underlies `fmt.money`.
- **UI: never hand-roll an element that exists in `src/components/ui/`.** If no primitive fits — **stop and ask the user** (new master component, or reuse a different one?). Editing a `ui/` master changes **every** call-site: **warn the user first and list what it affects.** Full rules → [docs/ui-patterns.md](docs/ui-patterns.md).

---

## Current state (keep ≤10 lines)

Phase 1 (renewal wedge) and Phase 2 (India-first workflows) ship — including lead capture (public form `/f/<token>` + Meta lead ads, migration `064`). Phase 3 is partial. Roadmap + what's left → [PRDs/roadmap.md](PRDs/roadmap.md).

**Meta lead ads are built but dark** — the Settings card renders only once `NEXT_PUBLIC_META_LEADS_CONFIG_ID` is set, which waits on Meta App Review (`leads_retrieval` + `pages_manage_metadata`). Setting that env var is the entire launch.

---

## Hard dependency

One-tap renewal reminder needs each account to have **WhatsApp connected** + an **approved Meta Utility template `gym_renewal_reminder`** with 4 body params — `{{1}}` name, `{{2}}` plan, `{{3}}` expiry, `{{4}}` fee. Without it the Remind button self-disables with a setup hint; everything else works.
