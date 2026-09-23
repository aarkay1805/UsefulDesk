# Joining checkout payment installments

Add member and lead conversion can collect the first invoice either in full or as a fixed no-fee 60/40 split. The split applies to the complete checkout total, including membership, services, and merchandise:

- 60% is recorded immediately through the append-only payment ledger.
- 40% remains on the same invoice and is due 28 account-local calendar days later.
- WhatsApp reminders are attempted 7, 3, 1, and 0 days before that deadline, after 09:00 in the account timezone.

`perform_join_checkout` creates the membership, combined immutable invoice,
first payment, proportional line allocations, and
`membership_installment_plans` row in one idempotent transaction. The generic
`invoice_balances` view remains the source of truth for the outstanding balance.
Immediately before Meta can receive a reminder, the worker re-reads the exact
installment promise, collectible invoice balance, refund-review state, and open
collection commitments. A later payment or hold therefore stops the stale
candidate; a partial payment reduces the reminder amount to the current
collectible balance. `installment_reminders_sent` is a claim-first dedupe
ledger. Only failures known to occur before the provider-attempt boundary
release the claim; accepted and ambiguous outcomes remain deduped. Standalone
sales may accept any partial payment or remain due, but do not create this
scheduled 60/40 promise.

## WhatsApp prerequisite

The account must have WhatsApp connected and the exact approved Meta **Utility**
contract `gym_installment_reminder`. Existing consent/opt-out records remain
audit history and do not gate this repository's established outbound path. It
uses the `whatsapp_account_updates` channel and POSITIONAL body
parameters in this order:

1. member name
2. outstanding installment amount
3. plan name
4. installment due date
5. legal business name

Exact body:

> Hi {{1}}, your remaining installment of {{2}} for your {{3}} membership is due on {{4}}. Reply to {{5}} for payment help.

Submission starts Meta review; approval and delivery are not guaranteed. Sync
Templates after review. The cron requires the exact Approved category, format,
components, and parameter order rather than approval by name alone.

If the template is missing or not approved, joining/conversion and payment collection still work; the cron skips the message and reports the setup issue in its response notes.

The diagnostic in Settings → Automated messages → Activity reports the same prerequisite as
**Blocked** with the exact recovery message, while **Nothing due** means there
is no eligible installment today. It does not execute the worker. A candidate
must still have a phone and an open positive invoice balance that is not under
refund review. Do not use membership status or collection mode as a blanket
suppression here: an installment can be backed by a combined historical invoice,
and its invoice balance is the current collection authority.

## Operations

The database-owned aggregator calls `/api/payment-installments/cron` hourly at
:41; GitHub Actions supplies the redundant run at :47. The route uses the
shared `AUTOMATION_CRON_SECRET` / `CRON_SECRET` authentication described in
[automations-and-cron.md](automations-and-cron.md).

Verify manually:

```bash
curl -sS \
  -H "x-cron-secret: <SECRET>" \
  https://desk.usefulmade.com/api/payment-installments/cron
```

The response reports scanned schedules, sent messages, skipped claims, failures, and setup notes.
`accepted` means Meta accepted a request; it is not delivered/read evidence.
Webhook delivery status remains authoritative.
Operational query/claim/completion failures and unresolved provider ambiguity
return `503` without dropping that aggregate body, so both schedulers surface
the run as failed. Missing setup, an empty cohort, a settled/held invoice, or
another final eligibility change remains a healthy `200` skip.
