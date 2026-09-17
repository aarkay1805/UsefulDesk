# Automated messages operator runbook

Settings → **Automated messages** uses the existing `?tab=reminders` URL for the
selected branch. It exposes the 14 existing rules under Renewals, Collections,
Retention, and Confirmations.

## Who can see and change what

| Surface                                               | Owner / admin | Agent / viewer                          |
| ----------------------------------------------------- | ------------- | --------------------------------------- |
| **Rules** — `GET /api/reminders/settings`             | Read          | Read                                    |
| Rule changes — `PATCH /api/reminders/settings`        | Change        | Refused (403)                           |
| **Activity** — `/api/reminders/activity`, `readiness` | Read          | Permission notice; nothing is requested |

- Reading the catalogue is `canViewAutomatedMessageRules` (every member). It
  mirrors the member-level SELECT policies on `renewal_reminder_settings`
  (033), `message_templates`, and `whatsapp_config` (017), so it needed no
  RLS change. Changing a rule stays `requireSettingsAccess`.
- Activity is `canViewAutomatedMessageActivity` (admin+). It mirrors the
  explicit `is_account_member(…, 'admin')` predicate in the
  `automated_message_activity` view, so opening Activity to agents needs a
  migration for that view as well as the predicate change.
- Without settings access, Rules shows **Read-only** and rows open with
  **View**. The switch, **Set up**, and **Change reminder days** stay
  focusable, and each opens an **Admin access required** explanation instead
  of acting. Sending-hour fields stay disabled. The Activity tab stays visible
  and shows **Admin access required** in place of the history.
- A 401/403 while loading Rules shows the server's reason without **Try
  again**; retrying cannot change an access decision.

## Configure and activate

1. Choose a rule and **Configure** to expand its own row and inspect who qualifies, its timing, sample
   message, stopping conditions, and staff follow-up behavior. **Close** collapses
   it; opening another rule closes the previous one without discarding drafts.
2. **Save settings** writes only that rule’s changed fields. Configuration can
   be saved while Off and never activates a schedule. **Cancel** restores the
   saved values. Unsaved changes survive group/detail navigation within this
   page and are isolated by account/branch; they are not persisted across reloads.
3. When an unready rule offers **Set up**, open it and choose
   **Set up required template** to open the required prefilled template modal
   over the rule. Without settings access, Set up explains that an admin or
   owner must do this and never opens the setup flow. The branch’s existing
   template opens for editing if eligible; pending templates show their approval
   status without another submission action. Cancel/close returns to
   the same expanded rule with unsaved edits intact. Submitting remains an
   explicit action and refreshes readiness without turning the rule on.
   Separate links that navigate to Templates still require saving or cancelling
   drafts; those links focus the exact contract and retain a return path.
4. Turn a rule On only after its branch WhatsApp connection and all required
   exact Approved/synced POSITIONAL contracts are ready. The API and database
   both reject a new enablement that lacks prerequisites. Already-On rules
   retain their preference when readiness is lost and show **Blocked**.

Joining installments use the recorded joining-payment schedule (7/3/1/0 days)
and have no independent account toggle. Overdue installment jobs belong to
Invoice collection. Collection, post-expiry, and retention rules share Invoice collection’s
account-local send window, whose ending hour is inclusive. Transaction
confirmations and AutoPay event updates are processed from their recorded
events and do not use that window. AutoPay retry messages are
informational and exempt from the collection daily budget; terminal collection
messages recheck the exact balance and reserve that budget. Payment
confirmations are separate from renewal promises and recovery requests.

## Read Activity accurately

Activity unions durable lifecycle jobs with membership-renewal,
service-renewal, and installment ledgers. Filters run in the database before
30-record pages, ordered by recorded time and unique activity ID. Date filters
use the selected account’s timezone. The API and security-invoker view limit
Activity to the selected branch's admins and owners.

**Recorded** is the available message/job/ledger timestamp, not necessarily a
delivery-receipt timestamp. The date under each rule is the subject’s own date,
named for that rule — **Expiry** (renewal, post-expiry, win-back, and session
pack), **Due date** (invoice collection and joining installments), **Promised
date**, **Link sent**, **Return date**, **Payment date**, or **AutoPay failed** —
never a promised send time. **Next attempt** appears when the queue retains one.
Waiting, Paused, and Sending rows are distinct from Blocked sends (missing
setup or a missing member detail such as a phone number), stopped sequences,
failed attempts, and unknown provider outcomes; the Outcome filter groups them
as Needs attention, Not sent yet, Sent, and Other. Accepted means the provider
accepted a send; Delivered/Read require retained evidence. Staff escalation
outcomes are described separately from the customer-message status.

Wide layouts show a fixed-order icon set per row — Conversation, Invoice,
Follow-up, Member — with tooltips and accessible names; narrow layouts spell
the same links out. Member and invoice links open their existing details, and
Conversation opens the recorded contact conversation. Follow-up opens the
contact profile over the Follow-ups queue; it is not a claim that the newest
open task was created by this specific reminder.

**Scheduled reminder readiness**, above the history, covers membership,
service, and joining installments only. **Nothing due** is a current result,
while an empty history means no matching retained records. Failed legacy
claims that were deleted cannot be reconstructed. History shows each record’s
latest job/outcome state, not a complete immutable timeline of every retry.

## Implementation and verification

The applied activation migration is
`20260912103000_reminder_rule_activation_readiness.sql`; the applied
activity view is `20260912104000_automated_message_activity.sql`. Keep SQL
contract tuples aligned with `template-contracts.ts`; the contract test compares
the exact payloads. Direct client calls cannot invoke the guard helpers.
The activation trigger checks every false-to-true transition, prevents tenant
moves, and leaves existing activation-generation handling intact.

Read-back confirmed security-invoker mode, authenticated SELECT with the
explicit admin predicate, no anon SELECT, and no browser-role execution of
internal readiness helpers. An authenticated owner read executed successfully.
A rollback-only database check rejected unready invoice activation and allowed
an unchanged configuration save; unknown contract IDs fail closed.

No schedules were enabled by this work: the existing membership and service
renewal switches remain On and all newer lifecycle switches remain Off.
No template was submitted, customer message sent, provider/payment operation
performed, application deployed, or delivery claimed. The five-owner usability
study and outcome attribution in the benchmark remain future validation.

Verification on 12 September 2026:

- 151 tests passed across 26 targeted reminder, settings, template, invoice, and
  member-detail suites. Coverage includes partial saves, readiness/activation,
  malformed requests, authorization boundaries, microsecond-safe pagination,
  date validation, exact invoice links, and draft/setup navigation.
- `npm run typecheck` passed. `npm run lint` passed with only three pre-existing
  warnings in the untouched Leads page; final changed-file lint was clean.
- Authenticated local browser checks covered the rule catalogue, saved On/Off
  states, configuration while Off, unsaved edits surviving group changes,
  Cancel restoring saved values, exact locked preset opening without
  submission, return to the same rule, Activity’s retained delivered record,
  Accepted filtering and its neutral empty state, and Activity → rule detail.
- Read-back returned zero Activity rows for an unrelated authenticated identity.
  The real owner’s browser loaded its branch history successfully. Production
  settings read-back remained membership On, service On, newer lifecycle Off.

The application was not built for production or deployed in this change.
