# Settings Navigation Quick Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Settings from sending gym owners to the wrong place: every link opens a real section, both "Settings" buttons open the same page, the Overview lists every section in the menu's order, clashing words are fixed, and related pages link to each other.

**Architecture:** `settings-sections.ts` stays the single source of truth for sections, headings and order. It gains section aliases, a typed `settingsHref()` builder and `isKnownSettingsTab()`, backed by a test that scans `src/` for bad `/settings?tab=` links. The Overview's tiles become a pure `buildOverviewGroups()` derived from `RAIL_GROUPS`, so the menu and the Overview can never drift again. Cross-links use one small `SettingsLink` component that is typed by section and keeps the selected branch.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Base UI / shadcn primitives in `src/components/ui/`, Vitest with Testing Library (`jsdom` per file), `@testing-library/user-event`.

**Spec:** `docs/superpowers/specs/2026-09-28-settings-navigation-audit.md` (full visual report: https://claude.ai/artifact/L8CUzhZEfHQhRfgxxJ1iA3)

## Global Constraints

- Scope is Phase 1 only. Do not regroup sections, build the phone list, add search, move Trainers or Expense categories out of their panels, or rename anything except the "Account" heading to "Personal". Those are Phase 2, planned after the owner test.
- Every existing `?tab=` value keeps opening the same section, including `tags`, `custom-fields` and now `payments`.
- Follow `docs/ui-patterns.md`: reuse masters from `src/components/ui/`, `className` only for external layout, compact text links are `buttonVariants({ variant: 'link', size: 'sm' })` on a `Link` with `data-slot="button"`, clickable cards hover on the border (`hover:border-border-hover`) with a neutral `bg-muted text-foreground` icon tile.
- Follow `docs/ux-copy.md`: plain desk words, one word per thing. Staff counts say "people" ("Members" means paying customers). Never label reminders "win-back". The Automations templates are Welcome message, Gym closed reply, Fees enquiry and Follow-up reminder.
- Authorization reuses what the call site already uses: `isOrganizationOwner` from `useAuth()` for adding branches (same as `BranchSwitcher`), `RequireRole` and `canEditSettings` elsewhere. No inline role comparisons, no new predicates, and no RLS, migration, route or dependency changes.
- Next.js 16: use only the `next/link` and `next/navigation` (`useSearchParams`) patterns already in these files. Read `node_modules/next/dist/docs/` before reaching for any other Next API.
- Effects keep the repository pattern: an inline async IIFE with a `cancelled` guard (`react-hooks/set-state-in-effect` is enforced).
- Commit directly to `main`; do not create a branch and do not push. Stage only the files each task names, and stage `PRDs/roadmap.md` and `docs/changelog.md` with `git add -p`, taking only this plan's hunks.
- Test command: `npx vitest run <files>`. Before each commit, also run `npx eslint <changed files>`. Run `npm run typecheck` in the last step of every task.

## Review Focus

- A `?tab=` value that matches an `Object.prototype` key (`constructor`, `toString`, `__proto__`) opens Overview and never throws. The test is in Task 1.
- A multi-branch owner who follows a new cross-link stays in the same branch: `SettingsLink` carries `?branch=`. The test is in Task 4.
- Someone who isn't the organization owner sees no Add branch button in Settings › Branches, and the page says who can add one. The test is in Task 5.
- A count query that fails shows a description, never "0 plans". A slow WhatsApp check doesn't blank the other tiles. The tests are in Task 3.
- `?view=trainers` doesn't leak into other sections, and an unknown `view` opens the Catalogue tab. The tests are in Task 5.

---

## File Map

- `src/components/settings/settings-sections.ts`: section aliases, `resolveSection`, `isKnownSettingsTab`, `settingsHref`, and `RAIL_GROUPS` (Account → Personal, moved last).
- `src/components/settings/settings-sections.test.ts` (new): resolver and href builder.
- `src/components/settings/settings-links.test.ts` (new): scans `src/` for `/settings?tab=` links that name no section.
- `src/components/finance/payment-link-actions.tsx`, `invoice-document-actions.tsx` and their tests: blocker links use `settingsHref`.
- `src/components/layout/sidebar.tsx` and `sidebar.ui.test.tsx`: the profile menu's Settings opens `/settings`.
- `src/components/settings/settings-overview-tiles.ts` (new) and its `.test.ts`: pure Overview model.
- `src/components/settings/settings-overview.tsx` and `settings-overview.test.tsx` (new): grouped Overview UI.
- `src/components/settings/settings-link.tsx` (new) and its `.test.tsx`: typed, branch-keeping text link into Settings.
- `src/components/finance/finance-expenses.tsx` and `finance-expenses.test.tsx` (new): "Manage categories" on the By category card.
- `src/app/(dashboard)/automations/page.tsx` and `page.test.tsx` (new): link to Automated messages.
- `src/components/settings/renewal-reminders-settings.tsx` and its test: link to Automations.
- `src/components/settings/products-services-settings.tsx` and its `.test.tsx` (new): `?view=trainers` opens the Trainers tab.
- `src/app/(dashboard)/settings/page.tsx` and `page.test.tsx`: section changes drop `view`.
- `src/components/settings/members-tab.tsx` and its `.test.tsx` (new): link to Trainers.
- `src/components/settings/organization-settings.tsx` and its `.test.tsx` (new): Add branch button.
- `docs/ui-patterns.md`, `docs/ux-copy.md`, `docs/changelog.md`, `PRDs/roadmap.md`: rules, glossary and status.

---

### Task 1: Every link into Settings opens a real section

**Files:**

- Modify: `src/components/settings/settings-sections.ts:187-201` (`isSection` and `resolveSection`)
- Create: `src/components/settings/settings-sections.test.ts`
- Create: `src/components/settings/settings-links.test.ts`
- Modify: `src/components/finance/payment-link-actions.tsx:73, 95` plus imports
- Modify: `src/components/finance/invoice-document-actions.tsx:126` plus imports
- Test: `src/components/finance/payment-link-actions.test.tsx:267, 284`, `src/components/finance/invoice-document-actions.test.tsx:361`

**Interfaces:**

- Consumes: `SETTINGS_SECTIONS`, `SettingsSection`, `DEFAULT_SECTION` (existing).
- Produces:
  - `resolveSection(raw: string | null): SettingsSection`, which now also resolves `payments` to `deals`
  - `isKnownSettingsTab(value: string): boolean`
  - `settingsHref(section: SettingsSection, params?: Readonly<Record<string, string>>): string`, which returns `/settings?tab=<section>` followed by the params, with `tab` never overridden

- [ ] **Step 1: Write the failing tests**

Create `src/components/settings/settings-sections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  isKnownSettingsTab,
  resolveSection,
  SETTINGS_SECTIONS,
  settingsHref,
} from './settings-sections';

describe('resolveSection', () => {
  it('opens Payments for the payments alias', () => {
    expect(resolveSection('payments')).toBe('deals');
  });

  it('keeps the legacy tag and custom field aliases', () => {
    expect(resolveSection('tags')).toBe('fields');
    expect(resolveSection('custom-fields')).toBe('fields');
  });

  it('opens every real section by its own id', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(resolveSection(section)).toBe(section);
    }
  });

  it('falls back to Overview for unknown, empty and prototype-key values', () => {
    for (const raw of [
      null,
      '',
      'billing',
      'constructor',
      'toString',
      '__proto__',
    ]) {
      expect(resolveSection(raw)).toBe('overview');
    }
  });
});

describe('isKnownSettingsTab', () => {
  it('accepts section ids and aliases only', () => {
    expect(isKnownSettingsTab('deals')).toBe(true);
    expect(isKnownSettingsTab('payments')).toBe(true);
    expect(isKnownSettingsTab('billing')).toBe(false);
    expect(isKnownSettingsTab('constructor')).toBe(false);
  });
});

describe('settingsHref', () => {
  it('builds a section link', () => {
    expect(settingsHref('deals')).toBe('/settings?tab=deals');
  });

  it('adds panel parameters after the section and never lets them replace it', () => {
    expect(settingsHref('products-services', { view: 'trainers' })).toBe(
      '/settings?tab=products-services&view=trainers'
    );
    expect(settingsHref('deals', { tab: 'members' })).toBe(
      '/settings?tab=deals'
    );
  });
});
```

Create `src/components/settings/settings-links.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isKnownSettingsTab } from './settings-sections';

const SRC = join(process.cwd(), 'src');
// Global flag for matchAll only; never call .test() on this regex.
const SETTINGS_LINK = /\/settings\?tab=([A-Za-z0-9_-]+)/g;
const HAS_SETTINGS_LINK = /\/settings\?tab=/;

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => join(SRC, file));
}

describe('links into Settings', () => {
  it('only name sections that exist', () => {
    const broken: string[] = [];
    for (const file of sourceFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(SETTINGS_LINK)) {
        if (!isKnownSettingsTab(match[1])) {
          broken.push(`${relative(process.cwd(), file)}: ${match[0]}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('still finds the links it guards', () => {
    // If the pattern ever stops matching, the test above would pass vacuously.
    const withLinks = sourceFiles().filter((file) =>
      HAS_SETTINGS_LINK.test(readFileSync(file, 'utf8'))
    );
    expect(withLinks.length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/settings-sections.test.ts src/components/settings/settings-links.test.ts`
Expected: FAIL. `resolveSection('payments')` returns `overview`; `isKnownSettingsTab` and `settingsHref` are not functions. The guard lists `payment-link-actions.tsx: /settings?tab=payments` twice and `invoice-document-actions.tsx: /settings?tab=payments` once.

- [ ] **Step 3: Implement aliases, the check and the builder**

In `src/components/settings/settings-sections.ts`, replace the existing `isSection` and `resolveSection` (the block beginning `function isSection(` down to the end of `resolveSection`) with:

```ts
function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * `?tab=` values that are not section ids but still open one: the old
 * flat layout's Tags and Custom fields tabs, and `payments`, the word
 * people and older links use for the Payments section (`deals`).
 */
const SECTION_ALIASES: Readonly<Record<string, SettingsSection>> = {
  tags: 'fields',
  'custom-fields': 'fields',
  payments: 'deals',
};

function aliasedSection(value: string | null): SettingsSection | null {
  if (!value || !Object.hasOwn(SECTION_ALIASES, value)) return null;
  return SECTION_ALIASES[value];
}

/**
 * Resolve a raw `?tab=` value to a section. Aliases land on their
 * section; anything unknown falls back to the Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  const alias = aliasedSection(raw);
  if (alias) return alias;
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}

/** True when a `?tab=` value opens a section, directly or by alias. */
export function isKnownSettingsTab(value: string): boolean {
  return isSection(value) || aliasedSection(value) !== null;
}

/**
 * Path to a Settings section. Typed, so a link cannot name a section
 * that does not exist. Extra params (a panel's own view) follow `tab`
 * and never replace it. Wrap with `branchHref` to keep the branch.
 */
export function settingsHref(
  section: SettingsSection,
  params: Readonly<Record<string, string>> = {}
): string {
  const search = new URLSearchParams({ tab: section });
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'tab') search.set(key, value);
  }
  return `/settings?${search.toString()}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/settings/settings-sections.test.ts src/components/settings/settings-links.test.ts`
Expected: PASS. The alias makes the three `payments` links known; Steps 5–8 point them at the right sections.

- [ ] **Step 5: Change the finance test expectations**

In `src/components/finance/payment-link-actions.test.tsx`, change both expectations (lines 267 and 284) from `'/settings?tab=payments'` to:

```ts
expect(resolution.getAttribute('href')).toBe('/settings?tab=deals');
```

In `src/components/finance/invoice-document-actions.test.tsx`, change line 361 to:

```ts
expect(resolution.getAttribute('href')).toBe('/settings?tab=business-details');
```

- [ ] **Step 6: Run the finance tests to verify they fail**

Run: `npx vitest run src/components/finance/payment-link-actions.test.tsx src/components/finance/invoice-document-actions.test.tsx`
Expected: FAIL on the three changed expectations. Each still receives `/settings?tab=payments`.

- [ ] **Step 7: Point the blockers at their sections**

In `src/components/finance/payment-link-actions.tsx`, add this import after the `@/components/ui/…` imports:

```ts
import { settingsHref } from '@/components/settings/settings-sections';
```

Replace both occurrences of:

```ts
              href: '/settings?tab=payments',
```

with:

```ts
              href: settingsHref('deals'),
```

In `src/components/finance/invoice-document-actions.tsx`, add the same import after the `@/components/ui/resolvable-action` import. Invoice details live in Business details, so in the `invoice_profile` case replace:

```ts
                href: '/settings?tab=payments',
```

with:

```ts
                href: settingsHref('business-details'),
```

- [ ] **Step 8: Run all Task 1 tests**

Run: `npx vitest run src/components/settings/settings-sections.test.ts src/components/settings/settings-links.test.ts src/components/finance/payment-link-actions.test.tsx src/components/finance/invoice-document-actions.test.tsx`
Expected: PASS.

- [ ] **Step 9: Lint and typecheck**

Run: `npx eslint src/components/settings/settings-sections.ts src/components/settings/settings-sections.test.ts src/components/settings/settings-links.test.ts src/components/finance/payment-link-actions.tsx src/components/finance/invoice-document-actions.tsx && npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/settings/settings-sections.ts src/components/settings/settings-sections.test.ts src/components/settings/settings-links.test.ts src/components/finance/payment-link-actions.tsx src/components/finance/payment-link-actions.test.tsx src/components/finance/invoice-document-actions.tsx src/components/finance/invoice-document-actions.test.tsx
git commit -m "fix(settings): open real sections from payment and invoice blockers"
```

---

### Task 2: Both Settings buttons open the Settings home

**Files:**

- Modify: `src/components/layout/sidebar.tsx:721`
- Test: `src/components/layout/sidebar.ui.test.tsx`

**Interfaces:**

- Consumes: `branchHref` (existing).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `src/components/layout/sidebar.ui.test.tsx`, add `import userEvent from '@testing-library/user-event';` below the `@testing-library/react` import, then append:

```tsx
describe('Sidebar account menu', () => {
  it('opens the Settings home, the same page as the sidebar Settings link', async () => {
    render(<Sidebar />);

    screen.getByRole('button', { name: /rajat@example\.com/ }).focus();
    await userEvent.keyboard(' ');

    const settings = await screen.findByRole('menuitem', { name: 'Settings' });
    expect(settings.getAttribute('href')).toBe('/settings');
    expect(
      screen.getByRole('menuitem', { name: 'Profile' }).getAttribute('href')
    ).toBe('/settings?tab=profile');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/layout/sidebar.ui.test.tsx`
Expected: FAIL. The received value is `/settings?tab=whatsapp`.

- [ ] **Step 3: Point the menu item at the Settings home**

In `src/components/layout/sidebar.tsx`, in the account dropdown's Settings item, replace:

```tsx
                      href={branchHref('/settings?tab=whatsapp', accountId)}
```

with:

```tsx
                      href={branchHref('/settings', accountId)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/layout/sidebar.ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx eslint src/components/layout/sidebar.tsx src/components/layout/sidebar.ui.test.tsx && npm run typecheck
git add src/components/layout/sidebar.tsx src/components/layout/sidebar.ui.test.tsx
git commit -m "fix(settings): open the Settings home from the account menu"
```

---

### Task 3: The Overview lists every section, in the menu's order

**Files:**

- Modify: `src/components/settings/settings-sections.ts:175-185` (`RAIL_GROUPS`)
- Create: `src/components/settings/settings-overview-tiles.ts`
- Create: `src/components/settings/settings-overview-tiles.test.ts`
- Modify: `src/components/settings/settings-overview.tsx` (whole file)
- Create: `src/components/settings/settings-overview.test.tsx`

**Interfaces:**

- Consumes: `RAIL_GROUPS`, `SECTION_META`, `SETTINGS_SECTIONS`, `SettingsSection`; `SettingsChip`, `StatusDot` (`./settings-chip`); `SettingsSectionHead` (`./settings-panel-head`); `ROLE_META` (`./role-meta`).
- Produces:
  - `interface OverviewCounts { members, pendingInvites, templates, templatesPending, tags, customFields, plans, catalogItems: number | null }`
  - `interface OverviewInput { counts: OverviewCounts | null; whatsapp: { configured: boolean; connected: boolean } | null; branchCount: number; currentBranchName: string | null; countryLabel: string; currency: string; modeLabel: string; themeName: string }`
  - `type OverviewStatus = { kind: 'loading' } | { kind: 'text'; text: string } | { kind: 'dot'; tone: 'ok' | 'muted'; text: string }`
  - `overviewStatus(section: SettingsSection, input: OverviewInput): OverviewStatus`
  - `buildOverviewGroups(input: OverviewInput): { label: string; tiles: { section: SettingsSection; status: OverviewStatus }[] }[]`

- [ ] **Step 1: Write the failing model tests**

Create `src/components/settings/settings-overview-tiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildOverviewGroups,
  overviewStatus,
  type OverviewCounts,
  type OverviewInput,
} from './settings-overview-tiles';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';

const counts: OverviewCounts = {
  members: 4,
  pendingInvites: 1,
  templates: 6,
  templatesPending: 2,
  tags: 12,
  customFields: 3,
  plans: 6,
  catalogItems: 5,
};

const failed: OverviewCounts = {
  members: null,
  pendingInvites: null,
  templates: null,
  templatesPending: null,
  tags: null,
  customFields: null,
  plans: null,
  catalogItems: null,
};

const input: OverviewInput = {
  counts,
  whatsapp: { configured: true, connected: true },
  branchCount: 2,
  currentBranchName: 'Iron Gym',
  countryLabel: 'India',
  currency: 'INR',
  modeLabel: 'Dark',
  themeName: 'Violet',
};

function textOf(
  section: SettingsSection,
  override: Partial<OverviewInput> = {}
) {
  const status = overviewStatus(section, { ...input, ...override });
  return status.kind === 'loading' ? 'loading' : status.text;
}

describe('buildOverviewGroups', () => {
  it('tiles every section except Overview and Your profile, in the menu order', () => {
    const menuOrder = RAIL_GROUPS.flatMap(({ group }) =>
      SETTINGS_SECTIONS.filter(
        (section) => SECTION_META[section].group === group
      )
    );
    const tiled = buildOverviewGroups(input).flatMap((group) =>
      group.tiles.map((tile) => tile.section)
    );
    expect(tiled).toEqual(
      menuOrder.filter(
        (section) => section !== 'overview' && section !== 'profile'
      )
    );
  });

  it('uses the menu headings, with Personal last', () => {
    expect(buildOverviewGroups(input).map((group) => group.label)).toEqual([
      'Messaging',
      'Enquiries',
      'Business setup',
      'Your gym',
      'Personal',
    ]);
  });
});

describe('overviewStatus', () => {
  it('counts team members as people, never as members', () => {
    expect(textOf('members')).toBe('4 people · 1 invite pending');
    expect(
      textOf('members', {
        counts: { ...counts, members: 1, pendingInvites: 2 },
      })
    ).toBe('1 person · 2 invites pending');
    expect(
      textOf('members', { counts: { ...counts, pendingInvites: 0 } })
    ).toBe('4 people');
  });

  it('describes Business details without mentioning branches', () => {
    expect(textOf('business-details')).toBe(
      'Gym name, legal name, and invoice details'
    );
  });

  it('shows active plan and catalogue counts', () => {
    expect(textOf('plans')).toBe('6 active plans');
    expect(textOf('plans', { counts: { ...counts, plans: 1 } })).toBe(
      '1 active plan'
    );
    expect(textOf('plans', { counts: { ...counts, plans: 0 } })).toBe(
      'No plans yet'
    );
    expect(textOf('products-services')).toBe('5 active items');
    expect(
      textOf('products-services', { counts: { ...counts, catalogItems: 0 } })
    ).toBe('Nothing added yet');
  });

  it('falls back to a description when a count failed, never to zero', () => {
    expect(textOf('plans', { counts: failed })).toBe('Plans and prices');
    expect(textOf('products-services', { counts: failed })).toBe(
      'Things you sell besides memberships'
    );
    expect(textOf('members', { counts: failed })).toBe('View team members');
    expect(textOf('templates', { counts: failed })).toBe(
      'View message templates'
    );
    expect(textOf('fields', { counts: failed })).toBe('Tags and extra details');
  });

  it('shows loading only on count tiles while counts load', () => {
    expect(textOf('plans', { counts: null })).toBe('loading');
    expect(textOf('members', { counts: null })).toBe('loading');
    expect(textOf('deals', { counts: null })).toBe(
      'UPI and Razorpay for this branch'
    );
    expect(textOf('reminders', { counts: null })).toBe(
      'Renewal and payment reminders'
    );
  });

  it('keeps the WhatsApp status independent of the counts', () => {
    expect(overviewStatus('whatsapp', { ...input, counts: null })).toEqual({
      kind: 'dot',
      tone: 'ok',
      text: 'Connected for this branch',
    });
    expect(
      overviewStatus('whatsapp', {
        ...input,
        whatsapp: { configured: true, connected: false },
      })
    ).toEqual({
      kind: 'dot',
      tone: 'muted',
      text: 'This branch needs reconnecting',
    });
    expect(
      textOf('whatsapp', { whatsapp: { configured: false, connected: false } })
    ).toBe('Not set up for this branch');
    expect(textOf('whatsapp', { whatsapp: null })).toBe('loading');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/settings-overview-tiles.test.ts`
Expected: FAIL with "Failed to resolve import ./settings-overview-tiles".

- [ ] **Step 3: Move the Account heading last and rename it Personal**

In `src/components/settings/settings-sections.ts`, replace the whole `RAIL_GROUPS` declaration with:

```ts
export const RAIL_GROUPS: {
  label: string | null;
  group: SectionMeta['group'];
}[] = [
  { label: null, group: 'top' },
  { label: 'Messaging', group: 'messaging' },
  { label: 'Enquiries', group: 'lead-management' },
  { label: 'Business setup', group: 'business-setup' },
  { label: 'Your gym', group: 'workspace' },
  // The owner's own login and look come last: gym settings lead, on the
  // phone strip and on the Overview alike.
  { label: 'Personal', group: 'account' },
];
```

- [ ] **Step 4: Create the Overview model**

Create `src/components/settings/settings-overview-tiles.ts`:

```ts
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';

/** Live counts behind the Overview tiles. `null` means that query failed. */
export interface OverviewCounts {
  members: number | null;
  pendingInvites: number | null;
  templates: number | null;
  templatesPending: number | null;
  tags: number | null;
  customFields: number | null;
  plans: number | null;
  catalogItems: number | null;
}

export interface OverviewInput {
  /** `null` until the count queries settle. */
  counts: OverviewCounts | null;
  /** `null` until the WhatsApp check settles; it never waits on counts. */
  whatsapp: { configured: boolean; connected: boolean } | null;
  branchCount: number;
  currentBranchName: string | null;
  countryLabel: string;
  currency: string;
  modeLabel: string;
  themeName: string;
}

export type OverviewStatus =
  | { kind: 'loading' }
  | { kind: 'text'; text: string }
  | { kind: 'dot'; tone: 'ok' | 'muted'; text: string };

export interface OverviewTile {
  section: SettingsSection;
  status: OverviewStatus;
}

export interface OverviewGroup {
  label: string;
  tiles: OverviewTile[];
}

/** The Overview doesn't tile itself; its identity card opens Your profile. */
const NOT_TILED: ReadonlySet<SettingsSection> = new Set([
  'overview',
  'profile',
]);

const LOADING: OverviewStatus = { kind: 'loading' };

function text(value: string): OverviewStatus {
  return { kind: 'text', text: value };
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** One status line per section. A failed count falls back to a description. */
export function overviewStatus(
  section: SettingsSection,
  input: OverviewInput
): OverviewStatus {
  const { counts } = input;
  switch (section) {
    case 'whatsapp':
      if (!input.whatsapp) return LOADING;
      if (!input.whatsapp.configured) return text('Not set up for this branch');
      return input.whatsapp.connected
        ? { kind: 'dot', tone: 'ok', text: 'Connected for this branch' }
        : {
            kind: 'dot',
            tone: 'muted',
            text: 'This branch needs reconnecting',
          };
    case 'templates': {
      if (!counts) return LOADING;
      if (counts.templates == null) return text('View message templates');
      const waiting = counts.templatesPending
        ? ` · ${counts.templatesPending} waiting for WhatsApp approval`
        : '';
      return text(
        `${count(counts.templates, 'template', 'templates')}${waiting}`
      );
    }
    case 'reminders':
      return text('Renewal and payment reminders');
    case 'capture':
      return text('Enquiry form and Facebook ads');
    case 'fields':
      if (!counts) return LOADING;
      if (counts.tags == null && counts.customFields == null) {
        return text('Tags and extra details');
      }
      return text(
        `${count(counts.tags ?? 0, 'tag', 'tags')} · ${count(
          counts.customFields ?? 0,
          'extra detail',
          'extra details'
        )}`
      );
    case 'business-details':
      return text('Gym name, legal name, and invoice details');
    case 'plans':
      if (!counts) return LOADING;
      if (counts.plans == null) return text('Plans and prices');
      return text(
        counts.plans === 0
          ? 'No plans yet'
          : count(counts.plans, 'active plan', 'active plans')
      );
    case 'products-services':
      if (!counts) return LOADING;
      if (counts.catalogItems == null) {
        return text('Things you sell besides memberships');
      }
      return text(
        counts.catalogItems === 0
          ? 'Nothing added yet'
          : count(counts.catalogItems, 'active item', 'active items')
      );
    case 'deals':
      return text('UPI and Razorpay for this branch');
    case 'localization':
      return text(`${input.countryLabel} · ${input.currency}`);
    case 'organization':
      return text(
        `${count(input.branchCount, 'branch', 'branches')} · ${
          input.currentBranchName ?? 'Your gym'
        }`
      );
    case 'members': {
      if (!counts) return LOADING;
      if (counts.members == null) return text('View team members');
      const invites = counts.pendingInvites
        ? ` · ${count(counts.pendingInvites, 'invite', 'invites')} pending`
        : '';
      return text(`${count(counts.members, 'person', 'people')}${invites}`);
    }
    case 'api':
      return text('For apps that connect to UsefulDesk');
    case 'security':
      return text('Email, password, and devices');
    case 'appearance':
      return text(`${input.modeLabel} mode · ${input.themeName} colour`);
    case 'overview':
    case 'profile':
      return text('');
  }
}

/** Every tiled section, under the menu's headings, in the menu's order. */
export function buildOverviewGroups(input: OverviewInput): OverviewGroup[] {
  return RAIL_GROUPS.flatMap(({ label, group }) => {
    if (!label) return [];
    const tiles = SETTINGS_SECTIONS.filter(
      (section) =>
        SECTION_META[section].group === group && !NOT_TILED.has(section)
    ).map((section) => ({ section, status: overviewStatus(section, input) }));
    return tiles.length > 0 ? [{ label, tiles }] : [];
  });
}
```

- [ ] **Step 5: Run the model tests to verify they pass**

Run: `npx vitest run src/components/settings/settings-overview-tiles.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing component test**

Create `src/components/settings/settings-overview.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    profile: {
      full_name: 'Asha Rao',
      email: 'asha@example.com',
      avatar_url: null,
    },
    accountId: 'account-1',
    accountRole: 'owner',
    defaultCurrency: 'INR',
    locale: { countryCode: 'IN' },
    canManageMembers: true,
    branches: [{ account_id: 'account-1', organization_name: 'Iron Gym' }],
  }),
}));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ mode: 'dark', theme: 'violet' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data: { phone_number_id: 'phone-1' },
            error: null,
          }),
        then: (
          resolve: (value: {
            count: number;
            data: null;
            error: null;
          }) => unknown
        ) => resolve({ count: 3, data: null, error: null }),
      };
      return builder;
    },
  }),
}));

