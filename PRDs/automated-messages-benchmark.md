# Automated messaging benchmark and proposed scope

Researched 11 September 2026. Status: recommendation for product decision, not an approved implementation plan. The prior Settings UI reorganization is provisional.

## Decision

Build a small catalogue of predefined **Automated messages**, grouped by owner purpose, with contextual setup status and useful activity records. Keep **Templates** as the single destination for creation, approval, and synchronization. Prioritize making the existing reminder types understandable and operable before adding more types.

This is an information-architecture and operational-confidence benchmark. Evidence comes from public vendor help documentation, with one corroborating product page. It is not a hands-on evaluation of authenticated products or proof of their business results. Missing documentation is not evidence of a missing feature. Email products inform interaction design, not WhatsApp approval or delivery behavior. Agent Reach's Exa executable was unavailable; research used web search and its Jina Reader route.

## Comparable patterns

| Product | Documented behavior | Implication for UsefulDesk |
| --- | --- | --- |
| Glofox | Connect → Automations contains predefined communications; distinguishes transactional emails from multi-step workflows. Its Member Expiring detail exposes start rules, stop rules, and message sequence. | Lead with a named business event; explain eligibility and stopping behavior inside its detail. |
| PushPress | Core puts automatic emails under Communicate → Automatic. Grow has predefined workflows grouped into folders such as Plans and Check-In Milestones. | Use a discoverable catalogue and purpose groups; a small gym should not need to author workflows. |
| FitnessForce NxT | Appointment automation configures center scope, trigger date, channel, relative timing, and selected WhatsApp template. Older FitnessForce follow-up documentation separately describes assigned staff tasks. | Show branch, timing, message, and staff outcome distinctly. Staff follow-up is an action, not another customer message. |
| Zoho Billing | Settings → Reminders & Notifications separates manual and automated reminders; automated schedules use due dates or expected-payment dates, and an expected date can suppress normal chasing. | Collection is its own category. Explain promises and pauses alongside the rule and preserve invoice-level context. |
| respond.io | Workflows is a separate module; template management has its own status, category, language, quality, and sync information. | One template-management destination, referenced contextually from each rule. |
| HubSpot | Record-level workflow history shows the path followed and success/failure of actions. | Activity should answer what happened to a particular member and why, with a useful next action. A full visual workflow diagram is unnecessary here. |

Sources supporting the table:

- [Glofox automations](https://support.glofox.com/hc/en-us/articles/46383097799956-Getting-Started-with-Automations) and [Member Expiring workflow](https://support.glofox.com/hc/en-us/articles/46443996969748-XLerate-Member-Expiring-workflow).
- [PushPress automatic communications](https://help.pushpress.com/en/articles/5482449-core-communications-automatic-emails-setup-management) and [workflow folders](https://help.pushpress.com/en/articles/10874207-workflows-overview).
- [FitnessForce NxT appointment reminders](https://help.fitnessforce.com/en/article/setting-automated-appointment-reminders-immgja/) and [legacy automated follow-up configuration](https://support.fitnessforce.com/portal/en/kb/articles/automated-follow-up-configuration-6-1-2021). These describe different product generations; do not assume exact current parity.
- [Zoho Billing reminders](https://www.zoho.com/us/billing/help/settings/notifications/reminders.html).
- [respond.io workflows](https://respond.io/help/workflows/workflows-overview) and [template management](https://respond.io/help/whatsapp/whatsapp-message-templates).
- [HubSpot record workflow history](https://knowledge.hubspot.com/workflows/review-a-records-workflow-paths-and-actions).

Corroboration: [Wati's template node](https://support.wati.io/en/articles/11463028-advance-chatbot-builder-using-template-node) selects from approved templates inside an automation. [Wellyx automation](https://wellyx.com/features/automation/) markets triggers, channels, and engagement tracking, but that page alone does not establish the exact UI organization.

## What the evidence changes about the provisional UI

1. Prefer **Automated messages** to **Reminders & messages**. It covers receipts and reminders while distinguishing this page from Inbox and manual sends. This is a naming hypothesis to validate with gym owners, not a label proven by the benchmark.
2. Keep just **Rules** and **Activity** as views. The separate Templates settings destination already exists; a second full readiness catalogue creates another place to search.
3. Replace the universal setup warning with per-rule readiness. An unused template should not make a working renewal setup appear broken. Connection failure affecting enabled rules can still use one shared notice.
4. Replace long, always-expanded explanatory cards with compact rule summaries and a detail panel composed from existing masters.
5. Keep the useful separation between saved On/Off preference and operational readiness. An enabled but blocked rule must not look healthy.

## Catalogue and rule detail

Use purpose groups, not Meta's Marketing/Utility categories:

| Group | Existing behavior to expose |
| --- | --- |
| Renewals | Membership and service renewal; short post-expiry follow-up |
| Collections | Invoice collection, joining installments, promise-to-pay, payment-link follow-up, failed AutoPay recovery |
| Retention | Session packs, planned freeze return, membership/service win-back |
| Confirmations | Payment confirmations |

Joining installments currently have distinct scheduling behavior: show their actual managed schedule and link to the owning configuration; do not invent an independent toggle. AutoPay recovery can stay one item but must distinguish informational retry updates from a terminal failure asking for payment. Grouping must not change message category or daily-cap semantics.

A collapsed rule shows name, one-line trigger/timing, saved On/Off, contextual readiness, and Configure. Detail explains **Who qualifies → When it sends → Message preview → When it stops → Staff follow-up**, with the applicable schedule controls. Show the exact linked template with a direct setup action and a return path to this rule. Template content continues to follow the existing locked feature contracts.

Illustrative summary, not live account data:

> Membership renewal — 7, 3, and 1 day before expiry — On — Needs setup: template awaiting approval.

No eligible members is a healthy empty state, not a setup failure. Provider acceptance must remain distinct from delivered/read. Keep staff-task outcomes separate from customer-message outcomes.

## Build order

### First: rule catalogue and activation confidence

- Preserve the existing URL and permissions; rename the navigation label.
- Implement the four groups, concise summaries, shared detail treatment, and contextual setup links.
- Allow configuration while off. Proposed activation behavior: explain and resolve missing prerequisites before a new enablement; saving a draft must not silently arm a send that starts later when a template is approved. This changes the current preference-saving behavior and needs an explicit product decision before implementation.
- For already-enabled rules that later lose readiness, retain the saved preference and show On + Blocked. Do not silently turn them off.
- Add a message preview using sample values that sends nothing. Keep actual test sends a separately labeled action if built later.
- Save and Cancel should have a clear scope. Prefer saving the selected rule's settings; implement safe partial writes or merge semantics so editing one rule cannot overwrite unrelated settings.

### Second: actionable activity across existing reminder types

- Cover every supported rule type; do not imply full coverage from the existing three-kind diagnostic endpoint.
- Filter by rule, outcome, and date; show member, scheduled/attempted time, reason, and next action under existing tenant/branch authorization.
- Link to the member, invoice, conversation, or existing staff follow-up as applicable.
- Show accepted/delivered/read only with the relevant evidence. Render understandable explanations instead of raw reason codes.
- Query bounded, ordered, paginated records. Current lifecycle history reads state/time/reason without a member identity or rule kind and has no query-level ordering or limit; moving it to a tab alone does not provide this functionality.
- Keep deliberate pauses, superseded jobs, technical blockers, and genuine delivery failures distinct.

### Later, after validation

Evaluate additional message types against unmet owner tasks and existing roadmap work. Do not add birthdays, arbitrary campaigns, AI-generated sequences, new channels, or a drag-and-drop builder merely for competitor parity. Trial follow-up and attendance-based retention require a separate gap/eligibility review before selection; related operating queues already exist.

## Acceptance and validation

These are proposed acceptance criteria, not measured results:

- In a short moderated check with five owner/front-desk users, at least four can find the renewal rule, explain its timing, identify why it cannot send, and locate the fix within 30 seconds each without prompting.
- Users can distinguish a payment receipt from a collection reminder, and a customer message from a staff follow-up.
- Configure → template setup → return preserves edits or explicitly handles them.
- Off + approved does not appear enabled; On + blocked does not appear ready; Nothing due is not an error.
- A received reply, settled balance, or changed membership stops only the applicable sequences under current domain rules.
- Activity distinguishes no eligible work, waiting for the send window, blocked setup, and provider acceptance without inventing delivery evidence.
- Measure time to first correctly configured rule and time to resolve a blocked message. Later track recorded payment/renewal outcomes; do not call them incremental recovered revenue without attribution evidence.

The main uncertainty is usability for our owners. Documentation supports these patterns, but does not prove that four groups, the label, or the detail layout outperform the provisional UI. Validate those choices before expanding the implementation.
