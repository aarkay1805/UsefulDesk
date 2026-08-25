# Resolvable Actions Pilot Design

## Goal

When a high-value action is unavailable, the user must be able to discover why and what to do next without leaving the current context to investigate. UsefulDesk will distinguish an action that is temporarily disabled from an action that is blocked by a resolvable prerequisite. A blocked action remains discoverable and opens an anchored explanation with one direct resolution whenever the current user can perform it.

The pilot covers WhatsApp messaging, renewals, payments, follow-ups, membership lifecycle actions, and invoice actions. It proves one reusable interaction contract before any product-wide migration.

## Product Rationale

UsefulDesk is phone-first and action-list-first. Hover-only titles do not work on phones, and native disabled controls often receive neither pointer nor keyboard events. A silent disabled button forces gym staff to infer whether they need to enter data, change a workflow state, connect an account, wait, or ask an administrator. That uncertainty is most damaging in the north-star loop: identify expiring members, contact them, collect money, assign follow-up, and track the conversation.

The selected pattern is an actionable popover. Desktop hover may expose a brief tooltip, but the persistent click, tap, and keyboard popover is the authoritative explanation and recovery surface.

## Considered Approaches

### Extend `GatedButton` globally

This would give rapid adoption but would change a shared component with 66 usages across 24 files. `GatedButton` currently represents role gating only; adding domain prerequisites, interactive popovers, and resolution callbacks would broaden its contract and make the pilot's blast radius unnecessarily large.

### Add a `ResolvableAction` master for the pilot — selected

A new master contains the interaction and accessibility behavior while pilot call sites retain ownership of domain readiness. Existing `Button` and `GatedButton` consumers outside the pilot remain unchanged. The pattern can replace `GatedButton` later only after the pilot proves its value and API.

### Build a local popover on each screen

This minimizes initial abstraction but duplicates trigger semantics, blocker priority, focus handling, and copy structure. The current product already demonstrates this drift: renewal reminders open a full dialog, invoice actions depend on native titles, and other actions are hidden or silently disabled.

## State Contract

The implementation will use two separate state channels:

- `disabled` means the action cannot usefully accept interaction right now and needs no recovery popover. Examples are a pending request, an empty message, an invalid form value already explained beside its field, and a first/last pagination boundary.
- `blocker` means the business action cannot run, but asking for an explanation or resolution is itself a useful action. The trigger remains focusable and activatable; activating it opens the blocker popover instead of running the original callback.

An action that is no longer applicable is not a blocker. Paid or void invoices do not offer Record payment, a payment with no refundable capacity does not offer Refund, and terminal membership states show only lifecycle actions that make sense for that state.

Permission is a blocker rather than a temporary disabled state. It has no fabricated request-access CTA in this pilot; the explanation names the role that can resolve it.

## Shared Component

Create `src/components/ui/resolvable-action.tsx` as a new master component. It composes the existing unmodified `Button`, `Tooltip`, and `Popover` primitives. It does not add a Button variant or permit call-site visual overrides.

The public blocker model is domain-neutral:

```ts
interface ActionBlocker {
  title: string;
  description: string;
  resolution?:
    { label: string; href: string } | { label: string; onResolve: () => void };
}
```

`ResolvableAction` accepts the normal action callback, an optional blocker, and the existing trigger render. It supports controlled `open` state so a blocked dropdown item can close its menu and open the explanation anchored to the owning action button. This is required for the member profile's Membership actions menu: selecting a blocked item records that item's blocker, closes the dropdown, and opens the popover from the visible Membership actions trigger.

When no blocker exists, the component behaves like the underlying action. When a blocker exists, the master:

1. prevents the original action callback;
2. applies the master-owned subdued blocked treatment without using native `disabled`;
3. sets `aria-disabled="true"`, `aria-haspopup="dialog"`, and `aria-expanded`;
4. opens the actionable popover on click, tap, Enter, or Space;
5. exposes the short reason in a desktop hover tooltip;
6. returns focus to the trigger when the popover closes;
7. renders at most one resolution CTA.

The blocked trigger remains a real useful control, so it keeps the normal pointer cursor. It does not use `cursor-not-allowed`. The master owns all blocked opacity, tooltip, popover spacing, and focus treatment; pilot call sites may control only external layout.

