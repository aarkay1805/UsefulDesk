# Subscription rollout preparation — refreshed evidence

**Checked 30 September 2026, 23:20 IST (17:50 UTC). Production is intake-only.**
This record completes the read-only preparation work; it grants no financial,
deployment, migration, messaging or access activation authority. Refresh the
time-sensitive checks at the actual opening. Primary incident/recovery owner:
Rajat Kashyap.

## Completed preparation package

| Work                       | Reviewable result                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release review             | [Pinned source review](subscription-release-review.md); no code defects found; required repository checks and local rollback runners passed.                            |
| Operational refresh        | Deployment, Production-only environment audit, database/access preservation, RLS, primary workers and backup evidence below.                                            |
| Financial recovery         | [Operator runbook](subscription-financial-recovery-runbook.md), including uncertain-effect binding and implementation limits.                                           |
| Controlled Live acceptance | [Walkthrough](subscription-live-acceptance-walkthrough.md) with review, human payment, signed capture/refund and isolation evidence requirements. No Live run occurred. |
| Current documentation      | Readiness, Live boundary, staging, offer, opening review and subscription PRD now separate current state from historical pre-installation checks.                       |
| Customer documents         | [Unissued invoice/receipt/refund packet](subscription-customer-document-pack.md); outstanding buyer/issuer facts stay explicit.                                         |

## Release and current deployment

- Canonical `desk.usefulmade.com` resolves to READY Production
  `dpl_Hx7CKFZx6YP9iDgwPExBNGCWmTkG`, exact main
  `5920fa78bfd60d513906616bab86e87ddddd896b`, checked through Vercel at
  17:41 UTC. The public login returned HTTP 200 in 0.27 seconds at 17:40 UTC.
