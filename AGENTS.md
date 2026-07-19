# UsefulDesk shared agent instructions

This is the canonical instruction file for every coding agent working in this repository. Keep shared product and engineering rules here; tool-specific files such as `CLAUDE.md` may import this file but must not duplicate it.

## Product direction

UsefulDesk is an India-first gym CRM built on a mature multi-tenant WhatsApp CRM (`wacrm`). Its gym layer includes members, plans, memberships, renewals, payments, and attendance. Market context lives in `PRDs/india_gym_crm_pain_points.md`.

**North star:** know who's expiring → remind on WhatsApp → collect on UPI → assign follow-up → track the conversation.

**Feature filter:** every feature must save the owner time, recover lost leads, collect renewals, or retain members. Otherwise, defer it.

**Principles:** phone-first · WhatsApp-native · renewal-first · action lists over dashboards · offline-tolerant · every exception has an owner, status, and next action · do not force a member app · the owner feels in control in 30 seconds.

## Read only the documentation your task touches

| Document | Read when |
|---|---|
| `docs/ui-patterns.md` | Touching any UI: canonical components, tokens, forms, tables, and animation |
| `docs/gym-domain.md` | Touching members, plans, memberships, billing, payments, auto-pay, or attendance |
| `docs/changelog.md` | Investigating why a past product or engineering decision was made |
| `PRDs/roadmap.md` | Checking what is built, next, or deliberately deferred |
| `docs/renewal-reminders.md`, `docs/automations-and-cron.md`, `docs/public-api.md` | Touching those subsystems |
| `PRDs/` | Implementing or revising the corresponding product specification |

Do not preload unrelated documents "just in case."

## Documentation maintenance

- Keep this file under roughly 150 lines / 2,500 tokens. It is loaded into every agent session, so prune stale guidance instead of appending feature narratives.
- A feature is not complete until the same change updates both `docs/changelog.md` and `PRDs/roadmap.md`. Keep the changelog entry terse: what shipped, where the code lives, and any gotcha a future agent must know. In the roadmap, move the feature into the appropriate Built/Shipped section, revise or remove its pending entry, and keep phase status accurate.
- Put new invariants or canonical-component rules here or in the single relevant `docs/` file. Never duplicate a shared rule across agent files.
- Put plans and deferred work in `PRDs/roadmap.md`, not here. Current product status must be read from the roadmap rather than recorded statically in an agent instruction file.
- Change this file only when a shared rule changes. Tool-specific instructions belong in that tool's shim file.

<!-- BEGIN:nextjs-agent-rules -->

## This is not the Next.js you know

This version has breaking changes; APIs, conventions, and file structure may differ from training data. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:usefuldesk-ux-rules -->

## UsefulDesk product UX rules

Before writing or reviewing UI, read `docs/ui-patterns.md` completely. Its terminology, component-reuse, label, and badge rules are product-wide invariants. Do not introduce page-specific wording or visual overrides for an existing shared component.

<!-- END:usefuldesk-ux-rules -->

## Architecture and authorization

- **Stack:** Next.js 16 App Router (`middleware` is renamed `proxy` at `src/proxy.ts`), React 19, TypeScript, Supabase (Postgres, Auth, Storage, and RLS), Tailwind v4, Base UI / shadcn primitives in `src/components/ui/`, and Motion from `motion/react`. Validation is hand-rolled; do not add Zod. Tests use Vitest and colocated `*.test.ts` files in `src/lib`.
- **Backend:** do not use `"use server"` actions. Use `src/app/api/**/route.ts` handlers or direct Supabase browser-client calls secured by Postgres RLS.
- **Tenancy:** an `accounts` row is a tenant; users belong through `profiles.account_id`. RBAC is `owner > admin > agent > viewer`, enforced by `is_account_member(account_id, min_role)` and mirrored in `src/lib/auth/roles.ts` plus `useAuth()`. Copy the RLS pattern from `supabase/migrations/017_account_sharing.sql`.
- **Capabilities:** every authorization check is a named predicate in `src/lib/auth/roles.ts`, tested in `roles.test.ts`, and mirrored by an RLS policy. Never place inline role comparisons at call sites.
- **Authored content:** only its author may edit it; its author or an admin/owner may delete it. Enforce this in both RLS and UI, with UI affordances gated through a `roles.ts` predicate. Never rely on a UI-only gate.
- **Migrations:** inspect `supabase/migrations/` to determine the latest migration; never record a fixed latest number in documentation. Add a filename that sorts after the current latest and follow existing idempotency patterns: guarded enums, `CREATE TABLE/INDEX IF NOT EXISTS`, drop-then-create policies, and reuse of `update_updated_at_column()`. Do not use `supabase db push`, because the project has MCP-applied migration-history divergence. Apply through an available Supabase migration tool and verify the resulting schema and policies; if no approved migration tool is available, report that rather than substituting `db push`.

