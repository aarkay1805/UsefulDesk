# Gym WhatsApp template library redesign

**Date:** 2026-08-21  
**Status:** Approved for implementation  
**Scope:** UsefulDesk gym template presets, operational template contracts,
readiness, consent, provider lifecycle, onboarding, scheduled sends, tests, and
documentation.

## Objective

Replace the current loosely connected template presets and one-off readiness
checks with one policy-aware contract library. A new gym owner can select a
supported template, submit the exact payload to Meta, understand its consent
and review limitations, and rely on every UsefulDesk send surface to use the
same name, category, parameters, and operational trigger.

The redesign must not imply that Meta approval or delivery is guaranteed.
Provider acceptance, review approval, recipient eligibility, pacing, quality,
and final delivery remain distinct states.

## Policy decisions

Current Meta guidance makes the following decisions load-bearing:

1. Membership and renewable-service reminders are **Marketing**. Their
   business purpose is to secure a future renewal purchase. Removing a call to
   action does not turn the renewal-chase trigger into a Utility operation.
2. Existing-invoice payment requests, installment reminders, payment receipts,
   and membership-activation confirmations are **Utility** when their content
   stays specific to the existing account, service, or transaction and contains
   no promotion, upsell, or cross-sell.
3. Win-back and seasonal offers are **Marketing**.
4. Every proactive WhatsApp template requires recorded opt-in. Marketing uses a
   distinct, positive marketing scope; a general account-update opt-in does not
   authorize promotions or renewal offers.
5. UsefulDesk will keep positional parameters. The application already builds
   and sends ordered `{{1}}...{{N}}` values; moving only the presets to named
   parameters would create a split contract.
6. UsefulDesk will submit exact operational payloads. Owners may create custom
   templates separately, but editing a wired preset's copy, category, variable
   order, footer, or buttons means it no longer satisfies that feature's
   readiness contract.

Primary references:

- Meta template categorization:
  `https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization.md`
- Meta template overview and parameter formats:
  `https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview.md`
- Meta template components:
  `https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.md`
- Meta template lifecycle and name restrictions:
  `https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management.md`
- WhatsApp Business Messaging Policy:
  `https://business.whatsapp.com/policy`

## Canonical template contracts

All contracts use `en_US` as the preset default while preserving the existing
ability to submit other supported languages as separate provider templates.
Operational readiness is evaluated per exact language row.

### UsefulDesk feature contracts

#### `gym_membership_renewal`

- Category: `Marketing`
- Consent scope: `whatsapp_marketing`
- Body parameters:
  1. member name — `Rahul`
  2. plan name — `Quarterly`
  3. membership end date — `20 Sep 2026`
  4. current renewal price — `₹3,999`
- Body:

  > Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current
  > price of {{4}} will continue your membership. Use the buttons below to
  > respond.

- Footer: `Tap Unsubscribe to stop promotional messages.`
- Quick replies: `Renew membership`, `Unsubscribe`
- Trigger: the member Remind action and the enabled membership-renewal cron.
- Eligibility remains recurring/legacy chaseable plans, active memberships,
  manual collection, a usable phone number, account-local send hour, claim
  dedupe, exact Approved Marketing template, and positive marketing opt-in.

The former `gym_membership_expiry_notice` preset and the
`gym_renewal_reminder` Utility fallback are retired from operational
selection. Existing provider rows remain visible and are not deleted.

#### `gym_service_renewal`

- Category: `Marketing`
- Consent scope: `whatsapp_marketing`
- Body parameters:
  1. member name — `Rahul`
  2. service name — `Personal Training`
  3. service end date — `20 Sep 2026`
  4. current renewal price — `₹4,500`
- Body:

  > Hi {{1}}, your {{2}} service ends on {{3}}. Renewing at the current price
  > of {{4}} will continue this service. Use the buttons below to respond.

- Footer: `Tap Unsubscribe to stop promotional messages.`
- Quick replies: `Renew service`, `Unsubscribe`
- Trigger: service Remind and the enabled service-renewal cron.
- Eligibility retains the current active item/option, valid current fixed or
  trainer rate, local send hour, claim/retry, phone, and account checks, plus
  the exact Approved Marketing contract and marketing opt-in.

The former `gym_service_renewal_reminder` Utility contract is retired. Existing
provider rows are not silently edited, deleted, or used as aliases.

#### `gym_installment_reminder`