The popover has a short state headline, one explanatory sentence, and one resolution CTA. Clicking a callback resolution closes the popover before invoking the callback. Clicking a link uses the existing pending-navigation treatment and normal browser Back navigation returns to the originating view. A failed inline resolution leaves or restores the blocker and uses the owning workflow's existing error message.

`GatedButton` remains unchanged during the pilot. Pilot call sites that need actionable permission explanations migrate to `ResolvableAction`; unrelated call sites do not.

## Domain Readiness and Data Flow

The shared master contains no WhatsApp, invoice, Razorpay, membership, or RBAC logic. Each owning domain resolves current data into either `null` or one `ActionBlocker` before rendering.

Blockers are prioritized in this order:

1. permission, because it determines whether the current user can perform any resolution;
2. missing local data, such as a member phone number;
3. conflicting workflow state, such as refund review or a live AutoPay mandate;
4. account or provider setup, such as WhatsApp, template, or Razorpay readiness.

Only the highest-priority blocker is shown. Copy may combine the underlying fact with the permission outcome, for example, “Ask an admin to add this member's phone number.” The popover never presents a checklist of unrelated setup problems.

Existing readiness sources remain authoritative:

- WhatsApp template readiness continues through `evaluateTemplateReadiness` and the exact template contracts.
- Renewal reminder readiness continues through `ReminderReadiness`; its existing resolution link is reused.
- Invoice document availability continues through `invoiceDocumentActionPresentation` and document status.
- Payment-link availability continues through the Razorpay route response, WhatsApp connection, template readiness, invoice state, currency, and contact phone.
- Membership lifecycle locking continues through `membershipLifecycleBlockReason` and the mandate state.
- Authorization continues through named predicates in `src/lib/auth/roles.ts`; no inline role comparison is introduced.

No database, RLS, route, or provider-contract change is part of this pilot. The UI explanation never weakens the existing server and database enforcement.

## Pilot Coverage

### WhatsApp messaging

- Composer actions blocked by role explain that the user can browse but cannot send and identify the required administrator action.
- A closed 24-hour session resolves through **Send template**, opening the existing template picker in the same view.
- Missing account connection or an unavailable exact template resolves to the existing WhatsApp or template setup surface when the current role permits it.
- Empty message text, attachment processing, and active sends remain ordinary validation or loading states.

### Renewals

- `SendReminderButton` replaces its local full blocker dialog with the shared anchored popover.
- A missing phone resolves to the existing member-profile editing path when the caller can expose it; otherwise the copy tells the user who can add the number.
- WhatsApp connection and renewal-template blockers reuse the existing readiness resolution.
- Renew membership actions blocked by a provider-coupled mandate resolve to the member Billing section or the existing Payments setup/attention surface as appropriate.

### Membership lifecycle

Renew, Change plan, Edit membership, Freeze, Resume, Cancel, and Reactivate remain present when the current membership state makes the action applicable. Permission or a blocking Razorpay mandate routes selection into a popover anchored to the Membership actions trigger. The popover names the selected action and offers **Open billing** or the existing payment-attention destination when that destination can help; otherwise it tells the user that the Razorpay subscription must be resolved first.

Plan-type restrictions and other states that make an action intrinsically inapplicable do not manufacture a blocker or CTA.

### Payments and invoices

- Record payment stays visible for an otherwise collectible invoice that is paused only by refund review. Admins receive **Resolve refund review**; other roles are told to ask an admin.
- Record-payment form validation remains beside Amount and other required fields, not in a popover.
- Copy payment link exposes Razorpay connection, provider availability, supported currency, collectible balance, and refund-review blockers.
- Send payment link additionally exposes missing phone, WhatsApp connection, and exact template readiness, each with the nearest existing resolution.
- Download invoice exposes invoice-profile or document-generation blockers using the existing invoice-details setup path when applicable.
- Send invoice on WhatsApp additionally exposes phone, connection, and exact invoice-document template blockers.
- Refund exposes unresolved line targeting or refund review with **Resolve refund review** for an authorized user. The historical-refund scan remains a loading state, and a payment with no refundable capacity does not render Refund.
- Void remains available only for an applicable manual payment. A role blocker is explained when the action is otherwise applicable; gateway payments continue to use Refund rather than Void.
- Paid, void, no-charge, and genuinely non-collectible invoice states do not display misleading collection actions.