const { SettingsOverview } = await import('./settings-overview');

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      json: async () =>
        url.includes('/members')
          ? { members: [{}, {}] }
          : url.includes('/invitations')
            ? { invitations: [] }
            : { connected: true },
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsOverview', () => {
  it('opens Your profile from the identity card', async () => {
    const onSelect = vi.fn();
    render(<SettingsOverview onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button', { name: /Asha Rao/ }));

    expect(onSelect).toHaveBeenCalledWith('profile');
  });

  it('groups the tiles under the menu headings, Personal last', () => {
    render(<SettingsOverview onSelect={vi.fn()} />);

    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual([
      'Messaging',
      'Enquiries',
      'Business setup',
      'Your gym',
      'Personal',
    ]);
  });

  it('includes the sections the old landing left out', async () => {
    const onSelect = vi.fn();
    render(<SettingsOverview onSelect={onSelect} />);

    expect(await screen.findByText('3 active plans')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: /Membership plans/ })
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Automated messages/ })
    );

    expect(onSelect).toHaveBeenNthCalledWith(1, 'plans');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'reminders');
  });
});
```

- [ ] **Step 7: Run the component test to verify it fails**

Run: `npx vitest run src/components/settings/settings-overview.test.tsx`
Expected: FAIL. The identity card is not a button, there are no group headings, and there is no Membership plans tile.

- [ ] **Step 8: Rewrite the Overview**

Replace the whole of `src/components/settings/settings-overview.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { THEMES } from '@/lib/themes';
import { COUNTRY_PRESETS } from '@/lib/locale/config';
import { UserAvatar } from '@/components/ui/user-avatar';
import { cn } from '@/lib/utils';

