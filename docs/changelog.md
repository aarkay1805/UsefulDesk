# Changelog — what shipped, and why

> **Archaeology.** Read a section only when you need the _reasoning_ behind a past decision. The durable **rules** extracted from this work live in `CLAUDE.md`, `docs/ui-patterns.md`, and `docs/gym-domain.md` — those are the sources of truth; this file is the record.
>
> **Append here** when you land a feature: what shipped, where the code lives, what a future session must not re-litigate. Terse.

---

## Fresh-account navigation branch context

Get Started now carries the selected account through every setup action and dashboard handoff with `branchHref`, including the pending-navigation target. Dashboard links use the shared `BranchLink` wrapper for KPIs, quick actions, work queues, reports, inbox, and empty-state handoffs. A production smoke on an isolated empty branch exposed that both surfaces rendered the right zero-data state but emitted branchless links; `src/components/onboarding/get-started-view.tsx` and `src/components/layout/branch-link.tsx` now follow the same durable branch-URL contract as the sidebar.

---

## Renewal reminder template category guard

The member-profile Remind action, Settings readiness card, Get Started checklist, automated renewal cron, and shared outbound-send boundary now require a supported renewal template to be both **Approved** and **Utility**. Live diagnosis found four Meta-accepted sends to two members later marked failed while the operating account's `gym_renewal_reminder` was classified Marketing; normal WhatsApp text delivery remained healthy. The shared send guard now stops Inbox and API callers before Meta accepts that known-bad configuration and points them to `gym_membership_expiry_notice`; an already-approved Utility legacy name remains supported. Its preset is deliberately an existing-membership account update with no renewal-completion CTA after Meta reclassified the first submitted wording as Marketing. The shared selector lives in `src/lib/memberships/renewal-reminders.ts`; settings, onboarding, member sends, cron, and `src/lib/whatsapp/send-message.ts` all enforce it. Meta edits send the required name, language, components, and requested category, and a false Meta success result now blocks the local category/status update so the provider and local row cannot silently diverge. Category-mismatch responses now name the selected category, explain Utility versus Marketing intent, confirm that Meta made no change, and persist the same actionable guidance on the Draft card. The connected WABA currently rejects creation of the replacement as Utility with Meta `100/2388025`, so do not resubmit it as Marketing under the canonical name; resolve the provider classification first. Meta can also reserve a deleted template name for 30 days, so waiting or a code-reviewed temporary alias is a deliberate launch decision.

---

## Consistent pending feedback for delayed actions

Buttons that wait on authentication, Supabase/API/storage work, imports, messaging, automation/flow operations, retries, or cold route transitions now show an in-control spinner and accessible busy state from activation through completion. `Button.loading` is the canonical contract; repeated actions track the clicked item, native controls replace their glyph, and `usePendingNavigation` covers imperative and Link navigation without double-pushing. Key code: `src/components/ui/button.tsx`, `src/hooks/use-pending-navigation.ts`, and the affected auth, member, contact, messaging, broadcast, automation, and flow surfaces. Gotcha: keep successful network-plus-navigation actions pending until the destination mounts; clipboard and explicitly optimistic local removals remain immediate.

---

## Phone input edit clarity and visible country codes

Constrained table-cell phone editors now expand to a responsive 240px floating surface without changing the column width, keeping the visible country code, complete national number, and compact check/cross actions unobstructed; the active shell uses the established focus ring plus restrained floating-panel elevation. All `InlineEditActions` consumers keep the original icon controls. The shared phone normalizer always presents country codes as `+<digits>`, including legacy digits-only account configuration, and the member-import review ledger shows qualified phones with the visible plus without changing stored, dedupe, or WhatsApp values. `COUNTRY_PRESETS.phoneNationalLengths` keeps shorter national plans and local numbers that begin with their dial code unambiguous. Key code: `src/components/ui/phone-input.tsx`, `src/components/ui/inline-edit-actions.tsx`, `src/lib/phone-input.ts`, `src/lib/locale/config.ts`, `src/components/leads/editable-cell.tsx`, and `src/components/members/import-members-preview.tsx`.

---

## Performance expense export and expense-category settings

Business → Performance now adds branch-wide posted Expenses and Net cash to the All staff CSV for the selected and previous calendar months; teammate-scoped and organization exports remain unchanged because expenses are not staff-attributable. Settings → Payments now lists the branch expense catalogue and lets admins add, rename, archive, and restore categories while agents/viewers retain read-only visibility and historical expenses keep archived references. Key code: `src/lib/finance/overview.ts`, `src/lib/reports/reporting.ts`, `src/components/reports/owner-reports-view.tsx`, and `src/components/settings/expense-categories-card.tsx`. Gotcha: never attach branch-wide expenses to a teammate-scoped export or infer staff profit.

---

## Remotion promo project removed

`usefuldesk-promo/` was committed by accident and is gone: the Remotion sources, its own `package-lock.json`, the tracked audio bed, and the rendered output. The root `tsconfig.json` no longer carries the `usefuldesk-promo` entry in `exclude` — that entry existed only to keep remote Next.js builds off the nested package — so `exclude` is back to `["node_modules"]`. Nothing under `src/`, `.github/`, or the root dependency tree referenced the project.

Gotcha: an earlier entry below records the root TypeScript project excluding the nested package. That is history now — do not re-add the exclude.

---

## Single authoritative lockfile — npm

