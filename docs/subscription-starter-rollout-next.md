# Starter web billing — current operating summary

Updated after the 2 October 2026 rollout and cleanup. This is the current action
list, not a live health report. Recheck the relevant records before opening a new
customer or changing any gate. Earlier release checks live in the
[dated rollout archive](subscription-starter-rollout-history-2026-10-02.md).

## Completed rollout

| Item                 | Accepted state and evidence                                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First customer       | Justin genuinely approved the terms, amount and standard reminders and paid ₹799. His verified term is 2 October–2 November 2026, ending at 5:54:56 pm IST. See the [opening record](subscription-justin-starter-opening-record.md).                                       |
| Commercial documents | Invoice `UM/2026-27/000001` and receipt `UM-R/2026-27/000001` are issued once and stored privately. Customer delivery is still pending. See the [issuance record](subscription-starter-document-issuance-record.md).                                                       |
| Starter restrictions | Approved standard-reminder-only capabilities and one active branch are enforced. Trials, complimentary, grandfathered manual and exact audited post-refund manual access are preserved. See the [activation record](subscription-starter-capability-activation-record.md). |
| External monitoring  | Public and read-only worker checks are configured on StatusCake Free; a real test alert reached the chosen owner email. The harmless test monitor is paused. See the [watchdog record](production-watchdog.md).                                                            |
| New gym businesses   | The prospective selection policy is active for registrations from the authorized 13:43:55.607014 UTC checkpoint. Selection gives no offer, owner consent, payment or access authority. See the [future-signup record](subscription-starter-future-signups.md).             |
| Provider redelivery  | The human skipped provider-redelivery/support acceptance. Original genuine HTTP 200 logs are retained; authentic repeat/mixed gym–SaaS acceptance remains unproven.                                                                                                        |
| Cleanup              | Merged rollout branches were retired and Billing Staging is paused. Production is independent of the test projects. See the [cleanup record](subscription-cleanup-record.md).                                                                                              |

The selection activation snapshot at 14:15:36 UTC contained zero future gyms.
Use the MFA-admin `platform_admin_starter_signup_queue` for the actual current
queue; do not turn that dated zero into a permanent claim.

## Next actions and ownership

| Action                       | Owner                    | Required next step                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Finish Justin's gym setup    | Rajat / Justin           | Add the actual membership plan and deliver the issued documents through an authorized channel. Do not mark setup complete without the real plan.                                                                                     |
| Prepare Live Starter renewal | Release operator / Rajat | Implement and accept the owner-reviewed renewal path before the 2 November expiry. Keep Live renewal initiation closed until its separate release acceptance.                                                                        |
| Review each new gym          | Rajat                    | Complete actual buyer/setup and supplier/tax/refund-support readiness, then prepare its exact Starter offer. Preserve the normal trial; open only after expiry and genuine authenticated owner review, followed by verified payment. |
| Accept reminder delivery     | Rajat                    | Select a connected, explicitly authorized recipient and the exact Approved/synced template before a real send. Justin's WhatsApp connection/delivery remains deferred by the human.                                                  |
| Review Production hosting    | Rajat                    | Review temporary Supabase Free acceptance by 13 October or its earlier triggers, as recorded in [Production readiness](production-readiness.md).                                                                                     |

Original internal initiation, customer refund initiation, Live renewals, higher
tiers, upgrades, add-ons and native Checkout retain their existing closed gates.
Signed intake, settlement and scoped financial recovery remain available. The
Home office internal refund is not a new customer sale; bank refund-credit proof
remains owner-deferred. Selection is not standing commercial/tax clearance or
permission to message a customer.

## Operating and acceptance references

- [Financial recovery runbook](subscription-financial-recovery-runbook.md): existing obligations, owned exceptions and containment.
- [Customer checkout contract](subscription-starter-customer-checkout.md): operator preparation, actual owner review and scoped opening.
- [Acceptance runner guide](subscription-acceptance-runners.md): local target boundaries, baseline requirements and rollback/concurrency checks.
- [Cloud staging record](subscription-staging-plan.md): preserved historical cloud acceptance; restore the paused current staging target only when needed.
- [Archived rollout sequence](subscription-starter-rollout-history-2026-10-02.md): earlier receipt, closed installation and first-customer disposition observations.

Keep immutable release manifests, receipts, grants and migration history. Neither
this document consolidation nor helper extraction changes a production gate,
payment, customer approval, message or schema.
