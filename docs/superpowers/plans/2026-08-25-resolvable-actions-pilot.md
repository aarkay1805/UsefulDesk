# Resolvable Actions Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one accessible, actionable blocked-state popover and use it across UsefulDesk's highest-value WhatsApp, renewal, invoice, payment, membership, and follow-up actions.

**Architecture:** A new domain-neutral `ResolvableAction` master composes the existing Button, Tooltip, and Popover primitives. Domain code continues to own readiness and maps only its highest-priority business blocker into a shared `{ title, description, resolution? }` model; native `disabled` remains reserved for loading and self-evident validation states.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, TypeScript 6, Base UI React 1.6, Tailwind CSS 4, Vitest 4, Testing Library, existing UsefulDesk UI primitives.

**Spec:** `docs/superpowers/specs/2026-08-25-resolvable-actions-design.md`

## Global Constraints

- Do not modify `src/components/ui/button.tsx`, `src/components/ui/popover.tsx`, `src/components/ui/tooltip.tsx`, or `src/components/ui/gated-button.tsx`; the approved design adds a new master and leaves existing masters unchanged.
- The new master owns blocked opacity, cursor, tooltip, popover spacing, and focus treatment. Call sites may pass only external layout classes.
- Use native `disabled` or Button `loading` only for pending work, field validation already explained beside the field, empty input, and obvious boundaries.
- A business blocker stays focusable and tappable, suppresses the original action, exposes `aria-disabled`, and opens the actionable popover.
- Show exactly one blocker and at most one resolution CTA. Priority is permission, missing local data, conflicting workflow state, then account/provider setup.
- Permission copy names who can resolve the action; do not add a request-access workflow.
- Reuse named predicates from `src/lib/auth/roles.ts`, existing readiness functions, existing settings destinations, and existing domain dialogs. Do not add inline role comparisons or backend bypasses.
- Do not add dependencies, database migrations, routes, RLS policies, provider calls, or settings pages.
- Base UI 1.6 controlled Popover and nested `render` composition are the supported APIs. Never set native `disabled` on a blocked Popover trigger because Base UI then prevents opening and removes it from the tab order.
- Preserve the user's unrelated changes in `PRDs/roadmap.md`, `docs/changelog.md`, `src/lib/finance/invoice-pdf.tsx`, `src/lib/finance/invoice-pdf.test.tsx`, and `output/`. Stage and commit only files named by the current task.
- Follow `docs/ui-patterns.md`: reuse masters, use `getErrorMessage`, use Button `loading`, preserve canonical labels, and avoid call-site restyling.

---

## File Map

- `src/components/ui/resolvable-action.tsx` — domain-neutral blocker model, trigger interception, tooltip, popover, resolution link/callback, controlled-open support.
- `src/components/ui/resolvable-action.test.tsx` — master behavior, accessibility, keyboard, focus, and resolution tests.
- `src/components/members/send-reminder-button.tsx` — renewal reminder blocker mapping; removes the local blocker Dialog.
- `src/components/inbox/message-composer.tsx` — session and role blockers; preserves empty/pending states.
- `src/lib/finance/invoice-detail-presentation.ts` — pure invoice action applicability and blocker codes.
- `src/components/finance/invoice-document-actions.tsx` — invoice PDF download/share blocker mapping.
- `src/components/finance/payment-link-actions.tsx` — Razorpay, invoice, phone, WhatsApp, and template blocker mapping.
- `src/components/finance/invoice-detail-dialog.tsx` — collection/refund/void action visibility and refund-review resolution.
- `src/components/finance/finance-invoices.tsx` — list/card Record payment action remains visible when only refund review blocks it.
- `src/components/members/membership-actions-menu.tsx` — focused, testable Membership actions menu and controlled blocker anchor extracted from the large member detail view.
- `src/components/members/member-detail-view.tsx` — consumes the extracted menu and provides Billing-section resolution.
- `src/components/follow-ups/follow-up-button.tsx` and `follow-up-completion-control.tsx` — permission blockers use the shared master.
- `docs/ui-patterns.md`, `docs/changelog.md`, `PRDs/roadmap.md` — shipped interaction contract and feature status.

---

### Task 1: Build the ResolvableAction master

**Files:**