- Category: `Utility`
- Consent scope: `whatsapp_account_updates`
- Body parameters preserve the existing send order:
  1. member name — `Rahul`
  2. remaining installment amount — `₹1,600`
  3. plan name — `Quarterly`
  4. installment due date — `20 Sep 2026`
- Body:

  > Hi {{1}}, this is a reminder for your existing {{3}} membership: the
  > remaining installment of {{2}} is due on {{4}}. Reply if you need help
  > with this payment.

- No header, footer, or buttons.
- Trigger: the existing claim-first 60/40 installment cron at 7, 3, 1, and 0
  days before the account-local due date.

#### `gym_payment_link`

- Category: `Utility`
- Consent scope: `whatsapp_account_updates`
- Body parameters preserve the live send contract:
  1. member name — `Rahul`
  2. outstanding amount — `₹2,700`
  3. invoice reference — `INV-1024`
  4. complete Razorpay short URL — `https://rzp.io/rzp/abc123`
- Body:

  > Hi {{1}}, your payment of {{2}} for invoice {{3}} is due. Pay securely
  > using this link: {{4}}. Please contact us if you need help.

- No header, footer, or buttons. The URL remains a body parameter because the
  application receives a complete provider short URL and must not assume a
  stable dynamic-button base path.
- Trigger: the explicit **Send payment link** action on an eligible, open,
  collectible invoice. Copy link remains independent of WhatsApp readiness.

### Optional account-update presets

#### `gym_payment_due`

- Category: `Utility`
- Consent scope: `whatsapp_account_updates`
- Parameters: member name, due amount, plan name.
- Body:

  > Hi {{1}}, a payment of {{2}} for your {{3}} membership is still pending.
  > Please clear it to keep your access active. Reply here for a payment link
  > or any help.

- Manual Inbox/contact-template use. It is not a substitute for the exact
  four-parameter payment-link contract.

This preserves the provider-approved Rajat account payload and existing starter
contract rather than mutating it solely for stylistic reasons.

#### `gym_payment_receipt`

- Category: `Utility`
- Consent scope: `whatsapp_account_updates`
- Parameters: member name, amount, plan, active-until date.
- Body:

  > Hi {{1}}, we received your payment of {{2}} for your existing {{3}}
  > membership. Your membership is active until {{4}}. Reply if any payment
  > detail looks incorrect.

- Manual use immediately after a payment is recorded. This work does not add an
  automatic receipt send.

#### `gym_membership_activation`

- Category: `Utility`
- Consent scope: `whatsapp_account_updates`
- Parameters: member name, plan, gym name, start date, end date.
- Body:

  > Hi {{1}}, your {{2}} membership at {{3}} is active from {{4}} until {{5}}.
  > Reply if any membership detail is incorrect.

- Manual use after successful checkout. This replaces the relationship-building
  `gym_welcome_member` wording with a specific account confirmation.

### Optional Marketing presets

Both templates require `whatsapp_marketing`, carry the footer
`Tap Unsubscribe to stop promotional messages.`, and include the quick replies
`I'm interested` and `Unsubscribe`.

#### `gym_win_back`

- Parameters: member name, gym name, previous membership end date.
- Body:

  > Hi {{1}}, your membership at {{2}} ended on {{3}}. If you would like to
  > return, use the buttons below and the gym team will help you choose a
  > membership.

- Trigger: manual or broadcast use against a marketing-consented audience.

#### `gym_festival_offer`

- Parameters: member name, festival/campaign, gym name, discount, offer end
  date.
- Body:

  > Hi {{1}}, {{2}} offer from {{3}}: {{4}} off annual memberships until
  > {{5}}. Use the buttons below if you would like details.

- Trigger: manual or broadcast use against a marketing-consented audience.

The current class-booking preset is removed. A booking confirmation would be a
valid Utility use case after a user-requested booking, but UsefulDesk has no
booking entity, source-of-truth details, or operational trigger. The preset can
return with that subsystem rather than encouraging unsupported messages.

## Contract registry architecture

Add one server-safe registry under `src/lib/whatsapp/` containing each
canonical contract's:

- stable contract ID, provider name, title, gallery group, category, language;
- purpose, consent scope, operational/manual trigger description;
- positional parameter labels, order, and samples;
- exact header/body/footer/buttons creation components;
- whether it is wired to a UsefulDesk feature;
- approved legacy behavior, which is empty for the two retired Utility renewal
  paths.

`template-presets.ts` becomes a UI projection of this registry instead of a
separate source of truth. Membership renewal, service renewal, installments,
payment links, communication labels, onboarding, Settings, and both send cores
import their identifiers and expected categories from the registry.

