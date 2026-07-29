# Conversion payment installments

Lead conversion can collect the first invoice either in full or as a fixed no-fee 60/40 split:

- 60% is recorded immediately through the append-only payment ledger.
- 40% remains on the same invoice and is due 28 account-local calendar days later.
- WhatsApp reminders are attempted 7, 3, 1, and 0 days before that deadline, after 09:00 in the account timezone.

`record_membership_installment_payment` creates the first payment and `membership_installment_plans` row in one transaction. The invoice view remains the source of truth for the outstanding balance, so later manual payments automatically stop reminders once the invoice is settled. `installment_reminders_sent` is a claim-first dedupe ledger; a failed send releases its claim for retry.

## WhatsApp prerequisite

The account must have WhatsApp connected and an approved Meta Utility template named `gym_installment_reminder` with four body parameters, in this order:

1. member name
2. outstanding installment amount
3. plan name
4. installment due date

If the template is missing or not approved, conversion and payment collection still work; the cron skips the message and reports the setup issue in its response notes.

## Operations

GitHub Actions calls `/api/payment-installments/cron` hourly at :30 alongside renewal reminders. The route uses the shared `AUTOMATION_CRON_SECRET` / `CRON_SECRET` authentication described in [automations-and-cron.md](automations-and-cron.md).

Verify manually:

```bash
curl -sS \
  -H "x-cron-secret: <SECRET>" \
  https://desk.usefulmade.com/api/payment-installments/cron
```

The response reports scanned schedules, sent messages, skipped claims, failures, and setup notes.