The existing persistent Refund review alert remains because that blocker pauses the invoice's entire collection section. It complements the selected popover pattern rather than replacing it: the alert explains the section-wide condition, while each blocked action gives the contextual resolution.

### Follow-ups

- Create and Complete follow-up permission blockers use the shared action popover.
- The existing “Follow-up already open” state keeps its current direct **Complete follow-up** resolution because it is already an explicit workflow surface, not a silent disabled action.
- Missing note or due-date input remains inline form validation.

## Copy Contract

The headline names the state, not a generic error: “Invoice template isn't ready,” “Refund review blocks collection,” or “Admin access required.” The description states why the selected action cannot run and what must change. The CTA uses a destination or task verb such as **Add phone number**, **Open template setup**, **Connect Razorpay**, **Open billing**, or **Resolve refund review**.

Copy must not expose internal template-contract terminology unless the user is being sent to the template manager, and even there the human-facing template label precedes any provider name. The popover never says only “Unavailable,” “Something went wrong,” or “Contact support.”

## Error and Concurrency Behavior

- Readiness loading uses the shared Button `loading` contract or an existing equivalent pending state and cannot open a premature blocker.
- A blocked trigger never invokes the underlying business action, even under rapid repeated activation.
- Only one blocker popover is open on a surface at a time.
- If readiness changes while the popover is open, the content updates from the authoritative state; when the blocker clears, the popover closes and the original action becomes available.
- Resolution navigation shows pending feedback on the CTA that initiated navigation.
- A failed resolution callback preserves the user's current view and reports the existing domain error; it does not optimistically enable the original action.
- Server-side rejection remains authoritative. If readiness changed after rendering, the existing action error is shown and the screen refreshes or re-evaluates readiness through its established path.

## Accessibility

Blocked actions remain in the tab order. `aria-disabled` communicates that the business action is unavailable, while `aria-haspopup` and `aria-expanded` communicate that the trigger exposes details. Enter and Space open the same popover as pointer activation. The popover receives a programmatic title and description, supports Escape and outside-click dismissal, and returns focus to its trigger.

The tooltip is supplemental and never the only carrier of blocker text. Resolution links and buttons have descriptive accessible names. No meaning depends on opacity or colour. Loading controls retain `aria-busy` through the existing Button contract.

## Testing

Implementation follows test-driven development.

1. Master component tests prove normal actions invoke their callback, blocked actions do not, click/Enter/Space open the popover, `aria-disabled` and popup state are correct, Escape restores focus, and link/callback resolutions work.
2. Tests prove native `disabled` and `loading` remain inert and do not expose a blocker popover.
3. Renewal tests cover missing phone, missing connection/template, resolution navigation, and replacement of the local blocker dialog.
4. Invoice tests cover document download/share, payment-link copy/send, refund review, refund capacity, role gates, and applicable-versus-terminal action visibility.
5. Membership tests cover every applicable dropdown action under permission and mandate blockers and verify the explanation is anchored to the Membership actions trigger.
6. Composer and follow-up tests cover session, role, and existing-open-follow-up behavior.
7. Verification runs focused Vitest suites, the full test suite, lint, typecheck, formatting check, and a production build.

## Rollout and Documentation

The pilot ships as one product change but implementation may proceed in focused slices: shared master, WhatsApp and renewals, invoices and payments, memberships, then follow-ups. Each slice uses the same master and blocker model; no local fallback popover is permitted.

Completion updates `docs/ui-patterns.md` with the disabled-versus-blocked contract and the new master component. It also updates `docs/changelog.md` and `PRDs/roadmap.md` in the same change, as required by the repository's feature-completion rules.

After the pilot is observed in use, a separate decision can migrate remaining high-value or product-wide `GatedButton` and bare `disabled` call sites. That future audit is not implicit in this implementation.

## Non-Goals

- migrating every disabled control in UsefulDesk;
- redesigning Button, DropdownMenu, Tooltip, or Popover geometry;
- adding a role-access request workflow;
- adding new settings destinations solely for resolution links;
- changing WhatsApp, Razorpay, invoice, membership, or follow-up backend rules;
- replacing field-level validation with popovers;
- showing explanations for obvious pagination boundaries or active loading states;
- adding analytics, experimentation infrastructure, or provider-health monitoring.
