# Starter capability activation — 2 October 2026

Production capability enforcement is active from **13:17:42.414274 UTC**
(6:47:42 pm IST). This is the second accepted rollout step. Justin's paid Starter
snapshot now permits only `standard_renewal_reminders`; custom renewal schedules,
bulk campaigns, configurable automations, gym payment links and new AutoPay
mandates are refused through the existing shared predicate and boundaries.
This does not promise sends before the exact WhatsApp prerequisites are ready.

## Actual roster and preserved access

The fresh Production roster has one current genuine paid Starter: Justin's
fitness, with one active branch, unsuspended access version 5 and the exact
2 October–2 November paid term. No saved custom schedule exists for that branch;
the effective standard defaults are 7/3/1, after 09:00 account-local time. No
unattempted off-schedule membership or service reminder claims were present.

Home office's original internal Starter payment remains fully refunded. Its
later **2 October 02:11:21.066284 UTC** manual activation is genuine: the existing
platform-admin audit attributes `activate` to Rajat and matches current manual
access version 4, ending **1 January 2027 15:39 UTC**. The historical paid term
was ended on refund; this separately administered term must not be mistaken for
that refunded paid grant. No history or access row was altered to accommodate it.

New private predicate `subscription_has_post_refund_manual_term` recognizes only
an active manual term starting after confirmed refund, with a non-null actor's
`activate` audit at exactly that start and matching organization/mode/start/end
and unsuspended after-state. Missing or mismatched audit fails closed. It does
not exempt Justin's genuine current paid Starter. Restored access may retain its
original independently approved term; the ordinary suspended/expired gate still
wins. Browsers/service have no direct execute grant on the private helper.

The seven branch snapshots changed only Justin's six-to-one capability list.
The two trial branches, one complimentary branch, two grandfathered manual
branches and Home office retained all six prior capabilities. Access status,
versions, service dates, branch counts and reminder settings are unchanged.

## Implementation and verification

Source `supabase/migrations/20261002132000_starter_live_capability_activation.sql`,
SHA-256 `9d4afd845f9fab3e031c217e3ca77e3894851e850596c009ae0e9f4c23f7980b`,
is installed through the connector as Production history **20261002131709**.
Installation changed no data or switch. The separately guarded operator update
then changed only `capabilities_enabled`, retaining the exact previously approved
`starter-731-after09-owner-reviewed-20261001-v1` policy. Test billing, advanced
payments and refunds remain false; Live customer renewals/refunds/higher tiers,
add-ons and native Checkout were not opened.

Live Starter active-branch limits now apply when capabilities are active even
while Test billing is closed. Creates/restores share-lock the settings row and
serialize on the organization lock. Activation refuses an over-capacity Starter
roster. Independently audited post-refund manual access remains outside the paid
allowance. Existing Test/trial/complimentary behavior is preserved.

- Rollback/replay acceptance passed Starter matrix, web/native authenticated
  snapshots, custom-write refusal, expiry/refund denial, second-branch create and
  restore refusal, over-capacity activation, and genuine admin-RPC manual-term
  preservation with absent/mismatched-audit denial. Synthetic facts ran only in
  the disposable local database and empty Billing Staging, never Production.
- Real separate-session local acceptance preserves exactly one active branch
  under concurrent creates. Concurrent document suspension and exact retries
  still pass; the generated clone was removed and source remained unchanged.
- Existing full-schema Test capability/schedule/claim/role/grace acceptance passed.
  Focused web/API/UI/send-boundary checks: **229 tests in 14 files**; native access:
  **10 tests in two suites**. The full unchanged application verification earlier
  in this release passed lint/typecheck, 4,354 tests in 531 files and 138-page build.
- Fresh read-only review and its incremental settings-lock/capacity review found
  no actionable issues. Billing Staging final rollback restored zero issues,
  payments/customer reviews and capability activation false.
- Production schema preservation matched all 22 existing relation fingerprints.
  After activation, only the billing-settings fingerprint changed as intended;
  all financial/access/tenant/gym fingerprints matched. The genuine issued pair's
  stored PDF hashes still match. Recovery queue/open exceptions remain zero.

[Post-issuance full backup 37009932872](https://github.com/aarkay1805/UsefulDesk/actions/runs/37009932872)
verified encrypted database and 44 Storage objects / 2,737,820 bytes / five buckets
at **13:04:45 UTC**, before this migration and activation. Export/upload proof
is not a new restore proof. No provider charge, refund, message or customer
approval was generated in this step.

## Remaining ordered acceptance

At the **13:19–13:21 UTC** provider-log review, the live merchant's retained
25 September–2 October listener logs show Justin capture `Tj2SqbXikAc10k` at
**2 October 17:55:00 IST**, plus original internal capture `TicuOgU1G5o30w` and
refund events `TidEP4tclLfJOP` / `TidERzm9Gl5HLh`; all have provider HTTP 200.
Justin's detail panel has no resend control and its response-body display is
`null`; this proves its recorded status, not repeat acceptance. Current
[Razorpay replay documentation](https://razorpay.com/docs/webhooks/replay-events)
explicitly excludes events acknowledged with 2xx in both replay flows. Authentic
same-event redelivery therefore needs provider assistance; no outage, fabricated
signature, direct HTTP replay or fresh charge/refund was used to force it.

Exactly one natural provider-ID SaaS receipt remains at the last check, with no
same-event repeated receipt or gym-classified receipt. The prior genuine gym
Payment Link delivery is historical evidence, not a matching mixed-listener
acceptance run. Do not mark step 3 complete from these observations.

For step 4, [StatusCake Free](https://www.statuscake.com/pricing/) is a suitable
no-cost candidate for small businesses: ten uptime monitors at five-minute
intervals. Its actual free signup page was opened for the owner; no account,
recipient, token, monitor or alert was created. Owner signup/login and explicit
alert email remain requested. Configuration may be prepared while step 3 awaits
provider assistance; widening the customer batch remains ordered after authentic
provider and external-alert acceptance, using only owner-selected organizations.

Rajat subsequently completed free StatusCake signup/sign-in; its free dashboard
is accessible. The exact alert email remains requested before channel/test setup.
He selected “any new gym member who signs up from now on” for rollout; gym business
accounts versus individual gym members is being clarified before implementing
that broader onboarding scope. No new customer preparation/approval was invented.

The human clarified that the new selection covers **every future gym business
account registering for UsefulDesk**, rather than individual gym members. This
supersedes the small named batch and requires a separate onboarding/offer path
with genuine owner review; it does not authorize bypassing trials or recording
future approvals. The exact owner alert email was supplied privately.