## Lead and public-endpoint invariants

- **Lead origin (`received_via`) is immutable.** Human origins (`manual`, `import`, or `NULL`) render the owner. All other origins render an `Auto · <channel>` pill and are ownership-locked by migrations `050` and `052`; use approval-gated `requestLeadAssignment` instead. Auto-captured leads must have `assigned_to = NULL` because no round-robin exists and setting it triggers `notify_lead_assigned` prematurely. A new capture path must pass `receivedVia` to `findOrCreateContact`, explicitly fire `new_contact_created`, and write a `contact_notes` row even on dedupe so repeat enquiries remain visible.
- **Unauthenticated endpoints:** put the token in the URL path. Use a `SECURITY DEFINER` RPC with a fixed response shape, run per-IP `checkRateLimit` before the database, and use a service-role write because RLS denies anon. For public writes, honeypots return 200 rather than 400; created and deduped rows return identical success bodies; Turnstile fails closed in production. The in-memory rate limiter is only a per-lambda speed bump.

## Localization

Every account owns `country_code`, `locale`, `timezone`, `date_order`, `time_format`, `week_start`, `phone_country_code`, `measurement_system`, and `default_currency`.

- Geography belongs only in `src/lib/locale/config.ts` (`COUNTRY_PRESETS`); adding a country means adding one preset.
- Use `buildFormatters(resolveAccountLocale(row))` and `fmt.date`, `dateShort`, `time`, `dateTime`, `number`, `money`, `moneyShort`, and `today()`. Client code uses `useLocale()` from `src/hooks/use-locale.ts`; servers and cron build formatters from the account row.
- Never hand-roll `toLocaleDateString`, `toLocaleString`, `Intl.NumberFormat`, or `format(date-fns)` for gym-domain output. Never put `en-IN`, `Asia/Kolkata`, or country conditionals at a call site.
- Use `todayInTz`, `hourInTz`, `dayStartInTz`, `dateAtNoonInTz`, `timeInTzToUtc`, and `hhmmInTz` for instants. `istToday()` remains only as the India-default fallback for pure-library `today` parameters; components pass `fmt.today()`.
- Localization covers regional formatting, not translation. Gate UPI with `upiAvailableFor(currency)` because it is an INR rail, not a geography condition.

## Engineering gotchas

- RLS-blocked `.delete()` and `.update()` calls can return no error and zero rows. Chain `.select('id')` on destructive operations and treat an empty result as failure.
- `react-hooks/set-state-in-effect` is enforced. In effects, load through an inline async IIFE with a `cancelled` guard; expose manual refetch through a nonce bump rather than calling a state-setting wrapper directly.
- Route error toasts through `getErrorMessage` from `src/lib/errors.ts`.

## Reuse before rebuilding

- WhatsApp send: `sendMessageToConversation` in `src/lib/whatsapp/send-message.ts`. `POST /api/whatsapp/send` accepts `contact_id` with `message_type: 'template'` and find-or-creates the conversation.
- Contact dedupe: `findExistingContact` and `isUniqueViolation` in `src/lib/contacts/dedupe.ts`.
- Media: `uploadAccountMedia('chat-media', file)` in `src/lib/storage/upload-media.ts`. For private receipts, use `uploadPrivateAccountMedia` plus signed URLs and never persist a signed URL.
- Money, dates, and numbers use the locale layer. `formatCurrency(value, currency, locale?)` in `src/lib/currency.ts` underlies `fmt.money`.
- Never hand-roll an element already available in `src/components/ui/`. If no primitive fits, stop and ask whether to create a new master component or reuse another one. Before editing a shared `ui/` master, warn the user and list affected call sites. Full rules are in `docs/ui-patterns.md`.

## Operational dependency

One-tap renewal reminders require an account with WhatsApp connected and an approved Meta Utility template named `gym_renewal_reminder` with four body parameters: `{{1}}` member name, `{{2}}` plan, `{{3}}` expiry, and `{{4}}` fee. Without it, the Remind button disables itself with a setup hint; other functionality remains available.
