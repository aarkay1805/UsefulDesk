# UI patterns (non-negotiable)

> Read this before writing ANY UI. Rules here are product-wide invariants, not suggestions.
> Two meta-rules govern everything below:
>
> 1. **Never hand-roll an element that exists in `src/components/ui/`.** If no primitive fits — **stop and ask the user**: new master component, or reuse a different one? Never silently roll an inline one-off.
> 2. **Master components (`src/components/ui/*`) are single sources of truth.** Editing one changes every call-site — **warn the user first and list what it affects.** Never restyle a reused component at a call-site. Use its existing variants and size props exactly as defined; `className` may control only external layout such as width, margin, alignment, or responsive visibility. If the needed visual treatment does not exist, **stop and ask the user** whether to add a master variant or design a new component together.

Visual references: [design tokens](design-tokens.html) · [atomic component sticker sheet](component-sticker-sheet.html)

## Token consistency (the rule that prevents drift)

Sibling components that read as the same _kind_ of thing must share the same tokens — popup padding, border/ring, radius, item inset, icon size, muted fill. Before adding or editing a component, open the **closest existing one and copy its tokens verbatim**. Don't eyeball a value.

Drift is a real bug, not a nit. Example: `DropdownMenuContent` had `p-1` on the popup, `SelectContent` had none — so a bare-item `ui/select` rendered items flush to the popup edge while an identically-shaped dropdown looked padded. Fixed at the master (`p-1` moved onto the Select's `List`).

When you spot a mismatch: **fix it at the master component** so every call-site converges, then cross-check the peers — menu ⇄ select ⇄ combobox ⇄ popover; search field; badge/pill family; chips; segmented toolbar controls.

**Semantic colour foregrounds never use a raw palette shade.** Use `text-{hue}-foreground` for coloured text/icons (`red`, `amber`, `emerald`, `blue`, and the other declared semantic hues). Each token starts from that hue's `-500` fill primitive and blends 45% toward the live page foreground, mirroring the adaptive contrast rule used by `text-primary-text`; this keeps the hue recognisable while clearing WCAG AA over its 10% subtle tint in light and dark modes. `text-destructive` aliases the same red foreground. A component may vary a subtle background's opacity, but not its foreground token. The only exception is `components/tremor/chart-colors.ts`, whose `-500` classes are data-mark colours locked to matching fills and strokes, not semantic product text.

**A chart series that means something never uses `--chart-1`.** That token _is_ the account accent, so any series bound to it changes hue with the theme. It is right for an arbitrary first series (visits, messages) and wrong the moment the series has a fixed meaning — the business overview's cash flow drew income on `--chart-1` against expenses on `--color-red-500`, so on the **rose** accent both series rendered red and on **amber** they sat one hue step apart. Semantic series take the fixed `-500` data-mark primitives the finance module already uses: emerald for money in, red for money out, amber and blue for the remaining declared hues. De-emphasise a secondary series by mixing toward `--card`, not with `fillOpacity` — a translucent mark lets the grid read through it.

## Directional trends

Every KPI delta uses the shared `MetricCard` direction treatment: upward/positive is `text-emerald-foreground`, downward/negative is `text-red-foreground`, and unchanged is `text-muted-foreground`. The arrow and label always share the same tone. Direction colours are semantic and must never inherit the account accent; sort arrows, disclosure chevrons, and money-flow direction icons are not trend deltas and keep their own established treatments.

## Concentric corners (nested radii)

**A rounded thing inside a rounded thing must be concentric: `outer = inner + gap`.** The gap is the real distance from the outer element's inner edge to the inner element — padding _plus any border_, because a border is layout. Get this wrong and the inner control reads as too square (or too round) for its container even though every value came off the ramp.

The base radius is 10px and the ramp is 6 / 8 / 10 / 14 / 18 / 22 / 26. With the 4px spacing scale that gives a small set of legal pairs — **derive the container's corner from the control it holds, never the other way round**:

| Inner           | Gap | Outer            |
| --------------- | --- | ---------------- |
| `rounded-sm` 6  | 4   | `rounded-lg` 10  |
| `rounded-md` 8  | 6   | `rounded-xl` 14  |
| `rounded-lg` 10 | 4   | `rounded-xl` 14  |
| `rounded-lg` 10 | 8   | `rounded-2xl` 18 |
| `rounded-md` 8  | 10  | `rounded-2xl` 18 |
| `rounded-xl` 14 | 4   | `rounded-2xl` 18 |
| `rounded-lg` 10 | 16  | `rounded-4xl` 26 |

- **Start from the master's radius, which you do not get to change.** `Button` is 10px at `icon` / `icon-lg` / default, and 8px at `xs` / `sm` / `icon-xs` / `icon-sm`. Pick the container's padding and corner to suit it.
- **Use `ring-1`, not `border`, on a container whose padding is doing concentric work.** A border consumes 1px of layout and throws the pair off by one; a ring paints outside the box and leaves the gap exact. The inbox hover toolbar and composer shell both moved to rings for this reason.
- **A pill container almost never survives this rule.** A fully rounded shell has an effective radius of half its height, which rarely lands `outer − gap` on the ramp. Prefer a rounded rectangle whose corner is derived; the inbox composer went `rounded-4xl` → `rounded-2xl` for exactly this.
- **Circles and non-corner-adjacent children are exempt.** An avatar centred in a row, or a badge sitting mid-content, has no corner near the container's and needs no pairing.
- Worked example: an `icon-lg` control is 36px at a 10px corner; pad it by 8px and the shell must be 18px — which also makes the shell 52px tall. Derived geometry, not a guessed value.

## Clickable cards — hover is the BORDER, never the fill

A clickable card (any bordered box that navigates or acts — nav tile, action row, selectable option) hovers with **`hover:border-border-hover` and nothing else**. The fill does not move: no `hover:bg-*`.

- **Never tint a card hover with the accent.** `--border-hover` is deliberately neutral. `hover:border-primary/40` collides with the emerald _done_ state on the onboarding rows the moment a gym picks the **emerald accent** (a real, shipped theme) — brand and status become the same green.
- Same reason, same rule for **leading icons** in those rows: neutral `bg-muted text-foreground`, not `bg-primary-soft text-primary`. Green appears once per row and only ever means done.
- `--border-hover` **mirrors intent per mode, not direction** — darkens on light (`0.922 → 0.87`), _lightens_ on dark (`0.28 → 0.36`). Darkening on dark would push the edge toward the card fill (`0.18`) and dissolve it, reading as the card _losing_ its border. Same logic as `--card-2`.
- **`hover:border-border` is a no-op** — the resting border is already `border-border`. Four cards shipped with that dead hover (and one with `hover:border-border/70`, which made the edge _weaker_). If you write a hover, check it changes something.
- **`Card` (`ui/card.tsx`) has no border** — its edge is `ring-1 ring-foreground/10`. Hovering a `Card` must target the **ring** (`hover:[&>div]:ring-border-hover`), not a border that doesn't exist. `[&>div]:hover:border-primary/50` on the dashboard tiles was silently dead for exactly this reason.
- **Selected/active states keep their `primary` tint** — only the _unselected_ hover is neutral, so selection still reads as selection.
- Out of scope (left on their own idioms): tag pills, dashed dropzones, icon-circle buttons, table rows, canvas nodes, destructive/red states.

Canonical: `onboarding/get-started-view.tsx` (`StepRow`) and `settings/settings-overview.tsx` (status tile) — visual twins with byte-identical boxes. **Change one, change the other**, or they drift.

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

### Section headings inside a page

**One heading level, and one queue per section.** The shell owns the page title; inside the page, a section heading names exactly one queue. A grouping heading that only introduces the sections beneath it — the dashboard's former **Work to do** and **The full picture** — is a level that adds a heading without adding meaning, and a card holding two differently-named queues is the same fault one level down. Delete the wrapper and give each queue its own section.

- **Name a section by the action, not by who it is about.** The dashboard split follow-ups into a Lead work queue and a Member work queue; an owner clearing follow-ups wants one list in due order, not two lists to reconcile. Audience is a filter (`Chip`), not a section boundary.
- **The heading is always outside the card; the card holds content and controls only.** Every block uses `DashboardSection` (`components/dashboard/dashboard-section.tsx`) and there is **no `CardTitle` anywhere on the dashboard**. A card keeps a `CardHeader` only when something acts on its content — filter Chips, a range `Toolbar`, a source `Select` — and drops the header entirely when it has none. A header whose only job is to repeat the heading above it is the level this rule deletes.
- Controls in that header are **left-aligned and content-sized**: put them in a `flex flex-wrap items-center gap-2` header rather than a `CardAction`, which `justify-self-end`s a lone control and stretches a bounded `Toolbar` across the whole card.
- `DashboardSection` owns the heading row: `min-h-6` reserves the height of a `size="xs"` link so sections with and without a trailing action leave identical space before their content, and its `meta` slot (a total, a help trigger) emits the `{' '}` a flex container drops visually but the accessible name needs (else a section announces "Leads by stage1 total"). Trailing links — **See all**, **Open inbox** — belong in `action`, beside the heading, not in the card. Pass `className` for external layout only — `flex flex-col` plus `flex-1` on the card makes two peer sections share a grid row at equal height, which is how sibling blocks sit side by side **without** a wrapper heading over them.
- Truncation is `QueueCount` (`components/dashboard/action-queue.tsx`): a right-aligned `N of M` that renders **only when the list is truncated**, because a count printed above the rows it counts restates them. Where filter Chips already carry live counts, the section does not repeat them. Give a section a **See all** only where a page owns that exact queue — `/leads` routes just `all | followups`, so the dashboard's uncontacted-lead queue correctly has none, and the merged follow-up queue shows one only once a Leads or Members chip narrows it to a queue a page owns.
- **A divider inside a card is a `Separator` occupying its own grid track**, never `divide-x`, never a `border-l` hung off a child. Give the grid an `auto` track between each pair (`sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`) and render `Separator orientation="vertical"` into it; the primitive's `data-vertical:self-stretch` matches the row height for free. Hide it with `hidden` — not `invisible` — at the breakpoint where the card stacks, so the rule leaves grid flow entirely and the single-column layout keeps exactly its content items. `divide-x` and `border-l` both key off DOM order rather than the visual row, so they paint a stray edge the moment the grid collapses. Canonical: `needs-attention-card.tsx` (three peers on one row) and `lead-funnel.tsx` (two unlike regions, which also renders the horizontal `sm:hidden` twin because there the split survives stacking).

## Cursor (base rule — never re-add per component)

Tailwind v4 Preflight sets `button { cursor: default }`. One base rule in `globals.css` owns it:

```css
button:not(:disabled),
[role='button']:not(:disabled) {
  cursor: pointer;
}
```

A `:disabled` control keeps the arrow (a dead affordance must not advertise itself). **Never add `cursor-pointer` to a button/tab/trigger.** A **non-button** clickable (`<div>`/`<tr>` row, card) still needs it explicitly.

## Pending button actions

Any button that waits for a network request, storage operation, other asynchronous work, or a cold route transition must show progress in the control that was pressed. Shared `Button` and `GatedButton` consumers use `loading`; the master inserts the spinner, sets `aria-busy`, disables repeat activation, and suppresses a competing direct icon while preserving the label. Do not hand-build a `Loader2` branch at a call site when `loading` fits.

Set pending state before the first awaited operation and clear it in `finally`. If success starts navigation, keep the button pending until the destination replaces the current view. Repeated rows use an item/action identifier so only the pressed control spins; unrelated row actions remain available unless concurrent work would be unsafe. Native buttons that cannot use the master must set `aria-busy`, prevent repeat activation, and replace their glyph with the same compact spinner. Instant local toggles, clipboard writes, and explicitly optimistic removals do not need a spinner when their visible result is immediate.

## Resolvable actions

Use `ResolvableAction` when an action is unavailable because a user or administrator can change a prerequisite. A blocker stays focusable and tappable, opens one anchored reason with at most one resolution CTA, and never invokes the original action. Use `disabled`/`loading` only for pending work, field validation already explained beside its field, empty input, and obvious boundaries. Actions that are no longer applicable are omitted rather than blocked. Permission, missing local data, conflicting workflow state, then provider setup is the blocker priority.

The master owns blocked styling, focus treatment, tooltip, and popover behavior. Call sites may control external layout only; they must not override that blocked treatment or hand-roll a competing tooltip or popover.

The explanation reads as an alert, not a dialog: it borrows the `Alert` grammar (`ui/alert.tsx`) — a `TriangleAlert` in `text-amber-foreground` in its own column, the title and reason beside it, the resolution left-aligned under the copy as an `outline` `size="sm"` button — and anchors itself to the blocked control with `PopoverArrow`, whose tail borders only the two edges facing away from the panel so the popover's hairline continues around the tip without crossing its base. A tailed popover must pass `POPOVER_ARROW_SIDE_OFFSET` as its `sideOffset`; the default 4px gap is narrower than the tail's reach. This panel is the one popover framed at 16px instead of the master's 10px, because it is read rather than picked from; that is a property of the blocker master, not a licence to reframe other popovers at a call site. It composes that grammar rather than nesting an `Alert`, whose card and `role="alert"` would box a panel inside a panel and re-announce a popup the popover already names. `PopoverArrow` is opt-in: no other popover grows a tail by default. `/preview/resolvable-action` is the dev-only harness for every blocker shape and anchor side.

## Text-link actions

`Button` (`ui/button.tsx`) with `variant="link"` is the canonical compact text-link action, including anchors styled through `buttonVariants`. It uses the account primary text colour without an underline at rest or on hover. Do not restore a hover underline or recreate this treatment at a call site. `AccordionContent` keeps underlines on ordinary prose links but excludes `[data-slot="button"]`; an anchor using `buttonVariants` inside an accordion must carry that slot marker so the two masters do not collide.

## Form fields

### Dialog title hierarchy

`DialogTitle` (`ui/dialog.tsx`) owns modal-title typography. Its default size remains the compact-dialog treatment; large split-layout and multi-step dialogs use the supported 18px semibold `size="lg"` variant instead of call-site size/weight overrides. Section headings inside a large dialog must remain subordinate to that title. Canonical large consumers: single-member creation (Add member and Convert to member) and the contact/lead Import wizard.

### Modal backdrop

Every focus-taking modal layer uses the shared Dialog or Sheet primitive and therefore the single `MODAL_BACKDROP_CLASS` recipe in `ui/modal-backdrop.ts`: a semantic background veil plus visible backdrop blur. Never restyle or remove that treatment at a call-site. Base UI deliberately omits a child Dialog's backdrop, so the same master also blurs a parent Dialog/Sheet popup while `data-nested-dialog-open` is present. Popovers, Selects, and DropdownMenus remain lightweight anchored panels and deliberately do **not** use the modal blur recipe.

**Fields are unfilled — never add `bg-muted` to one.** Every control (`Input`, `CurrencyInput`, `Textarea`, `SelectTrigger`, `DatePicker`, rare native `<input>`) renders on the primitive's `bg-transparent` (+ `dark:bg-input/30`). It reads as a field because of `border-input-border`, not a grey box. (~180 hand-added `bg-muted` fills were stripped across auth / contacts / leads / members / settings / broadcasts / automations / flows.) Don't reintroduce it; don't "fix" a plain-looking field by filling it.

Placeholder copy always uses the field primitive's `placeholder:text-muted-foreground`; never replace it with a prefilled controlled value merely to show guidance, and never override its colour at a call-site. Real user-entered values remain foreground text. When existing data is shown as placeholder guidance, preserve that data separately if the user submits without typing a replacement.

`bg-muted` stays correct for **non-field** surfaces (decorative/summary boxes `bg-muted/20`–`/40`, pills, badges, avatars, icon boxes, code chips, table headers, skeletons, message bubbles, segmented toolbar controls, Calendar's "today" cell) and for **state** styles (`hover:`/`focus:`/`data-[…]:`).

Deliberate filled exceptions (different pattern, not form fields): `SearchInput` and the chat surfaces (inbox `message-composer`, `contact-sidebar` note box, `ai-playground`).

### Labels

`Label` (`ui/label.tsx`) owns field-label typography. Its default is 14px medium; `size="sm"` is the documented compact-muted treatment: 12px, normal weight, `text-muted-foreground`, and 16px line height. Follow-up Reason, Follow-up, Due date, Assign to, and Reminder all consume this exact master recipe. Sibling labels in one field group use the same size. Never override label typography with a call-site `className`.

### No native `<select>`, ever

Every form dropdown is `ui/select.tsx`. Native selects render an unstylable OS popup and their hand-rolled triggers drifted from `Input`'s tokens. All ~40 were converted.

Idiom (see `member-personal-info.tsx` gender picker):

```tsx
<Select value={x || undefined} onValueChange={(v) => set(v ?? "")}>
  <SelectTrigger id={…} className="w-full"><SelectValue placeholder="…" /></SelectTrigger>
```

- Trigger defaults to `w-fit` → pass `w-full`. No `bg-muted`. `id` on the trigger (keeps `<Label htmlFor>`). `disabled` on the root.
- Base UI types `onValueChange` as `string | null` → guard always-set handlers with `(v) => v && f(v)`.
- Clearable field → a `<SelectItem value={null}>` first item (null re-shows the placeholder). A _selected_ null item ALSO renders as placeholder, so a real option mapped to `""` state (contact-form's "New" status) uses `value={null}` + a dynamic placeholder.
- `<optgroup>` ⇄ `SelectGroup` + `SelectLabel`.

**Controlled-vs-uncontrolled trap (fixed at the master):** Base UI latches `isControlled = value !== undefined` into a ref on the FIRST render, so `value={x || undefined}` mounted every Select _uncontrolled_ and flipped it to _controlled_ on first pick — console warning, and an uncontrolled root **ignores a programmatic reset** (form cleared, dialog reopened on another record). `null` = "controlled, nothing picked"; `undefined` = uncontrolled. The `Select` wrapper now **coerces an explicitly-passed `value: undefined` → `null`** (keyed on `"value" in props`, so a genuinely uncontrolled Select using `defaultValue` is untouched). The `value={x || undefined}` idiom stays correct — don't "fix" a call-site to `defaultValue`.

**Trigger label resolution (fixed at the master):** Base UI's `Select.Value` renders labels ONLY from the root's `items` prop, never from mounted `SelectItem` children — so a selected value used to echo raw (plan UUID, `male`). The wrapper now auto-derives `items` by walking its JSX children (explicit `items` wins; null-valued items skipped). Caveat: `SelectItem`s hidden inside a custom component aren't seen — those call-sites pass `items` explicitly.

### Date fields

`DatePicker` (`src/components/ui/date-picker.tsx`) — a **whole-field-clickable** Input-styled Popover trigger (CalendarIcon + `fmt.date`) opening `Calendar` (`ui/calendar.tsx`, react-day-picker v10). Replaced every native `<input type="date">` (only the icon was clickable; OS popup clashed).

- **Value contract = a date input's:** `value`/`onChange` are `'YYYY-MM-DD'` strings (parsed from parts, **never** `new Date(str)`); `min`/`max` are inclusive `'YYYY-MM-DD'`.
- Locale-aware: display via `fmt.date`, `weekStartsOn = locale.weekStart`.
- `Calendar` gotchas: month/year caption dropdowns route through **`ui/select`** via a custom `components.Dropdown` (rdp reads only `Number(e.target.value)`, so it's handed a `{ target: { value } }` synthetic — do NOT let rdp render its native `<select>`). Day cells/nav reuse `buttonVariants`. No rdp CSS import. Year range = `min`→`max`, else −100y→+5y via `startMonth`/`endMonth`.
- Layout is **fixed-width** (`root w-[16.5rem]`, fixed month/year trigger widths, `flex-1` day cells) so the popup doesn't resize with the month name. The rdp nav strip is `pointer-events-none` (chevrons re-enable) or it paints over and swallows caption-dropdown clicks.
- A "Today" footer link (account-tz `fmt.today()`, hidden when outside `min`/`max`) picks today and closes.

### Money inputs

`CurrencyInput` (`ui/currency-input.tsx`) — master `Input` with the account's currency symbol centred in a divided leading compartment. The divider, compartment width, and matching input padding are master behavior; never recreate or override them at a call site. Two modes:

- **plain** — `type="number"`, `value`/`onChange`.
- **grouped** — pass `groupLocale={locale.locale}` + `onValueChange`; renders `type="text"` with locale grouping as you type (`₹1,00,000` on en-IN) while returning the RAW numeric string. Caret restored by digit position.

A `type="number"` field can NEVER show separators — any new money field that should group uses grouped mode.

**Gotcha:** an `overflow-y-auto` scroller (dialog body) or a `Collapse` clips the focus ring on BOTH axes (non-`visible` `overflow-y` forces `overflow-x: auto`). Give it `-mx-1 px-1 py-1`-style inner padding or every field's ring gets sliced.

### Phone inputs

`PhoneInput` (`ui/phone-input.tsx`) — master `Input` for every subscriber/customer phone field. It reads `useLocale().locale.phoneCountryCode` and shows that code in a muted, divided, non-editable leading compartment; token-scoped public forms may pass the account code through the `countryCode` prop because they do not have an authenticated locale provider. The field must never offer a country picker or mutate the account setting.

The visible country code is always canonical `+<digits>` even when a legacy or token-scoped source supplies digits only. The DOM field shows only the national-number portion, while `value`, `defaultValue`, and `onValueChange` use the complete account-qualified phone expected by persistence, dedupe, and WhatsApp paths. The component owns splitting/joining the fixed code, removes a domestic trunk zero when joining, preserves explicit international input, and uses each `COUNTRY_PRESETS` entry's `phoneNationalLengths` to guard national numbers that happen to begin with the same digits as the country code. Do not repeat that normalization at call sites. Every inline editor uses the compact check/cross `InlineEditActions` pair. In a constrained table cell, an active phone editor expands to at most 15rem without changing the column width, floats above adjacent cells on `bg-card` with the floating-panel shadow, and caps itself to the viewport width; the country code, complete national number, and actions remain together inside that shell, with input padding clearing the icons. Regional settings' country-code field, Meta's Phone Number ID, and other identifiers are not subscriber phone fields and remain ordinary `Input`s.

### Search & searchable selects

- `SearchInput` (`ui/search-input.tsx`) — leading glyph over a **rounded-rectangle** `Input`, `border-border` + muted fill. Its wrapper owns the fixed 240px width; `containerClassName` is only for external layout such as margin or responsive visibility. Radius/border/icon/padding are **fixed** — never restyle per call-site. It is a controlled `type="search"` field (`value` + `onValueChange`) with a trailing clear button only while editable and non-empty; clear and Escape both reset through `onValueChange` and return focus to the input. It defaults to `aria-label="Search"` and `enterKeyHint="search"`; pass a contextual `aria-label` at the call-site. Used by leads/members/check-in toolbars, inbox conversation list, import + manage-columns pickers. (`Combobox`'s in-popover search and `global-search`'s command trigger are deliberately their own patterns.)
- `Combobox` (`ui/combobox.tsx`) — Select-styled trigger → Popover with search over **grouped** options + optional pinned footer action ("＋ Create…"). Use for lists too long to scan (import wizard's field picker). Short static lists stay on `ui/select`. Don't hand-roll popover+input search.

### List toolbar order

Data-list toolbars follow one reading order: **Search → Filters → Sort → vertical Separator → filter Chips → trailing view/scope/actions**. Omit controls a surface does not support; render the Separator only when Chips follow Filters and/or Sort. Search stays first and trailing presentation/scope controls use `ml-auto`. Canonical: All members and All leads.

## People

- **`UserAvatar`** (`ui/user-avatar.tsx`) is the canonical avatar — photo when `src` is set, first-initial fallback on the primary tint otherwise. **Every** person render goes through it (teammates, members, contacts, table/board views) so a photo uploaded once appears everywhere. Never hand-roll `Avatar + AvatarImage + AvatarFallback` for a person. Size via the `size` prop — `xs` (20px), `sm` (24px), `default` (32px), `lg` (40px) — and `className` only for a size the scale does not have. **Never set a text size in `fallbackClassName`.** Each named size already steps its initial onto the ramp; `fallbackClassName` is for the fill/tint alone, as the amber pending-transfer avatars use it. `xs` exists because a bare `className="size-5"` had become an unnamed fourth size at fifteen call sites: the Root resized but the Fallback kept its 14px default, so every one of them hand-corrected the initial and landed somewhere different — 9px, 10px, and 11px for what is visually the same avatar. A new size belongs in `ui/avatar.tsx`, never as a call-site pair of `size-N` plus a guessed `text-[Npx]`. Presence dots are children. Teammate URLs from `useAccountStaff()` (`avatarById`); current user from `useAuth().profile.avatar_url`.
- **`MemberIdentity`** (`components/members/member-identity.tsx`) is the canonical member cell — `UserAvatar` + name over a comm line (phone). Used in **every** member row: all-members table, renewals, follow-ups, trials, payment-due, inactive, check-in, payments ledger. Never hand-roll a name+phone stack for a member. Optional `meta` = a third caller-styled line ("plan · due date"); with `meta` the avatar top-aligns, else it centres. Pass `src` (`contacts.avatar_url`) at every call-site. Every Members-page tab also passes the shared `buildMemberAvatarPreview` result: hover/focus stays anchored to the avatar, enlarges the already-loaded photo, and exposes the row's applicable Details, reminder, and Follow-up actions without a hover-time query.
- **Member photo upload** — lives on `contacts.avatar_url` (no migration) in the `avatars` public bucket (path `{auth.uid()}/member-<contactId>-<ts>.webp`; RLS keys on the uid first segment). Click the large avatar in the member detail header (gated `canSendMessages`) → `AvatarEditorDialog`: view/upload/change/remove or paste an image from the clipboard with the platform shortcut, then **square crop** via `react-easy-crop` v6 (its structural CSS `react-easy-crop/react-easy-crop.css` **must be imported** — not auto-injected). On save, `cropToWebp` (`src/lib/images/optimize.ts`) crops → caps at `MAX_AVATAR_PX` (512) → WebP at 0.82, so a multi-MB phone photo lands ~30 KB. Writes chain `.select('id')`; previous object best-effort GC'd.

## Contact / lead detail surface

There is **ONE** lead/contact detail surface: **`ContactDetailContent`** (`components/contacts/contact-detail-content.tsx`) — identity header + quick-action row over the **Details / Tags / Notes & follow-ups** accordion. It owns its own fetches (`contacts`, `conversations`, `tags`+`contact_tags`, `custom_fields`+`contact_custom_values`), its own writes, and the shared option lists (`useLeadFieldOptions`).

It is **host-agnostic on purpose** (renders no Sheet chrome) and has exactly two hosts:

- `ContactDetailView` (`contact-detail-view.tsx`) — a thin `/leads` Sheet wrapper.
- `ContactSidebar` (`components/inbox/contact-sidebar.tsx`) — the inbox's 360px right panel.

**Hosts differ ONLY by props, never by forking:**

| Prop                | Purpose                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant`           | `'sheet'` renders Base UI `SheetTitle`/`SheetDescription` (Dialog parts — they **throw** outside a Sheet root); `'panel'` swaps in plain elements with identical classes        |
| `actions`           | allowlist of `ContactQuickActionId` — the inbox drops `chat` (you're in the thread) and `template` (composer is right there)                                                    |
| `collapsedSections` | inbox collapses `details` (13 label/value rows in a 360px rail is a wall)                                                                                                       |
| `active`            | fetch trigger — sheet passes its `open`, panel passes `true`                                                                                                                    |
| `onClose`           | dismisses the host. The **panel** renders it as a real Close button in its header; the **sheet** does not, because `SheetContent` already supplies an X, a backdrop, and Escape |

**Every affordance that opens the panel also closes it.** The inbox panel is an
inline column with no backdrop and no Escape, so it needs visible ways out: its
header Close button, the thread header's avatar/identity block, the active
conversation row's avatar, and the thread header's ⋮ item. The avatar targets
were reveal-only once, which shipped a panel a user could summon and not
dismiss — never reintroduce a one-way disclosure here. Each toggle carries
`aria-expanded` and swaps its label between **Open**/**Close** so AT never
announces "collapse" for a control that expands. A row avatar toggles only on
the row that is already active; on any other row it selects that conversation
and reveals the panel.

Adding a lead field once surfaces it in the table, the sheet **and** the inbox. The inbox panel is fully editable (same writes, same RLS, same transfer/assignment approval RPCs) and re-pulls the page's `activeContact` via `onUpdated` so the thread header + conversation list can't go stale.

The three overlays (`TemplatePicker` / `MemberForm` / `TransferRequestDialog`) live inside the content and therefore nest inside `SheetContent` on `/leads` — that's the established shape (member-detail nests its invoice/payment dialogs the same way), not a hazard.

The lead/contact header never renders a WhatsApp consent action. Scoped consent audit recording belongs only to the member profile's **Settings** card; the underlying history remains available without adding a competing lead quick action.

**Mobile (`<lg`):** the inbox is single-pane, so the same surface opens as an overlay Sheet via `ContactProfileSheet` (`variant="sheet"`, Details expanded). Gated in JS on `useMatchMedia("(min-width: 1024px)")` — **not CSS**: a Sheet portals to `<body>`, so a `lg:hidden` wrapper would style the wrapper and still let the overlay open on desktop.

## Notes thread

`ContactNotesThread` (`components/contacts/contact-notes-thread.tsx`, keyed by `contactId`) — composer + note cards + follow-up-on-note + all mutations. Mounted by both the lead detail surface and the member detail sheet. Its composer is the shared `FollowUpComposer`, and it consumes the shared `FollowUpDraft` / `DEFAULT_FOLLOW_UP_DRAFT` / `resolveDueDate` model from `components/follow-ups/follow-up-fields.tsx`. A member host passes `followUpReason={defaultReason(membership, fmt.today())}` so the composer opens on the same Reason chip a row action would pick; contact/lead hosts omit it and keep the neutral sentinel.

`FollowUpButton` (`components/follow-ups/follow-up-button.tsx`) is the canonical manual row trigger everywhere: ghost/small, `ListPlus`, and the verb **Follow up**. Gate it with `canAct`, never a bare `disabled`, so a viewer gets the Read-only tooltip instead of a dead control — the row trigger and the same row's avatar quick view must agree. It opens the shared `FollowUpDialog`; the only other manual creation path is the composer inside the profile section canonically labelled **Notes & follow-ups**. That section is a merged newest-first timeline: every task uses the same follow-up-first card hierarchy (task and due date, optional note, then created/assigned metadata), whether created from the row action or attached to a profile note; standalone tasks remain visible when their optional note is empty. Note-only entries remain note-first. Bulk Add note must stay note-only. Lead creators omit Reason chips and persist the schema's neutral `other` sentinel; member creators keep the contextual Reason choices. The noun remains hyphenated (**Follow-up**) in dialog titles, fields, queues, and statuses.

**`FollowUpComposer` (`components/follow-ups/follow-up-composer.tsx`) is the only manual follow-up writing surface.** One bordered card: a borderless note textarea, then `FollowUpFields` attached beneath it by a divider. The profile **Notes & follow-ups** composer and the standalone `FollowUpDialog` both mount it and must not grow a second layout — note first, fields below, ⌘/Ctrl+Enter submits, one shared placeholder. They differ only in what is required: the profile composer requires the note and toggles the follow-up on with the switch, while the dialog hides the switch because it _is_ the follow-up and its note is optional. Never render `FollowUpFields` outside this composer.

A note written in either surface is a real note. Both write a `contact_notes` row, link it through `follow_ups.note_id`, and copy its first 200 characters onto the task, so the timeline keeps the context after `CompleteFollowUpDialog` overwrites `follow_ups.note` with a closing note.

The database allows one **open** follow-up per contact. `FollowUpDialog` reads that task when it opens and, if one exists, replaces the form with a **Follow-up already open** state — the task's `FollowUpTaskSummary`, its due date and due-state badge, and a **Complete follow-up** action that swaps in `CompleteFollowUpDialog` as a sibling dialog (never a dialog nested inside a dialog). Every rejected write still names the same recovery: _Only one open follow-up at a time — complete the current one first._

The shared manual field set (`components/follow-ups/follow-up-fields.tsx`) uses one control recipe throughout: every value control — task type, due date, assignee, reminder — is an outline `Button size="sm"` menu trigger sitting under its own `Label size="sm"` caption inside a `role="group"`. Reason is the only exception, because a `ChipGroup` owns its full row. Never demote one of these fields to a ghost trigger or an inline label; the note composer and the standalone `FollowUpDialog` reach it only through `FollowUpComposer` and must not diverge.

Each value control carries its **own** caption, and the four sit in two `w-full justify-between` pairs — **Follow-up** / **Due date**, then **Assign to** / **Reminder** — collapsing to one column in a narrow composer. Task type and due date must not share a caption: `Follow-up` names the work and `Due date` names when it is owed, and one caption over both names neither. The unset reminder trigger reads **No reminder**, matching its own menu's first item. A custom due date renders through `fmt.date`, never the raw `YYYY-MM-DD`; before a date is picked the preset trigger reads **Custom date** — naming the choice — while the instruction **Pick a date** belongs to the date field alone, never to both stacked controls.

Profile follow-up cards read their task-type glyph from the `TASK_ICON` map exported by `follow-up-task-summary.tsx` — one icon vocabulary for queue cells and cards. An **open** task shows a due-state Badge (`danger` Overdue, `warning` Due today) resolved by the shared `followUpDueState` in `lib/follow-ups/due-state.ts`; Upcoming stays badge-free, matching `lead-accountability-view`'s `ISSUE_BADGE`, and a done or cancelled task never claims urgency. Never re-derive that mapping at a call site. A set reminder renders as its own supporting line so the user can verify what they scheduled. An assignee always reads `<name> (Me)` — the same order the Assign to field uses. Saved-note cards keep Edit and Delete as real footer buttons that reveal on hover or focus and stay visible under `(hover: none)`; clicking the note body is a mouse shortcut on top of them, never the only way in. The card footer carries the creation date only — the `StaffAvatar` beside the card identifies the author, and that name must not be repeated as footer text.

`FollowUpTaskSummary` (`components/follow-ups/follow-up-task-summary.tsx`) is the canonical follow-up table cell: task-type icon + task label, with an optional note beneath. Lead queues use that base treatment; member queues additionally pass the member-only neutral Reason badge. Do not reconstruct this cell at a table call-site.

`FollowUpQueueControls` (`components/follow-ups/follow-up-queue-controls.tsx`) is the canonical toolbar for the Leads and Members follow-up tabs: `SearchInput` + shared Filters + Sort + counted All/Overdue/Due today/Upcoming chips + My work/Team scope. The shared due-date and assignee filter panel lives in `components/follow-ups/follow-up-filters.tsx`; member queues enable the contextual Reason facet, while lead queues do not. Both tables keep column management, resizing, selection/bulk completion, inline reassignment, and pagination in parity. Member reminder actions and Reason badges remain member context; lead Status/Stage age remain lead context.

## Tables

Every table header label uses the muted neutral foreground owned by `TableHead` (`src/components/ui/table.tsx`). Do not restore foreground text or repeat `text-muted-foreground` at a call-site; consumers control only layout such as alignment, width, padding, and responsive visibility.

### Table loading

Async tables keep their real header, column widths, horizontal overflow, and sticky-column geometry visible while data loads. Use `TableSkeletonRows` when the table shell already renders, or `TableSkeleton` when the whole table is the loading boundary; both live in `src/components/table/table-skeleton.tsx`. Choose cell variants by the content being reserved (`identity`, `stacked`, `badge`, `checkbox`, `actions`, or plain `text`) and keep responsive visibility classes in the column config. Do not replace a table with a centred spinner or a single grey rectangle: both hide the destination structure and create a larger layout shift when rows arrive. Skeleton rows are presentation-only; the table exposes one concise loading status and never announces each placeholder cell.

### Product terminology and column labels

Visible product vocabulary is a shared interface contract. The same data concept keeps the exact same label across pages, tabs, tables, sort menus, column menus, filters, exports, and empty states. Never rename a familiar column to make one section sound more contextual.

- A member identity rendered with `MemberIdentity` is always **Name**. Do not relabel it as “Member,” “Customer,” “Customer details,” or “Member details.”
- Reuse the canonical labels from the primary table for shared member columns: **Name**, **Member ID**, **Plan**, **Expiry**, **Status**, **Assigned to**, **Fee**, and **Actions**.
- Finance → Invoices deliberately uses **Membership** for its combined plan-and-billing-period column: plan name is primary and the billing-period date range is its subtitle. It keeps **Member ID** separate from **Name** and uses **Balance**, without a redundant payment-status column.
- Follow-up-specific concepts remain **Due date**, **Follow-up**, and **Reason** wherever they appear. The task column is always **Follow-up**, never “Notes” or “Next action”; its optional note is supporting text inside the cell.
- In lead and follow-up surfaces, the accountable task is always called **Follow-up**. Use **No follow-up** and **Add follow-up**; never expose “next action” as a synonym. “Task” is an internal word only — user-facing buttons and descriptions say **Cancel follow-up** / **Cancel follow-ups**, never “Cancel task”.
- A follow-up's user-facing states are **Open**, **Completed**, and **Cancelled**; the verb that closes one is **Mark done**. The profile tick opens the Complete follow-up dialog, so its accessible name is **Complete follow-up** — not “Mark as followed up”, which promised an inline write it never performed.
- The verb for a note is **add**, everywhere: the quick action **Add a note**, the composer CTA **Add note** / **Add note & follow-up**, the bulk **Add note**, and the toast **Note added**. Do not mix in “create” for notes; **Create follow-up** stays the standalone dialog's own verb.
- Internal field keys may differ, but user-facing labels must not. A new synonym requires explicit product agreement and an update to this vocabulary before implementation.
- When adding or reviewing a table, compare every shared column and sort/filter label with the closest existing table before writing code.

### Column header

`ColumnHeader` (`src/components/table/column-header.tsx`) is the single source of truth for the `/leads` table AND the All-members table: label + one double-sided sort toggle (`ChevronsUpDown`, cycles asc→desc, shows the active direction lit) + a three-dot overflow menu (Sort asc/desc, an Excel-style value **Filter** submenu, column actions).

- Freeze / add-column / edit-options / drag-handle / the greyed "smart property" placeholder are **optional props** — leads passes the full set, members mounts just Sort + Filter + Hide.
- **The resize grip and any drag transform live on the owning `<th>`, never in `ColumnHeader`.**
- Don't fork it — restyle via props. Leads' `HeaderCell` is a thin adapter; members renders it directly.
- Members: column meta = `MEMBER_COLUMNS` (`members-table.tsx`), cells = `renderCell()`; header Filter submenus wire to the shared `MemberFilters` dims (plan/status/fee) so header filter ⇄ Filters panel can't drift. Layout (order/hidden/widths plus the Name-column freeze choice) persists in the `members-all` `useTablePrefs` blob; a toolbar "Columns" menu is the unhide surface. Only the required **Name** column is freezable, and freezing it also pins the leading selection checkbox; drag-reorder remains deliberately skipped for this compact fixed-column table. Frozen body cells use the opaque `bg-card-2` hover fill, never the row's translucent `bg-muted/50`, so scrolled content cannot bleed through the sticky layer.
- Attendance keeps its columns fixed but still uses `ColumnHeader` for interactive headers. Its **Plan** menu mirrors the All-members plan-value filter; do not replace it with a plain text header or add a one-off filter control.

### Lead-field cells

`src/components/leads/lead-cell-renderers.tsx` — `StatusBadge`, `AssigneeDisplay`, `statusCellOptions` / `sourceCellOptions` / `genderCellOptions` / `assigneeCellOptions`, `customEditKind`. Consumed by BOTH the `/leads` table and the import preview grid so they can't drift. Any new surface rendering lead fields goes through these.

### Persisted table views

`useTablePrefs(viewKey, defaults)` (`src/hooks/use-table-prefs.ts`) — per-user, per-account column state in the `table_preferences` table (migration `053`). Keeps the `useLocalStorage` `[value, setValue]` API: paints from a per-scope `localStorage` cache on first frame, DB row wins on load, writes update state + cache synchronously and **debounce** the upsert (500ms, flushed on unmount). Keys: `'leads'` (order/hidden/widths/pageSize/viewMode/view/sort/frozenCount/board) and `'members-all'`. `useLocalStorage` remains for non-scoped prefs.

## Badges / status pills

### Products & services vocabulary

Use **Products & services** for the catalogue/settings/profile section and **Services** for the Renewals source. A duration-based sold service is a **service**, not a plan or package; **trainer** is a service-assignment identity, never a staff authorization role. Service status copy is exactly **Upcoming**, **Active**, **Expired**, or **Cancelled**. Owner-facing trainer pricing is always called **trainer fees**, never a rate matrix. Missing trainer-duration pricing reads **Trainer fee not set** and makes the option unavailable—it must never imply a fallback or silently substitute another trainer's price. Fee setup reports **Trainer fees not set**, **Fees set for N of N trainers**, or **Fees set for all N trainers**; its CTA is **Set trainer fees** or **Edit trainer fees**. **Renew** extends by issuing a new service purchase at the current configured rate; **Reassign trainer** preserves the existing expiry and shows the prorated adjustment/credit result.

Settings → Products & services → Trainers shows every registered team member with a **Trainer** switch. Turning it on links that team account to one trainer identity; turning it off archives the identity from new assignments while preserving rates and service history. The switch never changes the teammate's account role or permissions. Trainers without team access stay under **Independent trainers** and keep the same avatar/name/context roster row, but their trailing action is a destructive trash button rather than a redundant Trainer switch. That card's header keeps the concise subtitle **For trainers without UsefulDesk team access.** and the contextual **Add trainer** action; neither belongs in a detached tab-level toolbar. Deleting an independent trainer removes saved rates while historical invoices and service assignments retain their snapshots.

`Badge` (`ui/badge.tsx`) is the canonical pill.

- **Never override a Badge's height, typography, padding, radius, border, or colours with call-site `className`.** Use the unmodified primitive and its documented variant. Two badges in the same family must therefore have identical geometry and type treatment.
- Fixed statuses → tinted variants (`success`/`danger`/`warning`/`info`/`violet`/`orange`/`pink`), **fill-only** recipe `bg-{c}/10 text-{c}-foreground`. No borders on pills.
- Admin-created **tags always render `variant="neutral"`** — the slate fill-only tint (`bg-slate-500/10 text-slate-foreground`). Slate = the neutral, non-colour-coded look.
- DB-driven hex colours (lead statuses) use the `color` prop. Known colour-picker values resolve to the exact fixed semantic variant (legacy red hex → `danger`, green → `success`, yellow → `warning`, blue → `info`, etc.); only an unknown custom hex uses the contrast-derived `.badge-tinted` fallback. The editor preview and swatches use the same mapping from `lib/semantic-colors.ts`.
- Domain wrappers map domain state → variant (`MembershipStatusBadge`, `FeeStatusBadge`, `InvoiceStatusBadge`, `InvoicePaymentBadge`, `PlanTypeBadge`, `VoidedPaymentBadge` — all in `components/members/membership-status-badge.tsx`). Add a wrapper rather than repeating variant choices at call-sites.
- Interactive chips (clickable choices and filters) use **`Chip` inside `ChipGroup`**, not badges. Don't force them into `Badge`.
- Follow-up due state is a status (`danger` for Overdue, `warning` for Due today, `neutral` for Upcoming); follow-up reason is a category (`neutral`). Their colours communicate different semantics, but both use the exact unmodified Badge geometry and typography.
- Compact live counters use `Badge size="count"`. This is the canonical segment/filter-chip counter geometry; do not reconstruct it with class overrides.
- **Inside a message bubble, a provenance tag is `BubbleMarker` (`components/inbox/message-bubble.tsx`), not a Badge.** A translucent chip laid on a bubble lightens the text's own background — the old `bg-primary/20 text-primary-text` Template pill measured 3.7:1 on cobalt and 3.9:1 on rose. The marker is unfilled and takes `text-chat-meta-out` on the outbound bubble / `text-chat-meta` on the inbound one; size and caps carry the demotion instead of colour. **Template** and **Button reply** share it — add a marker there rather than a second recipe, and never re-add a fill. See **Inbox chat surface** below for the tokens.

## Inbox chat surface

The inbox thread is the one place in the product that is deliberately modelled on another product's interface. Gym owners and front-desk staff already run their day inside WhatsApp; every hour they spend not re-learning a chat client is an hour the CRM does not cost them. Jacob's Law is the whole argument, so **fidelity to WhatsApp outranks local invention here** — but never the token layer, the accent system, or contrast.

### Tokens (`globals.css`)

The thread is neither `--background` nor `--card`. It has five of its own, and no chat colour may be written at a call site:

| Token               | What it is                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--chat-canvas`     | The recessed conversation plane. Sits **below** the list panel in both modes, which is what makes the list read as a panel. |
| `--chat-bubble-in`  | Inbound fill. Rises off the canvas on light, sits above it on dark.                                                         |
| `--chat-bubble-out` | Outbound fill: `color-mix` of `--primary` into the mode's base — a **tint**, never a solid accent fill.                     |
| `--chat-meta`       | Derived from `--chat-bubble-in`. Timestamps, ticks, markers on the inbound bubble and on the canvas.                        |
| `--chat-meta-out`   | Derived from `--chat-bubble-out`. Same job on the outbound bubble.                                                          |

**The Derived-Meta Rule.** The two meta tokens are `color-mix`ed from the fill they sit on, never declared per mode. The outbound bubble's lightness swings from violet's 0.36 to amber's 0.45 on dark, so a fixed grey lands anywhere between 3.6:1 and 7:1 depending on the account's accent. Deriving keeps all ten mode × accent combinations at 5.99:1 or better with no per-accent table. **Do not replace either with a literal, and do not copy WhatsApp's own `rgba(0,0,0,.6)` timestamp — on `#d9fdd3` it measures 2.3:1.**

**Body text on both bubbles is `--foreground`.** Because the outbound bubble is a tint, not a fill, there is no inverted palette inside it; `text-primary-foreground` does not belong on any chat surface.

### Bubbles

- **Geometry:** `rounded-lg` (10px), `px-2.5 py-1.5`, capped at `max-w-[min(65%,30rem)]` by `MessageActions`, with `shadow-[var(--chat-bubble-shadow)]` on both kinds. In light mode the inbound bubble is white on a near-white canvas, so the hairline shadow is load-bearing, not decoration.
- **Runs and tails.** `startsNewRun` (`message-thread.tsx`) opens a run on a sender change or a gap over `RUN_BREAK_MINUTES`. A run-opening bubble squares its outer **top** corner and draws `BubbleTail`; the rest stack at `mt-0.5` while runs separate at `mt-3`. Those two gaps are the thread's rhythm — **a uniform gap between every bubble is what makes a chat UI read as a list of records.**
- **Metadata rides the last line.** `BubbleMeta` renders twice: once `invisible` and inline so the final line wraps short of it, once absolutely positioned over the space that opens. Never replace this with a metadata row — a two-word reply would become two lines tall. Content types with no trailing paragraph (media, documents, audio, location) opt out through `trailingMeta`.
- **Anything that straddles two surfaces needs an OPAQUE fill.** The reaction pill overlaps the bubble's bottom edge, so half of it sits on the bubble and half on the canvas. Given a translucent fill — it shipped briefly on `--primary-soft`, a 12%-alpha accent — both surfaces read through it and the emoji floats in a two-tone wash. Every pill therefore takes the opaque `--chat-bubble-in` (white on light, the raised surface on dark), and every pill looks the same whoever left it — your own reaction is distinguished by `aria-pressed` and by the fact that clicking it removes it, not by a tint or a ring. The `--primary-soft` / `--primary-soft-2` pair stays correct for a chip sitting on ONE known surface; it is wrong the moment an element spans two.
- **The read tick is `text-sky-foreground`, and must not follow the account accent.** Blue double-ticks are the most recognised delivery signal in messaging; on the emerald or cobalt accent an accent-coloured tick would make "read" and "brand" the same colour. Every delivery state also carries an `aria-label`, so the meaning never rides on colour alone.

### The thread follows the reader, not the other way round

The message pane pins to the newest message **only while the reader is already
within `STICK_TO_BOTTOM_PX` (120) of the bottom** — tracked by `stickToBottomRef`
from the scroll event, never derived in render. It used to pin on every
`messages` identity change, which meant scrolling back through history was
undone by the next delivery receipt anywhere on the account. Above that band a
**Jump to latest** button appears; it sets `scrollTop` directly rather than
`scrollTo({behavior:'smooth'})`, because a smooth scroll emits intermediate
scroll events that read as "not at the bottom" and flash the button back on
mid-animation.

Two things must stay pinned alongside it. Toggling the contact panel re-pins
through an effect keyed on `contactPanelOpen`: narrowing the thread by 360px
re-wraps every bubble and grows `scrollHeight` while `scrollTop` stays put, so a
bottom-parked reader drifted hundreds of pixels up just for opening a profile.
And both message-update paths in `inbox/page.tsx` return `prev` unchanged when
the id is not in the open thread — the realtime channel carries every message
UPDATE in the account, and a blind `.map` handed back a fresh array for each one.

### A closed 24-hour window removes the composer, it does not disable it

While the session is closed, nothing the input row offers can leave the account
— free-form text, media, and an AI-drafted reply are all refused by Meta until a
template reopens it. So `message-composer.tsx` omits the row and the amber
banner becomes the bottom bar, carrying the single move that still works
(**Send a template**). This is the **Blocked actions** rule at the top of this file
applied literally: an action that no longer applies is removed, not left
standing as four controls that open the same explanation. Bubble **Reply** is
omitted for the same reason — it would arm a quote with nowhere to land, so
`message-thread.tsx` passes no `onReply` while the window is closed.

Two branches survive the close, deliberately: a **staged attachment** and a
**live recording**. A session that expires mid-compose must not silently swallow
an upload the agent already made, so those keep their shell and their own Send,
which still opens the closed-session blocker and its template resolution.

**The thread header's Status, Assign, and ⋮ are ghost buttons, not pills.** A pill trigger is the page-level filter idiom and it belongs on the list toolbar; three outlined pills in a row above a conversation put a fence around controls the eye should slide past. Ghost keeps the header as quiet as the one every user already knows, and the assignee's own name is the state readout that the accent tint used to provide.

### Deliberate deviations from the rest of the system

Two, both scoped to `components/inbox/` and both brief-driven. Do not generalise them, and do not "fix" them:

1. **The reply quote keeps a 4px `border-l-primary` bar** (`reply-quote.tsx`). Thick coloured side borders are refused everywhere else; this one is how every messaging client on the market signals a quote, and losing it costs more recognition than the rule protects.
2. **A conversation row hovers on its fill, not its border** (`hover:bg-foreground/5`, active `bg-primary-soft`). The clickable-card border rule governs bordered cards; a conversation row is a list row, which that rule already leaves on its own idiom.

### Where fidelity stops: our components stay our components

WhatsApp's icon actions are 40px circles. **Ours are not, and that is not a gap to close.** Every icon action on this surface — the header's ⋮ and back arrow, the composer's attach / template / AI / send, the hover toolbar's react / reply / copy, the reply quote's dismiss — is the unmodified `Button` master at a named `icon-*` size, and the product's `rounded-lg` icon geometry is the design language, not a compromise with it.

**Never reintroduce circles here.** Not with `rounded-full` at a call site, and not by adding a circular variant to `ui/button.tsx` for this surface's sake — a shape axis added to satisfy one screen becomes the override everyone reaches for next. Borrowing another product's _layout, rhythm, and interaction model_ is the point of this surface; borrowing its component geometry is where the borrowing ends.

One hand-roll survives, deliberately: the emoji swatches inside the reaction picker (`message-actions.tsx`) are native buttons carrying a glyph and a `hover:scale-125` affordance. They are colour swatches, not icon buttons. **If that picker is ever revisited, decide with the user whether it becomes a master component rather than quietly converting it.**

### Everything else stays canonical

Nested corners on this surface follow **Concentric corners** above: the composer shell is 18px around 10px controls at an 8px gap (52px tall), the hover toolbar 14px around 10px at 4px, and a message bubble is 10px around 6px nested blocks at 4px — which is why the bubble pads by only 4px and its text rows carry the reading inset themselves (`BUBBLE_TEXT_INSET`). Do not add padding to the bubble to space out type; it pushes every nested block out of the pair.

The list uses `SearchInput`, `Chip`/`ChipGroup` for queue filters, `Button variant="pill"` for the Tags and Company menu triggers (page-level filter actions, per **Pill action triggers**), `Button variant="link"` for **Clear all**, `Badge size="count"` for unread, `UserAvatar` for every face, and `ScrollArea`. The 48px list avatar and 11px meta type are the two documented size steps this surface added (`UserAvatar className="size-12"`, DESIGN.md's `Meta` step) — both named, neither guessed.

## Chips

`Chip` + `ChipGroup` (`ui/chip.tsx`) are the single component family for compact pressed/unpressed choices. A Chip has exactly one visual recipe: a fully rounded outlined pill whose selected state uses the account primary tint. It must not look like an outline `Button`, and there are no square or rounded-rectangle Chip variants.

- A `ChipGroup` is always a **single horizontal row**. The master hides its native scrollbar, lets the final visible Chip peek when space runs out, and conditionally overlays compact previous/next chevrons to browse the strip. Never restore `flex-wrap` or build page-specific overflow buttons.
- Every set lives in `ChipGroup` and explicitly declares `selectionMode="single"` or `selectionMode="multiple"`.
- **Single selection** — one choice at a time, such as follow-up Reason or a mutually exclusive due-date bucket. A controlled required choice may ignore an empty change so one option always remains selected.
- **Multiple selection** — zero or more independent choices, such as member quick filters.
- Call-sites choose only the documented `size`; they never override radius, padding, colours, border, typography, hover, focus, selected state, or spacing between Chips.
- Use the master default size for both filter sets and form choice sets so every product Chip has consistent geometry and typography.
- List/queue filter Chips append their live count through `ChipCount` (the compact neutral count Badge); selected Chips promote the nested counter into the same primary tint. Queue definitions remain available through `Tooltip` after a 1-second hover delay (keyboard focus remains immediate); do not repeat the same counts and help text in persistent summary cards above the queue.
- Toolbar segments remain `ToolbarToggleGroup` / `ToolbarToggleItem`; they are controls inside the bounded Toolbar family, not Chips.

### Pill action triggers

Page-level **Sort** and **Filters** popover/dropdown triggers use `Button variant="pill"`. This is the action counterpart to a Chip: the same fully rounded outlined silhouette, but button semantics because it opens a menu rather than selecting a choice. Pass `aria-pressed` when a sort or filter is active so the master applies the primary-tinted state; filter counts remain compact primary-filled circles inside the trigger. Do not recreate the radius, border, hover, active tint, or spacing at a call-site. Column-header menus and choices inside a filter panel keep their existing table/menu idioms.

## Money numerals

Every rendered `fmt.money` / `fmt.moneyShort` / `formatCurrency` value sits in an element with **`tabular-nums`** (fixed-width lining digits — keeps columns and count-up animations from jittering). Wrap the money part in `<span className="tabular-nums">` when it's inside prose.

Exempt: non-DOM strings (CSV, WhatsApp template params, toasts) and native `<option>` labels (browsers ignore font styling there).

## Animation (Motion)

Animate through the shared primitives in `src/components/ui/`, not scattered `motion.*` at call-sites.

| Primitive                                           | What it does                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Collapse` (`collapse.tsx`)                         | `open`-driven height+fade reveal that unmounts when closed (replaced the `grid-rows-[0fr↔1fr]` hack; the surrounding flex gap closes on its own)                          |
| `MotionList` + `MotionListItem` (`motion-list.tsx`) | wrap a `.map` so items fade/slide in-out and FLIP-reflow on add/remove/reorder (`AnimatePresence mode="popLayout"` + `layout`). Used on the notes list + `/notifications` |
| `AnimatedNumber` (`animated-number.tsx`)            | count-up on scroll-into-view; drives text via ref (no per-frame re-render); honours reduced-motion. Dashboard KPI tiles (pass `format` for currency)                      |

### Two hard gotchas

1. **Base UI dialogs / dropdowns / sheets / popovers already animate** via `data-open/closed` + `data-starting/ending-style` (tw-animate-css). Do NOT wrap them in Motion — it fights their mount lifecycle.
2. **Never put a `motion.*` (transform) on a `<tr>` or an ancestor of the leads table.** A transformed ancestor becomes the containing block and **breaks `position: sticky` frozen columns.** Row enter/exit is intentionally un-animated for this reason.

### Kanban board (leads) — drag perf is load-bearing

`leads-board.tsx` uses `LayoutGroup` + per-card `layout="position"` / `layoutId` so a dragged card _flies_ to its new column. dnd-kit owns the drag; its `DragOverlay dropAnimation` is `null` so Motion's FLIP owns the settle (**don't re-enable it** — double-animates).

Three things keep it smooth. All three are deliberate:

- **`contain: layout` on every card** (`[contain:layout]`). Motion flushes layout once per move to measure all cards; containment makes each card an isolated subtree so the flush skips its ~30 internal nodes (avatar/SVG/badges/dropdown). Without it the rich card body froze the drop at scale. **The fix is containment, NOT stripping the animation.**
- **Cheap re-renders during drag.** dnd-kit shares one React context, so every `useDraggable`/`useDroppable` consumer re-renders on each column crossing. So: `cardCtx` is ONE memoised object (stable ref); `ColumnCards` (memo, keyed on `leads`+`ctx`) is skipped when a column re-renders for its `isOver` outline; `DraggableLeadCard` is the ONLY context subscriber and is a bare wrapper whose re-render doesn't reach the `motion.div` (its parent); `LeadCard` (memo body) is skipped.
- **The optimistic status update must NOT be page state.** The board lives in an island — `LeadsBoardView` (`leads-board-view.tsx`) — owning a LOCAL optimistic mirror + the drag write, so a drop re-renders only the island + board, not the ~4k-line `LeadsPage` (toolbar, filters, ~10 always-mounted dialogs). The page stays fetch owner (`leads` prop drives the mirror, re-synced via adjust-state-during-render on a new array identity — a state guard `syncedProp`, not a ref, per the react-hooks lint). After the write commits, the island calls `onStatusPersisted` and the page syncs inside `startTransition` so that low-priority re-render can't interrupt the in-flight FLIP.

The drop container transitions only `background-color,outline-color` — never `transition-all`. If a huge board still drags heavy, the remaining lever is lowering `BOARD_LIMIT`.

**Board parity rules:** the board honours the shared Filters panel (`fetchBoard` runs `resolveContactIdFilter` + `applyLeadFilters`, sequence-guarded); the Filters button renders in **both** views (Sort / Edit columns stay table-only — filters constrain data, those are table presentation). Drag-status writes set `updated_at` and chain `.select('id')` (empty = RLS-blocked → toast + revert refetch). A card is a clickable **`<div>`**, not a `<button>` — it contains real buttons.