import { SECTION_META, type SettingsSection } from './settings-sections';
import {
  buildOverviewGroups,
  type OverviewCounts,
  type OverviewStatus,
} from './settings-overview-tiles';
import { SettingsChip, StatusDot } from './settings-chip';
import { SettingsSectionHead } from './settings-panel-head';
import { ROLE_META } from './role-meta';

interface WhatsAppStatus {
  configured: boolean;
  connected: boolean;
}

// The clickable-card recipe shared with the Setup checklist's StepRow
// (onboarding/get-started-view.tsx). docs/ui-patterns.md keeps them twins.
const TILE_CLASS = cn(
  'group border-border bg-card flex items-start gap-3.5 rounded-xl border p-4 text-left transition-colors',
  'hover:border-border-hover'
);

function headCount(
  result: PromiseSettledResult<{ count: number | null }>
): number | null {
  return result.status === 'fulfilled' ? (result.value.count ?? null) : null;
}

export function SettingsOverview({
  onSelect,
}: {
  onSelect: (section: SettingsSection) => void;
}) {
  const {
    user,
    profile,
    accountId,
    accountRole,
    defaultCurrency,
    locale,
    canManageMembers,
    branches,
  } = useAuth();
  const { mode, theme } = useTheme();
  const userId = user?.id;

  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  // WhatsApp is tracked separately: its health check decrypts the token
  // and pings Meta, which is far slower than the count queries. A slow
  // or flaky Meta round-trip must not blank the rest of the landing.
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);

  useEffect(() => {
    if (!userId || !accountId) return;
    let cancelled = false;
    const supabase = createClient();
    const acctId = accountId;

    (async () => {
      setCounts(null);
      const [
        membersRes,
        invitesRes,
        templatesTotal,
        templatesPending,
        tagsRes,
        fieldsRes,
        plansRes,
        itemsRes,
      ] = await Promise.allSettled([
        fetch('/api/account/members', { cache: 'no-store' }).then((r) =>
          r.json()
        ),
        canManageMembers
          ? fetch('/api/account/invitations', { cache: 'no-store' }).then((r) =>
              r.json()
            )
          : Promise.resolve(null),
        supabase
          .from('message_templates')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', acctId),
        supabase
          .from('message_templates')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', acctId)
          .eq('status', 'PENDING'),
        supabase
          .from('tags')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
        supabase
          .from('custom_fields')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('membership_plans')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase
          .from('catalog_items')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true),
      ]);

      if (cancelled) return;

      setCounts({
        members:
          membersRes.status === 'fulfilled' &&
          Array.isArray(membersRes.value?.members)
            ? membersRes.value.members.length
            : null,
        pendingInvites:
          invitesRes.status === 'fulfilled' &&
          invitesRes.value &&
          Array.isArray(invitesRes.value.invitations)
            ? invitesRes.value.invitations.length
            : null,
        templates: headCount(templatesTotal),
        templatesPending: headCount(templatesPending),
        tags: headCount(tagsRes),
        customFields: headCount(fieldsRes),
        plans: headCount(plansRes),
        catalogItems: headCount(itemsRes),
      });
    })();

    (async () => {
      setWhatsapp(null);
      const [row, health] = await Promise.allSettled([
        supabase
          .from('whatsapp_config')
          .select('phone_number_id')
          .eq('account_id', acctId)
          .maybeSingle(),
        fetch('/api/whatsapp/config', { cache: 'no-store' }).then((r) =>
          r.json()
        ),
      ]);
      if (cancelled) return;
      setWhatsapp({
        configured:
          row.status === 'fulfilled' && !!row.value.data?.phone_number_id,
        connected: health.status === 'fulfilled' && !!health.value?.connected,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, accountId, canManageMembers]);

  const displayName = profile?.full_name || profile?.email || 'Your account';
  const currentBranch = branches.find(
    (branch) => branch.account_id === accountId
  );
  const roleMeta = accountRole ? ROLE_META[accountRole] : null;
  const RoleIcon = roleMeta?.icon;

  const groups = buildOverviewGroups({
    counts,
    whatsapp,
    branchCount: branches.length,
    currentBranchName: currentBranch?.organization_name ?? null,
    countryLabel:
      COUNTRY_PRESETS[locale.countryCode]?.label ?? locale.countryCode,
    currency: defaultCurrency,
    modeLabel: mode.charAt(0).toUpperCase() + mode.slice(1),
    themeName: THEMES.find((t) => t.id === theme)?.name ?? theme,
  });

  return (
    <section className="animate-in fade-in-50 space-y-8 duration-200">
      <h2 className="sr-only">All settings</h2>

      <button
        type="button"
        onClick={() => onSelect('profile')}
        className={cn(TILE_CLASS, 'w-full items-center gap-4 px-5 py-5')}
      >
        <UserAvatar
          size="lg"
          className="size-14"
          name={displayName}
          src={profile?.avatar_url}
          fallbackClassName="text-xl"
        />
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground block text-xs">
            Your personal profile
          </span>
          <span className="text-foreground block truncate text-base font-semibold">
            {displayName}
          </span>
          {profile?.email ? (
            <span className="text-muted-foreground block truncate text-sm">
              {profile.email}
            </span>
          ) : null}
        </span>
        {roleMeta && RoleIcon ? (
          <SettingsChip variant={roleMeta.variant}>
            <RoleIcon />
            {roleMeta.label}
          </SettingsChip>
        ) : null}
        <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </button>

      {groups.map((group) => {
        const headingId = `settings-overview-${group.label
          .toLowerCase()
          .replace(/\s+/g, '-')}`;
        return (
          <section
            key={group.label}
            className="space-y-3"
            aria-labelledby={headingId}
          >
            <SettingsSectionHead id={headingId} title={group.label} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.tiles.map(({ section, status }) => {
                const meta = SECTION_META[section];
                const Icon = meta.brandIcon ?? meta.icon;
                return (
                  <button
                    key={section}
                    type="button"
                    onClick={() => onSelect(section)}
                    className={TILE_CLASS}
                  >
                    <span className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <Icon
                        className={cn('size-4', meta.brandIcon && 'grayscale')}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block text-sm font-semibold">
                        {meta.label}
                      </span>
                      <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                        <OverviewStatusLine status={status} />
                      </span>
                    </span>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function OverviewStatusLine({ status }: { status: OverviewStatus }) {
  if (status.kind === 'loading') {
    return (
      <>
        <Loader2 className="size-3 animate-spin" /> Loading…
      </>
    );
  }
  if (status.kind === 'dot') {
    return (
      <>
        <StatusDot tone={status.tone} /> {status.text}
      </>
    );
  }
  return <>{status.text}</>;
}
```

- [ ] **Step 9: Run the Task 3 tests plus the neighbours that read the headings**

Run: `npx vitest run src/components/settings/settings-overview-tiles.test.ts src/components/settings/settings-overview.test.tsx src/components/settings/settings-rail.test.tsx "src/app/(dashboard)/settings/page.test.tsx"`
Expected: PASS.

- [ ] **Step 10: Check the look once**

The Settings page needs a signed-in session, so check the rail and Overview through a temporary dev-only page. Create `src/app/preview/settings-overview-check/page.tsx`:

```tsx
'use client';

// TEMPORARY visual check for the Settings Overview. Delete before committing.
import { useState } from 'react';
import { notFound } from 'next/navigation';

import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import type { SettingsSection } from '@/components/settings/settings-sections';

export default function SettingsOverviewCheck() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [active, setActive] = useState<SettingsSection>('overview');
  return (
    <main className="bg-background min-h-screen p-4 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={active} onSelect={setActive} />
        <div className="min-w-0">
          <SettingsOverview onSelect={setActive} />
        </div>
      </div>
    </main>
  );
}
```

Start the `dev` server with the preview tools and open `/preview/settings-overview-check` at 390px and 1280px. Expected: the phone strip starts with Overview, WhatsApp and Message templates; the Overview shows five headings, Personal last, with neutral icon tiles. Tiles that need a session show "Loading…". Delete the file and its folder before committing.

- [ ] **Step 11: Lint, typecheck, commit**

```bash
npx eslint src/components/settings/settings-sections.ts src/components/settings/settings-overview-tiles.ts src/components/settings/settings-overview-tiles.test.ts src/components/settings/settings-overview.tsx src/components/settings/settings-overview.test.tsx && npm run typecheck
git status --short src/app/preview   # must print nothing
git add src/components/settings/settings-sections.ts src/components/settings/settings-overview-tiles.ts src/components/settings/settings-overview-tiles.test.ts src/components/settings/settings-overview.tsx src/components/settings/settings-overview.test.tsx
git commit -m "feat(settings): list every section on the Settings home in menu order"
```

---

### Task 4: Link Expenses and Automations to their settings

**Files:**

- Create: `src/components/settings/settings-link.tsx`
- Create: `src/components/settings/settings-link.test.tsx`
- Modify: `src/components/finance/finance-expenses.tsx:815-835` (`ExpenseCategoryCard`)
- Create: `src/components/finance/finance-expenses.test.tsx`
- Modify: `src/app/(dashboard)/automations/page.tsx:207-213`
- Create: `src/app/(dashboard)/automations/page.test.tsx`
- Modify: `src/components/settings/renewal-reminders-settings.tsx:1528-1531`
- Test: `src/components/settings/renewal-reminders-settings.test.tsx`

**Interfaces:**

- Consumes: `settingsHref`, `SettingsSection` (Task 1); `branchHref` (existing); `useAuth().accountId`.
- Produces: `SettingsLink({ section, params?, className?, children })`, a `next/link` anchor styled as the compact link button. `ExpenseCategoryCard` becomes an export.

- [ ] **Step 1: Write the failing SettingsLink test**

Create `src/components/settings/settings-link.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ accountId: null as string | null }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: auth.accountId }),
}));

vi.mock('next/link', () => ({
  default: (
    props: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
  ) => {
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    return <a {...anchorProps} />;
  },
}));

const { SettingsLink } = await import('./settings-link');

afterEach(cleanup);

describe('SettingsLink', () => {
  it('links to the named section', () => {
    auth.accountId = null;
    render(<SettingsLink section="deals">Manage categories</SettingsLink>);

    expect(
      screen
        .getByRole('link', { name: 'Manage categories' })
        .getAttribute('href')
    ).toBe('/settings?tab=deals');
  });

  it('keeps the selected branch and the panel view', () => {
    auth.accountId = '11111111-1111-4111-8111-111111111111';
    render(
      <SettingsLink section="products-services" params={{ view: 'trainers' }}>
        Set up trainers
      </SettingsLink>
    );

    expect(
      screen.getByRole('link', { name: 'Set up trainers' }).getAttribute('href')
    ).toBe(
      '/settings?tab=products-services&view=trainers&branch=11111111-1111-4111-8111-111111111111'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/settings/settings-link.test.tsx`
Expected: FAIL with "Failed to resolve import ./settings-link".

- [ ] **Step 3: Create SettingsLink**

Create `src/components/settings/settings-link.tsx`:

```tsx
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { branchHref } from '@/lib/auth/branch-context';
import { cn } from '@/lib/utils';

import { settingsHref, type SettingsSection } from './settings-sections';

/**
 * A compact text link into one Settings section, placed where the
 * related work happens. Typed by section and keeps the selected branch.
 * `className` is for external layout only (docs/ui-patterns.md).
 */
export function SettingsLink({
  section,
  params,
  className,
  children,
}: {
  section: SettingsSection;
  params?: Readonly<Record<string, string>>;
  className?: string;
  children: ReactNode;
}) {
  const { accountId } = useAuth();
  return (
    <Link
      data-slot="button"
      href={branchHref(settingsHref(section, params), accountId)}
      className={cn(buttonVariants({ variant: 'link', size: 'sm' }), className)}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/settings/settings-link.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing placement tests**

Create `src/components/finance/finance-expenses.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LocaleFormatters } from '@/lib/locale/format';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: null, accountRole: 'agent' }),
}));

vi.mock('next/link', () => ({
  default: (
    props: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
  ) => {
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    return <a {...anchorProps} />;
  },
}));

const { ExpenseCategoryCard } = await import('./finance-expenses');

const fmt = {
  money: (value: number) => `₹${value}`,
} as unknown as LocaleFormatters;

afterEach(cleanup);

describe('ExpenseCategoryCard', () => {
  it('links to where expense categories are managed, for every role', () => {
    render(<ExpenseCategoryCard totals={[]} postedAmount={0} fmt={fmt} />);

    expect(
      screen
        .getByRole('link', { name: 'Manage categories' })
        .getAttribute('href')
    ).toBe('/settings?tab=deals');
  });
});
```

Create `src/app/(dashboard)/automations/page.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    accountRole: 'owner',
    accountId: null,
  }),
}));

vi.mock('@/hooks/use-pending-navigation', () => ({
  usePendingNavigation: () => ({ navigate: vi.fn(), isPending: () => false }),
}));

vi.mock('next/link', () => ({
  default: (
    props: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
  ) => {
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    return <a {...anchorProps} />;
  },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        order: () => builder,
        then: (resolve: (value: { data: []; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return builder;
    },
  }),
}));

const AutomationsPage = (await import('./page')).default;

afterEach(cleanup);

describe('AutomationsPage', () => {
  it('points owners to Automated messages for renewal and payment reminders', async () => {
    render(<AutomationsPage />);

    const link = await screen.findByRole('link', {
      name: 'Open Automated messages',
    });
    expect(link.getAttribute('href')).toBe('/settings?tab=reminders');
  });
});
```

Append to the `describe('Automated messages catalogue', …)` block in `src/components/settings/renewal-reminders-settings.test.tsx`:

```tsx
it('points to Automations for automatic chat replies', async () => {
  render(<RenewalRemindersSettings />);

  const link = await screen.findByRole('link', { name: 'Open Automations' });
  expect(
    new URL(link.getAttribute('href') ?? '', 'https://usefuldesk.local')
      .pathname
  ).toBe('/automations');
});
```

- [ ] **Step 6: Run the placement tests to verify they fail**

Run: `npx vitest run src/components/finance/finance-expenses.test.tsx "src/app/(dashboard)/automations/page.test.tsx" src/components/settings/renewal-reminders-settings.test.tsx`
Expected: FAIL. `ExpenseCategoryCard` is not exported, and the "Open Automated messages" and "Open Automations" links don't exist. Every other renewal-reminders test still passes.

- [ ] **Step 7: Add the three links**

In `src/components/finance/finance-expenses.tsx`, add `import { SettingsLink } from '@/components/settings/settings-link';` with the other `@/components/…` imports, export the card, and give its header the link. `CardAction` is already imported. Replace:

```tsx
function ExpenseCategoryCard({
```

with:

```tsx
export function ExpenseCategoryCard({
```

and, inside it, replace:

```tsx
<CardHeader className="border-b">
  <CardTitle>By category</CardTitle>
</CardHeader>
```

with:

```tsx
<CardHeader className="border-b">
  <CardTitle>By category</CardTitle>
  <CardAction>
    <SettingsLink section="deals">Manage categories</SettingsLink>
  </CardAction>
</CardHeader>
```

In `src/app/(dashboard)/automations/page.tsx`, add `import { SettingsLink } from '@/components/settings/settings-link';` after the `@/components/ui/…` imports, and replace:

```tsx
<p className="text-muted-foreground mt-1 text-sm">
  Set up actions that happen by themselves when something happens on WhatsApp®.
</p>
```

with:

```tsx
          <p className="text-muted-foreground mt-1 text-sm">
            Set up actions that happen by themselves when something happens on WhatsApp®.
          </p>
          <p className="text-muted-foreground text-sm">
            Renewal and payment reminders are set up in Settings.{' '}
            <SettingsLink section="reminders">Open Automated messages</SettingsLink>
          </p>
```

In `src/components/settings/renewal-reminders-settings.tsx` (`Link`, `buttonVariants`, `branchHref` and `accountId` are already in scope in `RenewalRemindersSettings`), replace:

```tsx
<SettingsPanelHead
  title="Automated messages"
  description="Choose which WhatsApp messages to send automatically."
/>
```

with:

```tsx
<SettingsPanelHead
  title="Automated messages"
  description={
    <>
      Choose which WhatsApp messages to send automatically. Automatic replies to
      chats are set up in Automations.{' '}
      <Link
        data-slot="button"
        className={buttonVariants({ variant: 'link', size: 'sm' })}
        href={branchHref('/automations', accountId)}
      >
        Open Automations
      </Link>
    </>
  }
/>
```

- [ ] **Step 8: Run the Task 4 tests to verify they pass**

Run: `npx vitest run src/components/settings/settings-link.test.tsx src/components/finance/finance-expenses.test.tsx "src/app/(dashboard)/automations/page.test.tsx" src/components/settings/renewal-reminders-settings.test.tsx src/components/settings/settings-links.test.ts`
Expected: PASS.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
npx eslint src/components/settings/settings-link.tsx src/components/settings/settings-link.test.tsx src/components/finance/finance-expenses.tsx src/components/finance/finance-expenses.test.tsx "src/app/(dashboard)/automations/page.tsx" "src/app/(dashboard)/automations/page.test.tsx" src/components/settings/renewal-reminders-settings.tsx src/components/settings/renewal-reminders-settings.test.tsx && npm run typecheck
git add src/components/settings/settings-link.tsx src/components/settings/settings-link.test.tsx src/components/finance/finance-expenses.tsx src/components/finance/finance-expenses.test.tsx "src/app/(dashboard)/automations/page.tsx" "src/app/(dashboard)/automations/page.test.tsx" src/components/settings/renewal-reminders-settings.tsx src/components/settings/renewal-reminders-settings.test.tsx
git commit -m "feat(settings): link expense categories and reminders from where owners look"
```

---

### Task 5: Trainers and branches are one tap away

**Files:**

- Modify: `src/components/settings/products-services-settings.tsx:3, 175` (imports, initial tab)
- Create: `src/components/settings/products-services-settings.test.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx:54-57` (`go`)
- Test: `src/app/(dashboard)/settings/page.test.tsx`
- Modify: `src/components/settings/members-tab.tsx:342-353`
- Create: `src/components/settings/members-tab.test.tsx`
- Modify: `src/components/settings/organization-settings.tsx`
- Create: `src/components/settings/organization-settings.test.tsx`

**Interfaces:**

- Consumes: `SettingsLink` (Task 4); `BranchCreationDialog({ open, onOpenChange })` from `@/components/branches/branch-creation-dialog`; `useAuth().isOrganizationOwner`.
- Produces: `?tab=products-services&view=trainers` opens the Trainers tab. `view` is dropped when the section changes.

- [ ] **Step 1: Write the failing tests**

Create `src/components/settings/products-services-settings.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-1',
    accountRole: 'owner',
    loading: false,
  }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: { money: (value: number) => `₹${value}` },
    locale: { currency: 'INR' },
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        order: () => builder,
        then: (resolve: (value: { data: []; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return builder;
    },
  }),
}));

const { ProductsServicesSettings } =
  await import('./products-services-settings');

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ members: [] }) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProductsServicesSettings', () => {
  it('opens on the Trainers tab when linked with view=trainers', async () => {
    navigation.search = 'tab=products-services&view=trainers';
    render(<ProductsServicesSettings />);

    const trainers = await screen.findByRole('tab', { name: 'Trainers' });
    expect(trainers.getAttribute('aria-selected')).toBe('true');
  });

  it('opens on the catalogue for any other view', async () => {
    navigation.search = 'tab=products-services&view=bogus';
    render(<ProductsServicesSettings />);

    const catalogue = await screen.findByRole('tab', {
      name: 'Products & services',
    });
    expect(catalogue.getAttribute('aria-selected')).toBe('true');
  });
});
```

In `src/app/(dashboard)/settings/page.test.tsx`, make the search params configurable. Replace:

```ts
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams('tab=reminders'),
}));
```

with:

```ts
const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: 'tab=reminders',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
```

In that file's `beforeEach`, add `navigation.search = 'tab=reminders';` after `navigation.replace.mockReset();`, and append this test inside the `describe`:

```tsx
it('drops a panel view when moving to another section', () => {
  navigation.search = 'tab=products-services&view=trainers';
  render(<SettingsPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Profile section' }));

  expect(navigation.replace).toHaveBeenCalledWith('/settings?tab=profile', {
    scroll: false,
  });
});
```

Create `src/components/settings/members-tab.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    canManageMembers: true,
    accountRole: 'owner',
    profileLoading: false,
    accountId: null,
  }),
}));