- Create: `src/components/ui/resolvable-action.tsx`
- Create: `src/components/ui/resolvable-action.test.tsx`

**Interfaces:**

- Consumes: `Button`, `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverHeader`, `PopoverTitle`, `PopoverDescription`, `Tooltip`, `TooltipTrigger`, `TooltipContent`, `usePendingNavigation`.
- Produces: `ActionBlocker`, `ActionResolution`, and `ResolvableAction`. `ResolvableAction` accepts an existing trigger element, `onAction`, `blocker`, optional controlled `open/onOpenChange`, and Popover positioning props.

- [ ] **Step 1: Write the failing normal-versus-blocked tests**

Create a jsdom test with a normal action and a blocked action:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';
import { ResolvableAction } from '@/components/ui/resolvable-action';

afterEach(cleanup);

describe('ResolvableAction', () => {
  it('runs an unblocked action normally', async () => {
    const onAction = vi.fn();
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        onAction={onAction}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the blocker without running the business action', async () => {
    const onAction = vi.fn();
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        onAction={onAction}
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
        }}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Send invoice' });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(trigger);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("Invoice template isn't ready")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing module failure**

Run: `npx vitest run src/components/ui/resolvable-action.test.tsx`

Expected: FAIL because `@/components/ui/resolvable-action` does not exist.

- [ ] **Step 3: Add failing keyboard, resolution, disabled, and focus tests**

Add tests that prove:

```tsx
it('opens from Enter and restores focus after Escape', async () => {
  const user = userEvent.setup();
  render(
    <ResolvableAction
      trigger={<Button type="button">Send invoice</Button>}
      blocker={{
        title: "Invoice template isn't ready",
        description: 'Approve the invoice template before sending.',
      }}
    />
  );
  const trigger = screen.getByRole('button', { name: 'Send invoice' });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByText("Invoice template isn't ready")).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
});

it('runs a callback resolution but not the original action', async () => {
  const onAction = vi.fn();
  const onResolve = vi.fn();
  render(
    <ResolvableAction
      trigger={<Button type="button">Send invoice</Button>}
      onAction={onAction}
      blocker={{
        title: "Invoice template isn't ready",
        description: 'Approve the invoice template before sending.',
        resolution: { label: 'Open template setup', onResolve },
      }}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Open template setup' })
  );
  expect(onResolve).toHaveBeenCalledOnce();
  expect(onAction).not.toHaveBeenCalled();
});

it('keeps a truly disabled trigger inert', async () => {
  render(
    <ResolvableAction
      trigger={<Button type="button">Send invoice</Button>}
      disabled
      blocker={{
        title: "Invoice template isn't ready",
        description: 'Approve the invoice template before sending.',
      }}
    />
  );
  const trigger = screen.getByRole('button', { name: 'Send invoice' });
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(trigger);
  expect(screen.queryByText("Invoice template isn't ready")).toBeNull();
});
```

Also mock `next/navigation` and assert an `href` resolution calls the existing pending-navigation path and displays Button `loading` until navigation replaces the source view.

- [ ] **Step 4: Implement the domain-neutral master**

Implement these public types exactly:

```tsx
export type ActionResolution =
  | { label: string; href: string; onResolve?: never }
  | { label: string; onResolve: () => void; href?: never };

export interface ActionBlocker {
  title: string;
  description: string;
  resolution?: ActionResolution;
}

interface ResolvableActionProps {
  trigger: React.ReactElement;
  onAction?: React.MouseEventHandler<HTMLElement>;
  blocker?: ActionBlocker | null;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}
```

Use controlled-or-uncontrolled state. Compose `TooltipTrigger` and `PopoverTrigger` through Base UI's `render` prop, clone/merge the supplied trigger so the master owns activation, and keep the trigger's existing accessible name. Treat either the wrapper `disabled` prop or `trigger.props.disabled` as truly disabled: pass native disabled through and do not open. If `blocker` is present, set `aria-disabled`, prevent `onAction`, and open the Popover. If no blocker exists, invoke `onAction` without opening.

Render the approved content hierarchy:

```tsx
function resolveInline() {
  setResolvedOpen(false);
  if (blocker?.resolution && 'onResolve' in blocker.resolution) {
    blocker.resolution.onResolve();
  }
}

<PopoverContent side={side} align={align}>
  <PopoverHeader>
    <PopoverTitle>{blocker.title}</PopoverTitle>
    <PopoverDescription>{blocker.description}</PopoverDescription>
  </PopoverHeader>
  {blocker.resolution ? (
    <div className="flex justify-end">
      {'href' in blocker.resolution ? (
        <Button
          render={<Link href={blocker.resolution.href} />}
          loading={isPending(blocker.resolution.href)}
          onClick={() => startNavigation(blocker.resolution.href)}
        >
          {blocker.resolution.label}
        </Button>
      ) : (
        <Button onClick={resolveInline}>{blocker.resolution.label}</Button>
      )}
    </div>
  ) : null}
</PopoverContent>;
```

The master-owned blocked trigger treatment is subdued but interactive; do not use `cursor-not-allowed`. Suppress the hover Tooltip while the Popover is open. Close the Popover before invoking an inline resolution and return focus through Base UI's normal dismissal behavior.

- [ ] **Step 5: Run focused tests and static checks**

Run:

```bash
npx vitest run src/components/ui/resolvable-action.test.tsx
npx eslint src/components/ui/resolvable-action.tsx src/components/ui/resolvable-action.test.tsx
npx tsc --noEmit
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the master**

```bash
git add src/components/ui/resolvable-action.tsx src/components/ui/resolvable-action.test.tsx
git commit -m "feat(ui): add resolvable action master"
```

---

### Task 2: Migrate renewal reminders and WhatsApp composer actions

**Files:**

- Modify: `src/components/members/send-reminder-button.tsx`
- Create: `src/components/members/send-reminder-button.ui.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`

**Interfaces:**

- Consumes: `ResolvableAction`, `ActionBlocker`, existing `ReminderReadiness`, `onOpenTemplates`, and `useCan('send-messages')`.
- Produces: reminder and composer blockers that reuse existing readiness and callbacks without changing send APIs.

- [ ] **Step 1: Write failing renewal blocker tests**

Render `SendReminderButton` with a missing phone and with `readiness.ready=false`. Assert the Remind trigger has no native `disabled`, opens anchored copy, and never calls `/api/whatsapp/send`. For a readiness resolution, assert **Open template setup** uses the existing `/settings?tab=templates` href.

```tsx
expect((remind as HTMLButtonElement).disabled).toBe(false);
expect(remind.getAttribute('aria-disabled')).toBe('true');
await user.click(remind);
expect(screen.getByText('This member has no phone number')).toBeTruthy();
expect(fetch).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the renewal test and verify it fails against the Dialog implementation**

Run: `npx vitest run src/components/members/send-reminder-button.ui.test.tsx`

Expected: FAIL because the current component opens a Dialog and has no shared popover semantics.

- [ ] **Step 3: Replace the local reminder Dialog with ResolvableAction**

Delete `blockerOpen`, Dialog imports, and local Dialog markup. Build one blocker:

```tsx
const blocker: ActionBlocker | null = blocked
  ? {
      title: !hasPhone
        ? 'Phone number required'
        : "WhatsApp reminder isn't ready",
      description: blockedReason ?? 'Complete WhatsApp setup before sending.',
      resolution: resolution
        ? { label: resolution.label, href: resolution.href }
        : undefined,
    }
  : null;
```

Keep `sending`, `sent`, and `readiness.loading` as true disabled/loading states. Keep `sendRenewalReminder` unchanged.

- [ ] **Step 4: Write failing composer session and permission tests**

Make the `useCan` mock mutable. Add tests proving:

```tsx
it('resolves a closed session through the template picker', async () => {
  const onOpenTemplates = vi.fn();
  render(
    <MessageComposer
      conversationId="conversation-1"
      sessionExpired
      onSend={vi.fn()}
      onSendMedia={vi.fn()}
      onOpenTemplates={onOpenTemplates}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(screen.getByText('WhatsApp session has closed')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Send template' }));
  expect(onOpenTemplates).toHaveBeenCalledOnce();
});

it('explains read-only send actions without inventing a CTA', async () => {
  canSendMessages = false;
  render(
    <MessageComposer
      conversationId="conversation-1"
      sessionExpired={false}
      onSend={vi.fn()}
      onSendMedia={vi.fn()}
      onOpenTemplates={vi.fn()}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Send template' }));
  expect(screen.getByText('Admin access required')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /ask|request/i })).toBeNull();
});
```

- [ ] **Step 5: Migrate composer role and session blockers**

Use `ResolvableAction` for Send template, AI draft, and Send. Preserve these distinctions:

- `sending`, `drafting`, upload/recording work: Button loading/disabled;
- empty message while the session is open: disabled with no popover;
- `sessionExpired`: blocked Send action with **Send template** callback;
- read-only role: permission blocker with no CTA;
- the template trigger remains the direct enabled resolution for an expired session when the user has send permission.

Do not change message upload, recording, send, or template-picker APIs.

- [ ] **Step 6: Run communication tests**

Run:

```bash
npx vitest run src/components/ui/resolvable-action.test.tsx src/components/members/send-reminder-button.test.ts src/components/members/send-reminder-button.ui.test.tsx src/components/inbox/message-composer.test.tsx
npx eslint src/components/members/send-reminder-button.tsx src/components/members/send-reminder-button.ui.test.tsx src/components/inbox/message-composer.tsx src/components/inbox/message-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the communication slice**

```bash
git add src/components/members/send-reminder-button.tsx src/components/members/send-reminder-button.ui.test.tsx src/components/inbox/message-composer.tsx src/components/inbox/message-composer.test.tsx
git commit -m "feat: explain blocked WhatsApp actions"
```

---

### Task 3: Add resolvable invoice-document and payment-link actions

**Files:**

- Modify: `src/lib/finance/invoice-detail-presentation.ts`
- Modify: `src/lib/finance/invoice-detail-presentation.test.ts`
- Modify: `src/components/finance/invoice-document-actions.tsx`
- Modify: `src/components/finance/invoice-document-actions.test.tsx`
- Modify: `src/components/finance/payment-link-actions.tsx`
- Modify: `src/components/finance/payment-link-actions.test.tsx`

**Interfaces:**

- Consumes: `ResolvableAction`, `invoiceDocumentActionPresentation`, payment-link route availability, named role predicates, current contact/member data.
- Produces: stable invoice blocker codes and UI-owned resolution mapping to existing settings tabs.

- [ ] **Step 1: Add failing pure presentation tests for stable blocker codes**

Extend `InvoiceDocumentActionState` with:

```ts
export type InvoiceDocumentBlockerCode =
  | 'void'
  | 'refund_review'
  | 'invoice_profile'
  | 'document_preparing'
  | 'missing_phone'
  | 'whatsapp_disconnected'
  | 'template_unavailable';

export interface InvoiceDocumentActionState {
  show: boolean;
  enabled: boolean;
  reason: string | null;
  blocker: InvoiceDocumentBlockerCode | null;
}
```

Assert every existing reason branch returns the matching stable code and ready/hidden states return `null`.

- [ ] **Step 2: Run the pure test and verify missing blocker fields**

Run: `npx vitest run src/lib/finance/invoice-detail-presentation.test.ts`

Expected: FAIL because action states do not yet contain `blocker`.

- [ ] **Step 3: Implement blocker codes without changing existing reason copy**

Add codes alongside current `show`, `enabled`, and `reason`. Keep the current ordering and immutable-document rules. Do not move UI routes into the pure finance module.

- [ ] **Step 4: Write failing InvoiceDocumentActions popover tests**

Cover at least:

- viewer Share: **Admin access required**, no CTA;
- incomplete invoice profile: **Finish invoice setup** linking to `/settings?tab=payments`;
- missing phone: **Phone number required**, no CTA where the host has no editor callback;
- disconnected WhatsApp: **Connect WhatsApp** linking to `/settings?tab=whatsapp`;
- unavailable template: **Open template setup** linking to `/settings?tab=templates`;
- generating document: native disabled/loading, not a blocker popover;
- ready download/share still invoke their existing fetches.

- [ ] **Step 5: Migrate invoice document buttons**

Replace `GatedButton disabled title` with `ResolvableAction`. Build permission blockers before presentation blockers. Map stable codes to copy and resolutions in this UI component; keep `downloadInvoice` and `shareInvoice` unchanged.

Use Button `loading={downloading}` and `loading={sharing}`. Document generation status `generating` stays temporarily disabled because retrying shortly is not an immediate user resolution.

- [ ] **Step 6: Write failing payment-link blocker tests**

Extend the current readiness test suite to cover:

```tsx
expect(copy.getAttribute('aria-disabled')).toBe('true');
await user.click(copy);
expect(screen.getByText("Razorpay isn't connected")).toBeTruthy();
expect(
  screen.getByRole('link', { name: 'Connect Razorpay' }).getAttribute('href')
).toBe('/settings?tab=payments');
```

Also cover Send link priority: permission first, then missing phone, provider readiness, then template readiness according to the approved global order. Verify Copy link does not inherit WhatsApp-only blockers.

- [ ] **Step 7: Migrate payment-link actions**

Keep `readinessLoading` and `creatingFor` as true loading/disabled states. Convert `!providerReady` and `!sendReady` from native disabled/title states into blockers. Use existing `providerReason` and `templateReason`, with these resolution destinations:

- Razorpay/provider account setup: `/settings?tab=payments` with **Open payment setup**;
- WhatsApp disconnected: `/settings?tab=whatsapp` with **Connect WhatsApp**;
- exact template unavailable: `/settings?tab=templates` with **Open template setup**;
- missing phone: no CTA unless a host callback is explicitly supplied;
- unsupported/terminal provider state: explanation only when no existing destination can resolve it.

Do not change create/reuse/send Payment Link requests.

- [ ] **Step 8: Run invoice action tests and commit**

Run:

```bash
npx vitest run src/lib/finance/invoice-detail-presentation.test.ts src/components/finance/invoice-document-actions.test.tsx src/components/finance/payment-link-actions.test.tsx
npx eslint src/lib/finance/invoice-detail-presentation.ts src/lib/finance/invoice-detail-presentation.test.ts src/components/finance/invoice-document-actions.tsx src/components/finance/invoice-document-actions.test.tsx src/components/finance/payment-link-actions.tsx src/components/finance/payment-link-actions.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/lib/finance/invoice-detail-presentation.ts src/lib/finance/invoice-detail-presentation.test.ts src/components/finance/invoice-document-actions.tsx src/components/finance/invoice-document-actions.test.tsx src/components/finance/payment-link-actions.tsx src/components/finance/payment-link-actions.test.tsx
git commit -m "feat(finance): resolve blocked invoice delivery actions"
```

---

### Task 4: Keep applicable invoice collection, refund, and void actions explainable

**Files:**

- Modify: `src/lib/finance/invoice-detail-presentation.ts`
- Modify: `src/lib/finance/invoice-detail-presentation.test.ts`
- Modify: `src/components/finance/invoice-detail-dialog.tsx`
- Create: `src/components/finance/invoice-detail-actions.test.tsx`
- Modify: `src/components/finance/finance-invoices.tsx`

**Interfaces:**

- Consumes: `ResolvableAction`, invoice financial snapshot, `canRecordPayments`, `canCorrectPayments`, `canRefundGatewayPayments`, refund scan/allocation facts.
- Produces: pure `invoiceCollectionActionState`, `invoiceRefundActionState`, and `invoiceVoidActionState` helpers used consistently in mobile cards, desktop rows, and invoice detail.

- [ ] **Step 1: Write failing pure applicability tests**

Define exact helper results:

```ts
interface InvoiceResolvableActionState {
  show: boolean;
  pending: boolean;
  blocker: 'permission' | 'refund_review' | 'line_target_required' | null;
}
```

Tests must prove:

- open balance + permission => `{ show: true, pending: false, blocker: null }`;
- open accounting balance + refund review => `show: true`, blocker `refund_review`;
- paid, void, or no-charge invoice => `show: false`;
- refund scan incomplete => Refund `show: true`, `pending: true`;
- zero refundable capacity => Refund `show: false`;
- processed unallocated refund => Refund blocker `line_target_required`;
- manual paid payment => Void applicable; gateway payment => Void hidden and Refund considered instead;
- insufficient role => permission blocker only when the action is otherwise applicable.

- [ ] **Step 2: Run the pure test and verify helper failures**

Run: `npx vitest run src/lib/finance/invoice-detail-presentation.test.ts`

Expected: FAIL because the three helpers do not exist.

- [ ] **Step 3: Implement the pure action-state helpers**

Keep business math in `invoice-detail-presentation.ts`, use `isChargeableAmount`, and do not return React copy or callbacks. Permission is passed as a boolean fact; the helper must not inspect role names.

- [ ] **Step 4: Write failing invoice integration tests**

Create focused jsdom tests around exported action rows or the dialog with minimal mocks. Assert:

- refund-review invoice still renders Record payment with `aria-disabled="true"`;
- activating it opens **Refund review blocks collection**;
- authorized resolution CTA is **Resolve refund review**;
- a viewer sees **Admin access required** with no CTA;
- paid/void/no-charge invoices do not render Record payment;
- refund scan uses Button loading/disabled;
- no remaining refund amount removes Refund;
- applicable manual Void remains visible but role-blocked when necessary.

- [ ] **Step 5: Integrate collection actions in invoice detail and lists**

Replace the single `collectible` boolean with pure action state. Render PaymentLinkActions, Copy UPI, and Record payment whenever collection is applicable; gate each independently. Refund-review actions use a callback resolution that scrolls/focuses the existing refund review section or its existing **Resolve refund review** control. Add a stable element id/ref for that target rather than opening a duplicate dialog.

In `finance-invoices.tsx`, mobile and desktop use the same helper so Record payment is not silently hidden only because `requires_refund_review` is true. Preserve card/row click propagation.

- [ ] **Step 6: Integrate refund and void actions**

Replace Refund's `disabled title` with `ResolvableAction`. Keep historical reconciliation pending as loading. Hide Refund for zero capacity. Map `line_target_required` to the existing classification control. Show role-blocked Void only for an otherwise applicable manual payment and keep gateway payments on the Refund path.

- [ ] **Step 7: Run finance tests and commit**

Run:

```bash
npx vitest run src/lib/finance/invoice-detail-presentation.test.ts src/components/finance/invoice-detail-actions.test.tsx src/components/finance/invoice-document-actions.test.tsx src/components/finance/payment-link-actions.test.tsx
npx eslint src/lib/finance/invoice-detail-presentation.ts src/lib/finance/invoice-detail-presentation.test.ts src/components/finance/invoice-detail-dialog.tsx src/components/finance/invoice-detail-actions.test.tsx src/components/finance/finance-invoices.tsx
```

Expected: PASS.

Commit only the named files:

```bash
git add src/lib/finance/invoice-detail-presentation.ts src/lib/finance/invoice-detail-presentation.test.ts src/components/finance/invoice-detail-dialog.tsx src/components/finance/invoice-detail-actions.test.tsx src/components/finance/finance-invoices.tsx
git commit -m "feat(finance): explain blocked collection actions"
```

---

### Task 5: Extract and migrate membership lifecycle actions

**Files:**

- Create: `src/components/members/membership-actions-menu.tsx`
- Create: `src/components/members/membership-actions-menu.test.tsx`
- Modify: `src/components/members/member-detail-view.tsx`
- Modify: `src/components/members/member-detail-view.test.tsx`

**Interfaces:**

- Consumes: `ResolvableAction`, current membership status/trial state, `canManage`, `lifecycleBlockReason`, `busy`, and callbacks for renew/change/edit/freeze/resume/cancel/reactivate/open billing.
- Produces: `MembershipActionsMenu`, a focused owner of menu applicability and the controlled blocker anchored to the Membership actions trigger.

- [ ] **Step 1: Write failing menu behavior tests**

Create fixtures for active, frozen, and cancelled memberships. Prove applicable items match current behavior. Then prove a mandate blocker keeps items selectable for explanation rather than native-disabled:

```tsx
await user.click(screen.getByRole('button', { name: 'Membership actions' }));
await user.click(screen.getByRole('menuitem', { name: 'Renew membership' }));
expect(onRenew).not.toHaveBeenCalled();
expect(screen.getByText('AutoPay must be resolved first')).toBeTruthy();
await user.click(screen.getByRole('button', { name: 'Open billing' }));
expect(onOpenBilling).toHaveBeenCalledOnce();
```

Add a permission test that shows **Admin access required**, no resolution CTA, and no lifecycle callback.

- [ ] **Step 2: Run the menu test and verify the missing module failure**

Run: `npx vitest run src/components/members/membership-actions-menu.test.tsx`

Expected: FAIL because the extracted component does not exist.

- [ ] **Step 3: Implement MembershipActionsMenu**

Move only the existing membership DropdownMenu block from `member-detail-view.tsx`. Preserve the current item vocabulary and applicability conditions. Replace blocker-driven native `disabled` with a guarded selection handler:

```ts
function runOrExplain(label: string, action: () => void) {
  if (!canManage) {
    setBlocker({
      title: 'Admin access required',
      description: `Ask an admin or owner to ${label.toLowerCase()}.`,
    });
    return;
  }
  if (lifecycleBlockReason) {
    setBlocker({
      title: 'AutoPay must be resolved first',
      description: lifecycleBlockReason,
      resolution: { label: 'Open billing', onResolve: onOpenBilling },
    });
    return;
  }
  action();
}
```

Wrap the existing Membership actions trigger in controlled `ResolvableAction`. Setting `blocker` closes the DropdownMenu and opens the Popover anchored to that persistent trigger. `busy` remains native-disabled; blocker conditions do not.

- [ ] **Step 4: Integrate the extracted menu**

Replace the inline menu in `member-detail-view.tsx` with `MembershipActionsMenu`. Pass the existing setters/callbacks. Implement `onOpenBilling` by scrolling the existing `<Section id="payments">` into view and focusing its heading/first actionable element without creating a second Billing surface.

- [ ] **Step 5: Run member tests and commit**

Run:

```bash
npx vitest run src/components/members/membership-actions-menu.test.tsx src/components/members/member-detail-view.test.tsx src/components/members/member-detail-template-action.test.tsx
npx eslint src/components/members/membership-actions-menu.tsx src/components/members/membership-actions-menu.test.tsx src/components/members/member-detail-view.tsx src/components/members/member-detail-view.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/components/members/membership-actions-menu.tsx src/components/members/membership-actions-menu.test.tsx src/components/members/member-detail-view.tsx src/components/members/member-detail-view.test.tsx
git commit -m "feat(members): resolve blocked membership actions"
```

---

### Task 6: Migrate follow-up permission blockers

**Files:**

- Modify: `src/components/follow-ups/follow-up-button.tsx`
- Modify: `src/components/follow-ups/follow-up-completion-control.tsx`
- Create: `src/components/follow-ups/follow-up-actions.test.tsx`

**Interfaces:**

- Consumes: `ResolvableAction`, existing `canAct`, `gateReason`, `onClick`/`onMarkDone`, and canonical Follow up/Complete follow-up labels.
- Produces: canonical row and completion triggers with actionable permission explanations and no access-request CTA.

- [ ] **Step 1: Write failing follow-up blocker tests**

Assert an allowed Follow up click runs the callback. Assert `canAct=false` leaves the trigger focusable, opens **Admin access required**, and never invokes the callback. Repeat for the open completion tick and keep done/cancelled rendering unchanged.

- [ ] **Step 2: Run the test and verify native-disabled failures**

Run: `npx vitest run src/components/follow-ups/follow-up-actions.test.tsx`

Expected: FAIL because existing permission gates use `GatedButton` or a native disabled tick.

- [ ] **Step 3: Migrate the canonical follow-up triggers**

Keep `FollowUpButton` geometry, icon, and **Follow up** label byte-for-byte. Replace `GatedButton` with `ResolvableAction` around the unmodified Button. Build permission copy from `gateReason`:

```ts
const blocker = canAct
  ? null
  : {
      title: 'Admin access required',
      description: `Ask an admin or owner to ${gateReason}.`,
    };
```

Wrap the completion control's established native circular button with the same master; do not redesign it or alter terminal Badge states. Remove the local title-wrapper workaround.

- [ ] **Step 4: Run follow-up tests and commit**

Run:

```bash
npx vitest run src/components/follow-ups/follow-up-actions.test.tsx src/components/members/service-renewal-action-lists.test.tsx
npx eslint src/components/follow-ups/follow-up-button.tsx src/components/follow-ups/follow-up-completion-control.tsx src/components/follow-ups/follow-up-actions.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/components/follow-ups/follow-up-button.tsx src/components/follow-ups/follow-up-completion-control.tsx src/components/follow-ups/follow-up-actions.test.tsx
git commit -m "feat: explain blocked follow-up actions"
```

---

### Task 7: Document the contract and verify the complete pilot

**Files:**

- Modify: `docs/ui-patterns.md`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Verify: every file changed in Tasks 1–6

**Interfaces:**

- Consumes: the shipped ResolvableAction master and all pilot migrations.
- Produces: canonical product-wide documentation and completion evidence.

- [ ] **Step 1: Audit pilot call sites for forbidden silent blockers**

Run focused searches:

```bash
rg -n "disabled=|title=" src/components/members/send-reminder-button.tsx src/components/inbox/message-composer.tsx src/components/finance/invoice-document-actions.tsx src/components/finance/payment-link-actions.tsx src/components/finance/invoice-detail-dialog.tsx src/components/finance/finance-invoices.tsx src/components/members/membership-actions-menu.tsx src/components/follow-ups/follow-up-button.tsx src/components/follow-ups/follow-up-completion-control.tsx
rg -n "cursor-not-allowed|disabled:opacity|Read-only —" src/components/ui/resolvable-action.tsx
```

Classify each remaining `disabled` as loading, field validation, empty input, or obvious terminal/boundary state. Convert any remaining business prerequisite to `blocker`; do not mechanically remove valid disabled states.

- [ ] **Step 2: Update the UI master documentation**

Add a `Resolvable actions` section next to `Pending button actions` in `docs/ui-patterns.md` with this canonical contract:

```markdown
## Resolvable actions

Use `ResolvableAction` when an action is unavailable because a user or administrator can change a prerequisite. A blocker stays focusable and tappable, opens one anchored reason with at most one resolution CTA, and never invokes the original action. Use `disabled`/`loading` only for pending work, field validation already explained beside its field, empty input, and obvious boundaries. Actions that are no longer applicable are omitted rather than blocked. Permission, missing local data, conflicting workflow state, then provider setup is the blocker priority.
```

Document that call sites cannot override the master's blocked styling or hand-roll a competing tooltip/popover.

- [ ] **Step 3: Update changelog and roadmap without overwriting user edits**

Inspect the current dirty versions first. Add a terse changelog entry naming `src/components/ui/resolvable-action.tsx`, the six pilot domains, and the disabled-versus-blocked gotcha. Add the shipped pilot to the appropriate Built/Shipped section in `PRDs/roadmap.md`; do not replace or reformat unrelated existing edits.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npx vitest run src/components/ui/resolvable-action.test.tsx src/components/members/send-reminder-button.test.ts src/components/members/send-reminder-button.ui.test.tsx src/components/inbox/message-composer.test.tsx src/lib/finance/invoice-detail-presentation.test.ts src/components/finance/invoice-document-actions.test.tsx src/components/finance/payment-link-actions.test.tsx src/components/finance/invoice-detail-actions.test.tsx src/components/members/membership-actions-menu.test.tsx src/components/members/member-detail-view.test.tsx src/components/follow-ups/follow-up-actions.test.tsx
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

Expected: all commands PASS. If the production build requires unavailable environment configuration, capture the exact failure and prove whether it is pre-existing before claiming completion.

- [ ] **Step 5: Review accessibility and worktree isolation**

Verify with keyboard in the running app or a focused browser test:

- blocked triggers remain tabbable;
- Enter and Space open the popover;
- Escape closes it and restores trigger focus;
- tooltip copy is supplemental, not required;
- resolution CTA has one clear accessible name;
- underlying actions never run while blocked;
- phone-width popovers remain within the viewport.

Then run `git status --short` and `git diff --check`. Confirm the user's invoice PDF and `output/` changes are still present and were not staged by feature commits.

- [ ] **Step 6: Commit documentation and any final test-only corrections**

```bash
git add docs/ui-patterns.md docs/changelog.md PRDs/roadmap.md
git commit -m "docs: record resolvable actions pilot"
```

Do not stage `src/lib/finance/invoice-pdf.tsx`, `src/lib/finance/invoice-pdf.test.tsx`, or `output/` unless the user separately authorizes those changes.
