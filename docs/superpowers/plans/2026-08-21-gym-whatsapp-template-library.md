# Gym WhatsApp Template Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace UsefulDesk's disconnected gym WhatsApp presets and readiness checks with nine exact, policy-aware template contracts enforced consistently from Meta submission through manual and scheduled sends.

**Architecture:** A server-safe registry owns exact provider payloads, consent scopes, and triggers. A pure evaluator compares synced `message_templates` rows to those contracts, while shared send boundaries enforce provider readiness and positive scoped consent. Provider lifecycle routes persist Meta-owned category/parameter/component state, and product surfaces project the registry rather than restating template names or categories.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Supabase/Postgres/RLS, Vitest, Base UI/shadcn primitives, Meta WhatsApp Business Platform Graph API v21.0.

**Spec:** `docs/superpowers/specs/2026-08-21-gym-whatsapp-template-library-design.md`

## Global Constraints

- Work on the existing `main` checkout; do not create a branch or worktree.
- Preserve unrelated uncommitted changes and use `apply_patch` for source edits.
- Use positional `{{1}}...{{N}}` parameters and the exact nine payloads in the specification.
- Membership and service renewals are Marketing; installment, payment-link, payment-due, receipt, and activation contracts are Utility.
- Recognized feature templates require exact Approved provider state, category, positional format, components, and no pending provider-component sync.
- All proactive templates require positive scoped opt-in: `whatsapp_account_updates` or `whatsapp_marketing`.
- Do not claim Meta approval or delivery; a returned `wamid` means accepted only.
- Do not delete, rename, silently reclassify, or alias provider templates.
- Do not upgrade Graph API v21.0 in this change.
- Do not perform any Meta provider mutation or customer send during implementation and verification.
- Apply the migration only through an approved Supabase migration tool; never use `supabase db push`.
- Update `docs/changelog.md` and `PRDs/roadmap.md` before completion.

---

### Task 1: Canonical contract registry and preset projection

**Files:**

- Create: `src/lib/whatsapp/template-contracts.ts`
- Create: `src/lib/whatsapp/template-contracts.test.ts`
- Modify: `src/lib/whatsapp/template-presets.ts`
- Modify: `src/lib/whatsapp/template-presets.test.ts`
- Modify: `src/types/index.ts`

**Interfaces:**

- Produces: `TemplateContractId`, `TemplateConsentScope`, `TemplateContract`, `TEMPLATE_CONTRACTS`, `FEATURE_TEMPLATE_CONTRACTS`, `getTemplateContract(name)`, `getTemplateContractById(id)`, and `TEMPLATE_PRESETS`.
- Consumers: readiness, provider routes, send boundaries, cron workers, onboarding, Settings, and gallery tasks.

- [ ] **Step 1: Write failing exact-payload tests**

Assert all nine names, categories, parameter labels/samples, bodies, footers, buttons, gallery groups, consent scopes, triggers, and wired flags. Snapshot the provider components returned by `buildMetaTemplatePayload(contract.payload)` and assert no class-booking, welcome, expiry-notice, legacy renewal, or service-reminder preset remains.

```ts
expect(TEMPLATE_CONTRACTS.gym_membership_renewal).toMatchObject({
  category: 'Marketing',
  consentScope: 'whatsapp_marketing',
  payload: {
    name: 'gym_membership_renewal',
    body_text:
      'Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price of {{4}} will continue your membership. Use the buttons below to respond.',
    footer_text: 'Tap Unsubscribe to stop promotional messages.',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Renew membership' },
      { type: 'QUICK_REPLY', text: 'Unsubscribe' },
    ],
  },
});
expect(TEMPLATE_PRESETS).toHaveLength(9);
```

- [ ] **Step 2: Run the tests and confirm the registry is missing**

Run: `npx vitest run src/lib/whatsapp/template-contracts.test.ts src/lib/whatsapp/template-presets.test.ts`

Expected: FAIL because `template-contracts.ts` and the new contracts do not exist.

- [ ] **Step 3: Implement the typed registry and projection**

