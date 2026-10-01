# Subscription release review — preparation only

**Current Production status, 1 October 2026:** PR #21 merged as `71d897a6`;
both reviewed opening/recovery sources are installed and canonical Production
is READY, with financial activation off. The [installation record](subscription-production-install-record.md)
pins actual source/history, backup and preservation evidence. Historical staging
and candidate-review statements below do not override this verified installation.
Actual accounting/opening review and genuine Live capture/refund remain pending.

Reviewed on 30 September 2026. The candidate passed the scoped code review and
local verification below. No application or SQL defect requiring a patch was
identified. This is preparation evidence, not Production installation, opening
authority, a customer sale, or genuine Live provider acceptance.

## Pinned scope and deployed distinction

- Reviewed candidate: `c3031efaf56868470c846ec0a5485dd301dc744e`, branch
  `codex/starter-live-pilot-preparation`.
- Comparison: `5920fa78bfd60d513906616bab86e87ddddd896b..c3031efaf56868470c846ec0a5485dd301dc744e`.
- Recorded deployed baseline: intake-only main
  `5920fa78bfd60d513906616bab86e87ddddd896b`, Production deployment
  `dpl_Hx7CKFZx6YP9iDgwPExBNGCWmTkG` at `desk.usefulmade.com`, per the
  [installation record](subscription-production-install-record.md#approved-intake-only-activation-1615-utc).
  This review did not re-inspect or modify Production.
- Exact proposed initial-term scope: merchant `acc_TCJwBqanN9LTrK`, organization
  `8826d9aa-03f2-4ad7-ae91-0553052131f8`, one active INR branch, Starter
  `79900` minor units gross, 1,800-second quote, one calendar month from signed
  capture, approved 7/3/1 reminder policy after 09:00 local.
- Supplier and selected organization share a proprietor. A controlled payment
  is internal technical acceptance, without a self-invoice or claim of a
  customer sale. Ordinary customer issuance needs its own reviewed buyer,
  geography, registration and document facts.

Subsequent preparation documents are working-tree additions/edits. A final
release SHA containing those documents remains to be pinned before deployment;
the candidate above is the exact code/SQL reviewed here.

## Source pins

SHA-256 is computed from repository file bytes. No provider credential values
appear in these hashes or the validation output.

| Artifact                                                                        | SHA-256                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `supabase/migrations/20260930164040_starter_live_pilot_opening_preparation.sql` | `c2c05979cd04bf7c815a7d22e3d131d6747970ae54cf3de983822f0abecada62` |
| `src/lib/subscriptions/live-provider.ts`                                        | `76df4e2ecc88afac5eda85135ac76f58b62f41a583a961af1887813ae67314db` |
| `scripts/production-env-readiness.mjs`                                          | `7fb42e39ef7740f1760cda4f234febcdb3da998cd9133c63141610339283cdba` |
| `scripts/verify-starter-live-pilot-opening.sql`                                 | `40803d0a7f620914bcc38f54cf1c9e5eeaba2156ecc3b421dd73f8aeea3d9691` |
| `scripts/verify-starter-live-pilot-capabilities.sql`                            | `333856ab9d3dc186884639e319a657d7c238c53f62839e509f16ff29ba5508d6` |

The review's Live migration manifest SHA-256 is
`e24e60ee0012704d07f11bf10a76ff32348e598bc48b92e074303b06359b73f2`.
Its deterministic bytes are the filename-sorted twelve
`supabase/migrations/[digits]_subscription_live_*.sql` baseline files plus the
opening migration, with each line formatted as
`<lowercase SHA-256><two spaces><repository-relative path><LF>` and a final LF.
This scoped review manifest is not a claim that the twelve baselines must be
reapplied to Production; installed migration history must be checked separately.

## Findings and dispositions

| Review item                 | Finding and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact opening boundary      | Preparation inserts no review/offer rows and updates no switches. CHECKs use `COALESCE` to reject null merchant/pilot bindings; insert guards pin Starter economics, term policy, quote duration and the selected organization. Renewals retain their hard-closed constraint. Passed local assertions.                                                                                                                                                                                           |
| Authorization and evidence  | Opening evidence requires a current organization owner on insert and the matching approved offer. Evidence is immutable except one-way revocation. Review selection is pinned after the first quote. Evidence references and release/manifest formats cannot prove their contents; human inspection remains a gate.                                                                                                                                                                              |
| Private ledger writes       | RLS stays enabled; ordinary users have no private ledger access. Service direct DML and TRUNCATE are revoked; SELECT and existing service-only SECURITY DEFINER RPC execution remain. Trigger functions have empty search paths, postgres ownership and revoked direct execute grants. Passed permission/immutability assertions.                                                                                                                                                                |
| Provider binding            | Capture and refund preflight now call `fetchLiveOrder`, verifying the returned order ID equals the saved bound ID in addition to exact receipt/request/organization notes. Changed ID, receipt and request note regressions reject after one GET, before payment GET/refund POST. Passed repository tests.                                                                                                                                                                                       |
| Money initiation and dedupe | Durable order/refund claims precede POST; repeated unbound claims select recovery rather than another POST. Exact first-payment policy and actual request evidence apply to refund review. Current owner transfer remains supported. Passed local opening and baseline race/replay assertions.                                                                                                                                                                                                   |
| Stopping initiation         | Offer/review revocation immediately closes database quote/order/refund/conversion initiation while retaining intake and settlement. Application recovery audit permits only intake/settlement/refund reconciliation and closes both Live UI flags. An application rollback cannot undo provider effects. Passed local shutdown/revocation assertions.                                                                                                                                            |
| Capture after shutdown      | An already bound complimentary conversion capture is durably held for review if conversion initiation has closed; complimentary access remains unchanged. The runner proves that a held capture is preserved. It must not be described as automatically granting access during recovery.                                                                                                                                                                                                         |
| Unknown provider POST       | An unbound order/refund claim still requires an operator-owned approved GET lookup, exact provider verification and durable binding before reconciliation. Initiation endpoints refuse retries when runtime flags are off; there is no automatic recovery API for this case. Accepted limitation requiring an owner/status/next action in the runbook.                                                                                                                                           |
| Audit phases                | Intake-only, first-pilot and recovery-only are mutually exclusive. Pilot/recovery require exact merchant/pilot, visible Live identities and literal required flag values. Test/acceptance/renewal/capability switches, opaque safety flags, partial scopes and malformed values remain blocked. Missing system runtime exports and hidden secrets remain explicit independent verification warnings.                                                                                             |
| Capabilities and access     | Candidate leaves global capabilities closed. Separate rollback fixtures show valid nonpilot manual/trial/complimentary access unchanged; paid Starter only receives standard reminders, with custom schedule writes refused, and expiry/full processed refund revoke paid capabilities. Synthetic clock alignment is restored and is not provider evidence.                                                                                                                                      |
| Cloud fixture identity      | The earlier opening record named `c2d6b0215339aba403910b10681b3b657cfe0124e0256fd1806458049209f953` for historical cloud execution. Those historical bytes were not reproduced. Disposition: root executed the freshly hashed current payload through the approved staging connector at approximately 17:45 UTC; all assertions passed and the 17:46:07 UTC postcheck proved empty/off state. Current exact-source proof is closed; historical and current executions remain separately labeled. |

## Actual validation

These commands were executed locally once for this review, with exit code 0.
The explicitly selected container was the existing disposable full-schema
`supabase_db_usefuldesk-subscription-full-bo1rg7p0`; none reads a cloud dotenv or
calls a real payment provider.

| Command                                                                                                    | Result                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/verify-starter-live-pilot-opening.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0`     | Six assertion sections passed, including capability/access expiry/refund checks; opening migration replayed twice; twelve Live baseline migrations plus preparation rolled back; no Live tables remained.                          |
| `node scripts/verify-subscription-live-full.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0`         | All three existing boundary, renewal and complimentary suites passed independently; twelve draft migrations rolled back; no Live schema remained.                                                                                  |
| `node scripts/verify-subscription-capabilities-full.mjs supabase_db_usefuldesk-subscription-full-bo1rg7p0` | Capability, transaction hooks, schedule/claim retirement, role isolation and grace checks passed; baseline settings and account/user counts restored.                                                                              |
| `npm run verify`                                                                                           | ESLint, TypeScript, 4,183 tests in 522 files and optimized Production build passed; 133 pages generated. Completed 30 September at 17:44 UTC. Test output contained the existing jsdom `Window.scrollTo()` notice; no test failed. |

Local logs: `/tmp/usefuldesk-release-review-opening.log`,
`/tmp/usefuldesk-release-review-live-full.log`,
`/tmp/usefuldesk-release-review-capabilities.log` and
`/tmp/usefuldesk-release-review-verify.log`. These are transient review artifacts,
not durable provider acceptance records.

The current assembled opening/capability fixture, with psql meta-command lines
removed, hashes to
`384c0bdc331f98cf35f9176c3c82aac1c2f7debdb1a322c34df6f2db4d146ebf`.
The explicit `BEGIN; SET LOCAL client_min_messages=warning; … ROLLBACK;`
payload is `/tmp/usefuldesk-release-review-cloud-opening.sql`, 37,499 bytes,
SHA-256 `a9bd010e4d58b74cbabf97c34302fa0129a991f1c1f3c3cd17d6a9547764f0f9`.
It has zero psql meta commands and is intended only for the installed closed
candidate on verified empty `UsefulDesk Billing Staging`
(`otagotpezshybxkagtwv`). Root executed those exact payload bytes through the
approved staging SQL connector at approximately 17:45 UTC. The final result was
`PASS: approval/review revocation, policy-bound first refund, GET recovery after
shutdown, processed refund and TRUNCATE denial`; the complete fixture succeeded.

Root's postcheck at 17:46:07 UTC proved zero Auth users, accounts, organizations,
offers, opening reviews, quotes, orders, payments, refunds, events and grants;
all Live/Test/capability switches false, merchant/pilot/review bindings null,
zero active cron jobs and the grant-freeze trigger enabled (`O`). The staging
connector did not install or activate anything in Production. See the
[rollout preflight](subscription-rollout-preflight.md) for the coordinated
evidence record. This reviewer did not itself execute a cloud operation.

## Remaining real gates

1. Pin the final release SHA and migration manifest, refresh backup/restore,
   installed-schema, deployment, secret-blind environment, provider preflight,
   exact shared-merchant routing and scheduler evidence, then obtain explicit
   Production installation/opening approval for that package. Passing an
   environment audit is not approval.
2. Obtain Approved/synced canonical `gym_membership_renewal` readiness and a
   specifically authorized acceptance recipient before actual delivery.
   Submission/In review or prior deliveries of an older contract are not proof.
3. Select actual owner-reviewed immutable offer/opening evidence and the precise
   internal acceptance classification, tax/receipt consequences, access
   consequences and flags. No review/offer is seeded by this preparation.
4. A human completes any authorized real payment; prove bound order/receipt,
   signed capture, provider GET facts, durable dedupe, calendar term/access and
   shared gym-route isolation. Test/local/staging samples cannot close this gate.
5. Present and approve the exact original-payment full-refund request, amount,
   request time, policy and access effects before initiation; prove processed
   provider facts, signed delivery, dedupe and access termination. Close unknown
   POST effects through the approved recovery path with an owner and next action.

Broader rollout, native Checkout changes, advanced add-ons, renewals and global
capability activation remain separate scope. No Production mutation, money
movement, switch/offer activation, external message, commit or push was performed
by this review.

## Follow-on recovery candidate, 1 October IST / 30 September UTC

The historical review above pins `c3031efa`; it does not cover the later recovery
code. The follow-on candidate adds default-off original-claim GET recovery,
missing-webhook refund polling, fixed one-item checks in both ops pingers, durable
hold reasons and owned append-only exception review. Independent review identified
and fixed nonterminal lease-completion semantics and stranded queue metadata
after canonical binding/refund crash or webhook races. Final cron output retains
only aggregate counters for public logs. See the
[exact recovery acceptance record](subscription-financial-recovery-acceptance.md)
for source/fixture hashes, isolated staging installation, concurrency and fresh
Production preservation. No current money/access decision was weakened; held
financial outcomes still need individual review. The historical manual recovery
limitations are replaced only when this follow-on release/schema are installed
and its dedicated recovery gate is separately enabled.
