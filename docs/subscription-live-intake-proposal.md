# Live webhook intake proposal — 30 September 2026

**PREPARED; NOT ACTIVATED.** The approved closed configuration is installed and
verified in the [installation record](subscription-production-install-record.md).
This proposal opens only signed event intake. It creates no offer, quote, order,
charge, refund, paid grant, renewal or capability activation.

## Exact change awaiting approval

Review and merge PR #20, which adds the explicit `--allow-live-intake-only` mode
to `scripts/production-env-readiness.mjs`. Its default still blocks intake. The
explicit mode permits only literal `true` intake and continues to block every
Test, money, settlement, reconciliation, review/Checkout UI flag. Incomplete,
Test-key and provider-hidden safety configurations remain blockers. It prints
a distinct intake warning and confers no operational authorization.

After approval, set only
`USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED=true` in UsefulDesk Production
Vercel as readable Config, and set only
`private.subscription_live_settings.webhook_intake_enabled=true` for the
already bound merchant `acc_TCJwBqanN9LTrK` and pilot
`8826d9aa-03f2-4ad7-ae91-0553052131f8`. Assert all other booleans false before
and after this one-row update. No schema-opening migration is needed for intake;
hard-closed quote/order/refund/conversion/renewal CHECK constraints stay intact.
Redeploy the approved exact main release and verify READY/canonical alias before
registering the provider webhook. Verify unsigned webhook POST becomes 400,
while quote/order/refund POSTs remain 404 and financial/access rows are unchanged.

Register one new **Live** webhook in the existing UsefulMade Razorpay dashboard:

| Field       | Proposed value                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| URL         | `https://desk.usefulmade.com/api/subscriptions/live-webhook`                                                             |
| Secret      | The prepared private secret already stored in Production Vercel; transmit the same value only to Razorpay's webhook form |
| Events      | `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`                              |
| Status      | Enabled only after the receiver verification above                                                                       |
| Alert email | Existing merchant account email default; no new contact or notification recipient                                        |

This changes security-sensitive ingress and sends the named private secret to
Razorpay. Obtain action-specific owner confirmation before entering that secret
and submitting the provider form. Hand off any SMS challenge to the owner.
Preserve every existing gym/OAuth webhook and credential.

## Acceptance and limits

The existing deployed handler validates exact raw-body HMAC, merchant and event
identity, then confirms order ownership using provider GETs. Provider-proven gym
events are acknowledged as unrelated without SaaS/gym writes. Ambiguous ownership
returns 503 for retry. Captured/refund SaaS events require a bound pilot order and
durable dedupe before 200; they stay held with settlement/refund reconciliation
off. A failed-payment event can be marked terminal without granting access.
No valid SaaS order exists yet, so genuine SaaS capture/refund acceptance remains
for a later separately approved controlled payment step. A locally signed sample
or provider Test event must not be recorded as a genuine Live event.

Focused audit/provider/receiver tests passed 41 tests in 3 files. The explicit
audit mode has regression coverage for default refusal, complete intake-only
configuration, all other blocked billing/UI switches, hidden safety flags,
nonliteral intake and incomplete/Test credentials. Existing receiver tests cover
signature refusal, unrelated gym events, uncertain ownership, dedupe and disabled
settlement/refund behavior. Required verification passed lint, TypeScript, all **4,085 tests in 522 files**,
and the optimized Production build. No runtime switch or provider webhook was
activated by these checks.

[Razorpay's current guidance](https://razorpay.com/docs/webhooks/best-practices/)
describes non-2xx retries and disablement after continued failures for 24 hours,
duplicate delivery and possible five-second response timeouts. Inspect actual
delivery status/latency; do not equate Enabled with accepted delivery. The
[validation guide](https://razorpay.com/docs/webhooks/validate-test) distinguishes
Test-mode transaction events from Live proof and requires raw-body signature
verification. Context7's SDK webhook API applies to sub-merchants; use the
existing merchant dashboard rather than treating it as a Route sub-merchant.

## Rollback before any money exists

Disable only this new provider webhook first. Restore the Production intake
Config flag and database intake switch to false, redeploy the pinned release,
verify webhook/quote/order/refund 404 and rerun the default closed audit. Preserve
any durable events for review. Do not delete/rotate the saved keys or existing gym
webhooks. After a future money-opening change, use the separate financial recovery
procedure, which retains settlement/reconciliation for in-flight obligations.
