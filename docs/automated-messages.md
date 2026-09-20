# Automated messages operator runbook

Settings → **Automated messages** uses the existing `?tab=reminders` URL for the
selected branch. Its **Messages** and **Message history** tabs sit under the panel
heading. Messages lists the 14 existing messages in Renewals, Payment reminders,
Keep members coming back, and Confirmations sections. Opening a message from
**Review message**, **Change sending hours**, or a `?rule=<id>` link keeps the destination in view. Review
and `?rule=` open the rule; Change sending hours focuses the branch-level
Sending hours editor instead.

## Who can see and change what

| Surface                                        | Owner / admin | Agent / viewer                          |
| ---------------------------------------------- | ------------- | --------------------------------------- |
| **Messages** — `GET /api/reminders/settings`   | Read          | Read                                    |
| Rule changes — `PATCH /api/reminders/settings` | Change        | Refused (403)                           |
| **Message history** — activity/readiness APIs  | Read          | Permission notice; nothing is requested |

- Reading the catalogue is `canViewAutomatedMessageRules` (every member). It
  mirrors the member-level SELECT policies on `renewal_reminder_settings`
  (033), `message_templates`, and `whatsapp_config` (017), so it needed no
  RLS change. Changing a rule stays `requireSettingsAccess`.
- Message history is `canViewAutomatedMessageActivity` (admin+). It mirrors the
  explicit `is_account_member(…, 'admin')` predicate in the
  `automated_message_activity` view, so opening Message history to agents needs a
  migration for that view as well as the predicate change.
- Without settings access, Messages shows **Read-only** and rows open with
  **Details**. The switch, **Set up message**, and **Change reminder days** stay
  focusable, and each opens an **Admin access required** explanation instead
  of acting. Sending-hour fields stay disabled. The Message history tab stays visible
  and shows **Admin access required** in place of the history.
- A 401/403 while loading Messages shows the server's reason without **Try
  again**; retrying cannot change an access decision.

## Review and activate

1. Choose a message and **Details** to expand its own row and inspect who qualifies, its timing, sample
   message, stopping conditions, and staff follow-up behavior. **Hide details** collapses
   it; opening another rule closes the previous one without discarding drafts.
2. **Save changes** writes only that rule’s changed fields. Configuration can
   be saved while Off and never activates a schedule. **Cancel** restores the
   saved values. Unsaved changes survive tab/detail navigation within this
   page and are isolated by account/branch; they are not persisted across reloads.
3. When an unready rule offers **Set up message**, open it to review the
   required prefilled template
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

Installment reminders use the recorded joining-payment schedule (7/3/1/0 days)
and have no independent account toggle. Overdue installment jobs belong to
Unpaid invoice reminders. Unpaid invoice, post-expiry, and retention messages
share the branch-level Sending hours, whose existing storage fields remain under
the internal invoice-collection rule and whose ending hour is inclusive. The editor names every
rule in scope and keeps its draft/save/cancel state separate from per-rule
changes. Transaction
confirmations and AutoPay event updates are processed from their recorded
events and do not use that window. AutoPay retry messages are
informational and exempt from the collection daily budget; terminal collection
messages recheck the exact balance and reserve that budget. Payment
confirmations are separate from renewal promises and recovery requests.

Membership renewal, service renewal, and joining-installment workers retain
their separate after-09:00 account-local gate. Changing Sending hours does not
alter those schedules, activate any rule, or backfill prior milestones.

## Read Message history accurately

Message history unions durable lifecycle jobs with membership-renewal,
service-renewal, and installment ledgers. Filters run in the database before
30-record pages, ordered by recorded time and unique activity ID. Date filters
use the selected account’s timezone. The API and security-invoker view limit
Message history to the selected branch's admins and owners.

**Recorded** is the available message/job/ledger timestamp, not necessarily a
delivery-receipt timestamp. The date under each rule is the subject’s own date,
named for that rule — **Expiry** (renewal, post-expiry, win-back, and session
pack), **Due date** (unpaid invoice and installment reminders), **Promised
date**, **Link sent**, **Return date**, **Payment date**, or **AutoPay failed** —
never a promised send time. **Next attempt** appears when the queue retains one.
Waiting, Paused, and Sending rows are distinct from Blocked sends (missing
setup or a missing member detail such as a phone number), stopped sequences,
failed attempts, and unknown provider outcomes; the Status filter groups them
as Needs attention, Not sent yet, Sent, and Other. Accepted means the provider
accepted a send; Delivered/Read require retained evidence. Staff escalation
outcomes are described separately from the customer-message status.

Every layout shows contextual text links in a fixed order — Open chat, Invoice,
Follow-up, View member. Member and invoice links open their existing details,
and Open chat opens the recorded contact conversation. Follow-up opens the
contact profile over the Follow-ups queue; it is not a claim that the newest
open task was created by this specific reminder.

**Renewal and installment checks**, above the history, covers membership,
service, and installment reminders only. **Nothing due** is a current result,
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
  submission, return to the same rule, Message history’s retained delivered record,
  Accepted filtering and its neutral empty state, and Message history → message detail.
- Read-back returned zero message-history rows for an unrelated authenticated identity.
  The real owner’s browser loaded its branch history successfully. Production
  settings read-back remained membership On, service On, newer lifecycle Off.

The application was not built for production or deployed in this change.