Use an `as const satisfies` registry whose payload values satisfy `TemplatePayload`. Add `parameterLabels`, `purpose`, `trigger`, `galleryGroup`, `consentScope`, and `wired` metadata. Derive `TEMPLATE_PRESETS` with no copied bodies or categories.

```ts
export type TemplateConsentScope =
  'whatsapp_account_updates' | 'whatsapp_marketing';

export function getTemplateContract(
  name: string
): TemplateContract | undefined {
  return Object.values(TEMPLATE_CONTRACTS).find(
    (contract) => contract.payload.name === name
  );
}
```

Extend `MessageTemplate` with `account_id?: string`, `parameter_format?: 'POSITIONAL' | 'NAMED'`, and `provider_components_sync_required_at?: string`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/lib/whatsapp/template-contracts.test.ts src/lib/whatsapp/template-presets.test.ts src/lib/whatsapp/template-components.test.ts src/lib/whatsapp/template-validators.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```bash
git add src/lib/whatsapp/template-contracts.ts src/lib/whatsapp/template-contracts.test.ts src/lib/whatsapp/template-presets.ts src/lib/whatsapp/template-presets.test.ts src/types/index.ts
git commit -m "feat: define gym WhatsApp template contracts"
```

### Task 2: Exact provider readiness evaluator

**Files:**

- Create: `src/lib/whatsapp/template-readiness.ts`
- Create: `src/lib/whatsapp/template-readiness.test.ts`
- Modify: `src/lib/memberships/renewal-reminders.ts`
- Modify: `src/lib/memberships/renewal-reminders.test.ts`
- Modify: `src/lib/memberships/installments.ts`
- Modify: `src/lib/payments/payment-link-constants.ts`

**Interfaces:**

- Consumes: `getTemplateContract`, `MessageTemplate`.
- Produces: `TemplateReadinessCode`, `TemplateReadinessResult`, `evaluateTemplateReadiness(rows, contractId, language)`, `requireTemplateReady(rows, contractId, language)`, and canonical feature constants derived from the registry.

- [ ] **Step 1: Write evaluator tests for every state**

Cover `missing`, `pending`, `rejected`, `paused`, `disabled`, `wrong_category`, `wrong_parameter_format`, `component_drift`, `parameter_drift`, `provider_sync_required`, and `ready`. Include exact header/body/footer/button equality and contiguous positional variables.

```ts
expect(
  evaluateTemplateReadiness(
    [approvedRow({ category: 'Utility' })],
    'membership_renewal',
    'en_US'
  )
).toMatchObject({ ready: false, code: 'wrong_category' });
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `npx vitest run src/lib/whatsapp/template-readiness.test.ts src/lib/memberships/renewal-reminders.test.ts`

Expected: FAIL because readiness still accepts legacy Utility renewal names and compares only status/category.

- [ ] **Step 3: Implement pure comparison and structured errors**

Normalize nullable provider fields before comparison but do not normalize copy, button text/order, or parameter order. Return the matching provider row only for `ready: true`.

```ts
export type TemplateReadinessResult =
  | { ready: true; code: 'ready'; row: MessageTemplate }
  | {
      ready: false;
      code: Exclude<TemplateReadinessCode, 'ready'>;
      message: string;
      row?: MessageTemplate;
    };