vi.mock('@/hooks/use-locale', () => ({ useLocale: () => ({ fmt: {} }) }));

vi.mock('@/hooks/use-presence', () => ({
  usePresence: () => ({
    getPresence: () => 'offline',
    getRow: () => null,
    now: 0,
  }),
}));

vi.mock('next/link', () => ({
  default: (
    props: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
  ) => {
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    return <a {...anchorProps} />;
  },
}));

const { MembersTab } = await import('./members-tab');

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('invitations') ? { invitations: [] } : { members: [] },
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MembersTab', () => {
  it('links to trainer setup, which lives in Products & services', () => {
    render(<MembersTab />);

    expect(
      screen.getByRole('link', { name: 'Set up trainers' }).getAttribute('href')
    ).toBe('/settings?tab=products-services&view=trainers');
  });
});
```

Create `src/components/settings/organization-settings.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BranchAccount } from '@/hooks/use-auth';

const auth = vi.hoisted(() => ({ isOrganizationOwner: true }));

const branch: BranchAccount = {
  account_id: '11111111-1111-4111-8111-111111111111',
  account_name: 'Central',
  organization_id: '22222222-2222-4222-8222-222222222222',
  organization_name: 'Useful Fitness',
  legal_entity_id: '33333333-3333-4333-8333-333333333333',
  legal_entity_name: 'Useful Fitness Pvt Ltd',
  legal_entity_legal_name: 'Useful Fitness Pvt Ltd',
  role: 'owner',
  branch_status: 'active',
  readiness_state: 'ready',
  default_currency: 'INR',
  timezone: 'Asia/Kolkata',
  is_organization_owner: true,
  setup_reviewed_at: null,
  setup_reviewed_by: null,
};

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    account: { id: '11111111-1111-4111-8111-111111111111' },
    branches: [branch],
    isOrganizationOwner: auth.isOrganizationOwner,
  }),
}));

