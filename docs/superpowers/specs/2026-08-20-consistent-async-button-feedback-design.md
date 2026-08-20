# Consistent Async Button Feedback Design

## Goal

Every button that starts work whose completion is observably delayed by a network request, browser API, file operation, route transition, or substantial asynchronous computation must acknowledge the click immediately with a spinner inside that button. The pending button must also prevent duplicate activation and remain understandable to sighted users and assistive technology.

## Product Rationale

UsefulDesk is used from reception desks and phones, often on unreliable connections. A button that becomes inert without visible feedback makes the operator unsure whether the action started, encourages repeated clicks, and weakens the owner's sense of control. Pending feedback is therefore part of the action contract, not decorative animation.

## Scope

The audit covers shared `Button` and `GatedButton` consumers plus native buttons that start asynchronous work. It includes:

- authentication and account recovery;
- create, update, delete, archive, restore, revoke, disconnect, and retry mutations;
- WhatsApp reminders and other message sends;
- member check-in, membership/service lifecycle actions, and follow-up completion;
- uploads, imports, remote previews, and remote configuration checks;
- button-driven client route transitions where the destination may require loading;
- row-level actions, where only the activated row may appear busy.

It excludes actions that complete synchronously from the user's perspective: opening or closing an already-mounted surface, changing local filters or selection, copying already-available text, toggling visibility, and generating an in-memory download. A secondary cancel/close button disabled because a different action is pending does not receive a spinner; only the control that initiated the pending operation does.

## Shared Button Contract

`src/components/ui/button.tsx` will add an optional `loading?: boolean` prop.

When `loading` is true, the button will:

1. render the canonical Lucide `Loader2` icon with `animate-spin` before its existing children;
2. preserve the existing label so the action remains identifiable and button width remains stable enough for compact layouts;
3. set `aria-busy="true"`;
4. be disabled regardless of its caller-provided `disabled` value;
5. mark the spinner `aria-hidden="true"` so the accessible name comes from the unchanged button label.

The prop is consumed by the shared master and is not forwarded to the Base UI DOM element. Existing buttons remain visually and behaviorally unchanged when `loading` is omitted or false. Existing call sites that already render a correct in-button spinner need not migrate unless doing so removes duplication without changing copy or layout.

`GatedButton` inherits the prop through its existing `Button` props. Authorization gating remains independent: a button is disabled when either its role gate, caller-disabled state, or loading state prevents activation. The wrapper tooltip continues to explain role gates only.

Native buttons that cannot use the shared master because they are established composed controls will use the same `Loader2`, `animate-spin`, `aria-busy`, and duplicate-prevention behavior locally. This work will not convert unrelated native buttons or redesign their geometry.

## State Ownership

Pending state stays with the component that owns the operation.

- One form-level request uses one boolean state.
- Row actions use an item identifier or operation key so only the clicked row spins.
- Multiple operations on one surface use separate states when they can run independently.
- A button-driven route transition uses React's transition state or an equivalent explicit navigation state and resets naturally when the source unmounts.
- Every asynchronous handler clears its pending state in `finally` when the source remains mounted.

The shared button will not inspect returned promises or infer loading automatically. Explicit state keeps form submissions, callbacks that discard promises, Next.js navigation, concurrent row actions, and error recovery predictable.

## Copy and Visual Behavior

The spinner appears at the inline start of the existing button content and uses the current foreground color. Labels may retain an established progressive verb such as `Saving…` or remain as the base action such as `Save changes`; no screen depends on the text change alone as its loading indicator. Icon-only buttons keep their accessible label while the visible icon is replaced or accompanied in a way that avoids two competing glyphs.

No toast announces that an operation merely started. Existing success and error toasts remain unchanged. Loading begins synchronously with activation, before awaiting the network operation.

## Error and Concurrency Behavior

- A failed request clears the spinner and re-enables the action unless an existing authorization or validation gate still applies.
- Existing error messaging remains the recovery explanation.
- Repeated activation while pending is blocked at the button boundary and, where necessary, by the handler's existing guard.
- Independent row actions may run concurrently only when the underlying screen already supports that behavior; otherwise the existing page-level lock remains authoritative.
- A pending state must not replace or erase user-entered form data.

## Accessibility

The pending control retains its accessible name and exposes `aria-busy`. The decorative spinner is hidden from assistive technology. Disabled state prevents keyboard and pointer reactivation. Focus is not programmatically moved when loading starts. Motion is limited to the conventional rotation of a compact progress glyph; no surrounding layout or content animates.

## Testing

Implementation follows test-driven development.

1. Shared button tests prove loading renders a spinner, exposes `aria-busy`, preserves its label, blocks activation, and does not leak the custom prop to the DOM.
2. Focused component tests cover representative form submission, row-level mutation, destructive action, and navigation pending behavior.
3. Existing affected tests are updated only where the user-visible pending behavior changes.
4. Verification includes focused Vitest runs, the full test suite, lint, typecheck, formatting check, and a production build.

## Documentation

`docs/ui-patterns.md` will record the pending-action contract. On completion, `docs/changelog.md` will identify the shared master and audited surfaces, and `PRDs/roadmap.md` will record the shipped product-wide feedback behavior.

## Non-Goals

- page-level skeletons or route `loading.tsx` redesigns;
- progress percentages or cancellation for operations that do not already support them;
- optimistic data modeling changes;
- replacing existing success/error messaging;
- turning every disabled button into a loading button;
- introducing a new icon or animation library.