```

Replace raw feature constants with registry-derived names and remove `LEGACY_RENEWAL_TEMPLATE_NAME` from operational readiness.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/lib/whatsapp/template-readiness.test.ts src/lib/memberships/renewal-reminders.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit readiness**

```bash
git add src/lib/whatsapp/template-readiness.ts src/lib/whatsapp/template-readiness.test.ts src/lib/memberships/renewal-reminders.ts src/lib/memberships/renewal-reminders.test.ts src/lib/memberships/installments.ts src/lib/payments/payment-link-constants.ts
git commit -m "feat: enforce exact WhatsApp template readiness"
```

### Task 3: Provider state schema, sync, and component-drift webhook

**Files:**

- Create: `supabase/migrations/20260821120000_whatsapp_template_provider_contracts.sql`
- Create: `src/lib/whatsapp/template-provider-schema-contract.test.ts`
- Modify: `src/app/api/whatsapp/templates/sync/route.ts`
- Modify: `src/lib/whatsapp/template-webhook.ts`
- Modify: `src/lib/whatsapp/template-webhook.test.ts`

**Interfaces:**

- Consumes: Meta `parameter_format` and webhook template ID.
- Produces: persisted `parameter_format`, nullable `provider_components_sync_required_at`, sync clearing of that marker, and webhook marking of affected rows.

- [ ] **Step 1: Write failing schema/sync/webhook tests**

Assert the migration adds both columns idempotently, backfills numeric-placeholder rows to `POSITIONAL`, and leaves uncertain rows nullable. Assert sync requests and persists `parameter_format` and clears the marker. Assert component-update webhooks perform an awaited update by `meta_template_id`.

```ts
expect(update).toEqual(
  expect.objectContaining({
    provider_components_sync_required_at: expect.any(String),
  })
);
```

- [ ] **Step 2: Run tests and confirm missing state**

Run: `npx vitest run src/lib/whatsapp/template-provider-schema-contract.test.ts src/lib/whatsapp/template-webhook.test.ts src/app/api/whatsapp/templates/sync/route.test.ts`

Expected: FAIL because the columns, query field, and webhook mutation do not exist.

- [ ] **Step 3: Implement the idempotent migration and lifecycle persistence**

Use `ADD COLUMN IF NOT EXISTS`, a check constraint allowing `POSITIONAL`/`NAMED`, and an update limited to bodies whose placeholders are numeric. Extend the Meta sync select to include `parameter_format`; persist uppercase format and clear `provider_components_sync_required_at` only when the full provider row was parsed and stored. Make `handleComponentsUpdate` async and select `id` after update so a missing row is observable.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/lib/whatsapp/template-provider-schema-contract.test.ts src/lib/whatsapp/template-webhook.test.ts src/app/api/whatsapp/templates/sync/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit provider state support**

```bash
git add supabase/migrations/20260821120000_whatsapp_template_provider_contracts.sql src/lib/whatsapp/template-provider-schema-contract.test.ts src/app/api/whatsapp/templates/sync/route.ts src/lib/whatsapp/template-webhook.ts src/lib/whatsapp/template-webhook.test.ts src/app/api/whatsapp/templates/sync/route.test.ts
git commit -m "feat: track Meta template provider drift"
```

### Task 4: Provider create/edit integrity

**Files:**

- Modify: `src/app/api/whatsapp/templates/submit/route.ts`
- Create or modify: `src/app/api/whatsapp/templates/submit/route.test.ts`
- Modify: `src/app/api/whatsapp/templates/[id]/route.ts`
- Modify: `src/app/api/whatsapp/templates/[id]/route.test.ts`
- Modify: `src/lib/whatsapp/template-lifecycle.test.ts`

**Interfaces:**

- Consumes: Meta create result `{ id, status, category? }`, existing row status/category.
- Produces: local persistence of returned category; Approved edit requests omit category; category-change attempts on Approved rows return 409 without provider or local mutation.

- [ ] **Step 1: Write failing create/edit tests**

Assert Meta returning `MARKETING` for requested Utility persists `Marketing` and returns a `category_changed` warning. Assert Approved edits call `editMessageTemplate` without `category`, reject a requested category change, and do not update local rows when provider returns `{ success: false }`.

```ts
expect(upserted.category).toBe('Marketing');
expect(response.warning).toMatch(/returned Marketing/i);
expect(editArgs).not.toHaveProperty('category');
```

- [ ] **Step 2: Run tests and confirm current false-local-state behavior**

Run: `npx vitest run src/app/api/whatsapp/templates/submit/route.test.ts src/app/api/whatsapp/templates/\[id\]/route.test.ts src/lib/whatsapp/template-lifecycle.test.ts`

Expected: FAIL because create ignores returned category and edit always sends category.

- [ ] **Step 3: Implement provider-owned category handling**

Map `MARKETING`, `UTILITY`, and `AUTHENTICATION` to local title case only after validating the returned value. Dry-run continues using requested category and remains visibly synthetic. For Approved edits compare the request to the stored category before Meta, omit category in the provider call, and update local components/status only on explicit success.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/app/api/whatsapp/templates/submit/route.test.ts src/app/api/whatsapp/templates/\[id\]/route.test.ts src/lib/whatsapp/template-lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit lifecycle integrity**

```bash
git add src/app/api/whatsapp/templates/submit/route.ts src/app/api/whatsapp/templates/submit/route.test.ts 'src/app/api/whatsapp/templates/[id]/route.ts' 'src/app/api/whatsapp/templates/[id]/route.test.ts' src/lib/whatsapp/template-lifecycle.test.ts
git commit -m "fix: preserve Meta template lifecycle truth"
```

### Task 5: Positive scoped consent and audited staff control

**Files:**

- Create: `supabase/migrations/20260821121000_scope_whatsapp_template_consent.sql`
- Create: `src/lib/consent/template-consent.ts`
- Create: `src/lib/consent/template-consent.test.ts`
- Modify: `src/lib/consent/business-messaging.ts`
- Modify: `src/lib/whatsapp/broadcast-core.ts`
- Modify: `src/app/api/whatsapp/broadcast/route.ts`
- Modify: `src/app/api/v1/messages/route.ts`
- Create: `src/components/contacts/whatsapp-consent-control.tsx`
- Create: `src/components/contacts/whatsapp-consent-control.test.tsx`
- Modify: `src/components/contacts/contact-detail-content.tsx`
- Modify: `src/components/members/member-detail-view.tsx`

**Interfaces:**

- Consumes: contract `consentScope`, `record_contact_consent` RPC, `canManageContacts` capability.
- Produces: `assertTemplateConsentAllowed(db, accountId, phone, scope)`, `recordTemplateConsent(...)`, and a staff UI for explicit account-update/marketing opt-in or opt-out evidence.

- [ ] **Step 1: Write failing SQL, library, and UI tests**

Assert exact scopes require a latest positive event, later organization suppression blocks them, and `lead_follow_up` does not imply either scope. UI tests assert capability gating, unchecked defaults when no evidence exists, source/evidence requirement, and exact RPC arguments.

```ts
await expect(
  assertTemplateConsentAllowed(
    db,
    'account',
    '+919999999999',
    'whatsapp_marketing'
  )
).rejects.toMatchObject({ code: 'message_consent_required' });
```

- [ ] **Step 2: Run tests and confirm permissive defaults fail**

Run: `npx vitest run src/lib/consent/template-consent.test.ts src/components/contacts/whatsapp-consent-control.test.tsx src/lib/auth/roles.test.ts`

Expected: FAIL because exact template scopes and UI do not exist.

- [ ] **Step 3: Implement fail-closed database and TypeScript scopes**

Replace `business_message_allowed` in a new migration while preserving legacy-purpose behavior for non-template text/flows. For the two new scopes, locate the newest applicable `contact_consent_events` row by wall-clock ordering and require `opted_in=true`, while an organization suppression without a later same-scope opt-in remains blocking. Keep RPC grants identical to the latest migration.

- [ ] **Step 4: Implement audited consent control with existing primitives**

Use Dialog, Checkbox/Switch, Label, Badge, Input/Textarea, and Button without editing shared masters. Record `source='staff_recorded'`, selected purpose, explicit boolean, and a required evidence note. Mount the same control in contact and member detail views.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/lib/consent/template-consent.test.ts src/components/contacts/whatsapp-consent-control.test.tsx src/lib/auth/roles.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit consent enforcement**

```bash
git add supabase/migrations/20260821121000_scope_whatsapp_template_consent.sql src/lib/consent/template-consent.ts src/lib/consent/template-consent.test.ts src/lib/consent/business-messaging.ts src/lib/whatsapp/broadcast-core.ts src/app/api/whatsapp/broadcast/route.ts src/app/api/v1/messages/route.ts src/components/contacts/whatsapp-consent-control.tsx src/components/contacts/whatsapp-consent-control.test.tsx src/components/contacts/contact-detail-content.tsx src/components/members/member-detail-view.tsx
git commit -m "feat: require scoped WhatsApp template consent"
```

### Task 6: Replay-safe Unsubscribe quick reply

**Files:**

- Modify: `src/lib/consent/whatsapp-opt-out.ts`
- Modify: `src/lib/consent/whatsapp-opt-out.test.ts`
- Modify: `src/app/api/whatsapp/webhook/route.ts`
- Modify: `src/app/api/whatsapp/webhook/route.test.ts`

**Interfaces:**

- Consumes: normalized inbound text or template button reply.
- Produces: `whatsappOptOutText(message)` returning the comparable text for `text` and `button`; identical `record_contact_consent` opt-out behavior before downstream automation.

- [ ] **Step 1: Write failing button opt-out tests**

Assert `{ type: 'button', button: { text: 'Unsubscribe', payload: 'Unsubscribe' } }` is treated like standalone text, creates one organization suppression on replay, and does not dispatch Flow actions first.

- [ ] **Step 2: Run tests and confirm only text is handled**

Run: `npx vitest run src/lib/consent/whatsapp-opt-out.test.ts src/app/api/whatsapp/webhook/route.test.ts`

Expected: FAIL for the button case.

- [ ] **Step 3: Implement normalized opt-out extraction**

Extract text from either inbound shape, retain standalone STOP-family matching, and route both through the current audited RPC. Keep the provider message receipt/idempotency path as the replay guard.

- [ ] **Step 4: Run focused tests and commit**

Run: `npx vitest run src/lib/consent/whatsapp-opt-out.test.ts src/app/api/whatsapp/webhook/route.test.ts`

Expected: PASS.

```bash
git add src/lib/consent/whatsapp-opt-out.ts src/lib/consent/whatsapp-opt-out.test.ts src/app/api/whatsapp/webhook/route.ts src/app/api/whatsapp/webhook/route.test.ts
git commit -m "fix: honor WhatsApp unsubscribe buttons"
```

### Task 7: Shared manual and automation send enforcement

**Files:**

- Modify: `src/lib/whatsapp/send-message.ts`
- Modify: `src/lib/whatsapp/send-message.test.ts`
- Modify: `src/lib/automations/meta-send.ts`
- Create or modify: `src/lib/automations/meta-send.test.ts`
- Modify: `src/lib/automations/engine.test.ts`
- Modify: `src/lib/whatsapp/broadcast-core.ts`
- Modify: `src/lib/whatsapp/broadcast-core.test.ts`

**Interfaces:**

- Consumes: `getTemplateContract`, `evaluateTemplateReadiness`, `assertTemplateConsentAllowed`.
- Produces: all recognized template sends load an exact local row, enforce its contract and consent scope, and reject before Meta with structured codes.

- [ ] **Step 1: Write failing send-boundary tests**

Cover manual and service-role paths for missing row, wrong category, component drift, sync-required, missing scoped consent, and ready sends. Assert custom Approved templates continue through generic category-appropriate consent without becoming feature-ready.

- [ ] **Step 2: Run tests and confirm automation sends by name alone**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts src/lib/automations/meta-send.test.ts src/lib/automations/engine.test.ts src/lib/whatsapp/broadcast-core.test.ts`

