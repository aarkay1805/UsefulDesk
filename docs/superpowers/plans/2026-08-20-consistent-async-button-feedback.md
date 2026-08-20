# Consistent Async Button Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every delayed button action immediate, accessible, in-button spinner feedback while preventing duplicate activation.

**Architecture:** Extend the shared `Button` master with an explicit controlled `loading` prop, then wire the operation-owning pending state into affected shared and native buttons. Existing state is reused where present; row actions gain item-scoped pending keys; Next.js button navigation uses `useTransition` plus the clicked destination so unrelated buttons do not spin.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Base UI, Lucide React, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-20-consistent-async-button-feedback-design.md`

## Global Constraints

- Preserve every existing action, success/error message, authorization gate, and user-entered value.
- Only the control that initiated an operation displays a spinner; disabled sibling cancel/close buttons do not.
- Keep the current label in the accessible name, set `aria-busy`, hide the spinner from assistive technology, and disable repeat activation.
- Do not add a dependency or a second spinner primitive.
- Immediate local actions such as opening dialogs, changing filters, copying text, and in-memory CSV creation remain unchanged.
- Existing correct in-button loaders may remain local unless the shared prop removes duplication without changing layout or copy.

---

### Task 1: Add the shared loading contract

**Files:**

- Create: `src/components/ui/button.test.tsx`
- Modify: `src/components/ui/button.tsx`
- Read-through verification: `src/components/ui/gated-button.tsx`

**Interfaces:**

- Produces: `Button` accepts `loading?: boolean` in addition to Base UI and variant props.
- Behavior: `loading` renders one `Loader2`, sets `aria-busy`, forces `disabled`, preserves children, and is not forwarded to the DOM.
- Consumers: every later task passes its existing or new pending state through this prop.

- [ ] **Step 1: Write the failing shared-component tests**

```tsx
it('exposes a busy state and blocks activation while loading', async () => {
  const onClick = vi.fn();
  render(
    <Button loading onClick={onClick}>
      Save changes
    </Button>
  );

  const button = screen.getByRole('button', { name: 'Save changes' });
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.querySelector('.animate-spin')).not.toBeNull();
  await userEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

it('does not render loading state when loading is false', () => {
  render(<Button loading={false}>Save changes</Button>);
  const button = screen.getByRole('button', { name: 'Save changes' });
  expect(button.hasAttribute('aria-busy')).toBe(false);
  expect(button.querySelector('.animate-spin')).toBeNull();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/components/ui/button.test.tsx`

Expected: FAIL because `loading` is not a supported prop and no spinner or `aria-busy` is rendered.

- [ ] **Step 3: Implement the minimal master behavior**

```tsx
import { Loader2 } from 'lucide-react';

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
  };

function Button({
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </ButtonPrimitive>
  );
}
```

Retain the existing `className`, `variant`, `size`, and `data-slot` plumbing exactly.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- src/components/ui/button.test.tsx && npm run typecheck`

Expected: PASS with no React unknown-prop warning and no type errors. Confirm `GatedButton` accepts `loading` through `ComponentProps<typeof Button>` without changes.

- [ ] **Step 5: Commit the shared contract**

```bash
git add src/components/ui/button.tsx src/components/ui/button.test.tsx
git commit -m "feat: add shared button loading state"
```

---

### Task 2: Wire existing pending state into mutation and authentication buttons

**Files:**

- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/(auth)/signup/page.tsx`
- Modify: `src/app/(auth)/forgot-password/page.tsx`
- Modify: `src/app/(auth)/reset-password/page.tsx`
- Modify: `src/app/(auth)/login/page.test.tsx`
- Modify: `src/app/(auth)/signup/page.test.tsx`
- Modify: `src/app/(auth)/forgot-password/page.test.tsx`
- Modify: `src/app/(auth)/reset-password/page.test.tsx`
- Modify: `src/app/(dashboard)/dashboard-shell.tsx`
- Modify: `src/components/reports/owner-reports-view.tsx`
- Modify: `src/components/members/member-personal-info.tsx`
- Modify: `src/components/members/bmi-card.tsx`
- Modify: `src/components/members/member-danger-zone.tsx`
- Modify: `src/components/members/member-detail-view.tsx`
- Modify: `src/app/(dashboard)/broadcasts/[id]/page.tsx`

**Interfaces:**

- Consumes: `Button loading?: boolean` from Task 1.
- Produces: every listed initiating button maps its already-owned `loading`, `busy`, `deleting`, or retry state to the shared prop.

- [ ] **Step 1: Add failing auth pending-state tests**

For each auth page, hold the mocked request with a deferred promise, submit valid fields, and assert the submit button retains its accessible action name while exposing `aria-busy="true"` and `disabled=true` before resolving the request.

```tsx
let resolveRequest!: (value: { error: null }) => void;
requestMock.mockReturnValue(
  new Promise((resolve) => {
    resolveRequest = resolve;
  })
);

await user.click(screen.getByRole('button', { name: 'Create account' }));
const submit = screen.getByRole('button', { name: /Creating account/ });
expect(submit.getAttribute('aria-busy')).toBe('true');
expect((submit as HTMLButtonElement).disabled).toBe(true);
resolveRequest({ error: null });
```

Use each page's existing valid form setup and request response shape; for reset-password, hold the POST `fetch` response after the initial permission GET has completed.

- [ ] **Step 2: Run auth tests and verify RED**

Run: `npm test -- 'src/app/(auth)/login/page.test.tsx' 'src/app/(auth)/signup/page.test.tsx' 'src/app/(auth)/forgot-password/page.test.tsx' 'src/app/(auth)/reset-password/page.test.tsx'`

Expected: FAIL because the buttons only change text and do not expose `aria-busy` or a spinner.

- [ ] **Step 3: Pass existing state to the shared button**

Apply the corresponding state without changing validation gates:

```tsx
<Button type="submit" loading={loading} disabled={loading || otherGate}>
  {loading ? 'Updating...' : 'Update password'}
</Button>

<Button loading={busy} disabled={busy} onClick={save}>
  Save changes
</Button>

<Button loading={deleting} disabled={deleting} onClick={handleDelete}>
  {deleting ? 'Deleting…' : 'Confirm'}
</Button>
```

Wire the initiating controls only: dashboard retry, report retry, personal-info save, BMI save, member delete, member check-in, broadcast delete, and all four auth submits. Do not add `loading` to sibling cancel/close controls that are merely disabled during those requests.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- 'src/app/(auth)/login/page.test.tsx' 'src/app/(auth)/signup/page.test.tsx' 'src/app/(auth)/forgot-password/page.test.tsx' 'src/app/(auth)/reset-password/page.test.tsx' src/app/'(dashboard)'/dashboard-shell.test.tsx src/components/members/member-detail-view.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the existing-state wiring**

```bash
git add src/app src/components/reports src/components/members
git commit -m "fix: show pending feedback for core actions"
```

---

### Task 3: Add item-scoped state to asynchronous row and dialog actions

**Files:**

- Modify: `src/components/members/service-renewal-action-lists.tsx`
- Modify: `src/components/members/service-renewal-action-lists.test.tsx`
- Modify: `src/components/follow-ups/complete-follow-up-dialog.tsx`
- Modify: `src/components/settings/ai-knowledge.tsx`
- Modify: `src/components/settings/members-tab.tsx`
- Modify: `src/components/contacts/contact-detail-content.tsx`
- Modify: `src/components/members/member-detail-view.tsx`

**Interfaces:**

- Consumes: `Button loading?: boolean`.
- Produces: item-scoped operation keys such as `${row.id}:remind` or the relevant record ID; concurrent visual state never leaks to sibling rows.

- [ ] **Step 1: Write a failing service-row interaction test**

Render a renewal row with a deferred reminder request. Click **Remind** and assert only that row's Remind button becomes disabled and contains `.animate-spin`; the neighboring **Renew** action remains non-busy. Resolve the request and assert the Remind button re-enables.

```tsx
await user.click(screen.getByRole('button', { name: 'Remind' }));
const remind = screen.getByRole('button', { name: 'Remind' });
expect(remind.getAttribute('aria-busy')).toBe('true');
expect(
  screen.getByRole('button', { name: 'Renew' }).getAttribute('aria-busy')
).toBeNull();
```

- [ ] **Step 2: Run the service-row test and verify RED**

Run: `npm test -- src/components/members/service-renewal-action-lists.test.tsx`

Expected: FAIL because no row operation state is currently rendered.

- [ ] **Step 3: Add explicit operation ownership**

Use one operation key when a surface serializes actions:

```tsx
const [pendingAction, setPendingAction] = useState<string | null>(null);

async function remind(row: ServiceRenewalRow) {
  const key = `${row.id}:remind`;
  setPendingAction(key);
  try {
    await existingReminderWork(row);
  } finally {
    setPendingAction(null);
  }
}

<Button
  loading={pendingAction === `${row.id}:remind`}
  disabled={!canAct || pendingAction !== null}
  onClick={() => void remind(row)}
>
  Remind
</Button>;
```

Apply the same principle to remote renew-detail loading, follow-up completion/cancellation, AI knowledge edit/delete, invitation revoke, contact tag writes, and service cancellation. Reuse an existing item-ID pending state where the component already has one. Keep handlers protected by `try/finally` and retain existing error handling.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- src/components/members/service-renewal-action-lists.test.tsx src/components/members/member-detail-view.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit item-scoped feedback**

```bash
git add src/components/members src/components/follow-ups src/components/settings src/components/contacts
git commit -m "fix: show row action progress on async operations"
```

---

### Task 4: Cover native async controls and button-driven navigation

**Files:**

- Modify: `src/app/(dashboard)/flows/page.tsx`
- Modify: `src/components/flows/header.tsx`
- Modify: `src/components/automations/automation-builder.tsx`
- Modify: `src/app/(dashboard)/flows/[id]/page.tsx`
- Modify: `src/app/(dashboard)/flows/[id]/runs/page.tsx`
- Modify: `src/app/(dashboard)/automations/page.tsx`
- Modify: `src/app/(dashboard)/automations/new/page.tsx`
- Modify: `src/app/(dashboard)/automations/[id]/edit/page.tsx`
- Modify: `src/app/(dashboard)/automations/[id]/logs/page.tsx`
- Modify: `src/app/(dashboard)/broadcasts/page.tsx`
- Modify: `src/app/(dashboard)/broadcasts/[id]/page.tsx`

**Interfaces:**

- Native async controls reproduce the shared contract locally only where the current composed-card geometry prevents using `Button`.
- Navigation controls use `useTransition`; a local destination/action key identifies the clicked button.

- [ ] **Step 1: Add a failing flow-template pending test**

Render the template chooser with a deferred create request, click one template card, and assert the clicked native button has `aria-busy="true"`, is disabled, and renders `Loader2`; assert a second card does not expose `aria-busy`.

- [ ] **Step 2: Run the new flow test and verify RED**

Create `src/app/(dashboard)/flows/page.test.tsx`, then run: `npm test -- 'src/app/(dashboard)/flows/page.test.tsx'`.

Expected: FAIL because template creation currently disables every card without identifying the initiating card or rendering a spinner.

- [ ] **Step 3: Implement native-card and navigation feedback**

For template cards, retain the current native button and add a selected template key:

```tsx
const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null);

<button
  aria-busy={creatingTemplate === template.slug || undefined}
  disabled={creatingTemplate !== null || !canCreate}
>
  {creatingTemplate === template.slug ? (
    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    existingIcon
  )}
  {existingContent}
</button>;
```

For route-changing shared buttons:

```tsx
const [pendingHref, setPendingHref] = useState<string | null>(null);
const [isNavigating, startNavigation] = useTransition();

function navigate(href: string) {
  setPendingHref(href);
  startNavigation(() => router.push(href));
}

<Button
  loading={isNavigating && pendingHref === href}
  onClick={() => navigate(href)}
>
  View runs
</Button>;
```

Use the same `isNavigating && pendingHref === href` condition for established native icon/back buttons, rendering `Loader2` locally and setting `aria-busy`. Do not change ordinary links or clickable table/card rows in this pass.

- [ ] **Step 4: Run focused test, lint changed files, and typecheck**

Run: `npm test -- 'src/app/(dashboard)/flows/page.test.tsx' && npm run typecheck && npm run lint -- src/app src/components/flows src/components/automations`

Expected: PASS.

- [ ] **Step 5: Commit native and navigation feedback**

```bash
git add src/app src/components/flows src/components/automations
git commit -m "fix: show progress for async navigation controls"
```

---

### Task 5: Record the invariant and verify the full repository

**Files:**

- Modify: `docs/ui-patterns.md`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`

**Interfaces:**

- Produces: one durable UI rule describing when `Button loading` is required and which controls are excluded.

- [ ] **Step 1: Update product documentation**

Add this invariant to the Buttons section of `docs/ui-patterns.md`:

```md
### Pending actions

Any button that starts delayed asynchronous work uses the shared `loading` prop (or the identical local treatment for an established native composed control). Loading keeps the action label, adds the canonical spinner, exposes `aria-busy`, and disables repeat activation. Only the initiating control spins; sibling controls disabled by the same operation do not. Immediate local UI actions and in-memory copy/export actions are not loading actions.
```

Add a terse changelog entry naming `src/components/ui/button.tsx` and the audited product areas. Add the behavior to the appropriate shipped cross-product UX list in `PRDs/roadmap.md` without creating a new product phase.

- [ ] **Step 2: Run formatting and inspect the diff**

Run: `git diff --name-only -z HEAD~4 -- '*.ts' '*.tsx' '*.md' | xargs -0 npx prettier --write`, then `git diff --check` and `git diff --stat`.

Expected: no whitespace errors and no unrelated files.

- [ ] **Step 3: Run fresh full verification**

Run in order:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: every command exits 0 with zero test failures.

- [ ] **Step 4: Audit requirements against the spec**

Confirm from the final diff:

- every changed initiating action passes or renders pending state;
- pending state begins before awaiting and clears in `finally`;
- no sibling cancel/close button shows the initiating spinner;
- item-scoped actions do not light unrelated rows;
- labels and existing success/error behavior remain intact;
- the shared custom prop is not forwarded to the DOM.

- [ ] **Step 5: Commit documentation and final adjustments**

```bash
git add docs/ui-patterns.md docs/changelog.md PRDs/roadmap.md src
git commit -m "docs: record async button feedback invariant"
```
