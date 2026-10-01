# Live webhook intake proposal — 30 September 2026

**APPROVED AND ACTIVATED, 30 September 2026, 16:15 UTC.** The owner approved
this exact intake-only change and private-secret transmission to the existing
Razorpay merchant. See the [installation record](subscription-production-install-record.md#approved-intake-only-activation-1615-utc)
for deployed and provider evidence. The following records the approved scope.
This proposal opens only signed event intake. It creates no offer, quote, order,
charge, refund, paid grant, renewal or capability activation.

## Approved change

Review and merge PR #20, which adds the explicit `--allow-live-intake-only` mode
to `scripts/production-env-readiness.mjs`. Its default still blocks intake. The
explicit mode permits only literal `true` intake and continues to block every
Test, money, settlement, reconciliation, review/Checkout UI flag. Incomplete,
Test-key and provider-hidden safety configurations remain blockers. It prints
a distinct intake warning and confers no operational authorization.

The approved procedure sets only
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
and the optimized Production build. These checks themselves did not activate a runtime switch or provider webhook;
the separately approved activation is recorded below.

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

## Activation result

PR #20 merged as `5920fa78bfd60d513906616bab86e87ddddd896b`; its branch was
deleted. Main CI and CodeQL passed. Fresh Production deployment
`dpl_Hx7CKFZx6YP9iDgwPExBNGCWmTkG` is READY on `desk.usefulmade.com` for
that exact SHA, with only the environment/database intake switch enabled.
An unsigned webhook POST returned 400 `Invalid signature`; quote/order/refund
POSTs returned 404. The explicit audit passed with zero blockers and five
protected-value/Turnstile/intake warnings; its private export was removed.

Razorpay webhook `TiJKErwIC7VvRr` was created at 16:15:34 UTC in Live mode.
Its details show Enabled, the exact canonical URL, the five events above,
“Secret was provided during webhook setup”, and the existing merchant alert
email. No SMS challenge occurred. The saved private preparation record holds
its reference; no secret appears in repository records.

After creation, every other Live/Test/capability/policy/advanced switch remains
false. Existing access enforcement is preserved. Counts remain 8 Auth users,
6 accounts, 5 organizations, 554 gym payments and 2 active cron jobs; Live
quotes/orders/payments/refunds/events/grants and offer approvals are zero.
[Production health 36742907792](https://github.com/aarkay1805/UsefulDesk/actions/runs/36742907792)
passed. Enabled is configuration evidence only: genuine signed mixed-merchant
delivery and controlled Live payment/refund acceptance remain pending.