Expected: FAIL because `engineSendTemplate` never loads `message_templates` and manual sends use the generic `template` purpose.

- [ ] **Step 3: Implement one contract guard at both send cores**

Load by account/name/language before consent or Meta. For recognized names require exact readiness and use the contract scope. For custom templates require Approved status and infer `whatsapp_marketing` only from provider category; Utility uses `whatsapp_account_updates`. Preserve existing text-message purposes.

- [ ] **Step 4: Run focused tests and commit**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts src/lib/automations/meta-send.test.ts src/lib/automations/engine.test.ts src/lib/whatsapp/broadcast-core.test.ts`

Expected: PASS.

```bash
git add src/lib/whatsapp/send-message.ts src/lib/whatsapp/send-message.test.ts src/lib/automations/meta-send.ts src/lib/automations/meta-send.test.ts src/lib/automations/engine.test.ts src/lib/whatsapp/broadcast-core.ts src/lib/whatsapp/broadcast-core.test.ts
git commit -m "feat: guard WhatsApp template sends by contract"
```

### Task 8: Align feature triggers and localized parameter contracts

**Files:**

- Modify: `src/components/members/send-reminder-button.tsx`
- Modify: `src/components/members/send-reminder-button.test.tsx`
- Modify: `src/components/members/service-renewal-action-lists.tsx`
- Modify: `src/components/members/service-renewal-action-lists.test.tsx`
- Modify: `src/components/finance/payment-link-actions.tsx`
- Modify: `src/components/finance/payment-link-actions.test.tsx`
- Modify: `src/app/api/renewals/cron/route.ts`
- Modify: `src/app/api/renewals/cron/route.test.ts`
- Modify: `src/app/api/payment-installments/cron/route.ts`
- Modify: `src/app/api/payment-installments/cron/route.test.ts`
- Modify: `src/components/members/member-communication.tsx`

**Interfaces:**

- Consumes: registry names, parameter labels/order, evaluator, scoped consent errors.
- Produces: membership/service Marketing sends and installment/payment-link Utility sends with exact localized parameter order and actionable setup/consent skips.

- [ ] **Step 1: Write failing feature and cron tests**

Assert exact names and parameter arrays:

```ts
expect(send).toHaveBeenCalledWith(
  expect.objectContaining({
    templateName: 'gym_membership_renewal',
    params: ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'],
    purpose: 'whatsapp_marketing',
  })
);
```

Add corresponding service, installment `[name, amount, plan, dueDate]`, and payment-link `[name, amount, invoiceRef, url]` assertions. Verify cron records bounded setup/consent notes and does not claim a send.

- [ ] **Step 2: Run tests and confirm legacy constants fail**

Run: `npx vitest run src/components/members/send-reminder-button.test.tsx src/components/members/service-renewal-action-lists.test.tsx src/components/finance/payment-link-actions.test.tsx src/app/api/renewals/cron/route.test.ts src/app/api/payment-installments/cron/route.test.ts`

Expected: FAIL on legacy names, Utility category assumptions, and permissive readiness.

- [ ] **Step 3: Replace raw feature contracts with registry consumers**

Keep all existing locale helpers, claim-first behavior, retry policy, eligibility, and account-local send-hour logic. Change only the exact name/category/readiness/consent contract and communication labels.

- [ ] **Step 4: Run focused tests and commit**

Run: `npx vitest run src/components/members/send-reminder-button.test.tsx src/components/members/service-renewal-action-lists.test.tsx src/components/finance/payment-link-actions.test.tsx src/app/api/renewals/cron/route.test.ts src/app/api/payment-installments/cron/route.test.ts`

Expected: PASS.

```bash
git add src/components/members/send-reminder-button.tsx src/components/members/send-reminder-button.test.tsx src/components/members/service-renewal-action-lists.tsx src/components/members/service-renewal-action-lists.test.tsx src/components/finance/payment-link-actions.tsx src/components/finance/payment-link-actions.test.tsx src/app/api/renewals/cron/route.ts src/app/api/renewals/cron/route.test.ts src/app/api/payment-installments/cron/route.ts src/app/api/payment-installments/cron/route.test.ts src/components/members/member-communication.tsx
git commit -m "feat: align gym WhatsApp feature triggers"
```

### Task 9: Template gallery, locked feature forms, onboarding, and readiness UI

**Files:**

- Modify: `src/components/settings/template-manager.tsx`
- Create or modify: `src/components/settings/template-manager.test.tsx`
- Modify: `src/components/settings/renewal-reminders-settings.tsx`
- Modify: `src/components/settings/renewal-reminders-settings.test.tsx`
- Modify: `src/hooks/use-onboarding-status.tsx`
- Modify: `src/hooks/use-onboarding-status.test.tsx`
- Modify: `src/components/onboarding/get-started-view.tsx`
- Modify: `src/components/onboarding/get-started-view.test.tsx`
- Modify: `src/components/settings/settings-overview.tsx`

**Interfaces:**

- Consumes: preset projection, exact evaluator, provider lifecycle fields.
- Produces: three grouped gallery sections, locked wired-preset form fields, category/trigger/consent/review copy, and independent readiness for four feature contracts.

- [ ] **Step 1: Write failing UI contract tests**

Assert group headings `UsefulDesk features`, `Account updates`, and `Marketing`; nine card titles; category, parameters, trigger, consent requirement, and review caveat. Assert feature presets lock name/category/copy/parameter order/footer/buttons while language remains editable. Assert onboarding requires Approved Marketing `gym_membership_renewal`; Settings independently reports four feature contracts.

- [ ] **Step 2: Run UI tests and confirm old single-renewal contract**

Run: `npx vitest run src/components/settings/template-manager.test.tsx src/components/settings/renewal-reminders-settings.test.tsx src/hooks/use-onboarding-status.test.tsx src/components/onboarding/get-started-view.test.tsx`

Expected: FAIL on old gallery size, Utility renewal, and legacy readiness.

- [ ] **Step 3: Implement registry-driven UI without shared-master edits**

Use existing Dialog, Card, Badge, Label, Button, Input/Textarea, and settings section patterns. Show `Submission starts Meta review. Approval and recipient delivery are not guaranteed; Meta may reclassify.` Keep optional presets copyable into custom drafts only under a new custom name.

- [ ] **Step 4: Run focused tests and commit**

Run: `npx vitest run src/components/settings/template-manager.test.tsx src/components/settings/renewal-reminders-settings.test.tsx src/hooks/use-onboarding-status.test.tsx src/components/onboarding/get-started-view.test.tsx`

Expected: PASS.

```bash
git add src/components/settings/template-manager.tsx src/components/settings/template-manager.test.tsx src/components/settings/renewal-reminders-settings.tsx src/components/settings/renewal-reminders-settings.test.tsx src/hooks/use-onboarding-status.tsx src/hooks/use-onboarding-status.test.tsx src/components/onboarding/get-started-view.tsx src/components/onboarding/get-started-view.test.tsx src/components/settings/settings-overview.tsx
git commit -m "feat: rebuild gym WhatsApp template setup UI"
```

### Task 10: Documentation and static drift guards

**Files:**

- Create: `src/lib/whatsapp/template-documentation-contract.test.ts`
- Modify: `docs/renewal-reminders.md`
- Modify: `docs/payment-installments.md`
- Modify: `docs/automations-and-cron.md`
- Modify: `docs/gym-domain.md`
- Modify: `docs/razorpay-operations.md`
- Modify: `docs/razorpay-oauth-payment-links-and-refunds.md`
- Modify: `PRDs/products_services_and_trainer_pricing.md`
- Modify: `PRDs/multi_gym_saas_prd.md`
- Modify: `PRDs/upi_autopay.md`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`