Custom templates remain supported in the generic template manager and Inbox.
Only names recognized by the registry receive exact feature-contract
enforcement.

## Readiness and send enforcement

Create a pure contract evaluator that returns either a ready provider row or a
structured failure reason. A feature contract is ready only when the synced row
matches:

- account and exact template name/language;
- `APPROVED` status;
- expected provider category;
- `POSITIONAL` parameter format;
- exact body, footer, header, and buttons;
- exact contiguous variable positions and count;
- no pending provider-component-sync marker.

The evaluator produces specific states for missing, pending, rejected, paused,
disabled, wrong category, component drift, parameter drift, consent missing,
and provider sync required. UI surfaces turn these into an actionable Settings
link; cron summaries record bounded setup notes.

The same evaluator is used by:

- Get Started and Settings readiness;
- member and service Remind actions;
- payment-link Send readiness;
- membership, service, and installment cron workers;
- `sendMessageToConversation` for recognized template names;
- `engineSendTemplate`, which must load the synced local row before calling
  Meta rather than sending by name alone.

A Meta `wamid` means accepted. UsefulDesk continues to rely on delivery-status
webhooks for sent/delivered/read/failed truth and must not relabel Marketing
recipient restrictions as category errors.

## Consent model

Reuse `contact_consent_events`, `organization_message_suppressions`, and
`record_contact_consent`; do not add a parallel consent table.

Introduce two canonical scopes:

- `whatsapp_account_updates` — Utility account, membership, invoice, payment,
  booking-like, and transaction updates;
- `whatsapp_marketing` — renewal offers, win-back, campaigns, and promotions.

The database permission check becomes positive and fail-closed for these exact
scopes. A contact needs a latest applicable opt-in event and no later
organization suppression. Existing `lead_follow_up` permission does not imply
either scope. A Marketing opt-in does not silently replace account-update
permission or vice versa.

Add an agent-gated consent control on the existing contact/member detail
surface using current Dialog, Checkbox/Switch, Label, Badge, and Button
primitives. Staff can record the category permission, source, and evidence note;
the RPC supplies account, contact, actor, phone snapshot, and wall-clock audit.
No shared `src/components/ui` master change is expected.

Operational send blockers link to this consent control. New member/import flows
must not infer WhatsApp permission merely from possession of a phone number or
from a generic legitimate-interest confirmation. They either record explicit
category permission with source evidence or leave sends blocked.

Text replies containing standalone STOP-family keywords continue to create an
organization-wide suppression. Extend the same handler to normalized template
`type=button` replies so the canonical `Unsubscribe` quick reply records the
identical suppression before any downstream automation or Flow action.

## Provider lifecycle integrity

### Create

- Submit the exact requested payload.
- Persist Meta's returned ID, status, and returned category. Never overwrite a
  provider-returned reclassification with the requested category.
- If the returned category differs from the contract, report it explicitly and
  keep the feature not ready.
- Do not claim approval from a Pending or accepted create response.

### Edit

- Provider-backed edit UI warns that Meta replaces all components and re-runs
  review.
- Category is disabled for Approved templates because Meta does not allow an
  approved category edit.
- The route omits category on Approved component edits and rejects attempts to
  change it locally.
- Rejected/paused category edits follow provider rules and preserve exact
  provider errors.
- A failed or false provider response leaves local components/category/status
  unchanged and stores the actionable provider error.

### Sync and webhooks

- Fetch and persist `parameter_format` with category, status, components, and
  quality.
- A `message_template_components_update` webhook marks the exact template row
  as requiring provider sync. Recognized operational sends stop until sync
  reconciles the provider-owned components and clears the marker.
- Status webhooks continue to preserve rejection reasons. Sync remains the
  authoritative full-payload reconciliation path.
- Provider name/language uniqueness, category mismatch, edit-limit, and deleted
  name-reservation errors remain verbatim with Meta code/subcode/details.

## Template manager and onboarding UX

The preset gallery is grouped into:

1. **UsefulDesk features** — membership renewal, service renewal, installment
   reminder, payment link;
2. **Account updates** — payment due, payment receipt, membership activation;
3. **Marketing** — win-back and festival offer.

Each card shows category, parameter labels, trigger, consent requirement, and
whether a UsefulDesk feature depends on its exact payload. The create form
locks name, category, parameter order, copy, footer, and buttons for feature
contracts; language remains selectable. Optional presets can be copied into a
custom draft, but changing the name disconnects them from their preset identity.