- [PR #21](https://github.com/aarkay1805/UsefulDesk/pull/21) remains open and
  mergeable with candidate `c3031efaf56868470c846ec0a5485dd301dc744e`.
  [CI](https://github.com/aarkay1805/UsefulDesk/actions/runs/36748213794),
  [CodeQL](https://github.com/aarkay1805/UsefulDesk/actions/runs/36748206742)
  and Vercel checks succeeded for that exact candidate. The candidate is not
  the deployed Production release. Subsequent local preparation documents
  do not establish a new deployed SHA.
- Vercel's grouped Production runtime-error query returned no errors in its
  selected one-hour range at 17:42 UTC. This is bounded telemetry, not proof
  that every request or provider path succeeded.

## Production-only environment audit

At 17:44 UTC an isolated environment export targeted the known UsefulDesk
project/team and **Production only**, then ran
`node scripts/production-env-readiness.mjs --dotenv-stdin --allow-live-intake-only`.
It returned **zero blockers and five warnings**. The private 0600 export and
0700 temporary directory were deleted. No secret value was printed and no
local `.env.local` values were substituted for the export.

The warnings describe provider-hidden canonical URL/encryption-key values,
provider-hidden Live secrets, deliberate intake-only operation, and absent
Turnstile. The original canonical URL/key-format attestation and prior private
secret setup remain the recorded evidence; this export cannot independently
reveal those values. Public lead-form submissions fail closed without Turnstile.
The audit permits only Live intake; every other safety/Test/money/UI flag was
false or unset. An audit pass does not authorize opening a gate.

## Production database preservation

The reusable [read-only SQL](../scripts/subscription-rollout-preflight.sql) ran
successfully through the approved connector on `fwqthstqrkrwtaehefks` at
17:50:44 UTC. It returned:

| Fact                                                 | Result                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Auth users / accounts / organizations / gym payments | 8 / 6 / 5 / 554; unchanged from installed baseline.                                     |
| Organization access modes                            | One manual, two trial, two complimentary; no paid grants.                               |
| Live merchant / pilot                                | Existing approved exact binding retained.                                               |
| Live gates                                           | Intake true; quote/order/refund/settlement/renewal/complimentary conversion false.      |
| Test/capability/advanced/policy gates                | False; reminder policy unset; no Test merchant.                                         |
| Live financial/event/offer records                   | Quotes, orders, payments, refunds, events, grants, offers and refund reviews all zero.  |
| Candidate opening-review table                       | Absent from Production, confirming candidate migration is not installed there.          |
| Installed Live private tables                        | All ten have RLS; anon/authenticated SELECT and INSERT/UPDATE/DELETE privileges denied. |
| Database cron                                        | Both established jobs active, schedules unchanged.                                      |

Aggregate content hashes were identical at 17:47 and 17:50 UTC:

| Aggregate      | MD5 drift fingerprint              |
| -------------- | ---------------------------------- |
| Accounts       | `4e9261d4fe6dad606691c2a8458199f8` |
| Organizations  | `811505278063f66b442dbf7fdb6844eb` |
| Legal entities | `5e5ef2ddb79af1816cb905381bc95dbf` |
| Product access | `81afb08043fff0d87f00567efb4046f1` |

These are current drift baselines, not cryptographic backup or historical
same-content proof beyond this checked interval. No raw customer rows were
exported. The counts also match the earlier installation record.

## Schedulers and recovery point

Primary Supabase ops at **17:38 UTC** and renewals at **17:41 UTC** returned
HTTP 200, `failed: 0`, no timeout. All eight latest retained HTTP results were
200 with no timeout/error. The renewal worker's durable reminders response
included one deferred item and zero attempts; a healthy aggregate does not
claim that deferred work was delivered. No cron was manually invoked.

GitHub workflows are active. Their last successful **scheduled** runs at this
check were ops [36733315946](https://github.com/aarkay1805/UsefulDesk/actions/runs/36733315946)
at 14:59 UTC, renewals [36741691005](https://github.com/aarkay1805/UsefulDesk/actions/runs/36741691005)
at 16:05 UTC, and nightly backup
[36647153210](https://github.com/aarkay1805/UsefulDesk/actions/runs/36647153210)
at 29 September 23:48 UTC. Ops exceeded its 75-minute redundant-schedule limit;
renewals and nightly backup remained within their 120-minute/30-hour limits.
The latest scheduled public health run was 13:02 UTC; the later 16:15 UTC health
success was a manual dispatch and is not natural-schedule freshness proof.

**Owned operational exception:** late GitHub redundant ops/public-health
schedules, SEV-3 while the primary database paths and current public login are
healthy. Owner Rajat; next action inspect the next natural Actions run and
refresh at opening. A manual dispatch cannot repair the natural-schedule evidence
gap. If both execution paths miss their windows, apply the escalation thresholds
in the [production runbook](production-runbook.md). No scheduler settings were
changed and no external watchdog was enrolled.

The pre-installation full backup
[36714071889](https://github.com/aarkay1805/UsefulDesk/actions/runs/36714071889)
succeeded; its existing log contains both encrypted database and Storage
verification markers. The nightly backup also passed its export/encrypt/upload/
verify job. This refresh checked metadata and redacted verification markers,
not a new restore drill. Refresh the backup before the separately approved
Production candidate installation/opening.

## Exact-source staging evidence refresh

The earlier 16:50 UTC record names fixture hash `c2d6b021…`; that payload's exact
bytes were not reproduced from the current pinned source. It remains historical
evidence. To close the current-source comparison, the reviewed current opening
and capability fixture was assembled, psql meta-commands removed, and wrapped
in explicit `BEGIN/ROLLBACK` with no provider calls.

- SQL payload, 37,499 bytes:
  `a9bd010e4d58b74cbabf97c34302fa0129a991f1c1f3c3cd17d6a9547764f0f9`.
- Stripped fixture:
  `384c0bdc331f98cf35f9176c3c82aac1c2f7debdb1a322c34df6f2db4d146ebf`.
- Approved staging connector execution on `otagotpezshybxkagtwv` at approximately
  17:45 UTC passed all assertions, ending with the approval/review revocation,
  first refund, GET recovery after shutdown, processed refund and TRUNCATE-denial
  PASS result. This was synthetic SQL, not provider/payment evidence.
- Before and after: zero users/accounts/organizations/offers/reviews/quotes/
  orders/payments/refunds/events/grants, no active cron, null merchant/pilot/review
  bindings and all switches off. The postcheck at 17:46:07 UTC also confirms the
  immutable-grant trigger restored/enabled (`O`). Nothing persisted.

## Remaining external and consequential boundaries

Meta template approval/sync and authorized real delivery remain pending.
Candidate Production installation/release/opening approval, authentic immutable
offer/review references and controlled Live capture/refund/shared-route acceptance
also remain pending. The runbooks document manual gaps instead of pretending
that unbound claims, held payments or missing pending-refund events recover
automatically.

Vercel invoice `GQBCLHWV-0001` was refreshed read-only at approximately 17:45 UTC:
still **Open / Payment failed**, US$23.60, including US$3.60 tax, while the owner
previously reported payment. Keep it as a reconciliation exception; no duplicate
charge or support message was initiated. The owner instruction allows independent
preparation to continue. No bank settlement proof is available in this package.

Home office is internal proprietor acceptance, with no self-invoice or customer
sale. Final genuine-buyer facts and issuer treatment remain required before an
actual customer offer or invoice; see the customer document packet. Native
Checkout, renewals, paid add-ons and global capability activation remain separate
scope. None of these preparation results opens Production billing.