**Interfaces:**

- Consumes: canonical contracts and shipped behavior.
- Produces: current operational runbooks and static tests that reject active Utility-renewal guidance.

- [ ] **Step 1: Write failing static documentation test**

Assert operational sections contain `gym_membership_renewal`/Marketing and `gym_service_renewal`/Marketing, preserve installment/payment-link Utility, name both consent scopes, and distinguish submitted/Pending/Approved/accepted/delivered. Historical changelog evidence may retain retired names only when explicitly labelled historical/retired.

- [ ] **Step 2: Run the static test and confirm stale guidance**

Run: `npx vitest run src/lib/whatsapp/template-documentation-contract.test.ts`

Expected: FAIL on current Utility renewal guidance.

- [ ] **Step 3: Update product documentation**

Keep historical provider evidence intact in runbooks, but add a current canonical section that supersedes it. Add a terse changelog entry naming the registry/readiness/consent/provider-drift implementation and its gotcha. Move the library into the Built/Shipped roadmap section and remove the pending Utility-renewal interpretation.

- [ ] **Step 4: Run the static test and commit**

Run: `npx vitest run src/lib/whatsapp/template-documentation-contract.test.ts`

Expected: PASS.

```bash
git add src/lib/whatsapp/template-documentation-contract.test.ts docs/renewal-reminders.md docs/payment-installments.md docs/automations-and-cron.md docs/gym-domain.md docs/razorpay-operations.md docs/razorpay-oauth-payment-links-and-refunds.md PRDs/products_services_and_trainer_pricing.md PRDs/multi_gym_saas_prd.md PRDs/upi_autopay.md docs/changelog.md PRDs/roadmap.md
git commit -m "docs: align gym WhatsApp template operations"
```

