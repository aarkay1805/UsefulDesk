# Automated messages operator runbook

Settings → **Automated messages** uses the existing `?tab=reminders` URL and
settings authorization for the selected branch. It exposes the 14 existing
rules under Renewals, Collections, Retention, and Confirmations.

## Configure and activate

1. Choose a rule and **Configure** to inspect who qualifies, its timing, sample
   message, stopping conditions, and staff follow-up behavior.
2. **Save changes** writes only that rule’s changed fields. Configuration can
   be saved while Off and never activates a schedule. **Cancel** restores the
   saved values. Unsaved changes survive group/detail navigation within this
   page and are isolated by account/branch; they are not persisted across reloads.
3. Save or cancel a draft before opening Templates or the shared send-window
   configuration. The exact-template link carries the originating rule and
   branch. Templates offers that locked preset or its existing local template,
   then **Return to automated messages** reopens the rule. Opening a preset
   only creates an editor draft; submitting to Meta is a separate action.
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
use the selected account’s timezone. The API and security-invoker view enforce
selected-branch/settings access.

**Recorded** is the available message/job/ledger timestamp, not necessarily a
delivery-receipt timestamp. **Anchor** is the subject’s due/expiry/event date,
not a promised send time. **Next attempt** appears when the queue retains one.
Waiting and paused rows are distinct from setup blockers, stopped sequences,
failed attempts, and unknown provider outcomes. Accepted means the provider
accepted a send; Delivered/Read require retained evidence. Staff escalation
outcomes are described separately from the customer-message status.

Member and invoice actions open their existing details; Conversation opens
the recorded contact conversation. View profile opens the contact profile
where existing follow-up work lives; it is not a claim that the newest open
task was created by this specific reminder.

The three current schedule checks cover membership, service, and joining
installments only. Nothing due is a current diagnostic result, while an empty
activity table means no matching retained records. Failed legacy claims that
were deleted cannot be reconstructed. Activity is a view of retained current
job/outcome state, not a complete immutable timeline of every retry.

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
