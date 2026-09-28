# Settings navigation audit

Date: 2026-09-28. Full visual report: https://claude.ai/artifact/L8CUzhZEfHQhRfgxxJ1iA3
(private; the owner can share it from the page's Share menu).

## Problem

A gym owner using UsefulDesk said Settings is confusing and he has to guess
where things are. Nobody has watched him use it yet, so the causes below are
ranked by evidence and by how many everyday tasks they block. The Phase 0 test
confirms or corrects the ranking.

## Findings

| ID  | Severity | Finding                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                              |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| F1  | P1       | Below 1024px the rail is one horizontal strip of 17 buttons with the 5 group headings hidden. A 390px phone shows Overview, Your profile and half of Login & security; the strip is 2,618px wide in a 358px window.                                                                                                                                            | `settings-rail.tsx:76` (`overflow-x-auto`), `:91` (`hidden … lg:block`)                               |
| F2  | P1       | Connect Razorpay, Open payment settings and Finish invoice setup link to `/settings?tab=payments`, which is not a section, so they open Overview. Invoice details live in Business details.                                                                                                                                                                    | `payment-link-actions.tsx:73, 95`, `invoice-document-actions.tsx:126`, `settings-sections.ts:197–198` |
| F3  | P1       | Sidebar Settings opens Overview; profile-menu Settings opens WhatsApp.                                                                                                                                                                                                                                                                                         | `sidebar.tsx:124`, `sidebar.tsx:721`                                                                  |
| F4  | P1       | Misplaced settings: Trainers inside Products & services; Expense categories inside Payments ("Choose how members can pay you"); reminders in Settings › Automated messages while the menu's Automations has none and neither links to the other; Add branch only in the sidebar branch menu, while Settings › Branches says "Use the branch menu on the left". | `products-services-settings.tsx:175`, `deals-settings.tsx:37–45`, `organization-settings.tsx:128`     |
| F5  | P2       | Overlapping words: "Business setup" vs "Your gym" vs main-menu "Business"; "Account" means the person; Team card says "3 members" (members are paying customers); "Payments" means three things; "Automated messages" vs "Automations"; Business details card says "Gym name, branches, and invoice details".                                                  | `settings-sections.ts:175–185`, `settings-overview.tsx:187, 220–222`                                  |
| F6  | P2       | Overview tiles 10 of 17 sections, in a different order from the rail, missing Membership plans and Automated messages; the profile card is not clickable; its icon tiles use `bg-primary-soft` where `docs/ui-patterns.md` requires the neutral `bg-muted` of its canonical twin (`get-started-view.tsx` StepRow).                                             | `settings-overview.tsx:179–265, 270–297`                                                              |
| F7  | P2       | No settings search; `components/layout/global-search.tsx` is never mounted.                                                                                                                                                                                                                                                                                    |                                                                                                       |
| F8  | P2       | The desktop rail is 847px tall; on 1366×768 seven items start below the fold, and on long panels the sticky rail hides its last four.                                                                                                                                                                                                                          | `settings-rail.tsx:78`                                                                                |
| F9  | P3       | Staff and View-only users see all 17 sections but can change only Your profile, Login & security and Appearance.                                                                                                                                                                                                                                               |                                                                                                       |

Heuristic baseline (single reviewer): 23/40. Re-score after Phase 2.

## Decisions (owner of the product, 2026-09-28)

1. Ship the Phase 1 quick fixes now. Plan the Phase 2 restructure after the
   Phase 0 owner test shows what really confused him.
2. Phase 2 phone layout: replace the horizontal strip with a grouped vertical
   list you tap into, with a back arrow and the section name in the app bar.
3. Adopt the recommended names (below). Phase 1 applies only the one rename it
   needs: the "Account" heading becomes "Personal" and moves last, so the
   complete Overview stays business-first and matches the rail.

## Phase 1 scope (quick fixes)

1. Every internal link into Settings opens a real section. `payments` is kept
   as an alias for `deals`; Finish invoice setup opens Business details. A test
   fails when any `/settings?tab=` link in `src/` names an unknown section.
2. The profile menu's Settings opens the Settings home (`/settings`).
3. Overview lists every section except Overview and Your profile (the
   clickable identity card opens Your profile), grouped under the rail's
   headings in the rail's order, one status line each. The rail's "Account"
   heading becomes "Personal" and moves to the end.
4. Words: the Team tile counts "4 people · 1 invite pending"; Business details
   reads "Gym name, legal name, and invoice details"; the WhatsApp tile shows
   the WhatsApp mark; Overview icon tiles use the neutral canonical treatment.
5. Links from where the work happens: Business › Expenses "By category" card →
   Expense categories; Automations page → Automated messages; Automated
   messages → Automations; Team members → Products & services › Trainers
   (opened on the Trainers tab); Settings › Branches gets an Add branch button
   for organization owners.

Out of Phase 1: regrouping, the phone list, search, moving Trainers or
Expense categories, the staff view, and every other rename.

## Phase 2 direction (plan after the owner test)

Headings and items, in order:

| Heading             | Items                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Your gym            | Business details · Branches · Country, currency & time · later: UsefulDesk plan & billing (owner only) |
| Plans & pricing     | Membership plans · Products & services                                                                 |
| WhatsApp            | WhatsApp number · Message templates · Automated messages                                               |
| Payments & expenses | Payment methods · Expense categories                                                                   |
| Team                | Team members · Trainers                                                                                |
| Enquiries           | Enquiry form & ads · Tags & extra details                                                              |
| Personal            | Your profile · Login & security · Appearance · later: Notifications                                    |
| Advanced            | API keys                                                                                               |

Also in Phase 2: settings search with owner synonyms (package, PT fee, UPI,
QR, staff, GST, dark mode); the laptop rail scrolls inside its own column;
Staff and View-only users see Personal first with gym settings folded as View
only; every existing `?tab=` value keeps working. The subscriptions PRD's
"Settings → Billing" must ship as "UsefulDesk plan & billing".

## Phase 0 test (run with the owner on his phone)

Read each task aloud; don't help. Record the first tap, success, and the word
he looked for. Ask "Where did you expect it?" when he misses. Target after
Phase 2: at least 8 of 10 first taps right.

| #   | Task                                                                 | Where it is today                                           |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Change the price of your 3-month plan.                               | Business setup › Membership plans                           |
| 2   | A new trainer starts Monday. Add him and set his PT fee.             | Products & services › Trainers, then the fee on the service |
| 3   | Give your front-desk person her own login.                           | Your gym › Team members                                     |
| 4   | Turn on the WhatsApp reminder that goes before a membership expires. | Messaging › Automated messages                              |
| 5   | Add your UPI ID so members can pay you.                              | Business setup › Payments                                   |
| 6   | Add a new expense type called Electricity.                           | Business setup › Payments › Expense categories              |
| 7   | Change the name members see on your WhatsApp messages.               | Business setup › Business details › Legal business name     |
| 8   | WhatsApp messages stopped going. Check what's wrong.                 | Messaging › WhatsApp                                        |
| 9   | Open your second branch.                                             | Sidebar branch menu › Add branch                            |
| 10  | Change your own password.                                            | Account › Login & security                                  |

## Benchmark summary

Mindbody (Settings with search; groups Staff, Clients, Pricing, General…;
options hidden by permission), ABC Glofox (Studio, Payments, Clients, Bookings,
Forms, Integrations; memberships under Manage › Services), PushPress, Gymdesk,
Wodify, Fresha (Workspace settings card hub), Zenoti (organization vs center
settings), Square (Personal Information vs My business), Shopify (business
first, search, grouped list in the phone app), OpenPhone (Workspace, then Your
account; "Plan & billing"), WhatsApp Business app (Settings › Business tools),
WATI and Interakt (Billing and Developer settings apart), Zoho CRM (Setup page
with search). NN/g: hidden carousel options are rarely found; more than 15
subcategories on mobile warrant a landing page that lists them all.
