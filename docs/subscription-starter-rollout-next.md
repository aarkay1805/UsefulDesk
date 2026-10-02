# Starter web rollout — 2 October 2026

The owner selected **Starter web billing first** in this chat. Live renewals,
upgrades, add-ons and native Checkout remain outside this opening. The completed
Home office internal payment/refund is not a customer sale or authority to reopen
its initiation. Bank refund-credit evidence remains owner-deferred.

## Current evidence and remaining work

| Item                            | Evidence and next action                                                                                                                                                                                                                                                                                     | Owner                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Original Live money/access      | Passed: one verified ₹799 payment, one processed full refund, three reconciled original events, zero recovery items/exceptions and 554 gym payments at the 2 October 02:05:53 UTC Production check. Quotes/orders/refunds/conversion/renewals and tier capabilities remain off; intake/settlement remain on. | Rajat                    |
| Exact renewal templates         | Prerequisite passed: fresh provider GETs at **02:21:36 UTC** report membership and service renewal APPROVED, POSITIONAL, exact current body/buttons, no header/footer. Stored Production contracts also match. Actual delivery remains pending.                                                              | Rajat                    |
| Delivery receipts               | Production-installed and collection enabled on exact-main canonical deployment after verified full backup; schema/grants, initial runtime and financial/access preservation passed. Zero natural receipts at 02:49 UTC; authentic acceptance remains pending.                                                | Release operator         |
| Authentic same-event redelivery | Pending genuine provider traffic: repeated provider event ID and identical body hash, original financial/access preservation and actual provider response logs. Digest fallback and manual reconciliation do not supply this proof.                                                                          | Rajat                    |
| Mixed gym/SaaS routing          | Pending authentic matching deliveries. An unrelated receipt proves only a foreign order or orderless payment. Correlate private identities with real gym ingress/ledger evidence and verify both financial/access boundaries before calling it gym routing.                                                  | Rajat                    |
| Reminder delivery               | Select the actual acceptance recipient; prepare and authorize the exact current-contract message, then record its real delivery outcome. Worker HTTP 200 and template approval are separate.                                                                                                                 | Rajat                    |
| Customer opening                | Identify the genuine first buyer/organization, billing geography, financial-year PAN-wide turnover confirmation and fact-supported issuer/document treatment. Reuse supplied supplier identity/address; prepare the exact immutable customer offer/opening review before issuance.                           | Rajat                    |
| Starter capabilities            | Existing local/cloud Auth/API/RLS/worker acceptance passed. Refresh actual candidate schedules, branch roster, access and policy checks, then review exact capability activation with customer opening.                                                                                                      | Release operator / Rajat |
| Independent watchdog            | Code/RPC exist. Identify the chosen existing service/account; configure the prepared probes and separate token; verify natural probes and actual owner notification.                                                                                                                                         | Rajat                    |
| Operations                      | Primary ops/renewals are healthy; GitHub natural runs resumed but cadence is intermittent. Native scheduler acceptance passed. Review Supabase temporary Free acceptance by 13 October or its earlier triggers.                                                                                              | Rajat                    |

## Receipt behavior and release

`20261002023000_subscription_live_delivery_receipts.sql` adds a private,
RLS-enabled append-only table and service-only RPC. Service has SELECT and RPC
execution, no direct DML/TRUNCATE; browsers have neither. The RPC checks active
exact merchant/listener binding, identities and digest conflicts. SaaS receipts
must match durable original intake; known SaaS orders/payments cannot be labeled
unrelated. Listener organization does not attribute a foreign payment to it.

The existing webhook opts in only with literal
`USEFULDESK_SAAS_LIVE_DELIVERY_EVIDENCE_ENABLED=true`, after its Production,
signature, merchant and provider-ownership checks. It appends one receipt after
successful handling, before acknowledgment. Financial authority/idempotency are
unchanged. Failed handling creates no completed receipt; enabled persistence
failure returns 503. Flag absent/false retains existing behavior with no new RPC.

Receipt time is database recording time, not network arrival or HTTP-response
time. Provider event-ID headers and body-digest fallback are distinguished.
No raw bodies, signatures, credentials or buyer details are stored. No historical
receipts are backfilled. Repeated receipts are review candidates, not automatic
commercial/provider acceptance. Inspect aggregates with
`scripts/subscription-live-delivery-evidence.sql`; correlate provider logs and
gym/SaaS financial/access preservation privately.

Production sequence: review exact-source checks; verify encrypted database/Storage
backup and original fingerprints/gates; connector-install the additive migration
and verify schema/RLS/grants/empty receipts; deploy the reviewed source with the
flag absent/false; then enable **only** the evidence flag while preserving
recovery-only phase and closed money/UI/capabilities. Refresh the isolated
Production audit and inspect natural traffic/runtime errors. Contain collection
by closing this flag and redeploying; retain immutable receipts and intake/recovery.
The original 28-source opening manifest remains historical and unchanged.

## Validation

- Focused webhook/environment tests: **153 passed**. Full repository lint,
  TypeScript, **4,315 tests in 528 files**, and optimized Production build
  (**137 generated pages**) passed.
- Local full-schema runner passed existing Live boundary, expiry-renewal and
  complimentary suites plus receipt replay/repeats, unrelated isolation, conflicts,
  RLS, immutability and financial/access/gym/gate preservation. All 14 sources
  rolled back; no local Live tables remained.
- Billing Staging `otagotpezshybxkagtwv`: source SHA-256
  `2ba1a27f89685e50c1b581c087f9765070cdefce26bdc7053f8e41a2a17c0ec4`
  installed through the connector as history **20261002021926**.
  Synthetic repeated unrelated receipts and immutability/grants passed within
  rollback. At **02:20:13 UTC**, receipts/organizations/payments/events were zero,
  merchant/pilot unbound, all Live gates false and receipt RLS enabled.

These synthetic results do not establish authentic traffic acceptance. Production
installation is verified separately as history `20261002024027`, following the
verified full backup. Collection alone is enabled on the exact-source canonical
deployment with a zero-blocker recovery-only audit and clean initial runtime/
preservation checks, recorded in the
[Production receipt release record](subscription-delivery-receipts-production-record.md).

## Customer opening implementation still required

The installed `20260930164040` opening review permits only
`commercial_context='internal_acceptance'`; its quote trigger hard-codes Home
office and the accepted merchant. `subscription_pin_live_merchant` and the opening
review guard freeze that pilot/review after the original quote. The HTTP quote
and order routes, provider classification, settlement and recovery also require
the single configured pilot organization. Changing a flag or offer row cannot
create an independent customer path, and changing that binding would strand
late original-event recovery.

After identifying the first customer, prepare a separately reviewed default-closed
customer scope with its real commercial/issuer/offer references. Preserve the
original internal merchant/organization/review and recovery. Resolve the new
owner request and provider-proven order through server-owned scope authority;
never choose an organization from an unverified browser/webhook field. Keep
one-branch Starter/₹799/30-minute/capture-month rules, original claim/idempotency,
refund history and the 7/3/1-after-09:00 policy. Validate original late-event
recovery, customer/staff/outsider isolation, changed-review/capture holds and
closed renewals/capabilities before enabling that exact customer. This receipt
release does not implement or open that path.