`package-lock.json` is now the only lockfile. The tracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` are deleted, and `package.json` declares `"packageManager": "npm@11.9.0"` so the choice cannot drift again. npm was already the real toolchain: `.github/workflows/ci.yml` installs with `npm ci`, and the npm lockfile carried 81 commits against pnpm's 4. Key files: `package.json`, `.prettierignore`. Verified with a clean `npm ci` and the full CI gate — format:check, lint, typecheck, 1971 tests, build.

Two gotchas. **Dependency security overrides now live only in `package.json` `overrides`** — pnpm 11 read them from `pnpm-workspace.yaml`, so deleting that file leaves `overrides` as the single source for the Sharp, PostCSS, Undici, and related floors from the upstream security refresh; do not prune that field. And **`vercel.json` sets no `installCommand`**, so Vercel selected its package manager by auto-detecting a lockfile — while both were tracked, that detection rather than the repository decided whether a production build used npm or pnpm. The `packageManager` field now states it explicitly; confirm the first deploy after this change installs with npm.

---

## Prettier enforced in CI

`npm run format:check` now runs in `.github/workflows/ci.yml` ahead of lint, so formatting cannot drift again. A one-time repo-wide `npm run format` reformatted 353 files; that commit is formatting-only and listed in `.git-blame-ignore-revs` (opt in locally with `git config blame.ignoreRevsFile .git-blame-ignore-revs`).

**Do not re-litigate `trailingComma`.** The config keeps `"es5"`, not Prettier 3's `"all"` default. This was measured, not assumed: 530 of 845 `src` files already matched `es5` versus 96 for `all`, and the most recent work already conforms — of the 419 `src` files last touched in 2026-08, 363 were `es5`-clean and 56 were `all`-style. The `all`-style pocket is a contained 2026-07 drift, so switching would have reformatted the actively-maintained majority (749 files) to chase it.

Two gotchas. **Prettier is not always idempotent** — one file needed a second `--write` pass before `--check` accepted it; if the CI step fails right after you ran `npm run format`, run it again. And **`prettier --write .` reaches far past `src`**: `.prettierignore` now also excludes `pnpm-lock.yaml`, `.agents` (vendored third-party skills), and `.playwright-cli` (captured debug logs), which cut the sweep from 491 files to 353.

Related: two contract tests asserted on literal source text (`rpc("record_membership_payment"`, one exact `color-mix()` line in `globals.css`) and were hardened to be quote- and whitespace-tolerant, since any reformat would otherwise break them.

---

## Service-aware, resumable member import

The Map columns step now lets a valid service-only file reach preview when the branch has no membership plans. The old `plans.length === 0` footer gate predated service-aware import and silently disabled the button even though Phone + Service is a complete mapping; candidate validation remains the authority for unresolved or unusable offerings. Key code: `src/components/members/import-members-csv-dialog.tsx` and its dialog regression test.

Draft resume now authorizes Supabase Storage's actual `storage.object.sign` operation, so `GET /api/members/import-draft` can sign and restore the private workbook instead of leaving an invisible active draft that blocks the next upload. Migration `20260820092221_allow_signing_member_import_drafts.sql` was connector-applied to UsefulDesk and verified against the live VBF draft (`POST /object/sign` and signed workbook `GET` both 200). A failed initial draft save now clears the selected/parsed workbook, and an acknowledged revision no longer retriggers autosave indefinitely. Key code: `src/app/api/members/import-draft/route.ts`, `src/components/members/import-members-csv-dialog.tsx`, and the member-import schema/dialog regression tests.

Members CSV/XLSX import now creates membership-only, service-only, or combined customer purchases, groups compatible repeated rows, resolves current plans/services/trainers/rates, and commits each customer atomically through stable idempotency keys. Explicit historical service sold price, expiry, and cancelled state are audited snapshots; cancellation creates no refund. All Members is now contact-backed, so service-only customers remain manageable without fabricated memberships while membership metrics stay truthful. Unfinished imports keep an author-private, revision-safe 30-day draft and private source file that can resume across devices; stale revisions reload or Start fresh rather than overwrite. Migration `20260816122505_service_aware_resumable_member_import.sql` plus `20260816130000_harden_member_import_grants.sql` were connector-applied and rollback-accepted only in UsefulDesk Razorpay Test; Production was untouched. Key code: `src/lib/memberships/member-import-candidates.ts`, `member-import-transaction.ts`, `import-draft.ts`, `src/components/members/import-members-csv-dialog.tsx`, and `src/app/api/members/import-draft/`. Merchandise and multiple numbered service-column families remain out of scope.

Resolve issues now separates missing, invalid, and identity-conflicting phone numbers instead of calling all three “Repair phone numbers.” Every affected member shows the source row, Member ID, current value, exact recovery, and a **Fix phone** action that reveals paginated/filtered candidates, scrolls to the canonical phone cell, and focuses its editor on desktop or mobile; exclusion remains the explicit alternative. Key code: `src/components/members/import-members-preview.tsx` and its focused component tests.

The resolution workspace now uses compact dialog and preview spacing, one divider above grouped exceptions, and a frameless desktop candidate ledger so more corrective work stays visible without changing import behavior. The density is local to `import-members-csv-dialog.tsx` and `import-members-preview.tsx`; shared Accordion and Table masters remain canonical.

Resolve issues was then distilled to one shell and one copy source. Eight hand-built resolver layouts collapsed into two primitives — `IssueRows` (identity, its control, and a consistent **Exclude**) and `GroupChoice` (unmatched source value, one group-wide choice, **Exclude these N rows**) — so every issue reads the same way and exclusion is finally offered everywhere the step promises it. Four gotchas a future session must not re-litigate: **(1)** only the issue _title_ lives in the UI (`ISSUE_TITLES`); why it blocks and what to do next are authored once per issue as `explanation`/`nextAction` in `member-import-candidates.ts` and rendered by the shell — never restate them at a resolver. **(2)** Correction fields commit on **blur**, not per keystroke, so a half-typed date cannot re-validate all 500 rows; phone keeps its explicit **Save & resolve** because resolving reflows the queue and would unmount the input under the cursor. **(3)** The Issues tab badge counts issue _groups_ so it agrees with "Issue N of M" — the affected-member count is already in the dialog description, and each issue states its own row count. **(4)** The tab `aria-label`s are load-bearing: without them the computed name concatenates to "Issues7". Issue copy no longer says "CSV", which was wrong for the supported `.xlsx` path. Key code: `src/components/members/import-members-preview.tsx` and `src/lib/memberships/member-import-candidates.ts`.

A layout pass then fixed how that step reads. The queue rail groups its entries under the issue title (`queueSections`) and each row carries only the value that identifies it — a member name, the raw phone, the unmatched plan string — because three separate missing-phone groups otherwise rendered three identical titles, and a row label alone never said what was wrong with it. Rows show a count badge only when a group covers more than one row, and the per-row warning icon is gone: the whole rail is issues. Four consequences a future session should keep: **(1)** the focused pane leads with the issue title; the positional counter is retired and the previous/next pager now lives only in the mobile picker row, since on desktop the rail is the navigator — this supersedes the earlier note about the tab badge agreeing with "Issue N of M" (the badge still counts groups, which is what the rail shows). **(2)** `IssueRows` bounds its own height past four rows (`min(20rem,40vh)`, or `min(32rem,55vh)` when stacked) so an 18-row shared-phone group keeps both the instruction above it and **Save & resolve** below it on screen; before this the commit control sat ~1,200px below the fold. **(3)** The pane column needs `min-w-0`: as a grid child it otherwise sizes to the section's `max-w-3xl` measure and clips its own content on phones instead of fitting them. **(4)** The issue title now appears twice on screen (queue section label and pane heading), so tests must assert the focused issue as a `heading` role, not by text. `GroupChoice` also names the rows a single mapping lands on, and the payment-conflict figures read as a labelled Total/Paid/Balance/Off-by set instead of one muted run-on line.

A polish pass then fixed the **Review rows** ledger on that same step. The table is now a bordered frame whose single scroll box owns both axes, with the pager pinned beneath it; columns are Name, Member ID, Phone, Offering, Fee, Expiry, Status, Actions. Four gotchas a future session must not re-litigate: **(1)** do not wrap this table in the `Table` master — it injects its own `overflow-x-auto` container, and nesting that inside a vertical scroller detaches `sticky` from the box that actually scrolls, so the header slid away on scroll and the horizontal scrollbar parked ~700px below the fold. Use a raw `<table>` with `TableHeader sticky top-0 bg-popover` inside one scroll box, exactly as the leads import grid does; the header takes the dialog's `popover` surface, never `bg-background`. **(2)** Declared column widths must sum to the table's `min-w-*`, or `table-fixed` scales them all down and `whitespace-nowrap` cells overlap their neighbours — Expiry needed 150px in a 112px column and printed over Status. **(3)** The Offering cell has to stay one line: `EditableCell`'s inner box is `h-8 overflow-hidden`, so its previous badge/label/price stack was silently clipped. The sold price moved to a canonical **Fee** column (`candidate.purchaseTotal`, tabular numerals), Expiry states the date instead of restating the column, and the kind badge appears only for service, combined, and unmatched rows. **(4)** Anything that truncates needs a real width constraint: the offering label's bare `truncate` inside an `items-start` flex column forced the whole phone card list to scroll sideways. The empty state is now one framed panel with a **Show all rows** reset, shared by both surfaces. Key code: `src/components/members/import-members-preview.tsx`.

The queue rail's section headings then stopped reading as rows. The heading and its unselected entries had both resolved to `text-muted-foreground` at weight 500 — a 2px size step was the entire hierarchy, so a heading looked like a fourth, unclickable row. Rail entries now take the ink role (they carry a value the operator matches against their file, exactly as the same list does in the mobile `Select`), the heading keeps the muted role at `text-xs font-semibold tracking-wide`, and clusters are divided by the rail hairline the app sidebar already uses. Two gotchas: **(1)** the section wrapper must carry no top padding — a `sticky` heading cannot rise above its parent's content box, so `py-2` there parked the pinned heading 16px below the scrollport and let rows slide visibly through the gap; the heading owns its own `pt-3` instead, which doubles as the opaque clearance when pinned. **(2)** the rail heading stays a `<p>` tied to a `role="group"` by `aria-labelledby`, never a real heading element, because the focused pane already renders the same string as an `h3` and tests resolve it by `heading` role. Key code: `src/components/members/import-members-preview.tsx`.

**Map columns** was then distilled to the single question it asks per column. The **Status** column is gone — it restated in a second visual language what the field picker already says, so an unmapped column now simply renders "Don't import" in the muted role and the header line carries the aggregate (`8 mapped · 2 skipped`). Four things a future session should not re-add: **(1)** the "Safe local mapping is active" banner, which claimed a local fallback even when the AI recipe had succeeded, and whose **Use manual mapping** button was a differently-named duplicate of **Auto map**. Both collapsed into `remapFromColumnNames`, wired to **Auto map**: re-deriving every column from its header necessarily discards a suggested recipe, so the escape hatch is that button. **(2)** the per-column day/month toggle. `dateOrder` is one piece of state, so N ambiguous date columns rendered N copies of one global control and flipping any flipped all — it is now a single pill in the header row, shown only when `ambiguousDateCols` is non-empty, and its `▾` text glyph is a real icon. **(3)** the three stacked footer rules. They compose into one `mappingIssue` sentence beside the blocked button, and duplicated targets are now named by label rather than by raw key (`custom:<uuid>` used to reach the user) and outlined with `border-destructive` on the offending pickers so the collision is findable without hunting. **(4)** the sideways-scrolling table on phones: below `sm` the same rows stack as header / sample / full-width picker, because the field picker is the only control on this step and horizontal overflow put it off-screen on the device this product targets. The table and stacked list share one `renderPicker` helper — a plain function, not a nested component, so pickers do not remount per render. Key code: `src/components/members/import-members-csv-dialog.tsx`.

**Map columns** was then split by purchase, and the money it was quietly dropping is now imported. Membership and service each own a complete field group — plan/service, option, start date, expiry, status, list price, discount amount, discount %, and the charged amount — so a bare "Start date" or "Status" can no longer be ambiguous, and the old combined "Membership & services" group plus the separate "Payments" group are gone. Collection stays row-level (Amount paid, **Amount due**, method, date) because one CSV row is one invoice: two rows for the same member produce two invoices and no allocation split, while a single row mapping both families produces one invoice whose payment `allocate_invoice_payment` spreads proportionally by line balance. Per-line collection is deferred, not traded away — a per-row payment is the degenerate case.

Five things a future session must not re-litigate. **(1)** List − discount = charged, and any two derive the third; three that disagree is a blocking `pricing-mismatch`, never a silent pick. The load-bearing case is the pair every legacy Indian gym export ships — an "ACTUAL AMT" beside a "DISCOUNTED AMT" and no discount column at all — from which the discount is _derived_; on the 501-row reference file that recovered ₹35.3L of discount previously discarded. **(2)** `resolveImportedPricing` works in **integer paise**, because `membership_periods_discount_values_valid` recomputes `ROUND(list_price * discount_value / 100, 2)` and rejects float drift; a percentage that cannot land on a whole paise is stored as an equivalent flat amount rather than being forced. **(3)** Import writes only `memberships.conversion_list_price/_discount_type/_discount_value/_discount_amount` — `create_initial_membership_period` copies them to the period and `ensure_membership_period_invoice` derives the line's `list_amount`, so `InvoiceDetailDialog` renders the discount with no new UI. The RPC re-derives and re-validates the discount rather than trusting the browser. **(4)** `MEMBER_IMPORT_FIELDS` **order is load-bearing**: `autoMapColumns` claims the first unused match, so every membership field must precede its service twin. **(5)** Header normalization strips punctuation, so "Discount %" and "Discount" collapse to one token — `autoMapMemberColumns` disambiguates _before_ matching, never after, or the mapper's one-target-per-column bookkeeping breaks.

Two invisible behaviours were also closed. `money.listPriceColumn` was captured by the recipe, validated, and consumed by nothing; `money.balanceColumn` was read straight off the source row while its column displayed "Don't import", so a blocking payment conflict pointed at a column the owner was told was skipped. Both are ordinary visible fields now (`membership_list_price`, `amount_due`), as is the legacy Member ID that previously only reached `notes`. Because their aliases moved into the registry, plain **Auto map** now maps every money column of a real vendor export on header name alone — before this it silently reverted fee/paid/balance to "Don't import" and imported every member at plan list price with no payment. The member's trainer then became a real identity. "Assigned to" and "Trainer" looked interchangeable on a gym member, but `contacts.assigned_to` is FK -> `auth.users` — migration 049 spells out that a person without an auth user _cannot_ go in it — so relabelling it would have demanded a login seat for every trainer, and a real export's trainers (Mohit, Anand kumar, Aakash Mishra) have none. `contacts.trainer_id` now points at the `trainers` identity, whose `linked_user_id` is optional; `assigned_to` keeps notifications, follow-up ownership, and transfer approval. A bare "Trainer" column maps to the member (`membership_trainer`, placed before `service_trainer`, whose aliases narrowed to explicit service headers), resolves via `coerceTrainer`, and raises a grouped `trainer-unmatched` notice — `built.warnings` had no consumer at all before this, so an unresolved assignee was being dropped in silence. All Members now shows **Trainer** and ships **Assigned to** hidden-but-restorable rather than deleting it, because that cell also hosts the pending lead-assignment request and its Withdraw control (both of which also live on Leads and in `ContactDetailContent`, so nothing became unreachable). Two gotchas: **(1)** stored prefs always carry an explicit `hidden` array, so "never customised" is indistinguishable from "deliberately shown" — a `LAYOUT_VERSION` seeds `defaultHidden` exactly once and every visibility edit stamps the version, so the seed can never fight a layout the user arranged. **(2)** the seed is computed in render, not an effect, because `react-hooks/set-state-in-effect` is enforced. `member_customer_directory` needed no change — it projects `to_jsonb(contact)`, verified live. Migration `20260818090000_import_pricing_and_member_trainer.sql` was connector-applied as `20260818131046` in **UsefulDesk Razorpay Test only**; verified there as uuid `contacts.trainer_id`, composite FK `(account_id, trainer_id) -> trainers(account_id, id) ON DELETE SET NULL (trainer_id)`, partial index `idx_contacts_trainer`, `SECURITY DEFINER` RPC granted to `authenticated` with `anon` absent, and contacts RLS still enabled with its four policies. The receipt also lied about its successes. `MemberImportCommitResult.reason` is `null` on a committed row, so `result?.reason ?? fallback.reason` fell through and stamped every imported row **`candidate-not-committed`** beside outcomes that all read `created`/`recorded` — an audit trail that contradicted itself on its most common row. The fallback now applies only when a row produced no result at all. Watch for this shape wherever `??` merges a nullable success field against a failure default.

The first real import surfaced a validation asymmetry worth remembering: `perform_member_import_group` requires `end_date > start_date`, but `buildMembershipRow` did not, so a same-day row built clean, was marked **ready**, and would have aborted its entire customer group at commit with a raw database error. **Any row guard added to the RPC needs a local twin**, because the group-level transaction turns one bad row into a whole customer failing.

The right resolution turned out not to be blocking those rows. A legacy export repeats one date in both columns on per-session and day-pass memberships because it has no way to say "one day" — a shape, not a mistake — so expiry now derives as start + 1 day and the row imports untouched. `expiry-not-after-start` remains for an expiry that genuinely precedes its start. One trap in the follow-through: auto-dating initially made `expiryMismatch` fire on all 12 rows, because it compared the plan term against the _source_ date rather than the stored one — turning a hard error into 12 notices, 7 of them noise on rows that were now perfectly correct. It compares the stored expiry for auto-dated rows, so the reference file lands on 8 clean per-session rows and exactly 4 notices: `Boxing Competition 6M` memberships recorded as starting and ending the same day, which are real source data-entry errors and the rows that most deserve a human look.

That import also confirmed the pricing work against real data on VBF: 8 members, every discount reconciling (`list_amount` 48,000 / charged 20,000 on DILPREET), `broken_pricing_rows` zero database-wide, trainers resolving case-insensitively to independent identities with no login seat (`Anand kumar` -> `ANAND KUMAR`), Amount due surviving as a 6,300 collectible balance with `fee_status` due, and four repeat rows collapsing to one membership. One behaviour to know: an INACTIVE row with a FUTURE expiry maps to `cancelled`, and `set_membership_cancellation` voids its invoice — so any outstanding balance on such a row is erased on import. That is right for a real cancellation and lossy for a migration; the status mapping, not the void, is the lever if it needs changing.

Member import shipped to `UsefulDesk` for the first time: `20260818154722 service_aware_resumable_member_import`, `20260818154731 harden_member_import_grants`, `20260818154902 import_pricing_and_member_trainer`. It was purely additive — `member_customer_directory` and `perform_contact_checkout` did not exist there, so nothing was replaced, no existing table's data changed, and no policy on an existing table moved. A structural diff against Razorpay Test afterwards returned an **identical 28-object inventory** (both tables, five policies, eight indexes, four functions, four storage policies, the private bucket, the view, the column, and the composite FK), which is what proves the hand-applied SQL matched the repo. The repo is the complete source: Test's five MCP version rows were incremental applies consolidated into the two repo files. Applying the base chain is **required, not optional**, for this branch — `members-table.tsx` reads `member_customer_directory`, so the Members page cannot render without it. Key code: `src/lib/memberships/member-field-registry.ts`, `import-commit.ts`, `member-import-services.ts`, `member-import-transaction.ts`, `migration-recipe.ts`, and `src/components/members/import-members-csv-dialog.tsx`.

Every remaining `built.warnings` code then got a consumer. An earlier note here said `built.warnings` gained one and the unresolved assignee stopped being dropped in silence — that was true only of `unknown-trainer`. `unknown-assignee`, `unknown-churn-risk`, and `invalid-profile-value` were still produced and rendered nowhere, so an unmatched staff name, an unreadable churn-risk cell, and a height or weight that failed to parse all vanished between the preview and the commit. They now raise `assignee-unmatched`, `churn-risk-unmatched`, and `profile-value-invalid` notices beside `trainer-unmatched`, grouped by the offending source value so one bad spelling collapses to one entry. **A warning with no consumer is a value dropped in silence** — the contract is now covered by tests that fail if a code loses its notice. The assignee copy is worth reading before changing: an unmatched name does **not** import unassigned. `perform_member_import_group` inserts `COALESCE(NULLIF(v_contact_data->>'assigned_to','')::UUID, v_actor)`, so a new member falls to whoever ran the import, while an existing contact keeps the owner it already had.

The cancelled-dues write-off is now visible rather than silent. An INACTIVE row with a future expiry maps to `cancelled`, and `set_membership_cancellation` flips the current period to `void`, so any unpaid balance is erased at commit — this deleted a real ₹7,000 on the reference file. The mapping is correct for a genuine cancellation and lossy for a migration, so the row still imports and nothing about the void changed; it now raises a `cancelled-dues-written-off` notice naming the members whose balance is about to disappear, and the operator can exclude them first. The guard lives in `buildMembershipRow` beside the fee and paid figures it compares, in **whole paise**, so two-decimal float drift cannot invent a balance that is not there. It fires on any cancelled row carrying an unpaid balance, not only the INACTIVE-derived ones, because the loss mechanism is identical. `normalizeMemberMigrationStatus` remains the lever if the mapping itself should change; the void is not.

**Release note owed to owners on this deploy:** the members table hides **Assigned to** once, on next load, when the `LAYOUT_VERSION` seed runs. It is restorable from the column controls and nothing became unreachable, but with no announcement it reads as a column that went missing. Suggested wording: _"All Members now shows a Trainer column. To make room, Assigned to is hidden by default — add it back any time from the column controls at the top of the table."_

## Shared membership checkout

Add member, lead conversion, trial conversion, and renewal now share one responsive checkout panel for plan dates, first-cycle offers, catalogue items, credit, deferred collection, full collection, and post-credit 60/40 installments. The API accepts structured intent only; the database derives prices, expiry, offer snapshots, credit application, and collection amounts atomically, excludes setup fees from renewals, and leaves prior arrears on their original invoices. Direct agent execution of the legacy renewal RPC is revoked. Migration `20260816120000_shared_membership_checkout.sql` was connector-applied as `20260815195630` in Test and `20260815203350` in Production; rollback-scoped acceptance and exact execution-grant checks passed in both. Key code: `src/components/members/membership-checkout-panel.tsx`, `src/lib/memberships/checkout.ts`, `src/app/api/member-checkouts/route.ts`, and the migration.

The checkout's optional offers now use real smart defaults instead of placeholder-only values: discount selects 10% and bonus time selects +1 month. Switching to a fixed discount focuses and flags the required amount; clearing either offer flags its source field, while a blocked collection row names the incomplete upstream section rather than appearing broken. Expanded offer controls also stay contained at phone widths. Key code: `src/components/members/membership-checkout-panel.tsx`, `member-form.tsx`, and `membership-checkout-panel.test.tsx`.

Mid-cycle **Change plan** can again collect its first manual payment atomically. The payment validator now keeps membership-originated collections serialized on their already-locked membership period and reads the immutable linked invoice without requiring invoice UPDATE RLS; generic invoice collection retains its invoice lock. Migration `20260816120001_fix_change_plan_collection.sql` and `supabase/tests/change_plan_collection_acceptance.sql` carry the fix and rollback-scoped regression. Gotcha: do not solve this by granting authenticated users invoice UPDATE access or making the public change-plan RPC `SECURITY DEFINER`.

## Renewal membership modal and modal blur standard

**Renew membership** now follows the established Convert-to-member mental model: member/current-membership context sits beside a contained Membership details → Products & services → Payment task path, with a fixed header/footer, scrollable responsive body, labelled account-currency fields, and canonical Checkbox controls. Products & services is opt-in and reuses the dedicated Add purchase catalogue/quantity interaction; turning it off clears selected items before checkout. Dialog and Sheet now share one visible modal backdrop recipe; because Base UI suppresses nested child backdrops, their parent popup blurs while a nested dialog owns focus. Popovers, Selects, and DropdownMenus remain unchanged. Key code: `src/components/members/renew-membership-dialog.tsx`, `src/components/ui/modal-backdrop.ts`, `dialog.tsx`, and `sheet.tsx`.

## Purchase page chrome refinement

The dedicated **Add purchase** page now keeps its member context borderless, omits the redundant phone number, and leaves a 16px interval before the catalogue; its single accessible close icon lives in the shared app-bar trailing action slot. Its Create invoice action fills the payment card, while the reusable checkout retains its existing dialog action layout and Cancel controls. Key code: `src/app/(dashboard)/members/purchase/member-purchase-page.tsx` and `src/components/members/product-service-sale-checkout.tsx`.

## Trainer-first purchase rows

Trainer-priced services in **Add purchase** now place the trainer selector in the Price column and smart-default to the first alphabetically listed trainer with an active fee, so the configured price is visible and Add is immediately available. The selected trainer and fee still flow through the existing transactional checkout; missing trainer fees remain explicitly unavailable. Key code: `src/components/members/products-services-picker.tsx` and `products-services-picker.test.tsx`.

## Purchase actions grouped with Payment

The dedicated **Add purchase** checkout now places Cancel and **Create invoice** at the leading edge of the Payment card footer once an item is selected, keeping the final action attached to the payment decision. Empty checkouts retain a standalone Cancel action, and payment, submission, and ledger behavior are unchanged. Key code: `src/components/members/product-service-sale-checkout.tsx` and `product-service-sale-checkout.test.tsx`.

## Dedicated member purchase checkout

Member profile **Add purchase** now opens a dedicated member-aware page instead of nesting another dialog over the profile sheet. One compact identity line keeps the member's name, phone, Member ID, plan, and expiry visible without a separate details card; the catalogue combines item metadata into one supporting line, uses the table as its sole bordered surface without a repeated section label, keeps its desktop column width stable before Payment appears, and shows **Add** before switching a selected item to a quantity stepper starting at 1. Add and stepper controls share one compact, fixed, right-aligned footprint with centered contents, while the price-adjustment icon follows the amount so prices remain anchored. Payment plus Create invoice remain deferred until the first selection; Payment now uses **Collect now / Collect later** radios and reveals the pre-filled amount plus payment method only for immediate collection. Conditional service/trainer details, audited price adjustment, credit, Cancel/success return navigation, authorization, API, and immutable-ledger behavior are unchanged. Key code: `src/app/(dashboard)/members/purchase/`, `src/components/members/product-service-sale-checkout.tsx`, `products-services-picker.tsx`, and `src/lib/members/member-purchase-navigation.ts`.

## Theme-aware Google sign-in button

The shared Google Identity Services control on login and signup now uses Google's filled-black treatment in UsefulDesk dark mode and its outlined treatment in light mode, so the provider control follows the surrounding auth surface without replacing Google's official button. Focused coverage locks both mode mappings. Key code: `src/components/auth/google-auth-button.tsx` and `google-auth-button.test.tsx`.

## Desktop purchase checkout columns

Member profile **Add purchase** now uses a wider two-column desktop dialog with invoice items on the left and a sticky payment summary on the right, keeping the collection decision visible while the invoice is built. The existing stacked mobile/tablet layout and checkout behavior are unchanged. Key code: `src/components/members/product-service-sale-dialog.tsx` and `product-service-sale-dialog.test.tsx`.

## Member purchase checkout polish

Member profile **Add purchase** now separates invoice items from payment, shows the total/credit/due calculation before collection, provides Full and Leave due presets, validates collection amounts inline, and keeps catalogue loading/failure states honest. The shared picker now uses canonical cards, labelled controls, account-currency price overrides, and clearer required sale copy without changing checkout or ledger behavior. Key code: `src/components/members/product-service-sale-dialog.tsx` and `products-services-picker.tsx`.

## Payment Link readiness loaders

Invoice **Copy link** and **Send payment link** actions now keep their labels stable while showing the established spinner and `aria-busy` state during the parallel Razorpay, WhatsApp, and template readiness checks. An active link now reads **Payment link active** with its expiry on a separate supporting line, distinguishing link expiry from invoice status. The existing role, provider, phone, and template gates remain unchanged, and focused component coverage locks the busy, ready, and active-link hierarchy. Key code: `src/components/finance/payment-link-actions.tsx` and `payment-link-actions.test.tsx`.

## Razorpay permanently activated for Rajat

Under exact owner authorization, Production now keeps `RAZORPAY_OAUTH_ENABLED=true` only behind the existing Rajat Kashyap account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` / Live merchant `acc_TCJwBqanN9LTrK` pins. READY deployment `dpl_9dcvUKMuTMiXzw8xsC21GQ49cfhp` from commit `26149600cdbe08c028736e8074761505199ecb72` is promoted on `desk.usefulmade.com`; first-bind enrollment and every provider/refund acceptance flag remain false, and Stage 6 manual-key/legacy-ingress retirement remains intact. Authenticated UI verification showed Connected, Live, ready, and payment-link controls enabled on an existing eligible invoice without using them. Secret-blind closeout found zero relevant queues and zero new financial, messaging, refund, link, mandate, webhook, or OAuth-state records; the prior ₹40 settlement remains exactly once. No second customer, WhatsApp send, consent, refund, money movement, secret rotation, VBF action, or broader rollout is authorized. Operational evidence: `docs/razorpay-operations.md`.

## First real-client Razorpay Payment Link settled

Under exact owner authorization, the pinned Rajat Kashyap account / Live merchant opened a single OAuth settlement window for invoice `#BC2B1DDB`: secret-blind preflight matched its open INR ₹40 collectible balance, exact account/merchant, fresh OAuth readiness, connected WhatsApp, approved `gym_payment_link`, no prior link, and zero operational queues. READY deployment `dpl_C6dFzbhXXjZ3ZULLq7uCbZLJp4mW` kept enrollment and every acceptance flag false; the authenticated owner action created provider link `plink_TPxvlgki47VMgP` for exactly ₹40 with the fixed seven-day/non-partial contract and sent the approved template through the existing conversation. Meta callbacks advanced the stored message to Read. Signed application event `TPy00PfdmPIwtD` then settled the link exactly once: payment `1f8b569e-ff1a-4f39-a389-c1e6d18096b6` allocated ₹40 once and reduced both invoice balances to zero, with no pilot refund or review hold. Exact Live queues remained zero, and READY deployment `dpl_DAtth8pTbH8osaCiSVao71wpoi5x` immediately restored OAuth false while preserving the OAuth/Live/storage-v1/application-only connection. No second customer or broader rollout is authorized. Operational evidence: `docs/razorpay-operations.md`.

## Razorpay real-gym readiness and Meta template approval

The owner confirmed the exact-pinned Rajat Kashyap account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` / Live merchant `acc_TCJwBqanN9LTrK` is their operating gym, so the completed connection revalidation now counts as the first real gym-owner OAuth readiness pilot without expanding its authorization into messaging or money movement. A fresh authenticated 2026-08-15 **Sync from Meta** updated two existing templates and shows both exact `en_US` Utility templates Approved: `gym_payment_link` (`1996323644342719`) and `gym_payment_due` (`1528972491789269`). This removes the WhatsApp template prerequisite for payment-link Send, but no message or Payment Link was created. All Razorpay rollout/acceptance flags remain false at rest, VBF/Aakash stays closed, and any recipient/invoice/amount delivery, money-path exercise, or broader rollout still needs separate exact approval. Operational evidence: `docs/razorpay-operations.md`.

## Login & security visual polish

Settings → Login & security now separates connected sign-in methods from password changes, gives email and session controls their own clear task hierarchy, adds accessible password visibility controls, and uses a wider responsive settings column without changing provider-aware auth behavior. Key code: `src/components/settings/security-panel.tsx`, `sign-in-methods-card.tsx`, `account-email-form.tsx`, `password-form.tsx`, and `sessions-card.tsx`.

## Provider-aware profile and login security

Settings now reads Supabase's linked identities through `getUserIdentities()` with explicit loading, failure, and retry states, so Google-only, password-only, and Google-plus-password accounts see the correct sign-in methods instead of the latest session provider. **Your profile** now owns only photo and display name; **Login & security** owns the provider-specific Google address, verified recovery-link password addition, current-password changes, confirmation-aware account-email changes, and provider-neutral global UsefulDesk sign-out. A first Google sign-in may seed its HTTPS photo only while `profiles.avatar_url` is null and never retries after the first session, so a user photo or Remove remains authoritative. The existing signed recovery grant now allowlists the exact Login & security return path and refreshes identities on the completed settings landing; confirmed Auth email changes sync the denormalized profile copy only after Supabase changes `user.email`. No Google disconnect, migration, data repair, deployment, or auth-provider configuration change was made. Key code: `src/hooks/use-auth-identities.ts`, `src/components/settings/sign-in-methods-card.tsx`, `src/components/settings/account-email-form.tsx`, `src/components/settings/profile-form.tsx`, and `src/lib/auth/recovery-intent.ts`.

## Direct Google Identity sign-in

Login and signup now use Google's generated Identity Services button and exchange its ID token directly with Supabase through `signInWithIdToken`, so the user-facing flow no longer navigates through the Supabase project hostname. Every attempt creates a fresh 32-byte raw nonce, sends its SHA-256 hash to Google, and gives only the raw nonce to Supabase; the first attempt prefers FedCM and a clearly labelled retry re-renders Google's button in popup mode for unsupported browsers. Validated invitation destinations, hard post-login navigation, provider-error handling, automatic tenant/profile provisioning, and the existing India defaults for new Google owners remain unchanged. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is configured as a public Production/Preview Vercel value, while the Google client secret remains only in Supabase; report-only GIS CSP and popup-compatible COOP headers are enabled. The old same-origin redirect callback remains available only as an unshown rollback and email-recovery path. Production deployment `dpl_3x8q5fDrQekazAQApmuPTXitDVr9` passed a direct Google popup login through to the hydrated dashboard without a Supabase-hostname navigation. Key code: `src/components/auth/google-auth-button.tsx`, `src/lib/auth/google-identity.ts`, and the login/signup auth pages. Gotcha: Google Cloud must keep both `http://localhost:3000` and `https://desk.usefulmade.com` as exact authorized JavaScript origins; configuration propagation can be delayed.

## Authoritative account hydration

Signed-in dashboard access now becomes ready only after the selected account row supplies authoritative locale, currency, and timezone settings. A failed or unreadable account lookup clears tenant IDs, roles, and capabilities, keeps account-dependent content unmounted, and shows the existing in-place Retry path; a successful retry remounts the dashboard with the resolved account settings. No migration or data repair was required. Key code: `src/hooks/use-auth.tsx`, `src/lib/auth/account-recovery.ts`, `src/app/(dashboard)/dashboard-shell.tsx`, and `src/hooks/use-auth.test.tsx`. Gotcha: never publish profile tenancy or mount account-scoped consumers while `account=null`.

## Profile creation authority hardening

Profiles are no longer client-creatable authority records: the permissive `profiles_insert` policy is gone and `PUBLIC`, `anon`, and `authenticated` have no table INSERT grant, while atomic `postgres` signup provisioning, audited membership flows, self-service profile updates, and trusted `service_role` administration remain available. Migration `20260814165451_close_profile_insert_authority.sql` was connector-applied as `20260814165602` in Test and `20260814165712` in Production; rollback-only checks preserved complete signup provisioning and denied anonymous plus authenticated same-/cross-account inserts. Both environments had zero orphan Auth users or profile/membership inconsistencies to repair. Key coverage: `src/lib/auth/profile-insert-authority-contract.test.ts`. Gotcha: staff/assignee rosters read account-scoped profiles directly, so never restore a client-side profile INSERT path.

## Atomic signup provisioning

Signup now trims and rejects a blank required full name before calling Supabase Auth, while `handle_new_user` independently enforces the same invariant and propagates tenant-bootstrap failures so the Auth insert rolls back instead of leaving an orphan login. Migration `20260814164144_make_signup_provisioning_atomic.sql` was connector-applied as `20260814164435` in Test and `20260814164519` in Production; rollback-only checks proved blank-name rejection and complete normalized tenant provisioning, and the single unconfirmed `example.invalid` audit orphan was removed. Key code: `src/app/(auth)/signup/page.tsx`, `src/lib/auth/signup.ts`, and `src/lib/auth/signup-provisioning.test.ts`.

## Recovery-only password updates

Password recovery now mints a ten-minute, HttpOnly, server-signed grant only after Supabase proves a recovery exchange. The reset page sends password changes through a same-origin server route that binds the grant to the authenticated user, rejects ordinary signed-in sessions and tampered or expired grants, and clears the grant after success; the existing eight-character password policy is enforced at both UI and route boundaries. No migration or data repair was required. Key code: `src/app/auth/callback/route.ts`, `src/app/(auth)/reset-password/update/route.ts`, and `src/lib/auth/recovery-intent.ts`.

## Invitation continuation through auth recovery

Validated invitation continuations now survive signup-link failures, sign-in retries, forgot-password email/callback handling, and successful password reset. Only current-format UsefulDesk invite tokens can become `/join/<token>` destinations, and recovery completion reads that destination from the existing signed, user-bound recovery grant rather than a browser return-to. Ordinary auth still lands on the dashboard. No migration or data repair was required. Key code: `src/lib/auth/invitation-continuation.ts`, `src/app/auth/callback/route.ts`, the signup/login/forgot/reset pages, and `src/proxy.ts`.

## Razorpay pinned-readiness recovery

An existing exact-pinned Live OAuth connection can now recover after its 24-hour readiness evidence expires: the owner/admin Payments card reaches the same-origin refresh route, which alone may cross the stale-readiness gate, requires the configured Live account and already-bound merchant pins, rotates the stored OAuth grant, reruns read-only provider readiness probes, and persists the result. Ordinary payment operations still fail closed on stale readiness. On 2026-08-14 the owner separately authorized this connection-only action for Rajat Kashyap account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` / merchant `acc_TCJwBqanN9LTrK`; token generation advanced to 2, readiness became fresh, and the secret-blind closeout found no manual material, leases, active OAuth state, conflicting binding, new money/link/refund record, unresolved exact-Live event, or open exception. Production deployment `dpl_6BurUwHRp6AramDkS23hZAMkvAX4` is READY with OAuth, enrollment, and every acceptance flag false. At this step no separate real-gym classification or message/money authority was asserted; the later readiness entry records the owner's operating-gym clarification. VBF stayed closed, WhatsApp was not sent, and the deferred client secrets were not rotated. Key code: `src/app/api/payments/razorpay/oauth/refresh/route.ts`, `src/lib/payments/credentials.ts`, and `src/components/settings/razorpay-settings-card.tsx`.

## Renewal KPI and queue parity

Dashboard **Renewals due** now counts only active, non-trial memberships that participate in the renewal chase, matching its default seven-day Members → Renewals destination. Fixed-term and session-pack expiries no longer inflate the KPI; the loader reuses `isRenewalChaseable`, with focused regression coverage in `src/lib/memberships/stats.test.ts`. No migration or data repair was required.

## Retry-safe Meta lead capture

Meta lead-ad deliveries now use a lease-backed event claim and atomically retain the contact, one enquiry note, and the delivery's original `created_contact` result. A failure after capture resumes from that durable state instead of deduping the retry into an existing lead, duplicating its note, or suppressing `new_contact_created`; the automation dispatch marker also survives completion retries, phone-only/custom-name forms keep their prior normalized-phone fallback, and goal tagging remains non-blocking enrichment. Migrations `20260814033000_resume_meta_lead_capture.sql` and `20260814033100_allow_phone_only_meta_lead_capture.sql` were connector-applied as `20260813223320`/`20260813223747` in Test and `20260813223419`/`20260813223746` in Production; both schemas passed rollback-only capture/failure/resume/completion/grant and phone-only checks, advisors found no new related issues, and both environments had zero historical Meta events or contacts to repair. Key code: `src/app/api/meta/leads/webhook/route.ts` and its focused retry and schema-contract tests. Gotcha: as with any external dispatch, process loss after automation runs but before its marker commits retains a narrow at-least-once replay window.

## Atomic public-form lead evidence

Public lead forms now commit the contact, enquiry note, submission audit, and consent evidence in one service-only database transaction before returning success or dispatching `new_contact_created`. The same migration repairs the consent trigger's service-role check, which previously inspected the security-definer identity and rejected every backend submission; goal tagging remains a best-effort enrichment after the durable capture. Connector-applied Test and Production schemas passed rollback-only success, injected-failure rollback, consent-audit, and grant checks, and neither environment had partial form records to repair. Key code: `src/app/api/lead-forms/[token]/submit/route.ts`, `supabase/migrations/20260814032000_atomic_public_lead_capture.sql`, and `supabase/migrations/20260814032100_fix_service_role_consent_capture.sql`.

## Race-safe flow timeouts

The flow timeout cron now compares both `status='active'` and the exact `last_advanced_at` snapshot that qualified a run as stale. A concurrent inbound that advances the same still-active run therefore wins the compare-and-set instead of being overwritten as `timed_out`. Focused route coverage reproduces the scan-to-update race and preserves ordinary stale-run expiry in `src/app/api/flows/cron/route.test.ts`. No migration or data repair was required: Test and Production already use a non-null `timestamptz` freshness column and had zero active or timed-out flow runs.

## Recoverable delayed automation claims

Delayed automation waits now move through one atomic five-minute owner lease instead of a permanent `pending → running` claim. The 15-minute cron can reclaim an expired worker, while terminal `done` / `failed` transitions use lease-owner compare-and-set so a stale worker cannot finish newer work. Connector-applied Test and Production schemas passed rollback-only initial claim, expired reclaim, stale-owner rejection, current-owner completion, grant, and lease-clearing checks; both databases had zero queued executions to repair. Key code: `src/app/api/automations/cron/route.ts`, `src/lib/automations/engine.ts`, and `supabase/migrations/20260814031000_lease_delayed_automation_claims.sql`. Gotcha: a process loss after an external step succeeds but before completion is recorded can replay the remaining path at least once.

## Private WhatsApp media cache containment

Authenticated inbound WhatsApp media proxy responses are now `private, no-store` instead of publicly cacheable for 24 hours, preventing Meta-downloaded customer media from entering shared browser or intermediary caches. Focused route coverage locks the authenticated download bytes, content type, and cache contract in `src/app/api/whatsapp/media/[mediaId]/route.test.ts`. No migration or data repair was required; the existing public `chat-media` bucket used for outbound Meta delivery is unchanged.

## Public API lead-capture parity

Public `POST /api/v1/contacts` now records an enquiry note for both newly created and deduplicated contacts, and newly created contacts dispatch the existing `new_contact_created` automation after the response. Dedupe hits remain visible without replaying welcome automation. Focused route coverage locks both states in `src/app/api/v1/contacts/route.test.ts`. No migration was needed: Test and Production both expose the existing non-null `contact_notes` shape to `service_role`, and both had zero `received_via='api'` contacts to repair.

## Resumable public API broadcasts

Public `POST /api/v1/broadcasts` now persists each normalized destination and its template parameters before returning 202. Its `after()` callback and the authenticated 15-minute ops sweep share an atomic owner-leased recipient drain, so pending sends survive a platform timeout; lease-owner compare-and-set completion rejects stale workers and finalizes the broadcast only after every recipient is terminal. Connector-applied Test and Production schemas passed rollback-only expired-lease reclaim, stale-owner rejection, completion, aggregate-count, client-grant, and payload checks; both databases had zero existing broadcasts, so no repair was required. Key code: `src/lib/whatsapp/broadcast-core.ts`, `src/app/api/v1/broadcasts/cron/route.ts`, and `supabase/migrations/20260814030000_resume_public_api_broadcasts.sql`. Gotcha: deploy the migration before the route and keep `/api/v1/broadcasts/cron` scheduled; a process loss after Meta accepts a send but before its completion RPC remains an unavoidable at-least-once ambiguity.

## Durable WhatsApp webhook receipt and recovery

Signed WhatsApp webhook payloads now enter an idempotent service-only receipt ledger before Meta receives 200. The request's `after()` callback is only the first drain: an atomic five-minute lease, failed/stale retry, and the existing 15-minute authenticated ops scheduler recover unfinished receipts without overlapping processing; completed payload JSON is erased while its SHA-256 dedupe key remains. The connector-applied Production schema denies client table/function access and passed rollback-only duplicate, lease, fail/retry, completion, payload-erasure, and service-role checks. Key code: `src/app/api/whatsapp/webhook/route.ts`, `supabase/migrations/20260814023000_durable_whatsapp_webhook_receipts.sql`, and `src/lib/whatsapp/webhook-receipt-durability.test.ts`. Gotcha: deploy the migration before the route, and keep `/api/whatsapp/webhook` in `ops-crons.yml`; `after()` is a latency optimization, not the durability boundary.

## Tenant-safe monotonic WhatsApp status callbacks

Signed Meta status callbacks now retain `metadata.phone_number_id` as their tenant boundary and use one service-role-only invoker RPC to advance stored message and broadcast-recipient states atomically. Duplicate, unknown, cross-tenant, and regressive callbacks are no-ops, and public `message.status_updated` events fire only for a stored message that actually advanced. The connector-applied Production function has an empty search path, no client-role execute grant, and passed rollback-only wrong-tenant, regression, and forward-transition checks; no existing cross-account message-ID collision required repair. Key code: `src/app/api/whatsapp/webhook/route.ts`, `supabase/migrations/20260813205947_whatsapp_status_callback_integrity.sql`, and `src/lib/whatsapp/status-callback-integrity.test.ts`.

## AutoPay membership-lifecycle containment

Membership renew/edit/plan-change/freeze/cancel/reactivate/delete operations now fail at the database boundary while a Razorpay mandate is `creating`, `pending`, `active`, `paused`, or `orphaned`, and the member profile disables those same actions with a provider-resolution reason. The boundary recognizes both direct authenticated writes and authenticated callers retained through an RPC execution context. Delayed provider callbacks cannot switch a frozen, cancelled, or trial membership to auto collection or active state; an AutoPay insert against one of those states is rejected inside the existing charge transaction and preserved as a gateway exception. This is containment, not provider pause/cancel/rebind support: the remote subscription must become terminal before local lifecycle work resumes. The connector-applied Test and Production schemas match; Production had no mandates and Test had only two terminal mandates, so no data repair was required. Key code: `supabase/migrations/20260814021023_block_membership_mutations_with_live_mandates.sql`, `supabase/migrations/20260814022000_cover_security_definer_membership_deletion.sql`, `src/lib/payments/razorpay-membership-lifecycle-contract.test.ts`, and `src/components/members/member-detail-view.tsx`.

## AutoPay invoice-line allocation regression repair

The effective refund-aware payment allocator once again restricts `source='auto'` debits to the invoice line addressed by the payment's membership period, while manual and Payment Link payments retain generic proportional allocation and refund-adjusted collectible balances. The regression began when the full-refund migration replaced the earlier source-aware function; future contract coverage now resolves the last migrated definition rather than an obsolete historical copy. The connector-applied Test and Production schemas match, and neither database had an unrelated historical AutoPay allocation to repair. Key code: `supabase/migrations/20260814020500_restore_autopay_invoice_line_allocation.sql` and `src/lib/payments/razorpay-recurring-safety-contract.test.ts`.

## Account authority-column hardening

Direct browser/Data API updates can no longer change `accounts.owner_user_id`, `organization_id`, or `legal_entity_id`: an explicit safe-column grant and an invoker trigger protect those fields while audited lifecycle RPCs and backend operations remain available. Production already had the three column grants revoked by branch setup and its owner/legal-entity relationships were consistent; the dedicated trigger now prevents future privilege drift from reopening the boundary. Key code: `supabase/migrations/20260814015059_protect_account_authority_columns.sql` and `src/lib/auth/account-authority-boundary-contract.test.ts`.

## Account-scoped assignment and notification hardening

Contact, conversation, and follow-up assignees must now be active members of the same branch at the database boundary, including service-role automation writes. Notification creation and RLS enforce the same membership invariant, while staff removal transactionally clears operational assignments and that branch's old notifications. The applied migration repairs any stale references before enabling the guards; production had none. Key code: `supabase/migrations/20260813201114_enforce_account_scoped_assignments.sql` and `src/lib/auth/assignment-membership-boundary-contract.test.ts`.

## Dashboard polish

The Dashboard now reads in four plain-language groups: Today at a glance, Quick actions, Work to do, and The full picture. Short labels, neutral action icons, canonical text links, account-local dates, simpler empty states, and a clearer Lead health score keep the full daily view easy to scan. Member work shows next-seven-day expiring memberships directly; expired recovery stays in the full Renewals queue. Data, permissions, and routes are unchanged. Key code: `src/app/(dashboard)/dashboard/page.tsx` and `src/components/dashboard/`.

## Member profile drawer polish

The member profile drawer now keeps its identity and WhatsApp reminder action visually clear at narrow and wide widths, and its loading and failure states preserve the sheet hierarchy with explicit status, recovery, and accessible dialog labelling. Membership, billing, attendance, notes, permissions, and nested actions are unchanged. Key code: `src/components/members/member-detail-view.tsx` and `send-reminder-button.tsx`.

## Workspace settings polish

Settings → Regional settings, Organization & branches, and Team members now share the established narrow settings hierarchy, responsive card structure, canonical controls and status treatments, and concise owner-facing guidance. Regional settings groups account-wide formats with a live preview, Organization & branches clarifies the accessible branch roster and destructive lifecycle actions, and Team members pairs live presence with permission-safe role, invite, copy, revoke, and removal states without changing locale persistence, branch lifecycle behavior, invitations, or RBAC. Key code: `src/components/settings/localization-settings.tsx`, `organization-settings.tsx`, `organization-danger-zone.tsx`, `members-tab.tsx`, and `invite-member-dialog.tsx`.

## Payments settings polish

Settings → Payments now leads with concise UPI and Razorpay setup tasks, uses labelled responsive forms, exposes recoverable loading/error/read-only states, validates UPI IDs inline, and confirms account updates through returned rows. Razorpay status checks now time out with a retry instead of loading forever, while OAuth, provider diagnostics, money movement, and disconnect behavior remain unchanged. Key code: `src/components/settings/deals-settings.tsx` and `razorpay-settings-card.tsx`.

## Products and services settings polish

Settings → Products & services now uses concise setup copy, a responsive trainer roster, readable archived catalogue items, explicit loading/recovery and empty-trainer states, reset-on-close drafts, account-local money formatting, and clearer permission-safe errors without changing catalogue, trainer-fee, history, or checkout behavior. Key code: `src/components/settings/products-services-settings.tsx`.

## Lead management settings polish

Settings → Lead capture and Fields & tags now share the established section hierarchy, concise task copy, explicit loading/recovery/read-only states, tenant-scoped catalogues, labelled responsive forms, RLS no-op detection, and accessible destructive confirmations without changing public-form, Meta lead-ad, tag, or custom-field behavior. Key code: `src/components/settings/lead-capture-*.tsx`, `fields-and-tags-panel.tsx`, `tag-manager.tsx`, and `src/components/contacts/custom-fields-manager.tsx`.

## Renewal reminder settings polish

Settings → Renewal reminders now uses one responsive, permission-aware save flow for membership and service schedules, with accessible day choices, concise readiness guidance, explicit loading/recovery/read-only states, and no change to cron timing, templates, or WhatsApp gates. Key code: `src/components/settings/renewal-reminders-settings.tsx`.

## Message template settings polish

Settings → Templates now loads the full account template set, separates loading/error/empty/read-only states, and keeps create, preset, sync, edit, resubmit, and delete actions permission-gated. The responsive list and builder use canonical badges, alerts, cards, controls, linked labels, and safe native validation without changing Meta lifecycle behavior. Key code: `src/components/settings/template-manager.tsx`.

## WhatsApp settings polish

Settings → WhatsApp now leads with separate API-access and inbound-delivery checks, keeps delivery diagnostics visible, uses account-local date formatting, provides explicit read-only/loading/error states, and moves reset behind a keyboard-safe confirmation. Manual setup retains the existing Meta credentials, token, PIN, webhook, and registration behavior with labelled responsive controls and concise guidance. Key code: `src/components/settings/whatsapp-config.tsx` and `whatsapp-embedded-signup.tsx`.

## Account appearance settings polish

Settings → Appearance now uses compact radio-card choices with concise copy, responsive two/three-column accent selection, immediate account-synced updates, and explicit failure detection for RLS-blocked profile writes. Key code: `src/components/settings/appearance-panel.tsx`, `src/hooks/use-theme.tsx`, and `src/lib/themes.ts`.

## Account security settings polish

Settings → Login & security now uses concise task copy, field-linked accessible password errors, a contained save state, and a destructive global sign-out confirmation that stays visible while pending. Key code: `src/components/settings/security-panel.tsx`, `password-form.tsx`, and `sessions-card.tsx`.

## Account profile settings polish

Settings → Your profile now keeps the task to photo, display name, and sign-in email; it removes misleading internal account metadata, uses the canonical person avatar and alert patterns, keeps the save action inside the form card, and handles loading plus RLS-blocked updates explicitly. Key code: `src/components/settings/profile-form.tsx`.

## Payments and regional settings terminology

Settings now uses the owner-facing labels **Payments** and **Regional settings**. Currency is edited only under Regional settings; the duplicate currency card and Payments rail hint are removed, while UPI and Razorpay remain under Payments. Existing `?tab=deals` and `?tab=localization` deep links are unchanged. Key code: `src/components/settings/settings-sections.ts`, `deals-settings.tsx`, and `localization-settings.tsx`.

## Settings navigation grouping

The Settings rail now chunks its former thirteen-item Workspace section into Messaging, Lead management, Business setup, and a reduced Workspace, while Account remains unchanged and Overview stays ungrouped. All existing labels, icons, `?tab=` deep links, hints, panels, permissions, legacy tab aliases, and the mobile horizontal scroller are unchanged. Key code: `src/components/settings/settings-sections.ts`.

## Engagement navigation group

The primary sidebar now nests Broadcasts, Automations, Flows, and AI Agents under one accessible Engagement disclosure. It opens automatically for active child routes, remembers the user's preference elsewhere, preserves child active and Beta states, and expands the compact desktop rail before showing the nested destinations. The navigation now uses 8px vertical padding and 8px separator margins for tighter group rhythm across desktop, compact, and mobile layouts. Key code: `src/components/layout/sidebar.tsx`; the reveal reuses `src/components/ui/collapse.tsx`.

## Inbox responsive and accessibility polish

The Inbox conversation list now stays within the mobile viewport instead of expanding to its longest message, keeps timestamps and state visible, uses the full search width, and gives filtered and first-use empty states a clear recovery path. Conversation bubbles have a readable desktop measure, the composer uses concise mobile copy without a placeholder scrollbar, icon-only send/template/AI/assignment actions expose explicit accessible names, and status/count treatments reuse the canonical badges and loaders. Key code: `src/app/(dashboard)/inbox/page.tsx` and `src/components/inbox/`.

## Invoice accounting and refund-history polish

The shared invoice dialog now presents one reconciled summary across unpaid, part-paid, paid, no-charge, void, credited, adjusted, refunded, and refund-review states. Refunded invoices show net collection once with the gross-collected/refunded breakdown, while every refund is a dated ledger event with explicit pending, failed, orphaned, processed, accounting-outcome, and review language rather than a nested note card. The same component serves member Billing and Business → Invoices, with focused state-model tests in `src/lib/finance/invoice-detail-presentation.test.ts`. Key code: `src/components/finance/invoice-detail-dialog.tsx`, `src/components/members/membership-status-badge.tsx`, and `src/lib/finance/invoice-detail-presentation.ts`.

## Lean branch creation

Add branch is now one screen when starting fresh and two screens when reusing settings. Its first screen uses responsive setup choices plus a compact source-branch select, while the copy screen keeps the new branch and source in view, defaults only plans/products/services plus lead fields/tags, and keeps advanced reminders/automations/flows collapsed and off. The wizard hides single-choice billing-business setup, step tracking, technical counts, raw exclusions, and redundant review while explaining separation in owner-facing language. The existing authoritative preview, idempotent create, currency, tenancy, size, sanitization, and inactive/draft safety rules are unchanged. Key code: `src/components/branches/branch-creation-dialog.tsx` and its focused test.

## Active branches can be copied without setup review

Branch copying now treats readiness as the owner’s judgment rather than a platform prerequisite: any accessible active branch in the organization can supply selected configuration, even with no members, plan, WhatsApp, payments, or review marker. Objective safety checks remain—tenant access, active lifecycle, currency compatibility, bounded snapshots, allowlisted packs, sanitization, and inactive/draft executable copies. The review card and readiness badges are removed from Get Started, Organization settings, and the branch switcher; legacy review fields and the completion endpoint remain for compatibility. Migration `20260813154312_allow_active_branch_setup_copy.sql` is applied to Test and Production, with the rollback-scoped authenticated SQL suite passing on Test. Key code: `src/components/branches/branch-creation-dialog.tsx` and `supabase/tests/organization_branch_setup_copy_acceptance.sql`.

## Reviewed branch setup copying

Organization owners now add branches through a four-step wizard with an authoritative preview, stable request replay, and either guaranteed blank creation or selective configuration copying from a reviewed, same-organization, same-currency branch. Membership/pricing, lead setup, reminder timing, automations, and flows use explicit allowlists; identifiers are remapped, unsupported definitions are skipped with exact warnings, copied executable content stays inactive/draft, credentials and operational history are excluded, and every new branch remains in Setup until an admin confirms active plan/pricing and records the review. The three connector-applied migrations passed the rollback-scoped authenticated SQL suite and advisors in Test and Production, and a READY Production deployment serves the application. Key code: `supabase/migrations/20260812193001_organization_branch_setup_copy.sql`, `src/app/api/branches`, `src/components/branches`, and `supabase/tests/organization_branch_setup_copy_acceptance.sql`. Gotcha: Production initially has no reviewed source branches, so blank creation remains the guaranteed fallback.

## Invoice detail overflow containment

The shared invoice detail dialog now gives its content an explicit shrinkable grid row inside the viewport-height cap, so long invoice and payment histories scroll vertically while the header and footer remain visible. Key code: `src/components/finance/invoice-detail-dialog.tsx`.

## Action-first invoice redesign

Business → Invoices now follows the scan-first hierarchy validated against major finance/SaaS products: Outstanding and Overdue lead the summary, quick views are All / Needs attention / Paid / Upcoming / Void, desktop rows keep customer/status/total/balance prominent, and smaller screens use full-fidelity invoice cards instead of a wide table. The shared detail dialog uses a responsive 560px desktop cap, opens with an unlabelled customer identity beside the financial headline, avoids repeating the detailed totals in that snapshot, keeps the long ledger in a ring-safe bounded scroll area, and relies on the persistent top-right dismiss control instead of a duplicate footer Close action. Its payment history renders each refund as a full-width nested event: status, accounting outcome, and amount lead; reason, provider reference, source, and requester sit in a labelled audit grid; pending and failed requests do not imply completed negative cash movement. It uses one canonical status badge across overdue, review, upcoming, paid, due, no-charge, and void states and preserves every payment/refund/correction action. Standalone sale invoices now hydrate their contact independently of membership data, so walk-in service and merchandise customers remain named and searchable in the UI and CSV. Key code: `src/components/finance/finance-invoices.tsx`, `src/components/finance/invoice-detail-dialog.tsx`, `src/components/members/membership-status-badge.tsx`, and `src/lib/finance/invoices.ts`. Gotcha: Refund review remains an attention state but never becomes collectible.

## Razorpay template submission and post-Stage-6 pilot gate

The apparent 2026-08-12 Meta submissions were synthetic local rows created while Production template dry-run mode was still enabled; they never reached Meta. The exact rows and Production dry-run setting are removed. Meta then rejected the first real `gym_payment_link` body because it ended at `{{4}}`; UsefulDesk now preserves Meta error codes/details and rejects leading/trailing body variables before submission. With fixed wording after the link, Meta genuinely accepted `gym_payment_link` (`1996323644342719`) and the separately authorized `gym_payment_due` (`1528972491789269`); the authenticated 2026-08-14 provider sync reported both **Pending**. The latter contains no URL and does not replace the four-parameter Payment Link contract. Key code: `src/lib/whatsapp/meta-api.ts` and `src/lib/whatsapp/template-validators.ts`. The later 2026-08-15 sync recorded above proves both Approved and clears the template gate without fabricating a Send. `docs/razorpay-operations.md` retains the exact action-authorization boundary; VBF stays excluded and no enrollment/acceptance flag, money, refund, or WhatsApp Send was exercised.

## Razorpay Stage 6 OAuth-only retirement

Manual Razorpay setup is retired under the owner's explicit waiver of the remaining policy-only 14-day rollback hold. Connector-applied migration `20260811181302_retire_razorpay_manual_keys.sql` verified both databases had zero manual-mode/version-0 rows, erased Test's one dormant legacy webhook secret, and DB-locks credentials to OAuth/v1/application ingress with manual columns null; immutable cutover/delivery audits remain. The Settings key form, connection POST, Basic-auth/version-0 fallback and backfill, per-account/legacy-secret/cutover routes, rollback config, and retired selector RPCs are gone. OAuth recovery, named capability gates, strict Test/Live isolation, exact merchant binding, and application webhook processing remain fail-closed. READY deployments `dpl_9ZTDDvDN88gNm6CZ4qswhW47Ata1` (Production) and `dpl_AAJxU93wfh5dva7nhR4wRdimHymQ` (isolated Test) serve their canonical aliases with rollout/acceptance flags false and no manual rollback variable; the exact Rajat Live connection remains OAuth/ready and every operational queue remains zero. No real-money exercise, VBF action, or WhatsApp Send occurred; `gym_payment_link` was still unapproved at this closeout, its later approval is recorded above, and the unrotated OAuth client secrets remain under the recorded owner risk acceptance.

## Reliable tag-trigger automation dispatch

`tag_added` automations now dispatch only after the database creates a new tenant-owned contact/tag join, match the configured tag exactly, and stop chained tag automations at depth three. Dashboard contact edits use an authenticated operational route; Flow `set_tag`, Automation `add_tag`, API v1 contact writes, public lead forms, and Meta lead capture share the same idempotent server writer. CSV/member imports remain intentionally silent to avoid accidental mass sends, and send steps record a clear failed run when the tagged contact has no conversation. Key code: `src/lib/contacts/tag-write.ts`, `src/lib/contacts/tag-events.ts`, `/api/contacts/[id]/tags`, and the automation/flow engines. No schema change: the existing `(contact_id, tag_id)` unique constraint and account-scoped RLS are the concurrency and tenancy boundaries.

## Whole-word automation keyword matching

Keyword Match triggers now offer an explicit Whole word mode that uses Unicode-aware boundaries, treats punctuation and regex-significant keyword characters literally, and respects case sensitivity. Contains remains the raw-substring default and Exact still requires the whole message, so existing automations keep their behavior. Key code: `src/lib/automations/engine.ts`, `src/components/automations/automation-builder.tsx`, and focused engine/activation tests. No schema change.

## Nested automation branch editing

Automation steps under Condition Yes/No branches now use one tested tree-addressing model, so nested updates, deletion, insertion, and deep reordering mutate the intended branch instead of silently doing nothing. Condition cards use container-aware branch columns and fluid nested cards so the controls remain usable in the responsive builder. Key code: `src/lib/automations/builder-tree.ts`, its focused regression tests, and `src/components/automations/automation-builder.tsx`. Gotcha: build every step path with `childPath`; a branch child adds exactly one marker per tree level. No schema change.

## Account-access recovery

Signed-in sessions now retry one failed profile lookup, distinguish a valid viewer from an unresolved account/branch role, and explain the resulting read-only state instead of silently disabling every action. Dashboard and branch-access errors provide an in-place Retry path and retain fail-closed capability/RLS behavior. Key code: `src/lib/auth/account-recovery.ts`, `src/hooks/use-auth.tsx`, and `src/components/layout/account-access-alert.tsx`. No schema change.

## Automation webhook SSRF hardening

Automation `send_webhook` steps now reuse the public-address SSRF guard before fetch, refuse redirects, and time out after ten seconds while retaining the existing success and failed-step log semantics. Key code: `src/lib/automations/engine.ts` and its focused regression tests. Gotcha: every new server-side automation fetch must apply the guard immediately before the request and must not follow redirects.

## Next.js 16.3 React lint baseline

The Next.js 16.3 ESLint preset now passes with zero errors and warnings without weakening React's rules. Effect-driven loads and prop/URL resets use cancellable async boundaries, compiler dependency mismatches use stable whole-object dependencies, the Leads table derives its related column layouts through one pure helper, and intentional auth/tenant full-page reloads carry local explanations instead of changing session behavior. Key code: `src/app/(dashboard)/leads/page.tsx`, `src/components/inbox/message-thread.tsx`, the affected member/settings components, and `src/hooks/use-auth.tsx`. Gotcha: keep `react-hooks/set-state-in-effect` enforced; new mount/refetch effects must use the repository's cancellable async pattern.

## Selective upstream security dependency refresh

Next.js and `eslint-config-next` are pinned together at 16.3.0 without changing React. npm and pnpm now carry compatible security floors for Sharp/libvips, PostCSS, Hono, `@hono/node-server`, `ip-address`, `fast-uri`, `js-yaml`, `brace-expansion`, Undici, Nano ID, and Body Parser; both tracked lockfiles were regenerated. Key files: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`. Gotcha: the safe transitive toolchain requires Node 20.18.1+, and pnpm 11 reads overrides from the workspace file rather than `package.json`.

## Inbound conversation and message integrity

Inbound and public-API conversation resolution now converges oldest-first and recovers concurrent insert races; Meta message storage uses `(conversation_id, message_id)` as its idempotency boundary and stops replays before unread state, consent/referral work, Flows, automations, AI, broadcasts, or message-derived public webhooks. The independently unique conversation-creation boundary emits `conversation.created` before the message insert so a concurrent delivery cannot lose that event. Migration `20260811043230_inbound_webhook_integrity.sql` was applied first through the Supabase connector to UsefulDesk project `fwqthstqrkrwtaehefks`: it transactionally preserves conversation/message children while cleaning duplicates, installs both full unique indexes, removes the narrower referral-only index, and exposes an atomic fully-qualified `SECURITY INVOKER` unread RPC only to `service_role`. Key code: `src/app/api/whatsapp/webhook/route.ts` and `src/lib/whatsapp/resolve-conversation.ts`. Gotcha: keep the migration ahead of webhook deployment; never restore a client-side unread read/modify/write or move message-derived effects ahead of the message insert.

## WhatsApp and operator reliability backports

Template image-header fetches reuse the public-address SSRF guard, refuse redirects, and time out after ten seconds; inbound automation dispatch is awaited inside `after()` and log rows begin failed until terminal completion; Meta `type=button` template replies persist as interactive and enter the existing Flow reply path; customer replies CAS-reopen only closed threads; dashboard broadcasts have a 60/min batch budget and retry only pre-send HTTP 429 responses with bounded `Retry-After`. Key code: `src/lib/whatsapp/template-header-handle.ts`, `src/lib/automations/engine.ts`, `src/lib/conversations/reopen.ts`, `src/lib/broadcast-retry.ts`, and `src/lib/rate-limit.ts`. Deliberately deferred: upstream's full interactive-message/automation suite and tag-trigger automation.

## Post-login session navigation

Successful login now performs a full browser navigation so the new Supabase cookies reach the protected-route proxy; invitation sign-ins retain the encoded `/join/<token>` destination. Key code: `src/app/(auth)/login/page.tsx` and `src/lib/auth/post-login-navigation.ts`. Tunnel-origin/`next.config` changes were intentionally not ported.

This selective backport also intentionally excludes upstream i18n, AI dashboards, MCP server, Docker, media viewer, and the other named broad bundles; existing UsefulDesk cron timing-safe comparison, RBAC/security-route hardening, and Suspense/build fixes remain authoritative.

## Invoice detail spacing and action hierarchy

The shared invoice drill-down now keeps its intended dialog gutters under dense payment-link actions, wraps the footer safely, widens the desktop reading surface, and uses clearer Collected/Refunded labels plus structured refund metadata. Terminal payment-link states no longer compete with the invoice's current payment state, and Record payment is the sole primary footer action. Key code: `src/components/finance/invoice-detail-dialog.tsx` and `src/components/finance/payment-link-actions.tsx`.

## Razorpay failed-disconnect recovery

Rajat's accepted Live connection no longer remains ambiguously `disconnecting`. A service-role-only, lease/generation-guarded recovery contract first asked Razorpay to refresh the stored grant without exposing it; the provider returned `Token is already revoked`, so the row moved to `reconnect_required` rather than inventing readiness. Rajat then completed the shortest exact-account OAuth reconnect, which returned pinned merchant `acc_TCJwBqanN9LTrK`, `read_write`, and fresh readiness across the existing non-mutating provider probes. The row is now OAuth/Live/ready with current encrypted grants, application-canonical ingress, one existing activation audit, no manual material, lease, or error. Exact Live operational queues remain zero and no payment, refund, VBF action, WhatsApp Send, or Stage 6 work occurred. Key code: migration `20260811172006_reconcile_razorpay_failed_disconnect.sql`, `src/lib/payments/razorpay-disconnect-recovery.ts`, `/api/payments/razorpay/oauth/recover`, and the Settings recovery action. READY deployment `dpl_5GkfJc9Nj21pH5Liy8obPbfXpSuN` restores OAuth, first-bind enrollment, manual rollback, and every provider/refund acceptance flag false; the unrotated application secrets remain under the recorded owner risk acceptance.

## Razorpay co-branded first-merchant enrollment gate

The existing UsefulDesk Razorpay application exposes the provider-hosted Onboarding UI Configurator and its **Create your account to get started** flow. `src/lib/payments/razorpay-config.ts`, the OAuth callback, and credential/readiness helpers retain the disabled-by-default Production first-bind gate: only an explicitly allowlisted unbound tenant may adopt its first provider-issued `acc_…` identity, mismatched grants are revoked, and imported-account capability fallback cannot manufacture activation. The VBF/Aakash continuation is closed. Four Connect attempts created short-lived state reservations, but all expired unconsumed; VBF has no active OAuth state, credential, merchant binding, selector activation, Payment Link, gateway payment, or refund. Production remains pinned to Rajat's owner-controlled accepted account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` and merchant `acc_TCJwBqanN9LTrK`, now with separately recorded current readiness after the provider-grounded recovery above. Rajat's prior ₹1 Live payment/refund remains the sole Stage 5 money-path evidence, not a customer rollout. Do not resume VBF or another merchant without a new explicit decision.

## Razorpay Stage 5 production pilot accepted

Stage 5 provider/payment acceptance is accepted only for owner-controlled production account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` and exact Live merchant `acc_TCJwBqanN9LTrK`. The owner later confirmed this is their operating gym, so it is real gym-owner environment evidence; the ₹1 sale/refund remains a controlled acceptance exercise, not broader customer rollout authority. Rajat paid Mohit's isolated ₹1 sale invoice through Payment Link `plink_TO8x9EEvAaFTvD`; signed application event `TO8zmuGUYRsb5p` created one immutable UPI payment and one ₹1 line allocation. A provider-backed empty historical refund scan then enabled the authorized full `reopen_balance` refund `rfnd_TO9JVjXVBBVKQT`; signed event `TO9Lk5YahoU3O9` processed one ₹1 refund/allocation, no adjustment, and reopened the invoice to ₹1. Finance and the downloaded August CSV show ₹1 gross, ₹1 refunded, ₹0 net, no review, and the exact provider ids; Mohit's separate ₹2,700 membership due/reminder queue was unchanged, WhatsApp Send was not exercised, and the pilot catalog item is archived. Checkout migrations `20260810165912`/`20260810170205` repair a composite-row assignment bug, while `20260810172657` makes recovery require stored mode plus exact merchant identity and restores four mistakenly claimed pre-OAuth rows to unknown mode without deleting them. Both provider events had one genuine application delivery and no retry was offered; no duplicate was manufactured. Exact Live unresolved events, missing ledgers, unfinished links/refunds, and payment/refund exceptions are zero. READY deployment `dpl_KoiCtsfbL3SAefMxpUKuUYj7QUyJ` restores OAuth and every acceptance/rollback flag false; the local Vercel link is back on the isolated sandbox. Existing OAuth secrets remain unrotated under the recorded owner risk acceptance. Stage 6, manual Live keys, legacy-ingress removal, and WhatsApp Send remain out of scope.

## Razorpay Stage 4 refunds accepted in isolated Test

Stage 4 is accepted only for the single isolated Razorpay Test account. Admin-only full remaining-payment refunds retain immutable provider/payment facts, paise-exact copied allocations, canonical request identity, ambiguous-create recovery, signed-event/reconciliation finalization, and separate `reopen_balance` / `reduce_charge` accounting. Dashboard partial refunds still import header-only and block collection; migration `20260810034213` adds the only safe closure path: an admin must explicitly assign every refunded paise to original payment lines before the same service-only transaction classifies the refund, creates any equal append-only adjustment, and resolves its exact exception. Genuine closure assigned Dashboard refund `rfnd_TNlC69tk2RY9yk` (₹1.00 of ₹1.01) to line `64db2ce5-9b92-4c70-8dd4-c9c8fd373eb2` as `reduce_charge`; the invoice now has ₹0.01 net total/net cash, zero balance/review/dues, one refund allocation, one equal adjustment/allocation, immutable provider IDs, and an identical retry returns `duplicate`. All Razorpay event, charge, payment, and refund exception queues are zero; the latest CSV preserves `0.01` exactly. Key code is `src/lib/payments/razorpay-refunds.ts`, `src/lib/payments/refund-allocation-input.ts`, the refund API/dialog, refund-aware Finance exports, and migrations `20260809165718`–`20260810034213`. OAuth, manual rollback, ambiguity acceptance, and refund-retry acceptance remain false on restored READY Test deployment `dpl_4V52iQ6Rjm1MGxCByNDjp5p3pzso`; no other account, production/Live Mode, real money, credential rotation, legacy retirement, or Stage 5 work is authorized.

## Razorpay Stage 3 Payment Links

UsefulDesk can now create or reuse one exact full-balance INR Razorpay Payment Link per eligible invoice revision, copy it without WhatsApp, and settle only from a verified `payment_link.paid` event. The durable `creating | created | cancel_requested | paid | cancelled | expired | orphaned | failed` lifecycle, provider-unique references, seven-day/non-partial contract, recovery worker, service-only settlement/exception RPCs, deterministic generic-invoice allocations, and gateway-payment void guard live in `src/lib/payments/razorpay-payment-links.ts`, the shared webhook/recovery processor, `/api/payments/razorpay/payment-links`, and migrations `20260809140612`–`20260809153500`. The isolated Test acceptance created and paid a mixed ₹1.00 invoice, cancelled an invalidated ₹1.00 revision, then created and paid its ₹1.01 replacement; genuine application-canonical/legacy-shadow events settled each payment once, replay returned the same payment, and the final state had zero active/failed links, unresolved events, or payment/charge exceptions. At this Test acceptance `gym_payment_link` was not approved, so Send remained disabled while Copy and the complete provider lifecycle remained available; the later Production approval does not change that historical scope. OAuth/manual rollback flags were false on READY deployment `dpl_AKMLBbZUXfRcMKbfuZ7eoK8VpxPs`, and no production/Live or refund work was authorized.

## Razorpay Stage 2 genuine provider-retry acceptance

Stage 2 is accepted in the isolated Test stack. Migrations `20260809130000`–`20260809132000` and the authenticated same-origin admin route add a service-only, Test-only, exact-subscription, ten-minute, one-shot audit gate: the first valid application-canonical `subscription.cancelled` delivery is durably observed and answered 503 before canonical persistence, while only a Razorpay redelivery with the identical header event ID and raw-body SHA-256 may enter the existing claim/processor path. The provider cancellation trigger is itself account-scoped and audited before the OAuth call. Event `TNfmPtAekGkLfO` retried after 1.55 seconds with hash `524452d60dbed7f061f5c4f933980f7bf4e091d5b525194851994aa4179512e8`; the retry was acknowledged 200, produced one canonical row with `attempt_count=1`, revoked the mandate once, created no payment, retained one application observation plus one legacy-shadow observation, and left zero unresolved events or charge exceptions. Key code: `src/lib/payments/razorpay-webhook-retry-acceptance.ts`, `/api/payments/razorpay/webhook/retry-acceptance`, the application webhook route, and migrations `20260809130000`–`20260809132000`. Gotcha: this does not authorize another account cutover or legacy-endpoint removal; support ticket `20297340` may continue separately, and both rollout flags remain false outside an explicitly scoped Test exercise.

## Razorpay application-webhook cutover in isolated Test

Both Razorpay ingresses now use one canonical processor while the account selector permits exactly one of them to claim financial state. Migration `20260809120000` adds a service-only, Test-only parity gate that locks the OAuth credential row, revalidates three recent exact dual-ingress events plus processed/ledger/recovery evidence, switches `canonical_webhook_ingress` atomically, and writes an immutable cutover audit; `/api/payments/razorpay/webhook/cutover` exposes it only to an authenticated same-origin admin/owner in the acceptance deployment. The isolated Test selector switched to `application`, then cancellation of the synthetic Subscription produced one matching delivery per ingress at 0.180-second skew: application processed once, legacy remained shadow-only, the mandate became revoked, and unresolved events/exceptions stayed zero. Key code: `src/lib/payments/razorpay-webhook-processor.ts`, both webhook routes, the cutover route, and migration `20260809120000`. Gotcha: the newer provider-retry entry records the genuine duplicate-delivery acceptance; never manufacture a raw payload/signature. Both rollout flags remain false, and every credential visible during acceptance must rotate before any live merchant authorises.

## Razorpay durable recovery and OAuth token-due scan

Razorpay canonical events now preserve their first signed payload/identity, use owner-bound five-minute processing leases, and recover up to 100 pending, failed, or stale events every 15 minutes with 1m/5m/15m/1h/6h backoff and per-item failure isolation. The same worker leases each ready OAuth connection once daily and invokes the existing two-minute generation/CAS refresh only inside the seven-day token window. Key code: migrations `20260809110000`/`20260809111000`, `src/lib/payments/razorpay-recovery.ts`, `src/lib/payments/razorpay-webhook-processor.ts`, and `/api/payments/razorpay/recovery/cron`. Gotcha: the isolated Test scan correctly skipped its November-expiry token, advanced the next scan one day, and left generation 1; legacy was canonical at this checkpoint, before the later Test-only cutover recorded above.

## Razorpay OAuth Stage 1 acceptance and Stage 2 dual-ingress parity

The isolated Razorpay Test stack now has real development-client S256 authorization/code exchange evidence, five-capability imported-account readiness fallback, one successful lease-protected refresh rotation, verified disconnect scrubbing, and OAuth Bearer AutoPay mutation acceptance. Stage 2 adds the service-only delivery ledger/parity view and a Test-acceptance-only operator route that encrypts the legacy webhook secret without changing OAuth mode. After rotating the isolated application secret pair and configuring the merchant webhook, one simulated ₹1 Subscription produced matching authenticated, activated, and charged events at both ingresses with equal account/type/hash, sub-1.1-second skew, and zero application mutation. Key code: migration `20260809100000`, `src/lib/payments/razorpay-webhook-delivery.ts`, `src/lib/payments/credentials.ts`, and the Razorpay webhook routes. Gotcha: legacy intentionally stayed canonical for this parity checkpoint; the newer cutover entry records the subsequent selector change. Both rollout flags were restored false.

## Razorpay OAuth connection foundation

Stage 1 now adds mode-scoped, encrypted Razorpay OAuth connections; merchant/readiness state; rotating-token expiry and database-leased single-flight refresh; state/PKCE/CSRF-bound connect, callback, refresh, and revoke routes; OAuth Bearer mandate calls with one attributable-401 refresh retry; and an owner/admin Connect Razorpay settings flow. Manual credentials are versioned AES-GCM ciphertext and remain available only when the server-controlled rollback flag is explicitly enabled—revoked, blocked, or mode-mismatched OAuth never falls back. Key code: the `20260809000000`/`20260809001000` Razorpay OAuth migrations, `src/lib/payments/razorpay-oauth.ts`, `src/lib/payments/razorpay-refresh.ts`, `src/lib/payments/credentials.ts`, and `src/components/settings/razorpay-settings-card.tsx`; gotcha: both rollout flags remain false, production/manual-merchant backfill review is still outside the isolated acceptance scope, and all acceptance credentials must rotate before a live merchant authorises.

---

## Razorpay provider acceptance sandbox

Razorpay development OAuth, five read-only Bearer capabilities, a ₹1 Payment Link lifecycle, a disposable plan/Subscription lifecycle, and real signed application-webhook delivery now pass in an isolated Supabase/Vercel test stack; the temporary access token was revoked after acceptance. The new root application webhook is test-only, flag-locked, signature-verifying, observation-only, payload-size bounded, and logs provider identity plus a raw-body hash without member data or financial writes. The rerunnable probe handles Razorpay's distinct Payment Links collection shape, and the root TypeScript project excludes the nested `usefuldesk-promo` package so remote Next.js builds respect the workspace boundary. Key code: `src/app/api/payments/razorpay/webhook/route.ts`, `src/lib/payments/razorpay-webhook-observation.ts`, and `scripts/razorpay-provider-acceptance.mjs`; gotchas: legacy/application duplicate-delivery parity still gates Stage 2 cutover, and credentials exposed during acceptance must rotate before any live merchant authorisation.

---

## Razorpay recurring payment safety

UPI AutoPay now reserves one blocking local mandate before any remote subscription is created, reuses pending setup links, and cancels a newly created remote subscription when its local reference cannot be persisted; uncertain outcomes stay operator-visible and block retries. Recurring charges use Razorpay `paid_count` plus a frozen initial-period/cadence snapshot instead of inferring the next cycle from ledger balance, and confirmed charges that mismatch identity, sequence, amount, currency, period, or remaining membership-line balance persist in `gateway_charge_exceptions` without advancing another cycle. Auto allocations are membership-line-only while manual partial/proportional and 60/40 flows are unchanged. Key code: `supabase/migrations/20260804233201_harden_razorpay_recurring_charges.sql` and `src/app/api/payments/razorpay/`; gotcha: deploy the route code first and apply the migration immediately afterward (new setup then fails before remote mutation and charged webhooks retry during the short mismatch); the legacy RPC shim safely parks old-payload charges during rollback, and exception resolution/replay remains intentionally manual.

---

## Invoice detail simplification

Member profiles and Business → Invoices now share a calmer invoice drill-down with one header-level payment state, purchase items without redundant type pills or repeated allocations, a compact two-column financial table, and grouped payment rows. Paid invoices omit the repeated paid amount and zero balance; partial invoices retain paid, credit, and balance-due rows only when meaningful. AutoPay provenance, recorder identity, notes, receipts, and void audit details remain visible. Key code: `src/components/finance/invoice-detail-dialog.tsx`.

---

## Member billing history simplification

Member profiles now omit the redundant Items, source, and Payment columns from Billing history. The payment-state badge sits directly after the foreground invoice reference, followed by issued date, total, paid amount, and balance in one compact line. Headers use the shared table treatment plus the canonical **Issued on** label. Invoice drill-downs still show the source, purchased items, meaningful offer and price-override context, invoice totals, and payment audit detail. Key code: `src/components/members/member-detail-view.tsx`.

---

## Member product summaries and unified billing

Member profiles now present services and merchandise as newest-first Membership-style summaries with the same four-column hierarchy: item-name eyebrow over trainer/type, then Billing, Started/Purchased, and Expires/Quantity. Membership and service lifecycle badges stay beside their final renewal/expiry date, while Billing is invoice-first financial history: one checkout renders once with its internal reference, complete item summary, issued date, reconciled total, paid amount, balance, and payment state. Member profiles and Business → Invoices share one detail, collection, and correction flow showing line items, membership offer snapshots, recorder, AutoPay source, notes, receipts, and void history. Membership dues and AutoPay remain membership-line scoped even when the displayed invoice also contains services or merchandise. Key code: `src/components/members/member-detail-view.tsx`, `src/components/finance/invoice-detail-dialog.tsx`, and `src/components/finance/record-invoice-payment-dialog.tsx`.

---

## Renewal queue source control

Members → Renewals now keeps the Memberships / Services source segment inside the bordered queue toolbar as its leftmost control, immediately before Expiring / Expired, on both source views. Key code: `src/components/members/renewal-action-lists.tsx` and `src/components/members/service-renewal-action-lists.tsx`.

---

## Products, services, and trainer-priced personal training

UsefulDesk now sells member-only services and merchandise alone or alongside joining/renewal membership in one transactional immutable invoice. Settings owns archived catalogue records, calendar duration options, trainers, and explicit trainer-specific pricing; owner-facing setup calls these **trainer fees**, with plain set/edit CTAs and completion copy instead of a technical rate matrix. The Trainers tab lists every registered teammate with a role-preserving Trainer switch, while no-login Independent trainers use the same roster identity row with a permanent-delete trash action and keep a concise access subtitle plus contextual Add action in the correctly aligned card header. Deleting an independent trainer removes saved rates but historical invoices and assignments retain their snapshots. Member profiles show service/purchase history and support Add, Renew, Cancel, and prorated trainer reassignment. Generic line allocations preserve membership-only dues while proportional paise-exact cash/credit allocation, partial payments, combined 60/40 promises, service renewal queues, and claim-first WhatsApp automation reconcile at invoice level. The desktop setup follow-up removes duplicate Settings chrome, prevents duplicate active durations/unit prices in both the form and database, labels every control, uses account-currency inputs with canonical `Trainer fee not set` copy, confirms archive actions, and permanently deletes unused items while database constraints retain anything with invoice or service history. Eight applied migrations starting at `20260801160314`; key code: `src/app/api/member-checkouts/route.ts`, `src/lib/products-services.ts`, `src/components/settings/products-services-settings.tsx`, and `src/components/members/` product/service surfaces. Gotcha: trainer-priced options have no fallback, AutoPay never consumes member credit, and issued invoices never accept later lines.

---

## Membership-plan monthly price comparison

Settings → Membership plans now groups each plan in a clean catalogue card and presents every active billing option as an equal-weight responsive comparison card, without decorative plan avatars, a false selected state, or a duplicate cycle-name header. Each option leads directly with the dominant effective monthly price and savings badge, then anchors its bold total and quieter billing cadence at the bottom. Monthly, day/week, and session-pack options keep their real total as the hero; fixed terms say “term” and packs say “Valid for” rather than implying recurring billing. Savings appears only when the same active non-session plan has exactly one comparable active 1-month option; missing or ambiguous baselines and non-discounts never produce a savings claim. Plan actions sit in one overflow menu. Key code: `src/lib/memberships/pricing.ts` and `src/components/settings/plans-settings.tsx`.

---

## Finance cash-flow previous-month comparison

Business → Overview can now compare the selected month with the previous month inside the existing Daily/Weekly cash-flow chart. The optional four-series grouped view aligns calendar days and ordinal seven-day buckets, limits a current-month comparison to the same elapsed account-local day, handles unequal month lengths, keeps previous income/expense hues at reduced opacity, and exports the aligned daily comparison in the existing Overview CSV. The comparison checkbox sits beside the grouping control, while the series legend stays below the plot. Both months still come from the single Overview load, and the chart is empty only when neither month has movement. Key code: `src/lib/finance/overview.ts`, `src/components/finance/finance-cash-flow-chart.tsx`, and `src/lib/finance/overview.test.ts`.

---

## Member activity chart grouping

Business → Performance now gives the title-only Member activity card a Daily/Weekly shared segmented toolbar. Daily points roll into seven-day totals in Weekly mode, x-axis ticks use compact day-of-month labels because the Business header already owns Month Year context, and tooltips retain the full localized date. Key code: `src/components/reports/report-trend-card.tsx` and `src/lib/reports/activity-trend.ts`.

---

## Business month control title anchoring

The shared Business month navigator now sits in the app bar's leading group, exactly 24px after the **Business** title on Overview, Performance, Invoices, Payments, and Expenses. Export, staff/scope selectors, and tab-specific actions remain trailing, so their number and width no longer move the month control horizontally. Key code: `src/components/layout/header.tsx`, `src/components/layout/page-header-actions.tsx`, `src/components/finance/finance-month-actions.tsx`, and `src/components/reports/`.

---

## Business page consolidation

Business is now the single top-level destination for financial and business analysis, with URL-backed Overview, Performance, Invoices, Payments, and Expenses tabs. Performance absorbs the former Reports page while removing its duplicate Revenue collected KPI and Collections over time chart; it uses the exact Today / previous / next / Month Year navigator shared by the other tabs, and the selected calendar month scopes staff, organization, ad-performance, and CSV data. Ad performance sits beside lead-source analysis for All staff. The former Finance and Reports sidebar labels collapse into Business, while the stable `/finance` route and old `/reports` redirect preserve bookmarks and branch context. Key code: `src/components/finance/finance-month-actions.tsx`, `src/components/finance/finance-master-view.tsx`, `src/components/reports/owner-reports-view.tsx`, and `src/app/(dashboard)/reports/page.tsx`.

---

## Reports collection-mix consolidation

Owner Reports no longer renders the duplicate Collection mix card; Finance remains the canonical visual surface for payment-method and source mix. The report payload and CSV export retain those fields for historical export compatibility, and the Reports loading skeleton now mirrors the two remaining two-column analysis rows. Key code: `src/components/reports/owner-reports-view.tsx`.

---

## Ad performance help affordance

Finance Overview now places the question-mark help icon on the trailing side of the Leads acquired label while preserving the existing cohort tooltip and accessible name. Key code: `src/components/finance/finance-ad-performance.tsx`.

---

## Finance revenue drilldown row cleanup

Finance Overview revenue-source accordions now open directly into payment rows without a repeated nested header or Manual/Auto-pay badge. The payment method aligns with the parent Payments column, an intentional empty Share column preserves the parent grid, and Revenue keeps its existing right edge across every source. The flexible member column yields more room to collection dates, whose contextual line now wraps instead of truncating longer renewal descriptions. Key code: `src/components/finance/finance-revenue-breakdown.tsx`.

---

## Canonical underline-free text links

The shared `Button` link variant now renders account-primary hyperlink text without adding an underline on hover. `AccordionContent` preserves its prose-link treatment while excluding anchors marked as Button consumers, preventing its descendant selector from re-underlining Finance revenue-source “View all”; AI Playground setup navigation and Follow-up Filters “Clear all” inherit the Button change directly. Key code: `src/components/ui/button.tsx`, `src/components/ui/accordion.tsx`, and `src/components/finance/finance-revenue-breakdown.tsx`; durable rule: `docs/ui-patterns.md`.

---

## Canonical muted table headers

Every shared `TableHead` now renders header labels with the muted neutral foreground, bringing Finance revenue-source payment drilldowns and all other table consumers onto one token. Redundant page-level muted overrides were removed; alignment and layout remain call-site concerns. Key code: `src/components/ui/table.tsx`; durable rule: `docs/ui-patterns.md`.

---

## Finance revenue-source payment drilldowns

Finance Overview now expands each immutable revenue source into its five latest contributing payments instead of duplicating Reports' plan aggregation. Nested rows use canonical member identity without exposing phone numbers, preserve plan and Member ID as context, and open the established member detail sheet in place; collection/cycle timing, method, Manual/AutoPay source, and amount remain visible. View all preserves the selected branch and opens Finance Payments with a durable revenue-source URL filter backed by exact database-side totals, paging, and export. Migration `20260801090000_finance_payment_purpose_filter.sql` was applied through the Supabase connector as `20260731190701`; key code: `src/components/finance/finance-revenue-breakdown.tsx`, `src/lib/finance/overview.ts`, and `src/lib/finance/payments.ts`.

## Finance Overview card cleanup

Finance Overview cards now use divider-free headers throughout. Ad performance has a plain title without its decorative target icon or persistent acquisition-source subtitle; that explanation now lives in an accessible info tooltip on the Leads acquired row. Revenue breakdown header, stream, and expanded plan values share one right-aligned numeric axis for Payments, Share, and Revenue. Key code: `src/components/finance/finance-ad-performance.tsx` and the Overview card components in `src/components/finance/`.

## Finance revenue stream drilldowns

Finance Overview's Revenue breakdown now uses the Reports Plan performance accordion pattern: each immutable revenue stream shows payment count, total-revenue share, and revenue, then expands into plan-level payment counts, within-stream share, and revenue. Stream rows use a clean chevron-only hierarchy without decorative colour dots. The selected-month paid ledger remains the single source of truth, zero-value core streams stay visible, and Other remains hidden only when zero. Key code: `src/components/finance/finance-revenue-breakdown.tsx` and `src/lib/finance/overview.ts`.

## Finance revenue attribution and ad performance

Finance Overview now reconciles selected-month paid revenue into immutable Joining, Renewal, Due, and Other purposes and reports selected-month Marketing spend against the Instagram/Facebook/Meta lead cohort's to-date non-trial conversions and joining revenue. Initial member/import/installment collections use the validated joining RPC; later collections remain due, renewals and AutoPay are classified from their database operation/cycle, ambiguous history stays Other, Recent transactions names the purpose, contact changes refresh the view, and CSV includes both sections. Migrations `20260731120000_finance_revenue_attribution.sql` and `20260731121000_finance_ad_cohort_indexes.sql` were applied through the Supabase connector as `20260731180203` and `20260731180859`; key code also lives in `src/lib/finance/overview.ts` and `src/components/finance/finance-overview.tsx`. Gotcha: the cohort month is acquisition-local, while conversions and joining revenue intentionally continue accumulating afterward.

## Dashboard operating queues

The live **Needs attention** operating queues now sit on Dashboard beside Lead Conversion Rating, replacing the Average First Response Time chart. Reports no longer renders the queue card, while its existing report payload and CSV snapshot remain intact; the response-time component and loader remain in code but are no longer fetched or surfaced. Key code: `src/components/dashboard/needs-attention-card.tsx`, `src/components/dashboard/dashboard-insights.tsx`, and `src/components/reports/owner-reports-view.tsx`.

---

## Canonical single-member creation

**Add member** now uses the lead-conversion experience as the canonical single-person creation flow: the same responsive split dialog, click-to-edit personal-information rail, bounded membership details, one-time discount and bonus-month offers, and full-or-60/40 first-payment decision. New-member drafts now carry Birthday, configured Gender, and localized height/weight through contact creation or deduped-contact attachment; seeded lead conversions keep immediate contact/photo editing. Batch import and bulk conversion remain batch-specific. Key code: `src/components/members/member-form.tsx`; durable rules: `docs/ui-patterns.md` and `docs/gym-domain.md`.

---

## Conversion payment installments

**Convert to member** now presents its plan and start-date fields inside the same bounded section treatment as the adjoining offer and payment decisions. It offers two payment-method choices: pay the first invoice in full, or collect 60% immediately and leave 40% due exactly 28 account-local days later with no extra fee. The split path records the payment and installment promise atomically, preserves the invoice as the balance source of truth, and sends claim-first WhatsApp reminders 7, 3, 1, and 0 days before the deadline while money remains due. It requires an approved `gym_installment_reminder` Utility template with member, amount, plan, and due-date body parameters. Key code: `src/components/members/member-form.tsx`, `src/lib/memberships/installments.ts`, `src/app/api/payment-installments/cron/route.ts`, and `supabase/migrations/20260729190000_conversion_payment_installments.sql`. The migrations were applied through the Supabase connector as `20260729181535` and `20260729181706`.

---

## One-time lead conversion bonus months

**Convert to member** now offers bonus months with the same progressive-disclosure pattern as its price discount: an unfilled checkbox section, editable whole-month input, and shared +1/+2/+3 month quick chips. The live quote separates regular expiry, bonus time, and first expiry. The selected billing option remains unchanged; only the first period is extended, and later renewals continue from the actual expiry at the option's normal duration and price. Membership and invoice snapshots preserve the original expiry and bonus for audit, and invoice detail exposes both. Migration `20260729173714_one_time_conversion_bonus_months.sql` was applied through the Supabase connector as `20260729174039`. Key code: `src/components/members/member-form.tsx`, `src/lib/memberships/bonus-time.ts`, and `src/components/members/invoice-detail-dialog.tsx`.

---

## Member avatar quick view

Every Members tab—Renewals, Follow-ups, Trials, Payments, At risk, All members, and Attendance—now opens the same instant hover/focus quick view from the avatar, with a 144px cached profile photo, name, Member ID, and applicable Details, WhatsApp reminder, and Follow-up actions. The shared preview uses only list-loaded row data—never a hover-time query; the At risk list batches its missing contact-avatar fields into the list load. Key code: `src/components/ui/preview-card.tsx`, `src/components/members/member-identity.tsx`, and `src/components/members/member-avatar-quick-view.tsx`.

---

## Branch restore and permanent deletion

Organization owners who own a branch can now manage every branch from **Settings → Organization & branches**: active/read-only branches can be archived or permanently deleted, and archived branches can be restored or permanently deleted. Exact branch-name confirmation protects archive/delete, the final branch and last surviving active branch are guarded, and hard deletion purges branch Storage, transactionally re-homes shared users, removes branch-only logins, and records a durable deletion audit. Migration `20260728200000_branch_restore_and_erasure.sql` was applied through the Supabase connector as `20260728183018`; key code: `src/app/api/organization/branches/[accountId]/route.ts` and `src/components/settings/branch-actions.tsx`. Gotcha: deleting the final branch remains the separate organization-erasure flow.

---

## Permanent organization erasure

Organization owners now have a dedicated **Settings → Organization & branches** surface that lists every branch, moves current-branch archival out of Team members, and exposes an exact-name-confirmed permanent organization deletion. `DELETE /api/organization` snapshots cross-organization access, removes account-prefixed and exact legacy Storage objects through the Storage API, transactionally re-homes profiles that still belong elsewhere, deletes every branch and organization-scoped row through the owner-rechecking `delete_organization` RPC, and hard-deletes only Auth users left with no other organization access. A service-only `data_deletion_requests` record survives with completion counts or the failed stage. Migration `20260728175827_organization_erasure.sql` was applied through the Supabase connector as `20260728180541`; key code: `src/app/api/organization/route.ts`, `src/lib/storage/organization-erasure.ts`, and `src/components/settings/organization-settings.tsx`. Gotcha: Storage must be purged through its API before the relational RPC—never delete `storage.objects` rows directly.

---

## Organization-over-accounts multi-branch foundation

UsefulDesk now groups existing account tenants under organizations, with explicit legal entities and many-to-many branch memberships while preserving each account as an isolated operational branch. Durable branch URLs/header-scoped RLS fail closed on unauthorized or stale context; the sidebar selector works expanded, collapsed, and mobile, hard-reloads on switch, supports credential-free setup-state branch creation, and archives closures without deleting history. Its trigger now keeps the shared neutral outline visible at rest so the dropdown affordance remains discoverable. Invitation, staff/role, ownership, signup, presence, expense, media, reporting, realtime filters, and branch lifecycle paths are branch-aware. Owner Reports adds a read-only organization view with branch/legal-entity drilldowns and separate currency totals. A minimal organization contact index warns without merging; standalone inbound STOP-style commands create organization-wide suppression, and proactive templates, API sends, broadcasts, automations, and renewal reminders stay blocked unless a later explicit branch/purpose opt-in reopens that narrow scope. Migrations `20260728162503`, `20260728170116`, `20260728170241`, `20260728170553`, `20260728170731`, and `20260728171042` were applied through the Supabase connector and contain the incremental backfill, policies, archived-branch operational lock, last-active-branch guard, wall-clock consent ordering, foreign-key indexes, audit trail, and RPC boundaries. Key code: `src/lib/auth/branch-context.ts`, `src/hooks/use-auth.tsx`, `src/components/layout/branch-switcher.tsx`, `src/components/reports/organization-reports-view.tsx`, and the `20260728` organization/branch migrations. Follow-ups keep the branch selector's Base UI label inside its required menu group and let the database authorize the immediate switch into a newly created branch instead of rejecting it against a stale client snapshot. Gotcha: `profiles.account_id/account_role` is compatibility metadata only; never use it as the branch membership source of truth.

---

## Finance month controls in the app bar

Finance now keeps a simplified Google Calendar-style period navigator in the app bar across Overview, Invoices, Payments, and Expenses: **Today**, previous/next arrows, then one localized Month Year label. The label owns a fixed responsive width, so short and long month names never move the navigation buttons. The former Month and Year dropdowns plus separate Current month action are gone; narrow headers retain adjacent navigation and the period label while hiding Today. Export and tab-specific primary actions remain alongside it. Key code: `src/components/finance/finance-month-actions.tsx`.

---

## Semantic trend direction colours

KPI comparison rows now use one product-wide directional treatment through the shared `MetricCard`: upward trends are emerald, downward trends are red, and unchanged values remain neutral across Reports, Dashboard, and Finance. The arrow and label share the same semantic foreground token instead of borrowing the account accent. Key code: `src/components/dashboard/metric-card.tsx`; durable rule: `docs/ui-patterns.md`.

---

## Finance Overview expense integration

Finance Overview now reads posted expense-ledger rows for the selected and previous calendar months: Expenses and Profit cards show real totals, cash flow plots money out by expense date, Recent transactions merges income and expenses, and CSV export carries the same figures. Voided expenses remain excluded everywhere, and zero is shown only when the active ledger has no posted expense for that period. Key code: `src/lib/finance/overview.ts`, `src/components/finance/finance-overview.tsx`, and `src/components/finance/finance-cash-flow-chart.tsx`.

---

## Repository-wide ESLint cleanup

The current Next.js 16 / React 19 tree now passes ESLint with zero errors and zero warnings without rule overrides. The stale 56-error report was not reproducible from the supplied `main` revision (its untouched baseline was zero errors and 11 warnings); the remaining cleanup removed dead imports/state, made auth-driven effects depend on stable scalar IDs, cancellation-guarded the contact-form option loaders, and moved authenticated message images onto `next/image` without changing their proxy/blob delivery. Key code: `src/components/contacts/contact-form.tsx`, `src/components/inbox/message-bubble.tsx`, and the affected Inbox and Settings call sites.

---

## WhatsApp referral attribution

Inbound Click-to-WhatsApp messages now retain Meta’s normalized referral object on each message, classify Instagram/Facebook only from a trusted HTTPS source hostname, and set `contacts.source` as a compare-and-set first touch without changing `received_via='whatsapp'`. Referral-bearing retries are conversation-scoped and idempotent; the Inbox shows the ad/post context on the exact message, while the shared contact header exposes the resulting acquisition source. Migration `20260727200000` was applied through the Supabase connector. Key code: `src/lib/whatsapp/referral.ts`, `src/app/api/whatsapp/webhook/route.ts`, and `src/components/inbox/message-bubble.tsx`.

---

## Staff-scoped owner reporting

Reports now has an **All staff** master filter in the app bar plus one option per account teammate. Selecting a teammate scopes every KPI, trend, attention queue, plan/source breakdown, and CSV export to leads and members currently assigned to that user; the default keeps the existing account aggregate. Lead source rows now reuse the canonical source icons from Leads, and the page opens directly on the KPI grid with a 24px content inset instead of a duplicate subtitle, date/status line, or active-member badge. Migration `20260727190000` was applied through the Supabase connector and keeps all four reporting RPCs `SECURITY INVOKER` with an optional staff UUID. Key code: `src/components/reports/owner-reports-view.tsx`, `src/lib/reports/reporting.ts`, and `supabase/migrations/20260727190000_staff_scoped_owner_reports.sql`.

---

## Average Sale Price reporting

Reports now replaces the Attendance Visits summary card with **Average Sale Price**: the selected-period total of each new non-trial member’s first invoice value divided by that period’s new-member count, with the same calculation for the prior-period comparison and CSV summary. The initial invoice’s net `fee_amount` keeps joining discounts in the sale value; attendance remains available in the activity trend and plan breakdowns. Migration `20260727170803` was applied through the Supabase connector and adds an account-RLS-scoped reporting RPC with an exact paginated fallback. Key code: `src/components/reports/owner-reports-view.tsx`, `src/lib/reports/reporting.ts`, and `supabase/migrations/20260727170803_owner_report_average_sale_price.sql`.

---

## Responsive report performance tables

Reports cards now use clean divider-free title/subtitle headers throughout the page. Collection mix follows the same stacked header hierarchy as the other sections, renders payment methods and Manual/AutoPay sources as consistent label/value/progress metrics instead of source badges, attaches each transaction count to its method label so the value column remains currency-only, and moves its aggregate amount into a final Total row beneath the breakdown. Plan performance compresses flexible columns to content-aware minimums before horizontal scrolling, places each disclosure chevron inside the Plan column, removes the trailing alignment shims from parent and nested rows, aligns the Plan header plus parent and nested labels on one text axis, and gives every expandable plan row the same edge-to-edge divider and full-width neutral hover geometry as Lead source performance. Plan and lead-source table headers use muted labels without header-row hover. Lead source performance adds paid Revenue attributed through each selected-period acquisition contact’s membership, with the same value in CSV export and an exact paginated fallback when the reporting RPC is unavailable. Migration `20260727151311` was applied through the Supabase connector. Key code: `src/components/reports/owner-reports-view.tsx`, `src/components/reports/report-trend-card.tsx`, `src/lib/reports/reporting.ts`, and `supabase/migrations/20260727151311_owner_report_source_revenue.sql`.

---

## Plan billing-option performance

Reports → Plan performance now keeps each plan as a summary row and expands into its billing-option breakdown with Active, New, Visits, and Revenue metrics plus the option’s standard fee for context. Revenue follows the historical invoice period and attendance follows the billing period active on the visit date, so later plan changes do not rewrite past option performance; CSV export includes the same breakdown. Migration `20260727120000` was applied through the Supabase connector. Key code: `src/components/reports/owner-reports-view.tsx`, `src/lib/reports/reporting.ts`, and `supabase/migrations/20260727120000_owner_report_plan_options.sql`.

---

## Consequence-first member import review

The AI-assisted Members importer now groups repeated migration findings by customer outcome instead of rendering one jargon-heavy card per row: harmless expiry differences are one no-action notice, unusable/shared phones state that those members will be skipped, and inconsistent payments state that the member imports with the payment omitted. Preview opens on retained rows needing attention, carries financial migration notices into the import check, and can show all affected retained rows even beyond the normal 200-row preview cap. Key code: `src/lib/memberships/migration-recipe.ts`, `src/components/members/import-members-csv-dialog.tsx`, and `src/components/members/import-members-preview.tsx`.

---

## Bulk member deletion

All Members selection now includes an owner/admin-only **Delete** action for the current row selection or every member matching the active search and filters. One confirmation covers the whole selection; deletion uses the existing `delete_member` RPC with bounded concurrency, retains anonymized payment-ledger entries, reports partial failures honestly, and leaves failed rows selected for retry. Key code: `src/components/members/members-table.tsx`.

---

## Member photo clipboard paste

The member photo dialog now accepts an image pasted with Command+V on macOS or Control+V on Windows, routes it through the same size validation and square crop preview as a selected file, and leaves the existing WebP optimization and upload flow unchanged. Clipboard extraction falls back across browser item/file representations and ignores non-image clipboard content; the dialog keeps its upload and crop guidance deliberately brief. Key code: `src/components/members/avatar-editor-dialog.tsx` and `src/lib/images/clipboard.ts`.

---

## AI-assisted member CSV migration

The four-step Members importer now accepts an owner explanation and offers **Analyze file**, using the existing account-scoped AI provider with only headers, bounded samples, counts, and the explanation. The model can propose only a hand-validated, allowlisted recipe; pure code removes summary rows, groups by source identity, selects the latest parsed start date, splits common plan/term labels, preserves explicit expiry and legacy IDs, maps expired semantics, and surfaces every shared-phone, missing-phone, and financial exception with an owner/status/next action. Inconsistent payments are removed from the ledger payload rather than forged, plans remain human-matched, older history is explicitly excluded, and manual mapping remains available when AI is off or declined. The final commit now shows determinate row-level progress plus finishing stages, so large imports no longer appear stalled. Key code: `src/lib/memberships/migration-recipe.ts`, `src/app/api/members/import-analyze/route.ts`, and `src/components/members/import-members-csv-dialog.tsx`.

---

## Members Excel workbook import

The existing four-step Members import now accepts modern `.xlsx` workbooks as well as CSV, requires a worksheet choice when a workbook has multiple tabs, and feeds the selected sheet into the unchanged mapping, validation, editable preview, and commit pipeline. Excel parsing is loaded in the browser only when needed; invalid, protected, empty, oversized (over 10 MB), overly tall (over 5,000 data rows), and overly wide (over 100 columns) sheets surface actionable errors. Legacy `.xls` remains conversion-only because the safe selected parser supports modern OOXML workbooks, not the older binary format. Key code: `src/components/members/import-members-csv-dialog.tsx` and `src/lib/memberships/import-workbook.ts`.

---

## Razorpay credential and webhook recovery safety

Razorpay credentials now cross one server-only, account-scoped connection boundary: browser roles have no table privileges, the manual key-paste flow uses an authenticated route, and downstream API calls accept either today’s Basic credentials or a future partner OAuth token without payment-logic changes. Webhook events use atomic claim/complete/fail states with attempt, lease, and error history; failures return a retryable response while completed duplicates remain no-ops. A service-only missing-ledger view and admin Payment-settings warning report charged events without mutating or replaying them. Migration `20260726090000` was applied through the Supabase connector; existing charged events were only reported for explicit approval. Key code: `src/lib/payments/credentials.ts`, `src/lib/payments/webhook-processing.ts`, `src/app/api/payments/razorpay/`, and `supabase/migrations/20260726090000_razorpay_payment_safety.sql`.

---

## Dashboard route authentication defense in depth

Every page in the `(dashboard)` route group is now covered by the proxy's early anonymous redirect, including Finance, Reports, and Get Started, while a server layout backstop independently validates the Supabase user before rendering dashboard content. A filesystem contract test keeps future dashboard pages synchronized with the proxy policy; authentication, invitation, onboarding, public capture, and tokenized routes retain their existing access. No schema change. Key code: `src/lib/auth/dashboard-routes.ts`, `src/proxy.ts`, and `src/app/(dashboard)/layout.tsx`.

---

## Storage and media access hardening

Storage API enumeration is closed across avatars, WhatsApp chat/flow media, and private payment/expense receipts: exact-object retrieval remains available, but `object.list` is not authorized. Chat/flow uploads, updates, and deletes now require authenticated agent capability plus the canonical tenant path; avatar writes remain authenticated and user-folder scoped; private receipt writes retain agent/admin capability and persisted-object deletion guards. Because Storage returns newly inserted object metadata, a follow-up user-folder- and operation-scoped avatar SELECT policy permits only upload metadata reads without reopening listing. Chat/flow media intentionally remain public because Meta fetches their persisted URLs asynchronously from persisted public URLs, so anyone with an exact URL can still retrieve an object; moving them private requires a separate delivery migration with evidence that expiring signed URLs remain valid for retries. Key code: `supabase/migrations/20260725230417_harden_storage_media_access.sql`, `supabase/migrations/20260726151441_allow_avatar_upload_metadata_returning.sql`, and `src/lib/storage/storage-policies-contract.test.ts`.

---

## Operational and external-mutation authorization

Automation and flow service-role routes now require fresh agent-level operational capability and scope every privileged parent lookup to the caller’s current account, so viewers cannot mutate or dispatch work and a removed author cannot reach an old tenant through `user_id`. WhatsApp/Meta sends, reactions, broadcasts, connection/configuration, embedded signup, lead-source connection, and template lifecycle calls now require the named operational or settings capability before any external call. No schema change was needed because migration `017` already has the matching account-membership RLS policies. Key code: `src/lib/auth/account.ts`, `src/app/api/automations/`, `src/app/api/flows/`, `src/app/api/whatsapp/`, and `src/lib/auth/operational-route-guards-contract.test.ts`.

---

## SECURITY DEFINER execution-grant hardening

Public-schema `SECURITY DEFINER` functions no longer inherit direct `PUBLIC`, `anon`, or `authenticated` execution. The migration closes postgres-owned default-privilege drift, revokes the current client surface, restores only internally authorized account/lead/finance/presence and opaque-token RPCs, and keeps AI retrieval, AI slot claims, and webhook failure accounting service-role-only; trigger and one-time maintenance helpers remain non-callable through the Data API. Key code: `supabase/migrations/20260725221657_harden_security_definer_execute_grants.sql` and `src/lib/auth/security-definer-grants-contract.test.ts`.

---

## Profile tenant and role isolation

Authenticated self-service profile updates can no longer change `profiles.account_id` or `profiles.account_role`. A narrow trigger rejects those direct Data API writes while preserving name, avatar, and appearance edits plus the existing audited `SECURITY DEFINER` member-management, ownership-transfer, invitation-redemption, and onboarding flows. Key code: `supabase/migrations/20260725161912_protect_profile_membership_fields.sql` and `src/lib/auth/profile-membership-fields-contract.test.ts`.

---

## Dashboard membership actions

The dashboard gives members a dedicated **Member work** section beside the lead workflow: due member follow-ups take priority, nearest upcoming work appears only when nothing is due, and the follow-up column mirrors Lead work with the same compact clickable rows, task summary, due state, assignee avatar, and direct completion control while opening the established member sheet in place. The adjacent list shows account-local memberships expiring in the next seven days; expired recovery remains in Members → Renewals instead of adding a dashboard switch and second query. Key code: `src/components/dashboard/membership-action-lists.tsx`, `src/lib/dashboard/follow-ups.ts`, and `src/app/(dashboard)/dashboard/page.tsx`.

---

## Dashboard lead conversion rating

The dashboard now groups its four direct-create quick actions immediately beneath the owner summary cards, before the daily lead-action queue. Dashboard Insights presents its existing chart rows, lead funnel, and recent activity as independent sequential sections, with no enclosing card, group heading, subtitle, or parent reports action. The wider first-response card remains on the left beside a compact, equal-height **Lead Conversion Rating** card on the right. Its independent 7/30/90-day control defaults to All leads, keeps a quiet source drill-down grouped with the duration control, and shows a larger accessible five-axis radar immediately beneath its rating for member conversion, trial booking, first human response, on-time follow-up, and positive recorded follow-up outcomes; the top-axis label sits close enough to read as part of the radar while remaining clear of the score, every unclipped axis label exposes a concise mouse-and-keyboard tooltip, and missing evidence keeps the score unavailable. Source volume remains only in Lead Funnel context, while weights, targets, period, denominator, confidence, and proxy details open from the tooltip-backed question-mark button beside the rating heading into the unchanged keyboard-accessible calculation dialog. Lead Funnel stage-age labels now keep their complete text on one aligned line. No schema change. Key code: `src/app/(dashboard)/dashboard/page.tsx`, `src/lib/dashboard/lead-conversion-rating.ts`, `src/components/dashboard/dashboard-insights.tsx`, `src/components/dashboard/lead-conversion-rating.tsx`, `src/components/dashboard/lead-funnel.tsx`, and focused aggregator tests.

---

## Dashboard creation quick actions

Dashboard **New Lead** and **New Member** now deep-link into the existing page-owned creation dialogs instead of stopping at their list pages. Their role capabilities still gate whether the form opens, while **New Broadcast** and **New Automation** retain their dedicated creation routes. Key code: `src/components/dashboard/quick-actions.tsx`, `src/app/(dashboard)/leads/page.tsx`, and `src/app/(dashboard)/members/page.tsx`.

---

## Dashboard conversation-range styling

The Conversations over time 7/30/90-day selector now uses the shared Toolbar segmented control without a call-site active-fill override. Range switching and chart data are unchanged. Key code: `src/components/dashboard/conversations-chart.tsx`.

---

## Always-visible dashboard insights

The dashboard's Insights & recent activity section now stays expanded, loads with the page, and no longer has Show/Hide accordion controls. Its existing charts, funnel, response analysis, activity feed, Owner reports link, and placement after the daily action areas are unchanged. Key code: `src/components/dashboard/dashboard-insights.tsx`.

---

## Local development origin parity

Next.js development resources now allow the `127.0.0.1` loopback host in addition to the server's default `localhost`, preventing HMR/assets from being blocked when the local app is opened by IP. Keep the allowlist development-only through `allowedDevOrigins`; production CORS is unchanged. Key code: `next.config.ts`.

---

## Dashboard first-contact cards

The dashboard's **Waiting for first contact** queue now presents leads as compact horizontal rows inside one bordered, divided list. Every row keeps the avatar, name, and latest-message preview aligned with the waiting-age badge anchored at the right. Phone numbers are no longer fetched or rendered, and leads without profile/message data use neutral text fallbacks. Key code: `src/components/dashboard/lead-action-lists.tsx`.

---

## Compact dashboard follow-ups

The dashboard lead-action queue now renders follow-ups as compact, divided rows inside one bordered list matching the adjacent first-contact queue: the task-type icon replaces its text label and sits directly beside the lead identity, with the optional note below; due state/date, a tooltip-labelled assignee avatar, and the same encapsulated circular completion control used by the profile timeline remain in one trailing action cluster. Clicking or keyboard-opening a row launches the existing full lead quick view with its established contact actions, while completion remains a separate direct action. The redundant Upcoming badge and full-width assignee footer are gone, reducing queue height without removing agent-critical context. Key code: `src/components/dashboard/lead-action-lists.tsx`, `src/components/follow-ups/follow-up-task-summary.tsx`, and `src/components/follow-ups/follow-up-completion-control.tsx`.

---

## Decision-first daily dashboard

The dashboard now separates owner decisions from frontline work: outstanding fees, upcoming renewals, attendance-risk members, and today’s collections versus the prior seven-day daily average lead the page; the actionable lead queue follows immediately and replaces historical open-lead/activity vanity metrics. Its lead follow-up list keeps due and overdue work first, then shows the nearest upcoming follow-ups only when nothing is due; future work does not inflate the “to clear” count. Attendance risk deep-links to the newly reachable Members → At risk worklist, where missed-visit and never-checked-in context leads directly to Follow-up. Existing funnel, source, conversation, response-time, and activity views remain available in collapsed Insights, while period analysis stays in Reports. Key code: `src/components/dashboard/`, `src/lib/dashboard/follow-ups.ts`, `src/lib/memberships/stats.ts`, and `src/app/(dashboard)/members/page.tsx`.

---

## Finance Payments table cleanup

Finance → Payments now keeps Name focused on the member’s name and phone, while Payment ID remains a separately sortable column using the same compact muted reference treatment as Finance → Invoices. The redundant gateway-reference sub-line is no longer stacked in the table cell; payment data, search, filters, sorting, exports, receipts, and member actions are unchanged. Key code: `src/components/finance/finance-payments.tsx`.

---

## Finance Invoices table simplification

Finance → Invoices now keeps Name focused on member identity, shows Member ID in its own sortable identifier column, and combines the plan name plus billing-period date range under Membership. Internal invoice references use compact muted typography without the redundant cycle badge. The redundant standalone Billing period and Payment status columns are gone; Balance remains the table’s due-money signal, while payment-state filtering and export data stay available. Key code: `src/components/finance/finance-invoices.tsx` and `src/lib/finance/invoices.ts`.

---

## Finance Expenses dialog key fix

Finance → Expenses now gives its add and void dialogs separately namespaced remount keys, eliminating the duplicate `closed` React key warning while preserving form reset behavior across dialog lifecycles. Key code: `src/components/finance/finance-expenses.tsx`.

---

## My Members search parity

Every searchable My Members tab now follows Attendance's substring search semantics across member name, Member ID, and phone. All Members and Follow-ups resolve numeric name/phone/ID matches without disturbing server pagination, filters, counts, bulk selection, or export; Payments and Attendance share the same matcher, and every affected field advertises name-or-ID search. Key code: `src/lib/memberships/search.ts`, `src/components/members/members-table.tsx`, `src/components/members/follow-up-lists.tsx`, `src/components/members/payments-table.tsx`, and `src/components/members/attendance-view.tsx`.

---

## Unified Attendance member search

Members → Attendance now uses one left-aligned shared search field for member name or Member ID, matching the search-first layout of the other Members lists. The separate Member ID entry and ID-specific check-in button are gone; staff select the filtered member row and keep using the existing row-level check-in/check-out and member-detail behaviors. Key code: `src/components/members/attendance-view.tsx`.

---

## Members payment-due queue cleanup

Members → Payments is now a single operational payments-due queue with its existing search, plan filter, sorting, **Due today** / **Overdue** quick filters, reminders, payment entry, and paging intact. The duplicate recent-payments switch, ledger query, history filters, and export were removed; payment history remains in Finance → Payments. Key code: `src/components/members/payments-table.tsx` and `src/components/members/payment-table-filters.tsx`.

---

## Focused payment-due urgency filters

Members → Payments now exposes exactly two counted urgency filters: **Due today** matches only balances whose due date is the account-local current date, while **Overdue** matches every balance past its due date without day-range splits. Future-dated balances remain visible in the unfiltered queue but no longer share a quick filter with due-today work. Key code: `src/lib/memberships/dues.ts`, `src/components/members/payments-table.tsx`, and `src/components/members/payment-table-filters.tsx`.

---

## Finance period navigation

Finance uses one calendar-month scope on every tab, now presented as **Today**, previous/next arrows, and a single localized Month Year label. Navigation remains bounded by account history and the current month, while historical deep links remain selectable. Finance tabs do not repeat the selected period in redundant page subtitles. The URL and every loader/export stay on the existing `month=YYYY-MM` contract; Day/Week remains a contextual chart control. Key code: `src/components/finance/finance-month-actions.tsx`, `src/components/finance/`, `src/lib/finance/overview.ts`, `src/lib/locale/format.ts`, and `src/hooks/use-auth.tsx`.

---

## Finance Expenses ledger

Shipped the approved Finance Expenses tab with ledger-backed Total expenses, Recurring, One-time, and Largest category cards; daily/weekly and category analysis; search, filters, classification quick views, sorting, paging, and complete CSV export; private receipts; and admin-gated add/void flows. Every expense is explicitly classified as recurring or one-time, while posted/void remains an audit state and void never becomes a primary KPI. The append-preserving domain, seeded tenant categories, RLS, RPC guards, and storage policies live in migrations `20260724090000` / `20260724093000`; Overview expense/profit integration and category settings remain pending. Key code: `src/components/finance/finance-expenses.tsx`, `src/components/finance/add-expense-dialog.tsx`, `src/lib/finance/expenses.ts`, and `src/lib/auth/roles.ts`.

---

## Finance Payments ledger

Shipped the analytical Finance Payments tab over the append-only ledger: account-timezone month/date scope, payment/member/gateway search, status/plan/method/source/recorder filters, live All/Collected/Auto-pay/Voided views, database-side sorting and pagination, exact filtered totals and method mix, full-result CSV export, private proof reuse, and member deep links. Its summary now follows the familiar Invoices pattern—four horizontal metric cards—with Collection mix kept only on Overview rather than duplicated here. The read-only `finance_payment_ledger` RPC is security-invoker, explicitly tenant-guarded, and authenticated-only; payment entry, dues, reminders, and future failed-AutoPay recovery remain in Members → Payments. Key code: `src/components/finance/finance-payments.tsx`, `src/components/finance/finance-payment-filters.tsx`, `src/lib/finance/payments.ts`, and migrations `20260723120000` / `20260723121000`.

---

## Finance Invoices master

Shipped the account-wide Finance Invoices tab over the reconciled `membership_period_invoices` read model: calendar-month summaries, search by internal billing reference/name/phone/Member ID, lifecycle chips, payment/plan/collection filters, shared sorting, paging, complete filtered CSV export, invoice detail reuse, and exact-period payment entry through the named agent-level `canRecordPayments` capability. The UUID-derived reference is explicitly an internal record reference; PDF/WhatsApp document actions remain deferred until an approved migration adds immutable human invoice identity and snapshots. Key code: `src/components/finance/finance-invoices.tsx`, `src/components/finance/finance-invoice-filters.tsx`, `src/components/finance/finance-month-actions.tsx`, `src/lib/finance/invoices.ts`, and `src/lib/auth/roles.ts`.

---

## Finance Overview foundation

Shipped a calendar-month Finance Overview matching the approved analytical mockup: Revenue with prior-month comparison, Next month projected from active renewals, day/weekly income cash flow, invoice health, collection mix, recent transactions, and admin-only CSV export. Expense and Profit slots deliberately stay unavailable until the expense ledger exists; no zeroes are fabricated. Operational dues, payment entry, reminders, server-paged history, filters, and complete filtered export are restored to Members → Payments, while Finance keeps URL-backed Overview/Invoices/Payments/Expenses tabs for phased delivery. Key code: `src/app/(dashboard)/finance/page.tsx`, `src/components/finance/`, `src/lib/finance/overview.ts`, `src/lib/finance/views.ts`, and `src/app/(dashboard)/members/page.tsx`.

---

## Localized phone input rollout

Shipped the localized `PhoneInput` across public capture, contact/member creation and profile edits, typed custom fields, lead bulk/inline/import editors, and WhatsApp template phone buttons. The visible field edits only the national number beside the fixed account dialling code, while the shared boundary helper preserves complete account-qualified values for persistence, dedupe, and WhatsApp. Localization's country-code setting and Meta's Phone Number ID remain ordinary identifier inputs. Key code: `src/components/ui/phone-input.tsx`, `src/lib/phone-input.ts`, contact/member form surfaces, and `src/components/leads/editable-cell.tsx`.

---

## Member-profile membership and billing hardening

Membership edits now preserve the live cycle snapshot unless staff actually change its plan or billing option. Profile lifecycle mutations require consequence-aware confirmation and role-gated affordances; renewal exposes existing arrears and localized expiry; payment entry validates overpayments inline and returns to its invoice when cancelled; edit returns to the refreshed profile; AutoPay copy matches the option price charged by the API; and Billing actions wrap cleanly on mobile. Key code: `src/components/members/member-detail-view.tsx`, `src/components/members/member-form.tsx`, `src/components/members/record-payment-dialog.tsx`, `src/components/members/renew-membership-dialog.tsx`, `src/components/members/set-up-autopay-dialog.tsx`, and `src/lib/memberships/edit-cycle.ts`.

---

## One-time lead conversion discounts

**Convert to member** now uses one responsive split layout with the missing mockup hierarchy restored: a divided header whose title uses the shared 18px semibold large-dialog treatment, a subordinate **Membership details** heading, and an expiry helper kept snug beneath the billing option. The left third contains click-to-edit **Personal information**, including Birthday and the account-configured Gender choices, localized body measurements, and the shared member photo editor on the avatar; lead status is intentionally omitted. Active inline editors expand to a full-width second line with a dedicated action column and `2` gutter, keeping their content clear of the shared save/dismiss controls in the narrow rail. The right two thirds hold plan, discount, and first-payment decisions, with every input label using the default shared `Label` treatment—no conversion-specific colour, weight, or size overrides. Its spacing now follows one roomier scale: `2` between labels and controls, `4` between sibling fields and within cards, and `6` between major sections and between each checkbox-section header and its revealed controls. The modal grows up to 96vh and caps at 900px, stacks on smaller screens, and omits conversion Notes. Discount and payment use matching unfilled checkbox sections. Enabling the offer defaults to the first segmented option, **Percentage**, with **Fixed amount** second; percentage mode offers shared-master 10%, 20%, and 30% quick-input chips beside the editable field. The shared `CurrencyInput` now gives its currency symbol a divided leading compartment across all consumers. Percentage discounts validate inline as greater than zero and no more than 100%, disable conversion while invalid, and retain submit- and database-level guards. The offer reduces only the initial invoice; the invoice preserves the regular price and discount breakdown for audit, while future renewals continue to use the plan option's normal price. Key code: `src/components/members/member-form.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/currency-input.tsx`, `src/components/contacts/contact-detail-content.tsx`, `src/lib/memberships/discount.ts`, and `supabase/migrations/20260721130000_add_conversion_discounts.sql`.

---

## All Members frozen Name column

The required **Name** column in All Members can now be frozen or unfrozen from its shared column-header menu. The per-user, per-account choice persists in the existing `members-all` table preferences; freezing Name also pins the leading selection checkbox. Both sticky body cells use the opaque `bg-card-2` hover fill rather than translucent `bg-muted/50`, so horizontally scrolled text cannot bleed through while the hover still matches the row. Other member columns remain non-freezable. Key code: `src/components/members/members-table.tsx`.

---

## Account-wide Member IDs

Every membership now receives a database-assigned numeric **Member ID** starting at 1001, unique within its account, immutable, never reused, and intentionally stable across future branches. Existing memberships backfill oldest-first and every insert path shares one private per-account counter. All Members gained a visible, sortable, resizable, hideable Member ID column plus CSV output; the profile header exposes the number; and Attendance accepts staff quick check-ins by ID through the existing limit/override flow while auditing `method='member_id'`. Member ID is an identifier, not a login secret. Supabase grants new public-schema functions directly to its API roles, so trigger-only functions need explicit `anon`/`authenticated` revokes. Key code: `supabase/migrations/20260721120000_member_numbers.sql`, `supabase/migrations/20260721121000_harden_member_number_functions.sql`, `src/components/members/members-table.tsx`, `src/components/members/attendance-view.tsx`, and `src/components/members/member-detail-view.tsx`.

---

## Unified search and filter toolbars

Data-list toolbars now use one reading order—Search, Filters, Sort, divider, filter chips, then trailing view/scope actions—with All Members as the canonical layout. `ChipGroup` keeps every chip set on one horizontally browsable row: overflow stays clipped with a peeking final chip and contextual previous/next chevrons instead of wrapping. Filter chips use the same compact nested count badge as segmented Expiring/Expired controls; All Members and Payments gained live faceted chip counts, while Leads and both follow-up queues moved their existing counts into the shared treatment. The Leads table/board picker is icon-only, and its current-day quick view is labelled **Today**. Key code: `src/components/ui/badge.tsx`, `src/components/ui/chip.tsx`, `src/components/members/members-table.tsx`, `src/components/members/payments-table.tsx`, `src/components/follow-ups/follow-up-queue-controls.tsx`, and `src/app/(dashboard)/leads/page.tsx`.

---

## Pill-shaped Sort and Filters actions

Page-level Sort and Filters actions now share the fully rounded outlined `Button` pill variant across Leads, Members, follow-up queues, Payments, Inbox, and Broadcast recipients. Active sorts/filters use the account-primary tint, while inactive actions stay neutral; column-header menus remain unchanged. Key code: `src/components/ui/button.tsx`, `src/components/leads/leads-sort.tsx`, and the shared filter components.

---

## Leads quick views

The redundant **First response** tab has been consolidated into **All leads**, where URL-backed counted chips now provide **No follow-up**, **Unassigned**, **Mine**, and **Today** views across the table, board, bulk selection, and CSV export. With no chip selected, the complete lead list is shown. **No follow-up** means a New lead with no currently open follow-up; its filtered PostgREST anti-join deliberately ignores completed tasks. **Unassigned** excludes Lost leads and pending teammate assignments, while **Today** uses the account timezone. Key code: `src/app/(dashboard)/leads/page.tsx` and `src/lib/leads/quick-filters.ts`.

---

## Shared search width

The master `SearchInput` now owns a fixed 240px wrapper width, so Leads, Members, Attendance, follow-up queues, Inbox, member import, and Manage Columns stay aligned without page-level width overrides. Key code: `src/components/ui/search-input.tsx`.

---

## Hover-revealed sidebar scrollbar

The primary sidebar navigation now uses the shared `ScrollArea`: its slim themed scrollbar is rendered only when the navigation overflows and fades in while the rail is hovered, focused, or actively scrolling. The Inbox conversation list keeps the master component's existing always-visible default. Key code: `src/components/ui/scroll-area.tsx` and `src/components/layout/sidebar.tsx`.

---

## Repeating follow-up reminder ringtone

Unread `follow_up_reminder` notifications now drive a dashboard-wide subtle ringtone: one minute of six-second pulses, five minutes silent, repeated for at most one hour after delivery. Reading the notification stops it through the existing realtime `read_at` flow, including from another open tab/device; reopening the app resumes only the current phase of still-unread reminders. Inbox and reminder tones share one gesture-unlocked Web Audio context and use generated sounds with no licensed asset. Key code: `src/hooks/use-follow-up-reminder-ringtone.ts`, `src/lib/notifications/reminder-ringtone.ts`, and `src/lib/notifications/notification-sounds.ts`.

---

## Live Inbox dot and message chime

The sidebar now keeps its Inbox unread dot visible anywhere in the app, including while Inbox itself is active, and plays a short generated two-note chime for each realtime inbound customer message. The sound uses Web Audio rather than a licensed asset and arms after the first pointer or keyboard interaction to respect browser autoplay rules; messages received before that remain visual-only. Key code: `src/hooks/use-total-unread.ts`, `src/lib/notifications/notification-sounds.ts`, and `src/components/layout/sidebar.tsx`.

---

## Attendance member columns

The Attendance register now keeps member identity in the canonical **Name** column and shows the membership plan in a dedicated **Plan** column immediately after it. Plan visit-limit usage remains visible in that Plan cell, and its canonical column menu now provides the same plan-value filter as All members. Key code: `src/components/members/attendance-view.tsx`.

---

## Profile follow-up activity parity

The shared profile timeline now includes standalone follow-ups created from row actions, including tasks with no optional note; note-linked tasks remain attached to their authored note, and all entries sort newest-first. Standalone and note-linked tasks now share one follow-up-first card hierarchy: task and due date, optional note, then created/assigned metadata. The profile section is canonically labelled **Notes & follow-ups** across lead and member surfaces. Key code: `src/components/contacts/contact-notes-thread.tsx` and `src/lib/follow-ups/profile-activity.ts`.

---

## Follow-up outcome constraint repair (migration `20260719220919`)

Lead follow-ups can again be completed with **Contacted** or **Trial booked** in databases that retained migration `036`'s member-only outcome constraint. The idempotent repair migration reasserts the full shared outcome list and the done-requires-outcome invariant; a contract test now keeps the UI choices aligned with the SQL constraint. Key code: `src/lib/memberships/follow-ups.ts`, `src/lib/memberships/follow-ups-outcome-contract.test.ts`, and `supabase/migrations/20260719220919_repair_follow_up_outcome_constraint.sql`.

---

## Manual follow-up creation parity

Lead and member action rows now share one `FollowUpButton` (`ListPlus` + **Follow up**) and one standalone create dialog/copy across All leads, First response, All members, Renewals, Trials, and Inactive. Manual creation is limited to that row dialog and the profile **Notes & follow-ups** composer; bulk Add note is note-only again. Lead creators omit member-only Reason chips and always persist the neutral `other` sentinel, while member creators retain contextual Reason choices. Key code: `src/components/follow-ups/follow-up-button.tsx`, `src/components/follow-ups/follow-up-dialog.tsx`, `src/components/follow-ups/follow-up-fields.tsx`, and `src/components/contacts/contact-notes-thread.tsx`.

---

## Collapsible desktop navigation rail

The primary desktop sidebar can now collapse from 240px to a 64px icon rail without affecting the mobile drawer. Width, labels, badges, and the account footer transition together; compact navigation keeps unread/onboarding indicators and exposes every destination through right-side tooltips. The active state and full account menu remain available in both modes. Key code: `src/components/layout/sidebar.tsx`.

---

## Semantic colour foreground consistency

Coloured product text and icons now resolve through one adaptive foreground token per hue: its `-500` fill primitive blended 45% toward the live page foreground, following the themed-text contrast model and clearing WCAG AA over 10% subtle tints in both modes. `text-destructive` aliases the same red token, subtle primary treatments use `text-primary-text`, and badges/panels no longer pick ad hoc shades. Stored lead-status picker hex values resolve back to the exact semantic Badge variant, so a red lead status and a red fixed status share both foreground and tint primitives; arbitrary custom hex keeps the accessible derived fallback. Tremor's `-500` data-mark palette remains the explicit non-semantic exception. Key code: `src/app/globals.css`, `src/components/ui/badge.tsx`, `src/lib/semantic-colors.ts`, `src/lib/semantic-color-foregrounds.test.ts`.

---

## WhatsApp settings layout

The WhatsApp connection status and embedded-signup flow now use the full settings-panel width. The step-by-step Meta setup guide moved into the Manual setup accordion, where it sits beside the credential form on desktop and stacks below it on smaller screens. The split grid stays padded inside the accordion panel because its animation clips overflow and Card edges are outer rings. Key code: `src/components/settings/whatsapp-config.tsx`.

---

## Lead/member follow-up queue parity

The Leads and Members Follow-ups tabs now share `FollowUpQueueControls`: search, due/owner filters, sorting, live counted due buckets with tooltip definitions, and My work/Team scope behave the same in both contexts. Both tables now also provide persisted column visibility/widths, header sort/filter menus, row and all-matching selection, context-aware bulk completion, inline reassignment, and pagination. Member-only Reason/reminder behavior and lead-only Status/Stage age columns stay contextual. Key code: `src/components/follow-ups/follow-up-queue-controls.tsx`, `src/components/follow-ups/follow-up-filters.tsx`, `src/components/leads/lead-accountability-view.tsx`, and `src/components/members/follow-up-lists.tsx`.

---

## Live lead accountability refresh

Lead edits made in the shared detail sheet now re-fetch the active Follow-ups or First response queue through the same page-level invalidation path as All leads and the board. Follow-up creates, edits, completions, and deletions from the Notes section also notify that path. Key code: `src/app/(dashboard)/leads/page.tsx`, `src/components/leads/lead-accountability-view.tsx`, and `src/components/contacts/contact-detail-content.tsx`.

---

## Follow-up task-cell parity

Lead and member follow-up tables now share `FollowUpTaskSummary` (`src/components/follow-ups/follow-up-task-summary.tsx`): the **Follow-up** column renders the task-type icon, task label, and optional note with one hierarchy. Member rows additionally retain their member-only neutral Reason badge; lead queues remain reason-free.

---

## Search input interaction contract

The shared `SearchInput` (`src/components/ui/search-input.tsx`) is now a controlled semantic search field with contextual accessible names at every call-site, a mobile Search keyboard action, Escape-to-clear, and a trailing clear button that appears only for editable non-empty values and returns focus to the field. Leads, Members, Attendance, accountability queues, Inbox, member import, and Manage Columns all inherit the same behavior.

---

## Sales accountability (migration `20260719080908`)

Leads now has separate **Follow-ups** and **First response** tabs, each with My work / Team scopes. Follow-ups contains only open scheduled work (overdue, due today, or upcoming); First response contains leads still in New and highlights the 24-hour response target plus missing follow-ups. Queue counts live inside the filter chips, their definitions appear after a 1-second hover delay (and immediately on keyboard focus), and Unassigned is a real filter—no persistent summary-card row. The tabbed header uses the canonical bottom divider and 24px content separation. An open lead follow-up is the accountable owner/source of truth. Completing one requires a structured outcome, including contacted and trial booked. Key code: `src/components/leads/lead-accountability-view.tsx`, `src/lib/leads/accountability.ts`, `src/components/follow-ups/complete-follow-up-dialog.tsx`, and `supabase/migrations/20260719080908_sales_accountability.sql`.

---

## Member churn risk (migrations `068`–`069`)

Staff can mark a member as a churn risk from a dedicated profile-rail card below BMI. The flag defaults off, uses the existing agent-write contact RLS, and appears as a Yes/No column in All members (including CSV export). Migration `069` removes the initially shipped churn-risk note field so member context stays in the existing Notes section. Key code: `churn-risk-card.tsx`, `members-table.tsx`, `068_member_churn_risk.sql`, `069_remove_churn_risk_note.sql`.

---

## Milestone 1 — the renewal wedge (migration `031`) · built

Members = a **top-level nav section** (`/members`) whose home is the Renewals action lists. Contacts stays the raw people+inbox table.

- **Renewals tab** (`renewal-action-lists.tsx`) — two vertically stacked tables (Expiring in 7 days · Expired), borrowing the All-members table look. Each row carries Assign / Renew / Remind.
- **Expired table has a lookback filter** (30d / 3mo / 6mo / All time — client-filtered over the full expired set; default 30d = freshest chase targets).
- Payment-due moved off Renewals onto its own Payments tab.
- Plans managed at Settings → Membership plans.
- Key code: `src/app/(dashboard)/members/page.tsx`, `src/components/members/*`, `src/components/settings/plans-settings.tsx`, `src/lib/memberships/expiry.ts`.

---

## Early Phase-2/3 features (migrations `032`–`038`, `043`–`045`)

- **Attendance** (`032`) — check-in records; later gained plan limits + override (`062`/`063`).
- **Renewal reminder cron** (`033`, `src/app/api/renewals/cron`) — went hourly with a per-account 09:00-local send window in `055`; now filters `collection_mode='manual'` (see auto-pay dunning). Scheduled via GitHub Actions (Vercel Hobby has no sub-daily crons). Details: `docs/renewal-reminders.md`.
- **Payment-due buckets** (`034`) · **trial memberships** (`035`) · **member activity** (`037`) · **account UPI + copy-UPI-link** (`038`).
- **Follow-ups** (`036`, `043`–`045`) — assignable tasks with task types, due-date presets, account-tz reminder slots, and an optional link to the authoring note. **One OPEN task per contact** — cancel a note's open task before deleting the note. Notes live on the lead/contact detail sheet with author avatars, edit-in-place, and drafts.

---

## Leads module (migrations `039`–`042`)

Lead records on top of `contacts`: DB-driven lead status funnel (hex-coloured statuses), source/gender fields, per-account editable lead field options, custom fields with input types + formatting, inline edit actions. Table = draggable/resizable/freezable columns; board = kanban by `lead_status`.

**Sort.** Real `contacts` columns sort server-side via `.order(sortColumn)`. Everything else sorts **client-side** in `fetchContacts`' `clientSort` branch (`ClientSort = custom | person | tags`): pull all filtered lead ids → build a per-lead sort key → order the whole set (`compareCustomValues`: numeric types numerically, else lexical/`localeCompare`; imported dates are ISO so text order = chrono; blanks last) → fetch only the page's rows. Key source per kind — **custom** = the field's `contact_custom_values` value; **person** = the uuid column (`assigned_to`/`created_by`, on `ColumnDef.clientSort`) resolved via `nameById`; **tags** = each lead's alphabetically-first tag name (one account-scoped `contact_tags` read). A column is sortable if `sortColumn || isCustom || clientSort`.

**Per-column value filter.** Every filterable column's three-dot menu carries an Excel-style **Filter** submenu (`DropdownMenuSub` → `DropdownMenuItem`s with an always-visible left checkbox + `closeOnClick={false}`, so multi-select is obvious).

- **Built-in** columns map to a shared `LeadFilters` dimension via `columnFilterConfig` (status→`leadStatus`, source→`source`, gender→`gender`, tags→`tags`, assignee→`assigned`, received_by→`owner`, created_by→`createdBy`) — so the column filter and the global Filters panel are **one source of truth, no drift**.
- **Custom fields** of type text/number/currency (`CUSTOM_FILTER_TYPES`; email/phone/url/date excluded) filter too — distinct stored values load into `customFilterOptions`, selections live in `LeadFilters.customValues`.
- Free-text built-ins (name/phone/email/company/dates) omit the item.
- **Id-based filters** (tags + custom values) resolve to contact-id sets and **intersect** in `resolveContactIdFilter`; `applyLeadFilters`' `idFilter` param does `.in('id', …)`. Used by the table, select-all, and CSV export.

**Bulk actions** (`bulk-*.tsx`) — row multi-select shows a toolbar below the search bar that animates open/closed (`Collapse`; the count is frozen mid-collapse so it can't flash "0").

- **Edit** → `BulkEditDialog`: pick one property (status / assignee / source / gender / company / any custom field), set it, apply to all. (Assign is folded in here as "Assigned to" — no separate Assign button.)
- **Delete** → confirm + `.in('id', ids)`.
- **Add note** → `BulkAddNoteDialog`. Notes batch-insert and the surface stays note-only; manual follow-ups belong to a person's row action or profile Notes composer.
- **Convert to member** → `BulkConvertDialog`: plan + start date → one `active` membership per lead. Converted leads drop off the list (leads anti-join memberships).
- **Reuse note:** these dialogs' value pickers use `DropdownMenu` + `Badge`/`SourceIcon`/`UserAvatar` in the trigger, not `ui/Select` — its item padding differs. (Its old raw-value-echo reason is gone since the Jul 2026 items-derivation fix.)

---

## Leads CSV import 2.0 (Jul 2026 · `PRDs/import_leads_ux.md`)

`ImportWizard` (`components/contacts/import-wizard.tsx`) is **variant-parameterized**: `variant="contacts"` keeps the original 3-step flow; `variant="leads"` runs 4 steps — Upload → Map columns → **Preview & edit** → Confirm.

Leads additions: lead-field mapping targets (`buildLeadTargets` in `field-mapping.ts`; raw cell text rides on `MappedRow`) · searchable grouped field picker (`ui/combobox.tsx`) · heuristic type detection on inline field-create + per-column `DD/MM` chip for ambiguous date columns (`detectFieldType` / `detectDateOrder`) · an **editable preview grid** rendered with the leads table's own renderers (`import-preview-grid.tsx`; caps at 200 rows _shown_, all imported) · the **Fix values panel** — value-level remapping with row counts, fuzzy auto-match, and a remap log feeding the Confirm receipt + result audit.

Coercion engine = `src/lib/leads/import-coerce.ts` (pure, tested): option/assignee matching, `buildPreviewRows`, `applyValueFix`. **Commit consumes the edited `PreviewRow[]`**, not a mapping re-run. Insert payload extends with `lead_status`/`source`/`gender` and `assigned_to` (a mapped assignee overrides importer-as-owner; updates never null ownership).

**Gotcha:** unknown option values import as slugs and render as muted pills via `humaniseKey` — safe by design.

---

## Import → pending-teammate assignment (migration `049`)

The Fix-values panel can assign leads to a teammate who **doesn't exist yet**: an admin picks "Invite '<name>' as a teammate", which find-or-creates an `account_invitations` row (role `agent`, `full_name` set) — **reusing the invite system, not a parallel pending-staff table**.

Because `contacts.assigned_to` is FK→`auth.users(id)` and a pending invitee has no auth user, the parked assignment lives in **`contacts.pending_invitation_id`** (+ denormalized `pending_assignee_name` so non-admin agents can render it without reading the admin-only invites table). `assigned_to` stays the importer as the **fallback owner** — revoke/expire → the lead degrades to the importer, never ownerless.

Leads render "Invite pending · name" via `PendingAssigneeDisplay`. Resolve a pending owner → real member **inline** (assignee cell), by **filter** ("Assigned to" lists pending invitees, values `pending:<id>`), or in **bulk** — all clear the overlay. On redeem, `redeem_invitation` reassigns the parked leads to the joiner (assign-to-self → the notify trigger's self-guard suppresses the flood).

Copy/rotate a shareable link at Settings → Team → Pending invitations (`POST /api/account/invitations/[id]/link` — tokens are hash-only, so each copy rotates and invalidates the prior link). Sentinel `PENDING_ASSIGNEE_PREFIX` in `import-coerce.ts`.

**Scope:** pending owners are import-created only (not manually assignable from the normal picker) and don't count in round-robin/stats until they join.

---

## Three distinct ownership facts (don't conflate)

| Fact                              | Column                 | Rule                                                                                                     |
| --------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| origin **channel**                | `received_via` (`048`) | immutable                                                                                                |
| original human **creator**        | `created_by` (`051`)   | set once at insert, frozen on update by trigger `lock_contact_created_by`; read-only "Created by" column |
| current **owner** ("Received by") | `user_id`              | transferable via the `050` flow                                                                          |
| current **assignee** (delegate)   | `assigned_to`          | reassignable; approval-gated for non-owners via `052`                                                    |

### Lead ownership transfer (migration `050` · `PRDs/lead_ownership_transfer.md`)

**Ownership = the "Received by" human = `contacts.user_id`** — NOT `assigned_to`. Only **human-received** leads (`received_via` NULL/manual/import) are transferable; system-generated captures (whatsapp/meta/api/automation) are locked (RPC + UI both enforce).

- **Managerial (owner/admin):** transfer moves `user_id` instantly; new owner notified.
- **Peer handoff (agent):** transferring a lead they OWN opens an accept-gated request. `user_id` flips only when the target accepts — **never ownerless** (decline/cancel/supersede leave the current owner holding).

One entry RPC `request_lead_transfer` decides instant-vs-pending by role; `respond_lead_transfer` / `cancel_lead_transfer` complete it. All three SECURITY DEFINER; `lead_transfers` is SELECT-only from clients. State machine `pending → accepted/declined/cancelled/superseded`; `uniq_lead_transfer_pending` = one pending per lead.

Because ownership moves via `user_id`, the `notify_lead_assigned` trigger doesn't fire — the RPCs notify the new owner explicitly on admin-instant + admin-force-accept (a self-accept needs none). `notifications.reference_id` drives inline Accept/Decline on `/notifications`.

UI lives on the **Received-by column** (table cell + detail row): owner picker to start a transfer, `TransferPendingDisplay` overlay + Accept/Decline/Withdraw menu while pending, `TransferRequestDialog` for the agent note step. `lead_transfers` is on realtime so the overlay updates live. Predicates: `canReassignLeadsDirectly` (admin) / `canRequestLeadTransfer` (agent+) / `canResolveAnyLeadTransfer` (admin). Client lib `src/lib/leads/transfers.ts`.

### Lead assignment approval (migration `052`)

A SECOND flow on the **"Assigned to" column** (the delegate, distinct from ownership). The owner (`user_id`) or an admin change it **instantly**; **any other agent's change → a request the OWNER must approve** (approver = the owner OR any admin — _not_ the target, unlike ownership transfer). Applies to any change including unassign.

Reuses `lead_transfers` via a `kind` column (`'ownership' | 'assignment'`) + `approver_user_id`; `to_user_id` is now nullable (unassign); one pending per `(contact_id, kind)`. RPCs: `request_lead_assignment` / `respond_lead_assignment` / `cancel_lead_assignment`.

Instant + approve paths write `assigned_to`, so the existing `notify_lead_assigned` trigger notifies the new assignee **for free**; the pending request notifies the **owner** (`lead_assignment_request`; 4 new notif types). Bulk assign loops the RPC per lead so agents can't bypass.

**Deferred:** account-wide pending-transfers console, auto-expiry cron.

---

## Leads board parity (Jul 2026)

The board (`leads-board.tsx`) honours the shared **Filters panel** — `fetchBoard` runs `resolveContactIdFilter` + `applyLeadFilters` and is sequence-guarded like the table; the Filters button renders in **both** views. (Sort / Edit columns stay table-only: filters constrain the _data_, those are table _presentation_. Without this a table-set filter kept applying to CSV export while invisible from the board.)

Cards mirror the table row compressed: name + hover-reveal ⋮ menu (View/Edit/Delete — same page handlers as the table row menu) · phone/company · 2 tag pills + "+n" · footer = source glyph + compact created date vs the **owner slot** (assignee `UserAvatar`, or an amber pending chip for an in-flight ownership transfer / assignment approval / pending invite — same precedence as the table cells, so a lead mid-handoff can't look normal on the board; the `lead_transfers` realtime channel bumps `boardNonce` too). Board rows are tag-enriched (`BoardLead = Contact & {tags?}`; one account-scoped `contact_tags` read, no id list in the URL). Whole-board empty state matches the table's.

**Drag perf** is load-bearing and the FLIP animation is deliberately kept — the full render structure + the two traps (context re-render fan-out; optimistic state must not live on the page) are documented in `docs/ui-patterns.md` → Animation → Kanban board.

**Board settings (Tier 1).** A gear shows in board view (fused right of the view picker; opens the shared `ViewSettingsSheet` switched on `view`). Two knobs — the board's peers of the table's page-size/cell-wrap:

- **card density** — `comfortable` shows company + tags + source/date footer; `compact` = name/phone/owner only.
- **sort within column** — `newest`/`oldest`/`name`/`updated` (replacing the hard-coded newest-first; `sortColumnLeads`; reorder animates via the FLIP).

Both persist in the SAME `table_preferences` `'leads'` blob under a `board:{density,sortWithin}` sub-object (no new migration; `useTablePrefs` shallow-merges the default in). The board island bumps `updated_at` optimistically so the `updated` sort reflects a drop instantly.

**Board settings (Tier 2).** `board.collapseEmpty` (Switch): hides 0-count status columns **at rest** but reveals every column **mid-drag** (`collapseEmpty && !activeLeadId`), so an empty stage stays a valid drop target. `handleDragEnd` still validates against `allColumns`; only `displayColumns` is filtered. (Hide-specific-status-columns was skipped — redundant with the Filters panel's status dimension.)

**Deferred (Tier 3):** **group-by** — pivot the board on source / assignee instead of status. A real feature with a drag-semantics decision (dragging would set the grouped dimension: a direct source-write vs the approval-gated `requestLeadAssignment`), not a lightweight pref. Gender is intentionally excluded as a group dimension.

---

## Persisted table views (migration `053`)

The leads table's column state now persists **per-user, per-account** in `table_preferences`. Was a single global `localStorage` key — per-browser, account-agnostic, bled across accounts, no cross-device. New hook `useTablePrefs`; see `docs/ui-patterns.md` → Tables.

---

## Members parity pass (Jul 2026, migration `054`)

The Members module caught up with the leads-era infrastructure.

**All-members table rebuilt** (`members-table.tsx`) — server-paginated (`fetchSeq` guard, `.range()`, `contacts!inner` embed so search hits `contacts.name/phone` server-side; name sort via PostgREST embed-order `contact(name)`). Toolbar **Sort** (reuses `LeadsSort` — it's generic) + **Filters** (`members-filters.tsx`: plan / derived status / fee_status) + **CSV export** of the filtered set. Sort + pageSize persist via `useTablePrefs('members-all')`. Filter definition = pure `applyMemberFilters` (`lib/memberships/filters.ts`, tested) shared by table / select-all-matching / export.

**Bulk actions** (leads `Collapse` toolbar + frozen-count + select-all-matching): bulk WhatsApp remind (confirm dialog; `sendRenewalReminder` extracted from `send-reminder-button.tsx` for single+bulk reuse) · bulk note/follow-up (reuses leads' `BulkAddNoteDialog` — it gained a `noun` prop; selection is a `Map<membershipId, contactId>` because notes key by contact) · bulk record-payment / mark-paid (`bulk-record-payment-dialog.tsx`, per-row inserts + `.select('id')` tallies).

**Member detail gains the real notes thread** via the extracted `ContactNotesThread` (`onFollowUpChanged={refreshAll}` keeps the sheet's follow-up bar in sync). Legacy one-line `memberships.notes` stays as-is.

**Realtime:** `members/page.tsx` subscribes one `member-lists` channel on `memberships`/`payments`/`attendance` (published in `054`) → trailing-debounced `reloadKey` bump; all member tabs refresh live.

**Members CSV import** now mirrors the Leads four-step experience (Upload → Map columns → Preview & edit → Confirm) behind one header **Import** action; the old “Import from leads” branch is gone. `member-field-registry.ts` is the single contract for both All Members columns and import participation, with only database-generated Member ID and UI Actions allowed to opt out. The tolerant parser and mapping engine handle BOM/CRLF, quoted multiline cells, camelCase/vendor aliases, account-qualified phones, DMY/MDY/ISO/month-name/Excel dates, localized money, plan/billing aliases, profile units, tags, typed custom fields, assignees, statuses, and partial/full payments. Paid rows create real ledger entries through `record_membership_payment`; fee status remains database-derived. Existing members and in-file phone duplicates are previewed/skipped, while matching non-member contacts are safely enriched without overwriting auto-captured ownership. Key code: `src/components/members/import-members-csv-dialog.tsx`, `src/components/members/import-members-preview.tsx`, `src/lib/memberships/member-field-registry.ts`, and `src/lib/memberships/import-commit.ts`.

Also in this pass: the "View existing" dedupe link resolves contact→membership (`lib/memberships/lookup.ts`) and opens the detail sheet; person renders route through `UserAvatar`.

**Column machinery** (added later in Jul 2026): the All-members table gained the leads-style per-column header (sort + three-dot menu + resize + persisted layout) via the shared `ColumnHeader`. The required Name column can be frozen together with the selection checkbox; other columns remain non-freezable and drag-reorder stays intentionally skipped.

---

## Member detail sheet 3.0 (Jul 2026, migration `056`)

The wide sheet (`data-[side=right]:w-full` + `data-[side=right]:sm:max-w-[min(1200px,calc(100vw-2rem))]` — fills the viewport up to a 1200px cap rather than leaving dead space beside inner scrollbars) gained a jump-nav + BMI rail + full profile/settings.

> **⚠️ Sheet-width gotcha.** `ui/sheet.tsx` sets `data-[side=right]:w-3/4`, and a call-site's bare `w-full` does **not** beat it — tailwind-merge only dedupes utilities of the _same variant_, so an override of a `data-[side=*]:`-prefixed class must carry the same prefix. (The existing `max-w` comment said this; the `width` half was missed and silently pinned every sheet to 75vw.)

**Responsive:** the body is `lg:grid-cols-[minmax(640px,1fr)_310px]` — the 640px floor lives on the **grid track**, and the content column is `min-w-0` (a raw `min-w-[640px]` would also apply on mobile and force the whole sheet to scroll sideways). Below `lg` it stacks single-column with the BMI rail at the bottom; below `sm` the header actions take their own full-width row, and the Billing invoice table drops its Paid/Balance/Cycle columns + stacks the period into a two-line numeric range (every dropped fact is in `InvoiceDetailDialog`, which the row opens).

**Structure:** identity header over a `bg-muted/20` scroll body. A **sticky jump nav** (`ui/tabs.tsx` `variant="line"`, controlled by `activeSection`) scrolls to `#sec-<id>`; a scrollspy `IntersectionObserver` (`root` = the scroll body, `rootMargin: "-56px 0px -60% 0px"`) lights the active tab; each `<Section>` carries `scroll-mt-14`.

Sections: **Membership** (its `⋯` menu carries lifecycle actions — **Change plan** first, then Edit · Freeze/Resume · Cancel/Reactivate) **· Billing** (id `payments` — the invoice table + auto-pay setup; see `docs/gym-domain.md`) **· Notes** (`ContactNotesThread`) **· Attendance** (promoted from the old rail widget to a full section) **· Communication · Personal info · Settings**.

- **Communication** (`member-communication.tsx`) is a **template-send log, deliberately NOT a chat.** Owners talk to members on WhatsApp directly; a full embedded `MessageThread` was built and then **reverted as overkill** — if ever wanted again, the thread is fully host-agnostic and needs only ~150 lines of host glue. It answers "what did the system send, when, did it land": finds the member's conversation by `contact_id`, loads `messages` where `content_type='template'` + `sender_type in (agent,bot)` (newest-first, cap 50), renders Type / Channel / Subject / Status. Type = the reason from `TEMPLATE_REASONS` (`gym_renewal_reminder` → "Renewal reminder"; unknown templates humanise their name) with the send `fmt.dateTime` beneath; Status = a delivery badge (read/delivered/sent/failed → success/info/neutral/danger). Header "Open in Inbox" → `/inbox?c=<id>`. Template sends store `content_text=null`, so Subject comes from the reason map.
- **Personal info** (`member-personal-info.tsx`) — an editable form over the `056` contact columns, one Save. `name` stays a single field; gender reuses `GENDER_OPTIONS`.
- **Settings** (`member-danger-zone.tsx`) — Delete member only (Merge deferred).

**The rail is BMI-only** (`bmi-card.tsx`, `lg:sticky lg:top-16`), replacing the old Follow-up + Visits widgets (follow-ups still live inside the Notes thread). Pure lib `src/lib/bmi/bmi.ts` (`computeBmi` = kg/m², WHO zones, `bmiGaugeFraction`, cm↔ft-in / kg↔lb — tested); hand-built SVG+CSS-transition gauge `bmi-gauge.tsx` (no gauge dependency; honours reduced motion). Height/weight store **metric-canonical** on `contacts.height_cm/weight_kg` (a future Vitals section reuses them); imperial accounts (`locale.measurementSystem`) enter/read ft-in/lb, converted on save. **Standard BMI ignores gender/age** — neither is a BMI input. Missing measurements → an "Add measurements" empty-state (gated `canSendMessages`).

**Delete** = the `delete_member(contact_id)` RPC (SECURITY DEFINER) — re-checks owner/admin **server-side** (stricter than the agent-level `contacts_delete` RLS), purges the `payments` ledger (its FK is SET NULL, not cascade), then deletes the contact (cascading membership/attendance/notes/follow-ups). UI gate = `canDeleteMember` (admin+).

**New `contacts` columns (`056`):** `height_cm, weight_kg, date_of_birth, nickname, address_line1/2, city, state, postal_code, country` (all nullable; reuses the existing `name/phone/email/gender`).

---

## Inbox

### Member/lead segregation (Jul 2026, no migration)

`CONVERSATION_SELECT` (`lib/inbox/conversations.ts`) embeds `memberships(id)` under the contact; `normalizeConversation` flattens it to a derived `Conversation.isMember` (**no new column**). `ConversationItem` renders a `Badge` — `success` "Member" / `neutral` "Lead" — and the filter dropdown gained Members / Leads options (same list-filter path as unread/status).

### Contact panel = the lead detail surface (Jul 2026, no migration)

The inbox's right panel was a **separate, stale fork** of the lead detail sheet: read-only tag badges, a pre-refactor note box that **failed silently** on an RLS block, a hand-rolled avatar, a byte-for-byte copy of `copyPhone`, and an "ACTIVE DEALS" block for the **retired** pipelines feature (`/pipelines` just redirects to `/leads`; the `deals` table survives untouched but nothing reads it).

It now mounts the **same `ContactDetailContent`** the `/leads` sheet does (widened 280px → 360px, `details` collapsed, `chat`+`template` actions dropped). `ContactDetailView` is now a ~50-line Sheet wrapper; the old `contact-sidebar.tsx` body was deleted. Full prop contract: `docs/ui-patterns.md` → Contact / lead detail surface.

The page gained `handleContactUpdated` (re-pulls `activeContact` + bumps `resyncToken`) so an edit in the panel can't leave a stale name in the thread header or conversation list.

**Opened on demand.** The panel starts **closed** — selecting a conversation opens the chat and nothing else. It's revealed by clicking the contact's **avatar** (conversation row → selects that conv AND opens; thread header → opens) or the header's panel toggle, and once open it's **sticky** (follows whichever conversation you select until you close it). Deliberately **not persisted** — it used to default `true` and round-trip through a `wacrm:inbox:contact-panel-open` localStorage key, so a stored `true` would have defeated the new default. That key is gone.

> **⚠️ Why the conversation row is a plain `<div>`.** Making the row avatar clickable forced the row off `<button>` (a button may not nest a button). It is a plain clickable **`<div>`, NOT `role="button"`** — exactly the leads board card's shape: the div's `onClick` is the pointer convenience and the **name is the real `<button>`** carrying the keyboard/AT path. `role="button"` was tried first and is **wrong** — ARIA forbids focusable descendants inside a button, and the nested avatar's `aria-label` got absorbed into the row's accessible name, which read _"Open Mohit's profile Mohit Lead about 1 hour Welcome and…"_.

Both inbox avatars (row + thread header) now route through `UserAvatar` — the thread header's previously rendered a bare initial and ignored `contacts.avatar_url` entirely.

**Mobile (`<lg`):** the same surface opens as an overlay Sheet via `ContactProfileSheet`. Gated in JS on `useMatchMedia`, **not CSS** (a Sheet portals to `<body>`). `useMatchMedia` was promoted out of `flow-editor-shell.tsx` into `src/hooks/use-match-media.ts`.

---

## Billing periods / invoices (Jul 2026, migration `057`)

Recurring members get a real per-cycle invoice trail (Paid/Unpaid/Upcoming) instead of a single mutated membership row. New `membership_periods` table + `membership_period_invoices` view + `lib/memberships/periods.ts`; the member-detail Payments section became a badged, clickable invoice list with an `InvoiceDetailDialog`.

Full pattern (birth trigger, TS lifecycle, reconcile-by-`period_end`, TS-derived status, projected Upcoming) → `docs/gym-domain.md`.

Backfilled current + past-paid cycles from the ledger.

**Still deferred:** auto-generating/charging _future_ invoices (a billing cron — overlaps UPI AutoPay) · persisting the Upcoming projection · per-cycle fee history for backfilled rows (their fee = Σ paid).

---

## Payments hardening (Jul 2026, migrations `20260711173414` + `058`)

The ledger became DB-authoritative and tamper-resistant: trigger-derived `fee_status`, validated inserts, idempotent transactional RPCs, append-preserving voids, private receipt bucket, protected financial fields behind a tx-local GUC. Plus a reconciliation UX pass (who recorded each payment, per-method totals, CSV export, Full/Half chips, capped `paid_on`).

Full rules → `docs/gym-domain.md` → Payments ledger.

---

## Notes ownership (migration `046`)

Author-owned edit/delete + admin moderation. The rule (enforce in BOTH RLS and UI, via a `roles.ts` predicate) lives in `CLAUDE.md`.

---

## Motion animation layer (Jul 2026)

`motion/react` + reusable primitives. First call-sites: kanban cards fly between columns (FLIP), the leads bulk toolbar collapses via `Collapse`, the notes list + `/notifications` animate via `MotionList`, dashboard KPI tiles stagger-in + count-up via `AnimatedNumber`. Primitives + the two hard gotchas → `docs/ui-patterns.md`.

Motion+ "AI Kit" (paid dev-tooling) was evaluated and **not adopted** — only the free MIT lib is in use.

---

## Account-level localization (Jul 2026, migration `055`)

The product adapts to each gym's geography end-to-end. The pattern (columns, `src/lib/locale/*`, `useLocale()`, presets-only geography, tz helpers) is a **rule** and lives in `CLAUDE.md`.

Shipped in the same change: signup country picker (preset → `handle_new_user` metadata) · Settings → Localization section (country picker re-applies the preset; live format preview; currency stays shared with Payments & currency — same column) · the renewal cron went **hourly** with a per-account 09:00-local send window + locale-formatted `{{3}}`/`{{4}}` template params (the manual Remind button matches; `REMINDER_SEND_HOUR_LOCAL` in `renewal-reminders.ts`) · follow-up reminder slots resolve in the account tz · payment day-picks stamp via `dateAtNoonInTz` (the noon-UTC anchor was removed) · check-in/summary "today" windows via `dayStartInTz` · `formatCurrency` gained a `locale` grouping param (en-IN → ₹1,00,000) · `formatCustomFieldValue` gained `localeTag` (+ a plain-date UTC-shift fix) · `lib/dates/format.ts` (`formatDay`) was **deleted** — every render goes through `fmt.date` · `loadGymStats(db, today, timeZone)`.

**Deferred:** dashboard chart internals (`lib/dashboard/date-utils.ts` is still browser/server-local + Monday-first — cosmetic, charts only) · phone default-region parsing (placeholders/hints are dynamic, but a bare local number still needs an explicit country code — libphonenumber deferred) · reminder-slot 12h labels are fixed-English · a WhatsApp template's `language` is still the template's own.

---

## WhatsApp Embedded Signup (Jul 2026, no migration · `PRDs/multi_gym_saas_prd.md` §7)

Self-serve WhatsApp connect via Meta's **Facebook Login for Business** popup, replacing token-paste as the default.

Client `components/settings/whatsapp-embedded-signup.tsx` loads the FB JS SDK (`FB.login` with `config_id`, `response_type:'code'`, `sessionInfoVersion:'3'`; a `WA_EMBEDDED_SIGNUP` window-message carries `waba_id`+`phone_number_id`, the login callback carries the auth code) and POSTs both to `/api/whatsapp/embedded-signup`: `exchangeEmbeddedSignupCode` (`meta-api.ts` — code → non-expiring business-integration token) → `verifyPhoneNumber` → `registerPhoneNumber` with a random 6-digit PIN (best-effort; the error is parked on `last_registration_error` like the manual route) → `subscribeWabaToApp` → encrypt + upsert **the same `whatsapp_config` row shape** (no schema change; webhook demux by `phone_number_id` unchanged). Cross-account phone-claim check mirrors `/api/whatsapp/config`.

UI: the ES card is the primary CTA in `whatsapp-config.tsx`; the manual credential form moved into a "Manual setup (advanced)" accordion (default-open only when the ES env vars are absent — the card self-hides then).

Env: `META_APP_ID`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`; app secret reused.

**Gotchas:** the popup only completes for app admins/testers until Meta grants Advanced Access (`whatsapp_business_messaging/management`, `business_management`) · the app domain must be whitelisted in FB Login for Business settings · the FB SDK version is pinned to `META_API_VERSION` (`v21.0`).

---

## UPI AutoPay (Jul 2026, migrations `059`, `060` · `PRDs/upi_autopay.md`)

Razorpay UPI AutoPay / Subscriptions, per-gym credentials, one shared ledger for auto + manual. Verified end-to-end on live data (2 cycles auto-charged, membership rolled, retry a no-op, overpay still blocked in system mode).

Full architecture, the service-role GUC bypass, the webhook account guard, and the dunning fallback → `docs/gym-domain.md` → UPI AutoPay.

---

## Mid-cycle plan change / upgrade (Jul 2026, migration `061`)

Member sheet → Membership `⋯` → Change plan. Pro-rated credit for unused paid days. Verified end-to-end on live data (a ₹999-paid 30d cycle → a ₹3999 plan on day 8: old invoice 266.40 / paid 999 / balance 0, new invoice 3266.40 settled).

Math + RPC contract → `docs/gym-domain.md` → Mid-cycle plan change.

---

## Plan types + pricing options (Jul 2026, migration `062`; `063` = usage RPC + plan-type lock)

PushPress-style plan restructure: `recurring` / `non_recurring` / `session_pack`, each plan selling N billing options (duration × price). Settings → Membership plans rebuilt; canonical `PlanOptionPicker` mounted in member-form / renew / change-plan / import; check-in gained warn-with-override limit enforcement; the renewal cron + Renewals lists + autopay all route through `isRenewalChaseable(plan)`.

Backfill: every plan got one day-unit option mirroring its legacy scalars; memberships + current periods were pointed at it. Verified via a rollback DO-block on live: calendar clamp (Jan 31 → Feb 28 → Mar 28), no-setup-fee renewal, idempotent retry, pack auto-renew rejection.

Full model, `PLAN_COPY`, and the RPC-param gotcha → `docs/gym-domain.md`.

---

## Lead capture: public forms + Meta lead ads (Jul 2026, migration `064`)

Closes Phase 2's last gap — until now a lead could only be _typed in, imported, or waited for_. Two inbound paths, one shared foundation.

**Sequenced deliberately.** Meta needs App Review for `leads_retrieval` + `pages_manage_metadata` (weeks; resubmitting can re-queue the already-approved WhatsApp permissions). Forms have no such gate, so forms ship live and the Meta path sits **dark behind an unset `NEXT_PUBLIC_META_LEADS_CONFIG_ID`** — the card doesn't render until review clears.

**Shared foundation.** `findOrCreateContact` (`src/lib/api/v1/contacts.ts`) gained optional `receivedVia` + `source` on `ContactInput` (not positional args → zero call-site churn; the public API still defaults to `'api'`, guarded by a test). New `addContactTags` — additive, unlike the sibling `setContactTags`, which _replaces_ and would wipe a lead's existing tags on a second enquiry.

- **Auto-captured leads land UNASSIGNED and ownership-LOCKED.** `user_id` = `resolveAuditUserId()`; `assigned_to` stays NULL (no round-robin exists, and setting it would fire `notify_lead_assigned` at someone who never agreed to own the lead). The lock is **free**: `050:137` / `052:93` already refuse a transfer when `received_via NOT IN ('manual','import')`, so adding `'form'` inherited it with zero SQL. Assignment still works via the approval-gated `request_lead_assignment`.
- **Both paths always write a `contact_notes` row — on create AND on dedupe.** Without this a repeat enquiry from a known number is _completely invisible_: `findOrCreateContact` returns the existing row, `received_via` still reads `'manual'`, and no automation fires.
- Both fire `new_contact_created` themselves. The trigger existed but was dispatched from exactly one place (the WhatsApp webhook) — nothing fires it for you.
- Goal answer → a **tag**, not a new column (`GOAL_OPTIONS` in `leads/attributes.ts`). Keeps the blast radius at seven tags instead of ~8 files.

**Capture forms** (`/f/<token>`, `src/app/f/`, `src/app/api/lead-forms/`). Bare top-level segment like `/join` — no `proxy.ts` change (`protectedPaths` is a prefix allowlist). Fixed field set, no builder. The submit route is **the product's only unauthenticated write**; defence order is rate-limit → honeypot → Turnstile → validate → write.

- **The form token is PLAINTEXT, on purpose.** `account_invitations` hashes its token because that one grants _membership_, and pays for it by rotating on every copy. A form token grants no read of anything and lives in an Instagram bio, so it must be re-copyable. Revocation = `is_active` / rotate. Don't "fix" this.
- **The honeypot returns 200, never 400** — a distinct status tells a bot which field is the trap.
- **Success body is identical whether the contact was created or deduped**, or the endpoint becomes a free "is this number a lead at that gym?" oracle.
- `lead_capture_submissions` snapshots `consent_text` per row (DPDP needs proof of _what_ was agreed, not just that it was) and is `ON DELETE SET NULL` on `contact_id` — deleting a lead must not destroy its consent record. Service-role writes only; no client INSERT policy.
- **Turnstile fails CLOSED in production** when `TURNSTILE_SECRET_KEY` is unset (503). The per-IP limiter is an in-memory Map, per-lambda — on Vercel's fan-out it's a speed bump, **Turnstile is the wall**.

**Meta lead ads** (`src/app/api/meta/leads/`). Leadgen arrives on the **`page`** object, which gets its own callback URL + verify token — it cannot ride the WhatsApp webhook. Needs a **second FBLB config** (the WhatsApp Embedded Signup config is fixed-permission; page scopes can't be bolted on). `loadFbSdk` extracted to `src/lib/meta/fb-sdk.ts` so `FB.init` still runs once.

- **Processes INLINE, not in `after()`** — a deliberate divergence from the WhatsApp webhook. Once you've 200'd, Meta never retries, so a failure afterwards loses the lead _forever_. Work first, let the status code tell the truth: on failure return 500 and Meta retries for up to 36h.
- **Claims each lead in `webhook_events`** (`meta:leadgen:<id>`, the Razorpay `ignoreDuplicates` pattern) and **DELETEs its own claim on failure** — otherwise the retry is deduped away into silence. `064` had to `GRANT DELETE ON webhook_events TO service_role`; `059` granted only SELECT/INSERT/UPDATE. Pass `gateway:'meta'` explicitly — the column defaults to `'razorpay'`.
- **Always long-lived-swap the user token first.** Page tokens inherit the lifetime of the token they came from: from a short-lived one they die in ~1h and ingestion stops _silently_.
- Field mapping (`leads/meta-field-mapping.ts`) is three tiers — key-normalize → alias table → **shape fallback** (looks like an email / a phone). Custom question keys are arbitrary (derived from the question text), so a gym asking in Hindi still gets its leads.
- **Email-only leads are SKIPPED, and counted.** `contacts.phone` is NOT NULL and a phone-less lead is unreachable on the WhatsApp wedge. Settings surfaces "N leads skipped — your Meta form doesn't ask for a phone number", which the gym can actually fix in Ads Manager.

**The phone trap (`normalizeSubmittedPhone`, `leads/capture-form.ts` — used by BOTH paths).** A visitor types 10 local digits; `isValidE164` _happily accepts_ a bare `9876543210`, so it stores looking clean and is then un-messageable on WhatsApp forever — silently breaking the whole wedge, on the happy path. So the account's dial code is prefixed unless the input is explicitly international. Watch the guard for `'9198765432'`: a real 10-digit Indian number that merely _starts_ with `91` and must not be mistaken for one already carrying the country code.

Verified against live: bare 10-digit → stored `919876543210`; dedupe → 1 contact / 2 submissions / 2 notes / identical response body; honeypot → 0 rows; 6th submit → 429; revoke → `revoked`; Meta handshake fails closed (403); tampered signature → 401; failed ingest → 500 **with the claim rolled back**; pre-claimed redelivery → 200 no-op.

---

## Lead delete — admin-any + agent-owns-their-own (migrations `065`, `066`)

Deleting a lead is gated by the **authored-content ownership rule**, enforced in BOTH layers:

- **owner/admin** → delete any lead (incl. auto-captured + teammates').
- **agent** → only a lead THEY created via a human action — `created_by = self` AND `received_via` is human (NULL/`manual`/`import`). Auto-captured leads (whatsapp/meta/api/automation/form) and other people's leads are off-limits.
- **viewer** → never.

Two predicates in `src/lib/auth/roles.ts`: `canDeleteAnyLead(role)` (admin+, the managerial tier) and the per-lead `canDeleteLead(role, {createdBy, userId, receivedVia})` (imports `isHumanReceived` from `leads/attributes`). NOT a `useCan` action — it's per-lead, so call the predicate directly with the row's facts. `065` first tightened `contacts_delete` RLS agent→admin; `066` is the live policy: `is_account_member(…,'admin') OR (…,'agent' AND created_by = auth.uid() AND received_via IS NULL/IN('manual','import'))`. Member deletion unaffected (SECURITY DEFINER `delete_member` RPC, `056`, bypasses RLS).

- **New affordance:** "Delete lead" destructive button pinned below the scroll area in the shared lead sheet (`contact-detail-content.tsx`) — shows on BOTH the leads page sheet and the inbox contact panel off the one component. Confirm `Dialog`; delete chains `.select('id')`, treats zero rows as failure (RLS-silent-fail gotcha); on success → `onUpdated()` + `onClose()`.
- **Every delete path gated by the same predicate** (no UI-only gate): leads table row-action + board card menu compute `canDeleteLead` per-row (board threads `accountRole` + reuses `currentUserId` through `LeadCardContext`, split out of the agent-level `canEdit` that still gates Edit). `handleDelete`/`handleBulkDelete` now `.select('id')` — bulk reports "N deleted · M skipped (you can only delete leads you created)" since RLS silently filters an agent's mixed selection. Bulk button stays agent+ (`canEdit`); RLS is the real filter.

---

## Reminder-blocker dialog + template presets

Two small UX gaps on the renewal wedge's setup path.

- **Remind button explains itself.** `SendReminderButton` was disabled-with-a-title-tooltip when WhatsApp/template aren't ready — invisible on touch, easy to miss. Now the blocked button stays clickable (dimmed) and opens a dialog with the reason **and a deep-link CTA to the fix** (`/settings?tab=whatsapp` or `?tab=templates`). `ReminderReadiness` gained a `resolution: {label, href} | null` set by the hook; no-phone is a per-member blocker with no CTA. Covers every call site (payments buckets, renewal + trial action lists).
- **Template presets** (`src/lib/whatsapp/template-presets.ts`). Ready-made gym templates that pre-fill the New Template form — renewal reminder (the pinned `gym_renewal_reminder`, name locked so the Remind/cron wiring can't be renamed away), payment receipt, payment due, welcome, class booking (Utility); win-back + festival offer (Marketing, flagged as needing opt-in). Written to pass Meta review (transactional Utility copy, contiguous `{{1}}…` with 1:1 samples → clears `validateTemplatePayload`). Surfaced via a "Start from template" gallery dialog + empty-state CTA in `template-manager.tsx`; picking one drops its copy into the create form to customise + submit.

---

## Data deletion — Meta callback + account erasure (migration `066`)

Closes the App Review gap: Meta requires a Data Deletion Request URL, and there was no data-subject erasure path.

- **Meta Data Deletion Request Callback** — `POST /api/meta/data-deletion` (nodejs runtime). Parses + HMAC-verifies Meta's `signed_request` via `src/lib/meta/signed-request.ts` (signature is over the **encoded** payload segment, not the decoded JSON; rejects non-`HMAC-SHA256`, missing `user_id`, empty secret — colocated test). Fails closed with no `META_APP_SECRET`. Records a `data_deletion_requests` row and returns `{ url, confirmation_code }`. Set this route as the app's "Data Deletion Request URL" in the Meta dashboard.
- **Public status page** — `src/app/data-deletion/page.tsx` (`force-dynamic`, unauthenticated; the confirmation code is the capability). `?code=` → looks the request up with the service role and shows status; no code → deletion instructions (doubles as the "Data Deletion Instructions URL"). Note: FB Login here only grants business assets — we store no FB _profile_ keyed by ASID, so a callback usually has no profile PII to erase.
- **Account erasure** — `DELETE /api/account`, owner-only (`canDeleteAccount`, already existed) + exact account-name confirmation in `{ confirm }`. Deleting the `accounts` row cascades every `account_id` FK (all tenant Platform Data incl. encrypted `whatsapp_config` tokens); the two things Postgres FKs don't reach — Supabase Storage media (`account-<id>/` prefix across `chat-media`/`flow-media`/`profile-avatars`) and members' `auth.users` login identities — are purged explicitly (self deleted last). Admin-client delete chains `.select('id')` and treats empty as failure (RLS-silent-write gotcha).
- **`data_deletion_requests` table** (`066`) — audit log for both flows. **No FK to accounts on purpose** (an `ON DELETE CASCADE` would erase the trail the erasure creates). RLS enabled, **zero policies** → service-role-only.
- **UI trigger** — `AccountDangerZone` (`src/components/settings/account-danger-zone.tsx`) renders at the bottom of Settings → Members, **self-gated to owner** via `useCan('delete-account')` (returns null otherwise). Type-the-account-name-to-confirm dialog → `DELETE /api/account` → hard-nav to `/` (proxy bounces the now-unauthenticated session to sign-in).

---

## Get Started onboarding checklist (migration `067`)

PushPress-style setup guide for freshly created gyms: a `/get-started` page + sidebar item showing 6 auto-detected setup steps (connect WhatsApp, approve `gym_renewal_reminder`, first plan, first member, first paid payment, invite staff), a progress bar, and a "recommended next action" hero card deep-linking each step (`/settings?tab=…`, `/members`).

- **State lives in ONE place** — `OnboardingProvider` (`src/hooks/use-onboarding-status.tsx`), mounted in `dashboard-shell.tsx` inside `AuthProvider`. Sidebar badge (`N/6`) and page share the fetch. Pure derivation (step defs, done-rules, recommended-next) is `src/lib/onboarding/steps.ts` + colocated test.
- **Zero cost for mature accounts.** Provider short-circuits (no queries) unless admin+ AND `accounts.onboarding_dismissed_at IS NULL` (`067`, nullable timestamptz; existing 017 `accounts_update` RLS already covers the write — no new policy/predicate). When all 6 steps are detected complete the provider **auto-stamps the column once** (ref-guarded, `.select('id')` RLS-silent-fail check) — the sidebar item disappears forever; `/get-started` stays reachable and shows an all-done card. Explicit "Hide this page" button = same write early.
- **Failed fetches can never auto-dismiss**: `deriveOnboardingSteps` treats null signals (failed roster/invite fetches) as incomplete, so `allDone` is only ever affirmative.
- **Refetch-on-visit without setState-in-effect**: the provider keys its effect on `pathname.startsWith('/get-started')`, so landing on the page (e.g. returning from a completed step) refreshes state — the page itself never bumps a nonce in an effect.
- **New `ui/progress.tsx` master component** (user-approved): determinate track+fill (`bg-muted`/`bg-primary`, progressbar aria). First consumer is the setup guide header.
- Non-admins hitting the URL get a friendly "setup is handled by admins" card (no redirect). Row/tile anatomy copied from `settings-overview.tsx`; done-state = a filled emerald circle (see the card-hover section below — the original brand-tinted icon + outline tick was reworked).

---

## Card interaction states — neutral hover, `--border-hover` (no migration)

Triggered by a real clash: the onboarding step rows tinted their leading icon `bg-primary-soft`/`text-primary` and their done-tick emerald. **`emerald` is a shipped accent theme** — so a gym on that accent saw pending rows and done rows in the same green. Brand and status collapsed into one colour.

- **New token `--border-hover`** (`globals.css`, mapped as `--color-border-hover` → `hover:border-border-hover`). **Mirrors intent per mode, not direction**: darkens on light (`0.922 → 0.87`, ≈gray-200 → gray-300), **lightens on dark** (`0.28 → 0.36`). Darkening on dark would push the edge toward the card fill (`0.18`) and dissolve it — the card would read as _losing_ its border on hover. Same logic `--card-2` already uses.
- **Card hover = border only.** The fill no longer moves; `hover:bg-*` is gone from every clickable card. Deliberately **neutral, never accent-tinted** — that's what caused the clash. Rule → `docs/ui-patterns.md`.
- **17 cards / 13 files converged onto one hover**, retiring two competing idioms (`hover:border-primary-soft-2 hover:bg-card-2` and the older `hover:bg-muted/60`).
- **Four hovers never fired.** `flows:375`, `automations:280`, both `appearance-panel` cards: `hover:border-border` while already resting at `border-border` = no-op. `notifications:306` had `hover:border-border/70` — _weaker_ on hover. All now respond.
- **`gym-metrics.tsx` `TileLink` was dead too** — its child is a `Card`, whose edge is `ring-1 ring-foreground/10`, **not a border**. `[&>div]:hover:border-primary/50` targeted a border that doesn't exist. Retargeted to `hover:[&>div]:ring-border-hover`; those dashboard tiles have hover feedback for the first time.
- **Onboarding rows**: leading icon → neutral `bg-muted text-foreground` on every step (done or not); trailing done-tick → filled `size-5` emerald circle + white `Check` (`strokeWidth={3}`), replacing the `size-4` `CheckCircle2` outline. `CheckCircle2` still used by the all-done card.
- Selected/active states keep their `primary` tint — only the _unselected_ hover went neutral. Untouched on purpose: tag pills, dashed dropzone, icon-circle buttons, table rows, canvas nodes, destructive/red.
- `StepRow` (`get-started-view.tsx`) and the settings status tile (`settings-overview.tsx`) are **byte-identical boxes** — visual twins that must change together.
- Verified: `tsc` + eslint clean, `next build` green, and both utilities confirmed in the emitted CSS (`.hover\:border-border-hover:hover{border-color:var(--border-hover)}`, `…ring-border-hover:hover>div{--tw-ring-color:var(--border-hover)}`).

---

## Provider branding in integration settings

Added a shared compact provider-mark component (`src/components/brand/provider-mark.tsx`). WhatsApp uses a grayscale mark beside the settings menu label and its brand-green mark beside the panel heading; Razorpay payments and Meta lead ads use theirs in the relevant card title. Provider colours stay separate from semantic status and action iconography.

---

## Gym-first expense category presets

New branches now receive a refined ten-category gym expense catalogue, with **Staff salaries & trainer payouts** replacing the generic Salaries label and **Software & subscriptions** added. Existing active untouched Salaries presets are renamed, Software & subscriptions is backfilled once, previously unseeded branches receive the complete catalogue, and renamed or archived categories are never recreated. Key code: `supabase/migrations/20260820162727_refine_gym_expense_category_presets.sql` and `20260820163041_complete_unseeded_expense_category_catalogues.sql`.