The UI states that submission starts Meta review, approval is not guaranteed,
Meta may reclassify, and approval does not guarantee recipient delivery.

Get Started keeps the renewal-first north star but changes its template step to
the Approved Marketing `gym_membership_renewal` contract. Settings shows
independent readiness for membership renewal, service renewal, installments,
and payment links; one approved template never satisfies another contract.

## Migration and compatibility

Add an idempotent migration sorting after the current latest migration to add:

- `message_templates.parameter_format`, normalized to `POSITIONAL` for existing
  numeric-placeholder rows and populated from provider sync thereafter;
- a nullable provider-component-sync marker timestamp.

Follow the repository's drop-then-create policy and Data API grant patterns.
Apply only through an approved Supabase migration tool; do not use
`supabase db push`.

Existing provider templates are preserved. Retired names remain sendable only
as generic custom templates when they are Approved and the contact has the
category-appropriate consent; they do not satisfy renewal readiness and are not
selected by cron or member actions.

## Testing strategy

Implementation follows TDD. Focused tests cover:

1. exact creation payload snapshots for all nine contracts;
2. contiguous variables, samples, footer/button limits, and category metadata;
3. registry projections and the absence of raw operational template names at
   consumers;
4. readiness success and every structured failure, including Approved wrong
   category, exact-component drift, and provider-sync-required;
5. manual and automation send boundaries loading and enforcing the same row;
6. membership/service Marketing and installment/payment-link Utility category
   gates;
7. localized date/money parameter order for every wired sender;
8. positive account-update/marketing consent and later organization suppression;
9. `Unsubscribe` text and template-button replay-safe opt-out recording;
10. provider returned-category persistence, immutable Approved category edits,
    false-success handling, sync of parameter format, and component-drift
    marking;
11. onboarding, Settings, gallery, member/service actions, payment-link UI, and
    cron setup notes;
12. documentation/static contracts preventing the retired Utility-renewal
    guidance from returning.

Run focused Vitest suites first, followed by the full test suite, typecheck,
lint for touched files or full lint as practical, formatting check, and build.
Browser verification covers the preset gallery, locked feature form, readiness
states, consent dialog, and responsive Settings/member surfaces. No real Meta
message is sent during verification.

## Documentation

Update in the same implementation:

- `docs/renewal-reminders.md`;
- `docs/payment-installments.md`;
- `docs/automations-and-cron.md`;
- `docs/gym-domain.md`;
- the payment-link runbook where its exact template contract is documented;
- the products/services PRD reminder contract;
- `docs/changelog.md`;
- `PRDs/roadmap.md`.

Documentation must distinguish submission, Pending review, Approved provider
state, accepted message ID, and delivered/read status. It must not promise Meta
approval or delivery.

## Rajat account provider pilot

The provider pilot happens only after code, migration, tests, docs, deployment,
and authenticated application verification pass.

1. Keep all renewal automation disabled.
2. Run an authenticated read-only Sync from Meta for the exact Rajat Kashyap
   UsefulDesk account and snapshot matching provider IDs, names, languages,
   categories, statuses, parameter formats, and components.
3. Diff provider state against the nine canonical payloads.
4. Treat an already-exact Approved template as satisfied; do not resubmit it.
5. Before any provider write, present the exact create/edit list and the effect
   of each provider mutation. No delete is part of the pilot.
6. Submit missing canonical names sequentially, one template at a time.
7. After each accepted create, record the exact provider ID/status/category and
   sync before proceeding.
8. Stop immediately on rejection, automatic reclassification, name collision or
   reservation, false success, unexpected payload mutation, or other provider
   response. Report the exact Meta code, subcode, message, ID, status, and
   category. Do not switch categories or invent an alias.
9. Do not send any WhatsApp message during template submission or status sync.
10. A later delivery test requires the relevant template to be Approved and a
    separately confirmed staff-controlled contact. It remains a distinct
    action-time authorization and never uses a real customer implicitly.

## Non-goals

- No Authentication templates.
- No class-booking subsystem or template until UsefulDesk owns booking facts.
- No automatic payment receipt or membership activation send.
- No automatic reply-to-renew action beyond recording the inbound quick reply in
  the existing conversation; staff continue the workflow.
- No deletion or renaming of existing provider templates during implementation.
- No Graph API version upgrade in this change; schedule that shared integration
  migration before v21.0 reaches end of availability.
- No guarantee of Meta approval, category retention, recipient eligibility, or
  delivery.
