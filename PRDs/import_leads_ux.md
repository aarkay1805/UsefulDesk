# Import Leads — UX & Engineering Design

> Status: **Built (Jul 2026)** — the §9 checklist shipped as designed; this
> doc is now the reference for how the flow works. Key code:
> `src/components/contacts/import-wizard.tsx` (variant prop, 4-step flow),
> `src/components/leads/import-preview-grid.tsx` (preview grid + Fix values
> panel), `src/lib/leads/import-coerce.ts` (coercion/detection engine),
> `src/components/leads/lead-cell-renderers.tsx`, `src/components/ui/combobox.tsx`.
>
> Original approval: 4-step wizard with a new
> editable **Preview & edit** grid, full lead-field mapping (status / source /
> gender / assignee). Inspired by HubSpot's contact-import flow — we keep the
> good parts (per-column sample preview, "choose or create a property", an
> editable table you can fix before committing) and drop the over-engineered
> parts (object-type selection, email-as-unique-id scare banner).
>
> **v2 (Jul 2026):** triaged the full 16-page HubSpot walkthrough
> (`PRDs/HubSpot Contact Import - UX Walkthrough & PRD for Jim CRM.pdf`)
> feature-by-feature — see §11 for the adopt/adapt/skip table. Headline
> additions: a **value-level "Fix values" panel** (fix each bad status/source
> once, applied to every row — answers old open-question #1), **type-ahead
> search** in the field picker, **heuristic field-type detection** when
> creating a custom field inline, results **summary tiles**, and a sample CSV
> template link. Interactive prototype of the whole flow:
> https://claude.ai/code/artifact/cbc7360a-18d0-4a32-9afe-75f58f084c69

## 1. Why

Gyms live in WhatsApp + Excel. The single biggest onboarding moment is "I have
a spreadsheet of 300 leads — get them in." Today `ImportWizard`
(`src/components/contacts/import-wizard.tsx`) imports **contacts** well but:

1. **Can't map lead fields.** Targets are phone/name/email/company/tags/custom
   only. A lead export with Status / Source / Gender columns (exactly the
   HubSpot screenshot we studied) loses those or dumps them as raw custom text.
2. **No editable preview.** The Review step shows counts + a consent checkbox.
   The owner can't *see the leads table they're about to create* and fix a
   mis-mapped status or a wrong source before it lands.

This design closes both. It reuses the existing pure mapping engine
(`src/lib/contacts/field-mapping.ts`) and the leads table's own cell renderers
so the preview looks **identical** to `/leads` — that is the feature.

## 2. Non-goals

- **CSV only.** No XLSX/Google-Sheets parsing. Other formats → a one-line hint
  linking a free "convert to CSV" utility. (Decided.)
- No new object types (we import one thing: a lead = a `contacts` row).
- No new DB columns / migration — `lead_status`, `source`, `gender`,
  `assigned_to` already exist on `contacts`.
- No AI column mapping, no dedupe-by-email. Phone stays the identity key.

## 3. What we keep from the current wizard (reuse, don't rebuild)

| Capability | Lives in | Keep as-is |
|---|---|---|
| CSV parse (quoted cells, BOM-safe) | `parseCsvRaw` | ✓ |
| Auto-map by header synonyms | `autoMapColumns` | ✓ (extend synonym table) |
| Per-column sample values ("Preview Information") | `samples` memo | ✓ |
| Create custom field on the fly | wizard `handleSaveField` | ✓ |
| Mapping validation | `validateMapping` | ✓ (extend) |
| Row structuring | `applyMapping` → `MappedRow` | ✓ (extend, see §6) |
| Dedupe by phone (in-file + vs DB) | `dedupeByPhone`, `findExistingContact` | ✓ |
| Import modes add/update/both | `handleImport` | ✓ (move UI to Confirm) |
| `received_via:'import'`, importer as owner | `handleImport` insert payload | ✓ |

## 4. Flow

Rename entry point on the Leads page to **Import Leads** (button already there:
`import-wizard` import in `src/app/(dashboard)/leads/page.tsx`). Same component,
parameterized by variant (see §7).

```
Step 1  Upload CSV        dropzone (unchanged) + "other format? convert first" hint
Step 2  Map columns       existing table + green "Mapped" check + lead-field targets
Step 3  Preview & edit    NEW — renders as the leads table, cells editable, per-row flags
Step 4  Confirm & import   mode (add/update/both) + consent + final counts
```

`StepIndicator` grows from 3 → 4 labels: Upload · Map · Preview · Confirm.

### Step 1 — Upload (minimal change)
- Keep the dropzone. `accept=".csv,text/csv"` already correct.
- Add sub-text: "Exported from Excel or Google Sheets? Save as **.csv** first."
  with a link to a converter (external — open in new tab). No in-app conversion.
- **Sample CSV template** download link (one static file with the canonical
  headers: Name, Phone, Email, Status, Source, Gender, Assigned to). For the
  paper-register gym starting its first sheet. (HubSpot P2, adopted — ~free.)

### Step 2 — Map columns (extend)
Layout unchanged (File column · Sample data · Field dropdown), plus:
- **Green "Mapped" check** per row (steal from HubSpot) — lit when the column is
  mapped to a real target, muted dot when "Don't import". Drive off the mapping
  array; near-free.
- **Lead-field targets** in the dropdown, grouped, with **type-ahead search**
  (a search input pinned at the top filters across all groups; "Create new
  field…" stays pinned at the bottom — HubSpot's searchable picker, adopted):
  - *Standard*: Name, Phone\*, Email, Company
  - *Lead*: **Status**, **Source**, **Gender**, **Assigned to** (NEW)
  - *Tags*
  - *Custom fields* (+ Create new field…)
- **Heuristic field-type detection on inline create** (HubSpot's "scanning
  column data…", minus the AI): when the user picks "Create new field", scan
  the column's values with `detectFieldType()` (§5.3) and pre-fill the
  create-field form — label from the header, type from the samples, and for
  low-cardinality columns the distinct values as dropdown options. User
  confirms or edits before committing; never silently created.
- **Date-order chip** (replaces HubSpot's global date-format confirm step):
  when a column maps to a date-type custom field and the samples are
  ambiguous (`03/07/…`), show a small inline `DD/MM ▾` chip on that mapping
  row. Defaults to DD/MM (India); toggling re-renders the samples live.
  Unambiguous samples (a `13/…` day) auto-resolve and show no chip.
- Auto-map synonyms for the new targets:
  - status: `status, lead status, stage`
  - source: `source, lead source, channel`
  - gender: `gender, sex`
  - assignee: `assigned to, owner, assigned, rep, agent`
- Keep the phone-required + no-duplicate-target validation.
- **Drop** HubSpot's "No unique identifier" banner. Replace with a calm inline
  note under the phone row: *"Leads are matched by phone number — duplicates in
  your file and existing leads are handled automatically."*

### Step 3 — Preview & edit (NEW — the centrepiece)
A grid that **renders through the leads table's own column renderers**, so it is
visually identical to `/leads`: `Badge` status pills (hex colours via
`fieldOptions.statusFor`), `SourceIcon`, gender label, `UserAvatar` for
assignee, custom-field formatters (`formatCustomFieldValue`).

- **Columns shown** = the mapped targets, in the leads table's canonical order,
  with Name + Phone always first.
- **Every cell is editable inline**, reusing the same editors as the leads table
  (`EditableCell` + the status/source/gender/assignee dropdown pickers). Edits
  mutate the **in-memory preview only** — no DB writes until Step 4.
- **Per-row status chip** on the left:
  - `New` — will be inserted (green)
  - `Update` — matches an existing lead by phone (only in update/both mode; cyan)
  - `Skip · no phone` — greyed, excluded, not editable (amber)
  - `Skip · duplicate in file` — greyed, excluded (amber)
- **Unknown option values flagged amber** — e.g. a Source cell "Boxing" that
  matches no option. Clicking an amber cell opens the **Fix values panel**.
- **Fix values panel (v2 — the HubSpot steal).** A slide-in panel that groups
  every unmatched status/source/gender value **by distinct value, not by
  row**, with a row count per value ("Not Interested — 40 rows"). Fixing a
  value once applies to every row carrying it. Contents per field:
  - One card per distinct unmatched value: the raw text, its row count, and a
    picker of the account's real options (status options render as their
    coloured pills).
  - **"Auto-match remaining"** button: best-guess via `coerceOptionValue`'s
    fuzzy pass (case/punctuation-insensitive label match, e.g. "insta" →
    Instagram); anything still unresolved stays amber for manual pick.
  - A **live counter** of affected rows that drains as values are fixed
    (40 → 12 → 0) and flips green at zero — HubSpot's error counter, adopted.
  - Every fix is recorded in a session **remap log** (`raw → resolvedKey`,
    count) that feeds the Confirm receipt and the post-import audit line.
  - Unfixed values still import safely (stored as slug, muted pill — §5), so
    the panel never blocks Next. Rationale: at 300-row scale one bad source
    label can appear 80× — per-cell fixing is 80 clicks, per-value is 1.
- **Header summary**: `42 leads · 3 skipped (no phone) · 2 duplicates · 5 unmatched values`
  — the unmatched-values chip opens the Fix values panel.
- **Large files**: render up to `PREVIEW_CAP` (e.g. 200) rows; above that show
  "Showing first 200 of 420 — all will be imported." Edits/flags still computed
  for every row. (Windowing optional; correctness must not depend on it.)

ASCII sketch:
```
Preview — 42 leads · 3 skipped · 2 dupes · 5 unmatched values
┌────────┬────────────┬──────────────┬─────────┬──────────┬────────┬──────────┐
│  flag  │ Name       │ Phone        │ Status  │ Source   │ Gender │ Assigned │
├────────┼────────────┼──────────────┼─────────┼──────────┼────────┼──────────┤
│ ● New  │ Uma        │ 9646029209   │ [New ▾] │ [Ref. ▾] │ [F ▾]  │ [— ▾]    │
│ ● New  │ ahmed      │ 9888325155   │ [New ▾] │ [Insta▾] │ [M ▾]  │ [Aakash] │
│ ● New  │ pardeep    │ 8827211280   │ [New ▾] │ ⚠Boxing  │ [M ▾]  │ [— ▾]    │ ← fix
│ ⊘ Skip │ (no phone) │ —            │  … row greyed, excluded                 │
└────────┴────────────┴──────────────┴─────────┴──────────┴────────┴──────────┘
```

### Step 4 — Confirm & import
- **Move the mode radio here** (add / update / both) — Map is about columns,
  Preview about data, Confirm about the write policy. `dontOverwriteEmpty`
  toggle stays with update/both.
- **Consent checkbox** (unchanged — WhatsApp/anti-spam confirmation). Note:
  HubSpot's version guards email deliverability; ours guards the WhatsApp
  number the whole business runs on — it stays, and gates the Import button.
- **Import receipt** beside the policy controls: new / update / skipped-why
  counts plus the **remap audit** from the Fix values panel
  (`"Not Interested" → Lost ×2`). This is HubSpot's Remappings tab adapted to
  an in-flow receipt — same trust, no persistent import-history surface.
- **Final counts** reflect the *edited* preview: `Import 42 leads` /
  `Update 6 · Add 36`.
- **Post-import: summary tiles** (v2). Replace the small result banner with
  big scannable numbers — Added / Updated / Skipped — plus one audit line
  ("5 values remapped · view") and CTAs: **View leads** / Import another.
  Extends the existing `ImportResult` panel; the trust moment after 300 rows.

## 5. Lead-field coercion (new pure module)

New file `src/lib/leads/import-coerce.ts` (colocated `*.test.ts`). Pure so it's
unit-tested like the rest of `field-mapping.ts`.

### Option fields (status / source / gender)
`coerceOptionValue(raw, options): { key: string; matched: boolean }`
1. Exact key match against the account's `LeadFieldOption[]`
   (`resolveFieldOptions`).
2. Case-insensitive label match.
3. No match → `slugifyOptionKey(raw, existingKeys)` and `matched:false`.

Storing an unknown slug is safe: `source`/`gender` are free-text columns, and
the render layer already humanises unknown keys (`statusColumn`, `optionLabel`,
`humaniseKey` in `field-options.ts`) — no crash, muted pill. `matched:false`
drives the amber "unmatched" flag in the preview so the user can fix or (admin)
create the option before committing.

### Assignee
`coerceAssignee(raw, staff): userId | null` — case-insensitive match of the cell
against the staff roster names (`useAccountStaff().nameById`). No match → null
(falls back to importer-as-owner, current behaviour). Never creates a user.

### Field-type detection (v2 — powers inline create)
`detectFieldType(header, samples): { label, type, options? }` — pure
heuristics, no AI:
1. ≥80% of non-empty samples match a date pattern → `date` (plus
   `dateOrder: 'DMY' | 'MDY' | 'ambiguous'` from digit ranges — a `13/…`
   day disambiguates; all-ambiguous → default DMY + show the chip).
2. ≥90% numeric → `number`.
3. Distinct non-empty values ≤ 12 **and** ≤ half the row count → `dropdown`
   with the distinct values pre-filled as options.
4. Else → `text`.
Label = title-cased header. Always shown for confirmation, never auto-committed.

### Remap log (v2 — powers the receipt + audit)
The Fix values panel maintains `Map<'status'|'source'|'gender',
Map<rawValue, resolvedKey>>` plus per-value row counts. Applying it is a pure
pass over `PreviewRow[]`; the same structure renders the Confirm receipt and
the post-import "N values remapped" audit. Session-only — nothing persisted.

## 6. Engine changes (`field-mapping.ts`)

Generalize, don't fork. The Contacts wizard keeps working; Leads opts in.

- Extend `TargetField` with optional metadata so lead targets self-describe:
  ```ts
  kind: 'standard' | 'tags' | 'custom' | 'option' | 'assignee'
  optionsField?: 'status' | 'source' | 'gender'   // for kind:'option'
  ```
- `buildTargets(customFields)` stays for contacts. Add
  `buildLeadTargets(customFields)` (or a `{ includeLeadFields }` flag) that
  appends Status/Source/Gender/Assignee.
- Extend `MappedRow` with optional `leadStatus? / source? / gender? / assignedTo?`.
- `applyMapping` gains a resolver arg for option/assignee columns (or the wizard
  post-processes `MappedRow` with `import-coerce`). Prefer **post-process**: keep
  `applyMapping` dependency-free, layer coercion in a `buildPreviewRows()` step
  the Leads variant owns.

### Preview row model
```ts
interface PreviewRow {
  base: MappedRow;                 // phone/name/email/company/tags/custom
  leadStatus: string | null;       // resolved + editable
  source: string | null;
  gender: string | null;
  assignedTo: string | null;       // user_id
  status: 'new' | 'update' | 'skip-no-phone' | 'skip-dupe';
  unmatched: Set<'status'|'source'|'gender'|'assignee'>;
}
```
**Critical:** `handleImport` currently re-runs `applyMapping` at commit. It must
instead consume the **edited `PreviewRow[]`** so on-the-fly edits actually land.
The insert payload extends with `lead_status / source / gender / assigned_to`
(assignee overrides the importer-as-owner default when set).

## 7. Component shape

Parameterize `ImportWizard` rather than clone it:
- Add a `variant: 'contacts' | 'leads'` (or pass `targets` + `entityLabel` +
  `renderPreviewRow`) prop.
- `variant:'leads'` → `buildLeadTargets`, "Import Leads" copy, 4 steps with the
  preview grid; `variant:'contacts'` → current 3-step behaviour unchanged.
- Preview grid = a new `ImportPreviewGrid` subcomponent that imports the leads
  table's column renderers. To avoid a circular import, lift the shared
  renderers (status pill, source, gender, assignee, custom) into a small
  `src/components/leads/lead-cell-renderers.tsx` that both `/leads/page.tsx` and
  the grid consume. (Aligns with the CLAUDE.md "reuse, don't rebuild" rule.)

## 8. Edge cases

- **No phone column** → Step 2 blocks (existing rule).
- **Row with empty phone** → `skip-no-phone`, greyed, excluded (existing
  `droppedNoPhone`).
- **In-file dupes** → `dedupeByPhone` keeps first; rest → `skip-dupe`.
- **Existing lead (add mode)** → skipped at commit (existing). Flag as `skip`
  in preview when mode=add, `update` when mode=update/both. Needs the existing
  `phone_normalized` lookup to run *before* preview (or lazily) to label rows —
  acceptable one extra read on entering Step 3.
- **Unknown status/source/gender** → stored as slug, flagged amber, editable.
- **Unknown assignee name** → unassigned + flag.
- **Contact that is already a member** (`memberships` row) → still matched by
  phone; update mode updates it. Note: `/leads` anti-joins memberships, so an
  updated member won't appear in the leads list (expected).
- **Large files** → preview cap with honest "showing N of M" (no silent
  truncation — CLAUDE.md rule).

## 9. Build checklist (when we implement)

1. `src/lib/leads/import-coerce.ts` + test — option/assignee coercion,
   `detectFieldType`, date-order detection. (M)
2. `field-mapping.ts` — `buildLeadTargets`, `TargetField` metadata, `MappedRow`
   lead fields; tests. (S)
3. `lead-cell-renderers.tsx` — extract shared renderers from `/leads/page.tsx`. (M)
4. `ImportPreviewGrid` + `FixValuesPanel` — editable grid reusing renderers +
   `EditableCell`; value-level remap with live counts + remap log. (L)
5. `ImportWizard` — `variant` prop, 4-step flow, searchable grouped picker,
   move mode to Confirm, consume `PreviewRow[]` at commit, extend insert
   payload with lead fields. (L)
6. Results tiles + Confirm receipt + sample template file on Upload. (S)
7. Wire Leads page button → `variant:'leads'`; keep Contacts path on `'contacts'`. (S)
8. **Update `CLAUDE.md`** (Leads module "Built since M1" + the reuse notes) and
   the memory index — per the non-negotiable doc rule.

## 10. Open questions

- ~~Bulk-fix in preview (e.g. "set Status = New for all unmatched")?~~
  **Answered in v2: yes, build it as the Fix values panel (§4 Step 3).** The
  HubSpot walkthrough settled it — real CSVs carry the same bad value across
  dozens of rows, so value-level remap is the difference between 1 fix and 80.
- Persist the last-used mapping per account (HubSpot remembers)? Defer.
- Windowed rendering for very large files (react-window) — only if a real import
  janks; otherwise the cap + "showing N of M" is enough for M1.
- Import-history page (who imported what, when): defer until multi-staff
  imports collide in practice; `received_via:'import'` + `created_at` cover
  v1 forensics.

## 10a. Preview polish (built Jul 2026, post-first-run feedback)

Shipped after dogfooding a real 1,000-row export:

- **Fix-values panel is docked open, non-dismissible** whenever anything is
  unmatched (no "N values to fix" button to click through, no ✕). It only
  disappears when everything is clean; the summary chip is now a passive
  status indicator, not a trigger. `ImportPreviewGrid` computes
  `showPanel = unmatched.length > 0`.
- **Preview owns its scroll.** For the leads Step-3 pane the dialog body is
  `flex flex-col overflow-hidden` (not `overflow-y-auto`), and the grid is a
  flex column whose table lives in a `min-h-0 flex-1 overflow-auto` region —
  so the horizontal scrollbar sits just above the sticky dialog footer
  (mirrors the `/leads` table), instead of overflowing off-modal. Other steps
  and the contacts variant keep normal body scroll.
- **Assignee is a first-class fixable field.** `FixableField = OptionField |
  'assignee'`; `unmatchedValues` / `applyValueFix` now cover assignee, so
  mapped-but-unmatched staff names surface in the panel (resolvable to an
  existing teammate or "Assign to me (importer)") and count toward the fix
  total — previously they showed amber in-cell but the summary wrongly said
  "all match". The Preview button is gated on `useAccountStaff().loading` +
  `fieldOptions.loading` so coercion never runs against an empty roster
  (which false-flagged every assignee).

### Create teammate on the fly from an import — BUILT (migration 049, Jul 2026)

Resolve an unmatched **Assigned to** value by *creating a new teammate*
(pending invite), park the leads on them now, show "Invite pending · <name>"
on the leads page until they activate — then hand the leads over on redeem.

**Shipped** (reuses `account_invitations`, not a parallel table). Design as
built:
- Migration `049_pending_invite_assignees.sql`: `account_invitations.full_name`;
  `contacts.pending_invitation_id` (FK → account_invitations, `ON DELETE SET
  NULL`) + `pending_assignee_name` (denormalized display); `redeem_invitation`
  extended to reassign parked leads to the joiner (assign-to-self → notify
  trigger self-guard suppresses the flood). `assigned_to` stays the importer
  as fallback owner (revoke/expire → degrades to importer, never ownerless).
- `POST /api/account/invitations/[id]/link` rotates the token + returns a fresh
  URL (tokens are hash-only). Copy-link lives in Settings → Team → Pending
  invitations, which now shows `full_name`. Rotating invalidates the prior link
  (UI warns).
- Import Fix-values assignee card: existing pending invites as options +
  admin-only "Invite '<name>' as a teammate" (find-or-create, dedup by name).
  Sentinel key `pending:<id>` (`PENDING_ASSIGNEE_PREFIX`) → `applyValueFix`
  parks the row. Commit writes `pending_invitation_id`/`pending_assignee_name`.
- Resolve pending → real member: inline (assignee cell), by filter (Assigned-to
  lists pending invitees), or bulk (BulkEdit) — all clear the overlay.
- Scope kept: pending owners are import-created only; not in round-robin/stats
  until they join.

Design decisions that shaped the built version (why the obvious approaches
were rejected): a parallel `pending_staff` table was dropped in favour of
reusing `account_invitations`; a polymorphic `assigned_to` was rejected in
favour of the separate `pending_invitation_id` slot (keeps the `auth.users`
FK intact); and creating real `auth.users` up front was rejected because CSV
rows carry a name, not an email — the bearer invite link is how the person
self-authenticates. Bearer-link caveat: whoever opens the link becomes that
teammate (the name is a memo, not verified identity) — acceptable because the
owner controls link distribution.

## 11. HubSpot feature triage (v2 record)

Full walkthrough: `PRDs/HubSpot Contact Import - UX Walkthrough & PRD for Jim
CRM.pdf` (16 pp., live 1,000-row import). Filter applied: does it help a gym
owner save time, recover leads, collect renewals, or retain members?
Interactive version: https://claude.ai/code/artifact/cbc7360a-18d0-4a32-9afe-75f58f084c69

**Adopt (7)**

| HubSpot pattern | Verdict for the gym CRM |
|---|---|
| Fix-errors panel: remap bad enum values by *value* with row counts, auto-fix, live counter (pp. 4–5) | **The single best steal.** Becomes the Fix values panel (§4 Step 3). P0. |
| Per-column green "Mapped" check (p. 3) | Adopt as-is — drives off the mapping array, ~free. P0. |
| Searchable, grouped property picker (pp. 3–4) | Adopt — type-ahead over Standard/Lead/Tags/Custom. P0. |
| "Scanning column data" → suggested label/type/options (pp. 5–7) | Adopt the *pattern*, not the AI: `detectFieldType` heuristics (§5.3). P1. |
| Big-number results summary (pp. 9–10) | Adopt — summary tiles on the result panel. P0. |
| Sample CSV template (p. 2) | Adopt — one static file. P2. |
| Required-field validation gate (p. 15) | Already ours (phone-required). Keep. |

**Adapt (3)**

| HubSpot pattern | Our shape |
|---|---|
| Remappings audit tab on a persistent import-history page (p. 13) | In-flow: Confirm receipt + post-import audit line from the remap log. No new surface. |
| "No unique identifier" scare banner (p. 14) | Calm one-liner under the Phone row; phone is the key, dedupe automatic. (Already decided in v1.) |
| Global date-format confirm step (p. 9) | Inline per-column `DD/MM ▾` chip, only when a mapped date column is ambiguous; DMY default for India. |

**Skip (6)**

| HubSpot pattern | Why not |
|---|---|
| Header-language selector (p. 2) | Indian gym sheets are English/Hinglish-headered; the synonym table covers it. |
| "Import as" object-type selector (p. 3) | We import exactly one object: a lead. |
| Google Sheets connect + XLSX (p. 2) | CSV-only stands (§2) — OAuth/sync cost, no wedge value. |
| AI property creation "Breeze" / Data Agent fill (p. 7) | Heuristics land the same result at 300-row scale; no AI in the critical path. |
| Import naming + history list (p. 9) | Deferred (see §10). |
| "Clean up your data" paid upsell + option-style picker (pp. 7, 13) | No paid tiers; statuses already carry hex pill colours. |

Deferred item for the To-Do list in CLAUDE.md when built: this reserves the
`received_via:'import'` path already used by the contacts wizard — no new origin.