### Task 11: Apply and verify database migrations

**Files:**

- Verify: `supabase/migrations/20260821120000_whatsapp_template_provider_contracts.sql`
- Verify: `supabase/migrations/20260821121000_scope_whatsapp_template_consent.sql`

**Interfaces:**

- Consumes: approved Supabase migration connector and selected project identity.
- Produces: live schema/functions matching repository migrations, or an explicit blocker if no approved tool is available.

- [ ] **Step 1: Run local migration contract tests before any remote mutation**

Run: `npx vitest run src/lib/whatsapp/template-provider-schema-contract.test.ts src/lib/consent/template-consent.test.ts`

Expected: PASS.

- [ ] **Step 2: Resolve the approved Supabase project without exposing secrets**

Use the Supabase connector to list projects and match the existing UsefulDesk project reference from repository configuration. Do not print access tokens, database passwords, or encrypted provider credentials.

- [ ] **Step 3: Apply migrations sequentially through the connector**

Apply `20260821120000_whatsapp_template_provider_contracts.sql`, verify columns/check constraint/backfill, then apply `20260821121000_scope_whatsapp_template_consent.sql` and verify function definition/grants. Stop and report the exact tool/database response on failure; do not use `supabase db push`.

- [ ] **Step 4: Record verification evidence without provider writes**

