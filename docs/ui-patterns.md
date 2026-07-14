# UI patterns (non-negotiable)

> Read this before writing ANY UI. Rules here are product-wide invariants, not suggestions.
> Two meta-rules govern everything below:
> 1. **Never hand-roll an element that exists in `src/components/ui/`.** If no primitive fits — **stop and ask the user**: new master component, or reuse a different one? Never silently roll an inline one-off.
> 2. **Master components (`src/components/ui/*`) are single sources of truth.** Editing one changes every call-site — **warn the user first and list what it affects.** Restyle a single call-site via `className`/variants, never by forking.

## Token consistency (the rule that prevents drift)

Sibling components that read as the same *kind* of thing must share the same tokens — popup padding, border/ring, radius, item inset, icon size, muted fill. Before adding or editing a component, open the **closest existing one and copy its tokens verbatim**. Don't eyeball a value.

Drift is a real bug, not a nit. Example: `DropdownMenuContent` had `p-1` on the popup, `SelectContent` had none — so a bare-item `ui/select` rendered items flush to the popup edge while an identically-shaped dropdown looked padded. Fixed at the master (`p-1` moved onto the Select's `List`).

When you spot a mismatch: **fix it at the master component** so every call-site converges, then cross-check the peers — menu ⇄ select ⇄ combobox ⇄ popover; search field; badge/pill family; segmented toggle.

## ⚠️ Overriding a variant-prefixed class in a master (tailwind-merge)

tailwind-merge only dedupes utilities of the **same variant**. So an override of a `data-[side=*]:`-prefixed class **must carry the same prefix** — a bare `w-full` at a call-site does NOT beat `ui/sheet.tsx`'s `data-[side=right]:w-3/4` (this silently pinned every sheet to 75vw until the member sheet was fixed to `data-[side=right]:w-full data-[side=right]:sm:max-w-[…]`). Same trap for any prefixed default in a master.

## Page chrome

**One header per page.** Title, actions, and sub-nav tabs all live in the shared app bar (`src/components/layout/header.tsx`). A page must **not** own a second title/subtitle row or a standalone tab strip.

- Header is a two-row `flex-col`, divider on the outer `<header>`: row 1 = route title (from the `pageTitles` map) + trailing actions slot; row 2 = tab slot (`empty:hidden`, so tab-less pages stay one row).
- Pages portal chrome in via `page-header-actions.tsx`: `<PageHeaderActions>` (Import / Export / Add … — gate with `GatedButton`'s `canAct` + `gateReason`; **gate, don't hide**) and `<PageHeaderTabs>`.
- Because the divider is on the whole header, a filled tab row pushes the divider **below** the tabs — nav reads as part of the header.
- Tabs = `ui/tabs.tsx` **`variant="line"`** (underline), controlled (`value`/`onValueChange`). Not a pill segment bar.
- **Line variant's active tab is `--primary`** (label + underline) — not `foreground`, which ignored the account's accent theme. Master change in `ui/tabs.tsx`, so every line-tab surface moved together. The default/pill variant is untouched.
- An overflow-capable tab strip must **keep the lit tab in view** — a scrollspy nav (member sheet) centres the active tab on change, else mobile lights an off-screen tab.
- Canonical: `/leads` (actions), `/members` (actions + line tabs).

## Cursor (base rule — never re-add per component)

Tailwind v4 Preflight sets `button { cursor: default }`. One base rule in `globals.css` owns it:

```css
button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer }
```

A `:disabled` control keeps the arrow (a dead affordance must not advertise itself). **Never add `cursor-pointer` to a button/tab/trigger.** A **non-button** clickable (`<div>`/`<tr>` row, card) still needs it explicitly.

## Form fields

**Fields are unfilled — never add `bg-muted` to one.** Every control (`Input`, `CurrencyInput`, `Textarea`, `SelectTrigger`, `DatePicker`, rare native `<input>`) renders on the primitive's `bg-transparent` (+ `dark:bg-input/30`). It reads as a field because of `border-input-border`, not a grey box. (~180 hand-added `bg-muted` fills were stripped across auth / contacts / leads / members / settings / broadcasts / automations / flows.) Don't reintroduce it; don't "fix" a plain-looking field by filling it.

`bg-muted` stays correct for **non-field** surfaces (decorative/summary boxes `bg-muted/20`–`/40`, pills, badges, avatars, icon boxes, code chips, table headers, skeletons, message bubbles, segment toggles, Calendar's "today" cell) and for **state** styles (`hover:`/`focus:`/`data-[…]:`).

Deliberate filled exceptions (different pattern, not form fields): `SearchInput` and the chat surfaces (inbox `message-composer`, `contact-sidebar` note box, `ai-playground`).

### No native `<select>`, ever

Every form dropdown is `ui/select.tsx`. Native selects render an unstylable OS popup and their hand-rolled triggers drifted from `Input`'s tokens. All ~40 were converted.

Idiom (see `member-personal-info.tsx` gender picker):
```tsx
<Select value={x || undefined} onValueChange={(v) => set(v ?? "")}>
  <SelectTrigger id={…} className="w-full"><SelectValue placeholder="…" /></SelectTrigger>
```
- Trigger defaults to `w-fit` → pass `w-full`. No `bg-muted`. `id` on the trigger (keeps `<Label htmlFor>`). `disabled` on the root.
- Base UI types `onValueChange` as `string | null` → guard always-set handlers with `(v) => v && f(v)`.
- Clearable field → a `<SelectItem value={null}>` first item (null re-shows the placeholder). A *selected* null item ALSO renders as placeholder, so a real option mapped to `""` state (contact-form's "New" status) uses `value={null}` + a dynamic placeholder.
- `<optgroup>` ⇄ `SelectGroup` + `SelectLabel`.

**Controlled-vs-uncontrolled trap (fixed at the master):** Base UI latches `isControlled = value !== undefined` into a ref on the FIRST render, so `value={x || undefined}` mounted every Select *uncontrolled* and flipped it to *controlled* on first pick — console warning, and an uncontrolled root **ignores a programmatic reset** (form cleared, dialog reopened on another record). `null` = "controlled, nothing picked"; `undefined` = uncontrolled. The `Select` wrapper now **coerces an explicitly-passed `value: undefined` → `null`** (keyed on `"value" in props`, so a genuinely uncontrolled Select using `defaultValue` is untouched). The `value={x || undefined}` idiom stays correct — don't "fix" a call-site to `defaultValue`.

**Trigger label resolution (fixed at the master):** Base UI's `Select.Value` renders labels ONLY from the root's `items` prop, never from mounted `SelectItem` children — so a selected value used to echo raw (plan UUID, `male`). The wrapper now auto-derives `items` by walking its JSX children (explicit `items` wins; null-valued items skipped). Caveat: `SelectItem`s hidden inside a custom component aren't seen — those call-sites pass `items` explicitly.

### Date fields

`DatePicker` (`src/components/ui/date-picker.tsx`) — a **whole-field-clickable** Input-styled Popover trigger (CalendarIcon + `fmt.date`) opening `Calendar` (`ui/calendar.tsx`, react-day-picker v10). Replaced every native `<input type="date">` (only the icon was clickable; OS popup clashed).

- **Value contract = a date input's:** `value`/`onChange` are `'YYYY-MM-DD'` strings (parsed from parts, **never** `new Date(str)`); `min`/`max` are inclusive `'YYYY-MM-DD'`.
- Locale-aware: display via `fmt.date`, `weekStartsOn = locale.weekStart`.
- `Calendar` gotchas: month/year caption dropdowns route through **`ui/select`** via a custom `components.Dropdown` (rdp reads only `Number(e.target.value)`, so it's handed a `{ target: { value } }` synthetic — do NOT let rdp render its native `<select>`). Day cells/nav reuse `buttonVariants`. No rdp CSS import. Year range = `min`→`max`, else −100y→+5y via `startMonth`/`endMonth`.
- Layout is **fixed-width** (`root w-[16.5rem]`, fixed month/year trigger widths, `flex-1` day cells) so the popup doesn't resize with the month name. The rdp nav strip is `pointer-events-none` (chevrons re-enable) or it paints over and swallows caption-dropdown clicks.
- A "Today" footer link (account-tz `fmt.today()`, hidden when outside `min`/`max`) picks today and closes.

### Money inputs

`CurrencyInput` (`ui/currency-input.tsx`) — master `Input` with the account's currency symbol overlaid. Two modes:
- **plain** — `type="number"`, `value`/`onChange`.
- **grouped** — pass `groupLocale={locale.locale}` + `onValueChange`; renders `type="text"` with locale grouping as you type (`₹1,00,000` on en-IN) while returning the RAW numeric string. Caret restored by digit position.

A `type="number"` field can NEVER show separators — any new money field that should group uses grouped mode.

**Gotcha:** an `overflow-y-auto` scroller (dialog body) or a `Collapse` clips the focus ring on BOTH axes (non-`visible` `overflow-y` forces `overflow-x: auto`). Give it `-mx-1 px-1 py-1`-style inner padding or every field's ring gets sliced.

### Search & searchable selects

- `SearchInput` (`ui/search-input.tsx`) — leading glyph over a **rounded-rectangle** `Input`, `border-border` + muted fill. Width/flex on the wrapper via `containerClassName`. Radius/border/icon/padding are **fixed** — never restyle per call-site. Used by leads/members/check-in toolbars, inbox conversation list, import + manage-columns pickers. (`Combobox`'s in-popover search and `global-search`'s command trigger are deliberately their own patterns.)
- `Combobox` (`ui/combobox.tsx`) — Select-styled trigger → Popover with search over **grouped** options + optional pinned footer action ("＋ Create…"). Use for lists too long to scan (import wizard's field picker). Short static lists stay on `ui/select`. Don't hand-roll popover+input search.

## People

- **`UserAvatar`** (`ui/user-avatar.tsx`) is the canonical avatar — photo when `src` is set, first-initial fallback on the primary tint otherwise. **Every** person render goes through it (teammates, members, contacts, table/board views) so a photo uploaded once appears everywhere. Never hand-roll `Avatar + AvatarImage + AvatarFallback` for a person. Size via `size`/`className`, initial restyle via `fallbackClassName`, presence dots as children. Teammate URLs from `useAccountStaff()` (`avatarById`); current user from `useAuth().profile.avatar_url`.
- **`MemberIdentity`** (`components/members/member-identity.tsx`) is the canonical member cell — `UserAvatar` + name over a comm line (phone). Used in **every** member row: all-members table, renewals, follow-ups, trials, payment-due, inactive, check-in, payments ledger. Never hand-roll a name+phone stack for a member. Optional `meta` = a third caller-styled line ("plan · due date"); with `meta` the avatar top-aligns, else it centres. Pass `src` (`contacts.avatar_url`) at every call-site.
- **Member photo upload** — lives on `contacts.avatar_url` (no migration) in the `avatars` public bucket (path `{auth.uid()}/member-<contactId>-<ts>.webp`; RLS keys on the uid first segment). Click the large avatar in the member detail header (gated `canSendMessages`) → `AvatarEditorDialog`: view/upload/change/remove, **square crop** via `react-easy-crop` v6 (its structural CSS `react-easy-crop/react-easy-crop.css` **must be imported** — not auto-injected). On save, `cropToWebp` (`src/lib/images/optimize.ts`) crops → caps at `MAX_AVATAR_PX` (512) → WebP at 0.82, so a multi-MB phone photo lands ~30 KB. Writes chain `.select('id')`; previous object best-effort GC'd.

## Contact / lead detail surface

There is **ONE** lead/contact detail surface: **`ContactDetailContent`** (`components/contacts/contact-detail-content.tsx`) — identity header + quick-action row over the **Details / Tags / Notes** accordion. It owns its own fetches (`contacts`, `conversations`, `tags`+`contact_tags`, `custom_fields`+`contact_custom_values`), its own writes, and the shared option lists (`useLeadFieldOptions`).

It is **host-agnostic on purpose** (renders no Sheet chrome) and has exactly two hosts:
- `ContactDetailView` (`contact-detail-view.tsx`) — a thin `/leads` Sheet wrapper.
- `ContactSidebar` (`components/inbox/contact-sidebar.tsx`) — the inbox's 360px right panel.

**Hosts differ ONLY by props, never by forking:**

| Prop | Purpose |
|---|---|
| `variant` | `'sheet'` renders Base UI `SheetTitle`/`SheetDescription` (Dialog parts — they **throw** outside a Sheet root); `'panel'` swaps in plain elements with identical classes |
| `actions` | allowlist of `ContactQuickActionId` — the inbox drops `chat` (you're in the thread) and `template` (composer is right there) |
| `collapsedSections` | inbox collapses `details` (13 label/value rows in a 360px rail is a wall) |
| `active` | fetch trigger — sheet passes its `open`, panel passes `true` |
| `onClose` | sheet dismisses; panel doesn't |

Adding a lead field once surfaces it in the table, the sheet **and** the inbox. The inbox panel is fully editable (same writes, same RLS, same transfer/assignment approval RPCs) and re-pulls the page's `activeContact` via `onUpdated` so the thread header + conversation list can't go stale.

The three overlays (`TemplatePicker` / `MemberForm` / `TransferRequestDialog`) live inside the content and therefore nest inside `SheetContent` on `/leads` — that's the established shape (member-detail nests its invoice/payment dialogs the same way), not a hazard.

**Mobile (`<lg`):** the inbox is single-pane, so the same surface opens as an overlay Sheet via `ContactProfileSheet` (`variant="sheet"`, Details expanded). Gated in JS on `useMatchMedia("(min-width: 1024px)")` — **not CSS**: a Sheet portals to `<body>`, so a `lg:hidden` wrapper would style the wrapper and still let the overlay open on desktop.

## Notes thread

`ContactNotesThread` (`components/contacts/contact-notes-thread.tsx`, keyed by `contactId`) — composer + note cards + follow-up-on-note + all mutations. Mounted by both the lead detail surface and the member detail sheet. `NoteComposerCard` / `FollowUpDraft` / `DEFAULT_FOLLOW_UP_DRAFT` / `resolveDueDate` live here and are re-exported from `contact-detail-view.tsx` for old import sites.

## Tables

### Column header

`ColumnHeader` (`src/components/table/column-header.tsx`) is the single source of truth for the `/leads` table AND the All-members table: label + one double-sided sort toggle (`ChevronsUpDown`, cycles asc→desc, shows the active direction lit) + a three-dot overflow menu (Sort asc/desc, an Excel-style value **Filter** submenu, column actions).

- Freeze / add-column / edit-options / drag-handle / the greyed "smart property" placeholder are **optional props** — leads passes the full set, members mounts just Sort + Filter + Hide.
- **The resize grip and any drag transform live on the owning `<th>`, never in `ColumnHeader`.**
- Don't fork it — restyle via props. Leads' `HeaderCell` is a thin adapter; members renders it directly.
- Members: column meta = `MEMBER_COLUMNS` (`members-table.tsx`), cells = `renderCell()`; header Filter submenus wire to the shared `MemberFilters` dims (plan/status/fee) so header filter ⇄ Filters panel can't drift. Layout (order/hidden/widths) persists in the `members-all` `useTablePrefs` blob; a toolbar "Columns" menu is the unhide surface. Drag-reorder + freeze deliberately skipped (~6 fixed columns).

### Lead-field cells

`src/components/leads/lead-cell-renderers.tsx` — `StatusBadge`, `AssigneeDisplay`, `statusCellOptions` / `sourceCellOptions` / `genderCellOptions` / `assigneeCellOptions`, `customEditKind`. Consumed by BOTH the `/leads` table and the import preview grid so they can't drift. Any new surface rendering lead fields goes through these.

### Persisted table views

`useTablePrefs(viewKey, defaults)` (`src/hooks/use-table-prefs.ts`) — per-user, per-account column state in the `table_preferences` table (migration `053`). Keeps the `useLocalStorage` `[value, setValue]` API: paints from a per-scope `localStorage` cache on first frame, DB row wins on load, writes update state + cache synchronously and **debounce** the upsert (500ms, flushed on unmount). Keys: `'leads'` (order/hidden/widths/pageSize/viewMode/view/sort/frozenCount/board) and `'members-all'`. `useLocalStorage` remains for non-scoped prefs.

## Badges / status pills

`Badge` (`ui/badge.tsx`) is the canonical pill.
- Fixed statuses → tinted variants (`success`/`danger`/`warning`/`info`/`violet`), **fill-only** recipe `bg-{c}/10 text-{c}-400`. No borders on pills.
- Admin-created **tags always render `variant="neutral"`** — the slate fill-only tint (`bg-slate-500/10 text-slate-500`). Slate = the neutral, non-colour-coded look.
- DB-driven hex colours (lead statuses) use the `color` prop → same fill-only recipe, inline.
- Domain wrappers map domain state → variant (`MembershipStatusBadge`, `FeeStatusBadge`, `InvoiceStatusBadge`, `InvoicePaymentBadge`, `PlanTypeBadge`, `VoidedPaymentBadge` — all in `components/members/membership-status-badge.tsx`). Add a wrapper rather than repeating variant choices at call-sites.
- Interactive chips (clickable tag toggles, removable filters) are **buttons**, not badges. Don't force them into `Badge`.

## Money numerals

Every rendered `fmt.money` / `fmt.moneyShort` / `formatCurrency` value sits in an element with **`tabular-nums`** (fixed-width lining digits — keeps columns and count-up animations from jittering). Wrap the money part in `<span className="tabular-nums">` when it's inside prose.

Exempt: non-DOM strings (CSV, WhatsApp template params, toasts) and native `<option>` labels (browsers ignore font styling there).

## Animation (Motion)

Animate through the shared primitives in `src/components/ui/`, not scattered `motion.*` at call-sites.

| Primitive | What it does |
|---|---|
| `Collapse` (`collapse.tsx`) | `open`-driven height+fade reveal that unmounts when closed (replaced the `grid-rows-[0fr↔1fr]` hack; the surrounding flex gap closes on its own) |
| `MotionList` + `MotionListItem` (`motion-list.tsx`) | wrap a `.map` so items fade/slide in-out and FLIP-reflow on add/remove/reorder (`AnimatePresence mode="popLayout"` + `layout`). Used on the notes list + `/notifications` |
| `AnimatedNumber` (`animated-number.tsx`) | count-up on scroll-into-view; drives text via ref (no per-frame re-render); honours reduced-motion. Dashboard KPI tiles (pass `format` for currency) |

### Two hard gotchas

1. **Base UI dialogs / dropdowns / sheets / popovers already animate** via `data-open/closed` + `data-starting/ending-style` (tw-animate-css). Do NOT wrap them in Motion — it fights their mount lifecycle.
2. **Never put a `motion.*` (transform) on a `<tr>` or an ancestor of the leads table.** A transformed ancestor becomes the containing block and **breaks `position: sticky` frozen columns.** Row enter/exit is intentionally un-animated for this reason.

### Kanban board (leads) — drag perf is load-bearing

`leads-board.tsx` uses `LayoutGroup` + per-card `layout="position"` / `layoutId` so a dragged card *flies* to its new column. dnd-kit owns the drag; its `DragOverlay dropAnimation` is `null` so Motion's FLIP owns the settle (**don't re-enable it** — double-animates).

Three things keep it smooth. All three are deliberate:

- **`contain: layout` on every card** (`[contain:layout]`). Motion flushes layout once per move to measure all cards; containment makes each card an isolated subtree so the flush skips its ~30 internal nodes (avatar/SVG/badges/dropdown). Without it the rich card body froze the drop at scale. **The fix is containment, NOT stripping the animation.**
- **Cheap re-renders during drag.** dnd-kit shares one React context, so every `useDraggable`/`useDroppable` consumer re-renders on each column crossing. So: `cardCtx` is ONE memoised object (stable ref); `ColumnCards` (memo, keyed on `leads`+`ctx`) is skipped when a column re-renders for its `isOver` outline; `DraggableLeadCard` is the ONLY context subscriber and is a bare wrapper whose re-render doesn't reach the `motion.div` (its parent); `LeadCard` (memo body) is skipped.
- **The optimistic status update must NOT be page state.** The board lives in an island — `LeadsBoardView` (`leads-board-view.tsx`) — owning a LOCAL optimistic mirror + the drag write, so a drop re-renders only the island + board, not the ~4k-line `LeadsPage` (toolbar, filters, ~10 always-mounted dialogs). The page stays fetch owner (`leads` prop drives the mirror, re-synced via adjust-state-during-render on a new array identity — a state guard `syncedProp`, not a ref, per the react-hooks lint). After the write commits, the island calls `onStatusPersisted` and the page syncs inside `startTransition` so that low-priority re-render can't interrupt the in-flight FLIP.

The drop container transitions only `background-color,outline-color` — never `transition-all`. If a huge board still drags heavy, the remaining lever is lowering `BOARD_LIMIT`.

**Board parity rules:** the board honours the shared Filters panel (`fetchBoard` runs `resolveContactIdFilter` + `applyLeadFilters`, sequence-guarded); the Filters button renders in **both** views (Sort / Edit columns stay table-only — filters constrain data, those are table presentation). Drag-status writes set `updated_at` and chain `.select('id')` (empty = RLS-blocked → toast + revert refetch). A card is a clickable **`<div>`**, not a `<button>` — it contains real buttons.