vi.mock('./branch-actions', () => ({ BranchActions: () => null }));
vi.mock('./organization-danger-zone', () => ({
  OrganizationDangerZone: () => null,
}));
vi.mock('@/components/branches/branch-creation-dialog', () => ({
  BranchCreationDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Add a branch" /> : null,
}));

const { OrganizationSettings } = await import('./organization-settings');

afterEach(cleanup);

describe('OrganizationSettings', () => {
  it('lets the gym group owner add a branch right here', async () => {
    auth.isOrganizationOwner = true;
    render(<OrganizationSettings />);

    await userEvent.click(screen.getByRole('button', { name: 'Add branch' }));

    expect(screen.getByRole('dialog', { name: 'Add a branch' })).toBeTruthy();
  });

  it('tells everyone else who can add a branch', () => {
    auth.isOrganizationOwner = false;
    render(<OrganizationSettings />);

    expect(screen.queryByRole('button', { name: 'Add branch' })).toBeNull();
    expect(
      screen.getByText(/Only the owner of the gym group can add branches\./)
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/products-services-settings.test.tsx "src/app/(dashboard)/settings/page.test.tsx" src/components/settings/members-tab.test.tsx src/components/settings/organization-settings.test.tsx`
Expected: FAIL.

- The Trainers tab is not selected for `view=trainers`.
- `replace` receives `/settings?tab=profile&view=trainers`.
- There is no "Set up trainers" link.
- There is no "Add branch" button and no owner-only line.

If the Products & services test fails for a missing mocked hook field instead, add that field to the mock and run again. The failure must be about the tab.

- [ ] **Step 3: Open the Trainers tab from `view=trainers`**

In `src/components/settings/products-services-settings.tsx`, add `import { useSearchParams } from 'next/navigation';` after the `react` import, and replace:

```tsx
const [tab, setTab] = useState<'catalogue' | 'trainers'>('catalogue');
```

with:

```tsx
// `?view=trainers` (Team members links here) opens on the Trainers tab.
const searchParams = useSearchParams();
const [tab, setTab] = useState<'catalogue' | 'trainers'>(() =>
  searchParams.get('view') === 'trainers' ? 'trainers' : 'catalogue'
);
```

- [ ] **Step 4: Drop `view` when the section changes**

In `src/app/(dashboard)/settings/page.tsx`, inside `go`, replace:

```ts
const params = new URLSearchParams(searchParams.toString());
params.set('tab', next);
```

with:

```ts
const params = new URLSearchParams(searchParams.toString());
// `view` belongs to the panel that was open; don't carry it along.
params.delete('view');
params.set('tab', next);
```

- [ ] **Step 5: Link Team members to Trainers**

In `src/components/settings/members-tab.tsx`, add `import { SettingsLink } from './settings-link';` next to the `./settings-panel-head` import, and replace:

```tsx
description = 'See who can use this branch and choose what they can do here.';
```

with:

```tsx
        description={
          <>
            See who can use this branch and choose what they can do here.{' '}
            <SettingsLink
              section="products-services"
              params={{ view: 'trainers' }}
            >
              Set up trainers
            </SettingsLink>
          </>
        }
```

- [ ] **Step 6: Add branches from Settings › Branches**

In `src/components/settings/organization-settings.tsx`:

1. Replace the imports block's first lines:

```tsx
import { Building2, Check } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
```

with:

```tsx
import { useState } from 'react';
import { Building2, Check, Plus } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { BranchCreationDialog } from '@/components/branches/branch-creation-dialog';
import { Button } from '@/components/ui/button';
```

2. Replace the start of the component:

```tsx
export function OrganizationSettings() {
  const { account, branches, isOrganizationOwner } = useAuth();
  if (!account) return null;
```

with:

```tsx
export function OrganizationSettings() {
  const { account, branches, isOrganizationOwner } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  if (!account) return null;
```

3. Give the panel head the owner-only action:

```tsx
<SettingsPanelHead
  title="Branches"
  description="Switch between branches under your gym name. Each branch keeps its own members, payments, and connections."
  action={
    isOrganizationOwner ? (
      <Button onClick={() => setCreateOpen(true)}>
        <Plus className="size-4" />
        Add branch
      </Button>
    ) : undefined
  }
/>
```

4. Replace the footer paragraph:

```tsx
<p className="text-muted-foreground text-xs">
  Use the branch menu on the left to add or switch branches.
</p>
```

with:

```tsx
<p className="text-muted-foreground text-xs">
  Switch branches from the branch menu at the top of the side menu.
  {isOrganizationOwner
    ? null
    : ' Only the owner of the gym group can add branches.'}
</p>
```

5. After the closing `</Card>` of the branch list and before the `isOrganizationOwner` danger-zone block, add:

```tsx
{
  isOrganizationOwner ? (
    <BranchCreationDialog open={createOpen} onOpenChange={setCreateOpen} />
  ) : null;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/settings/products-services-settings.test.tsx "src/app/(dashboard)/settings/page.test.tsx" src/components/settings/members-tab.test.tsx src/components/settings/organization-settings.test.tsx src/components/settings/settings-links.test.ts`
Expected: PASS.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
npx eslint src/components/settings/products-services-settings.tsx src/components/settings/products-services-settings.test.tsx "src/app/(dashboard)/settings/page.tsx" "src/app/(dashboard)/settings/page.test.tsx" src/components/settings/members-tab.tsx src/components/settings/members-tab.test.tsx src/components/settings/organization-settings.tsx src/components/settings/organization-settings.test.tsx && npm run typecheck
git add src/components/settings/products-services-settings.tsx src/components/settings/products-services-settings.test.tsx "src/app/(dashboard)/settings/page.tsx" "src/app/(dashboard)/settings/page.test.tsx" src/components/settings/members-tab.tsx src/components/settings/members-tab.test.tsx src/components/settings/organization-settings.tsx src/components/settings/organization-settings.test.tsx
git commit -m "feat(settings): reach trainers from Team members and add branches from Branches"
```

---

### Task 6: Record the rules, names and status

**Files:**

- Modify: `docs/ui-patterns.md` (the "Page chrome" section, after the "A Settings panel's views are not page chrome" bullet)
- Modify: `docs/ux-copy.md` (glossary table)
- Modify: `docs/changelog.md` (new entry at the top)
- Modify: `PRDs/roadmap.md` (new entries at the top)
- Add: `docs/superpowers/specs/2026-09-28-settings-navigation-audit.md`, this plan, `.impeccable/critique/2026-09-28T07-31-43Z__src-app-dashboard-settings-page-tsx.md`

- [ ] **Step 1: Add the Settings rules to `docs/ui-patterns.md`**

After the bullet that begins `- **A Settings panel's views are not page chrome.**`, add:

```markdown
- **Links into Settings name a real section.** Build them with `settingsHref(section)` or render `SettingsLink` (`settings/settings-link.tsx`, which keeps the branch). `resolveSection` keeps `tags`, `custom-fields` and `payments` working, and `settings-links.test.ts` fails on any `/settings?tab=` literal in `src/` that names no section. A panel's own sub-view rides on `view` (Products & services: `view=trainers`), and changing section drops it.
- **The Settings Overview mirrors the menu.** `settings-overview-tiles.ts` derives its headings and order from `RAIL_GROUPS` and `SECTION_META`, so a new section appears in both. Every tile has one status line. A failed count falls back to a description, never to zero. The identity card opens Your profile.
```

- [ ] **Step 2: Add the new words to the `docs/ux-copy.md` glossary**

Add these rows to the glossary table, after the **Team**, **team member** row:

```markdown
| **Personal** | Account (for your own login and look) | The Settings heading for Your profile, Login & security and Appearance. It comes last. |
| **N people** (counting team members) | N members, N users | "Members" always means paying customers. |
```

- [ ] **Step 3: Add the changelog entry**

At the top of `docs/changelog.md`, below its title block, add:

```markdown
## 2026-09-28 — Settings stops sending owners to the wrong place (built in code)

Settings links are typed: `settingsHref()` and `SettingsLink` in `src/components/settings/`, plus `settings-links.test.ts`, which fails on a `/settings?tab=` link naming no section. The Razorpay and invoice blockers had pointed at the missing `payments` tab. They now open Payments and Business details, and `payments` stays an alias. The account menu's Settings opens the Settings home. The Overview (`settings-overview-tiles.ts`) lists every section under the menu's headings, in the menu's order. It adds plan and catalogue counts and counts staff as people, and the identity card opens Your profile. The "Account" heading is now "Personal" and comes last. Cross-links: By category → Manage categories; Automations ↔ Automated messages; Team members → Trainers (`view=trainers`); Branches has Add branch for gym group owners. Gotcha: a panel sub-view uses `view`, and the Settings page drops it on section change. Audit and Phase 2 direction: `docs/superpowers/specs/2026-09-28-settings-navigation-audit.md`.
```

- [ ] **Step 4: Update the roadmap**

At the top of `PRDs/roadmap.md`, add:

```markdown
## Built in code — Settings navigation quick fixes (2026-09-28)

Phase 1 of the Settings navigation audit (`docs/superpowers/specs/2026-09-28-settings-navigation-audit.md`): links into Settings always open a real section, one Settings door, a complete Overview in menu order with "Personal" last, clash-free counts, and cross-links from Expenses, Automations, Team members and Branches.

## Proposed — Settings navigation restructure (2026-09-28)

First, run the 15-minute owner test in the spec with the owner who reported the confusion and two others; record first taps and the words they looked for. Then plan Phase 2 from the results. Decided: phones get a grouped list you tap into (no sideways strip), and the recommended names are adopted: Your gym, Plans & pricing, WhatsApp (WhatsApp number), Payments & expenses (Payment methods, Expense categories), Team (Team members, Trainers), Enquiries, Personal, Advanced (API keys). Also in Phase 2: settings search with owner synonyms, a laptop rail that fits 1366×768, and a folded View-only staff view. The subscriptions work must name its Settings page "UsefulDesk plan & billing", not "Billing". Deferred: whether Automations and Automated messages merge.
```

- [ ] **Step 5: Verify the whole change**

Run: `npx vitest run src/components/settings src/components/finance src/components/layout "src/app/(dashboard)/settings" "src/app/(dashboard)/automations" && npm run lint && npm run typecheck`
Expected: all tests PASS; lint and typecheck report no errors. (Lint covers the whole tree, including the other session's files. If it fails only in files this plan didn't touch, note it in the handoff and don't fix it here.)

- [ ] **Step 6: Commit only this plan's documentation**

```bash
git add docs/ui-patterns.md docs/ux-copy.md docs/superpowers/specs/2026-09-28-settings-navigation-audit.md docs/superpowers/plans/2026-09-28-settings-navigation-quick-fixes.md .impeccable/critique/2026-09-28T07-31-43Z__src-app-dashboard-settings-page-tsx.md
git add -p docs/changelog.md PRDs/roadmap.md   # take only the two new Settings entries
git diff --cached --stat                         # confirm no other session's hunks are staged
git commit -m "docs(settings): record navigation fixes, rules and restructure plan"
```