Read back column metadata and function definition/grants only. Do not query contact consent evidence or Meta credentials beyond what schema verification requires.

### Task 12: Full application verification and provider-pilot gate

**Files:**

- Modify only if verification reveals a defect in files already in scope.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: verified application build, documented remaining limitations, and a provider pilot mutation list presented for separate explicit approval.

- [ ] **Step 1: Run formatting and focused contract suite**

Run: `npx prettier --write <all touched source and documentation files>`

Run: `npx vitest run src/lib/whatsapp src/lib/consent src/lib/memberships src/lib/automations src/components/settings src/components/members src/components/finance src/hooks/use-onboarding-status.test.tsx src/app/api/renewals/cron/route.test.ts src/app/api/payment-installments/cron/route.test.ts src/app/api/whatsapp/webhook/route.test.ts`

Expected: PASS.

- [ ] **Step 2: Run repository-wide verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run format:check`

Run: `npm run build`

Expected: all commands exit 0. If an unrelated pre-existing failure appears, preserve it and report the exact command/output separately.

- [ ] **Step 3: Verify responsive product surfaces in the browser**

Run the application without provider mutations and inspect desktop/mobile widths for Templates gallery, wired locked form, independent readiness, Get Started, contact/member consent control, and feature-send blockers. Confirm keyboard labels and existing focus behavior.

- [ ] **Step 4: Audit operational names and prohibited claims**

Run:

```bash
rg -n "gym_membership_expiry_notice|gym_renewal_reminder|gym_service_renewal_reminder" src docs PRDs
rg -n "guaranteed|guarantees approval|will be approved" src docs PRDs
```

Expected: retired names appear only in historical/retirement context; no approval or delivery guarantee appears.

- [ ] **Step 5: Commit verification fixes and stop before provider mutation**

```bash
git status --short
git log --oneline --decorate -12
```

Present code, test, migration, and browser evidence. Then run only an authenticated read-only Rajat-account Meta sync/snapshot if the user separately confirms that production read operation. Present the exact proposed create/edit mutations and wait for explicit action-time approval. Do not submit templates or send a message in this task.
