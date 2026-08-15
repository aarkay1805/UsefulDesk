# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are Indian gym owners and owner-managers who need to understand revenue risk and act on it quickly, often from a phone. Front-desk staff and managers handle member records, payments, attendance, and daily follow-up; sales staff and trainers participate in assigned workflows without needing the full owner view.

## Product Purpose

UsefulDesk helps gyms recover renewals, collect payments, retain members, and keep follow-up work accountable. It brings member and lead records, WhatsApp conversations, UPI-aware collections, attendance, and next actions into one operating system so teams do not have to coordinate the same work across spreadsheets, paper registers, calls, and disconnected chats.

Success means the owner can see who is expiring or overdue, contact them on WhatsApp, collect payment, assign follow-up, and track the outcome with minimal manual chasing.

## Positioning

UsefulDesk is an India-first, WhatsApp-native gym CRM centered on renewals and collections rather than a broad feature dashboard. Its distinctive mechanism is the complete action loop: identify revenue or retention risk, continue the real conversation in WhatsApp, collect through India-appropriate payment rails, give every exception an owner and next action, and preserve the result on the member timeline.

## Operating Context

Gym teams work from phones and reception desktops while serving members in person. Their source material commonly includes WhatsApp conversations, Excel or Google Sheets, paper registers, payment screenshots, cash and UPI records, attendance events, renewal dates, and staff follow-up notes.

The daily owner workflow is operational: review expiring, overdue, inactive, and unconverted members or leads; send reminders; collect or reconcile payment; assign follow-up; and resolve exceptions. The product must remain useful for a single-location boutique gym while supporting multi-tenant accounts, shared teams, branches, and role-based access.

## Capabilities and Constraints

- The gym layer covers members, plans, memberships, renewals, payments, attendance, products and services, and follow-up workflows on top of a mature WhatsApp CRM.
- Core CRM capabilities include a shared WhatsApp inbox, contacts, leads, pipelines, broadcasts, automations, team accounts, and account-scoped data.
- Roles are owner, admin, agent, and viewer. Authorization and tenant isolation are enforced in both the application and database.
- Phone-first workflows and action lists take priority over dashboard breadth. The product should tolerate unreliable connectivity and avoid requiring a member app.
- Accounts own their locale, timezone, date and time conventions, phone country code, measurement system, and currency. UPI is available only for INR.
- WhatsApp sending depends on a connected account and the relevant approved Meta template. Missing setup must not block unrelated work.
- Payment and member data are sensitive. Private receipts, credentials, account isolation, and authenticated or tokenized public endpoints must preserve the repository's security rules.
- UsefulDesk is not trying to become a full gym ERP in its first product phases; renewal, payment, WhatsApp, attendance, and accountable exception handling remain the priority.

## Brand Commitments

The product name is UsefulDesk. Its voice is direct, practical, and operational: tell the user what needs attention and what they can do next. Claims must stay grounded in implemented behavior or evidence already in the repository.

Existing product and payment icon assets live in `public/brand/`. Visual decisions remain governed by the incumbent interface until a separate design-system or redesign workflow explicitly changes them.

## Evidence on Hand

- `PRDs/india_gym_crm_pain_points.md` contains the India gym CRM market research, pain-point synthesis, positioning, and source list behind the product direction.
- `PRDs/roadmap.md` records what is built, planned, and deliberately deferred.
- `docs/gym-domain.md` records the membership, billing, payment, and attendance domain model.
- `docs/privacy-and-subprocessors.md` records the real data categories, subprocessors, and security commitments.
- The runnable application and its routes are the source of truth for implemented capability.
- The repository does not establish customer testimonials, case studies, adoption figures, revenue benchmarks, or press coverage. Future work must not fabricate them.

## Product Principles

1. Save the owner time, recover lost leads, collect renewals, or retain members; defer work that does none of these.
2. Make the next action obvious: action lists over passive dashboards, with an owner, status, and next step for every exception.
3. Be phone-first, WhatsApp-native, renewal-first, and tolerant of unreliable connectivity.
4. Fit the gym's existing behavior instead of forcing a member app or a heavyweight rollout.
5. Make the owner feel in control within 30 seconds.
