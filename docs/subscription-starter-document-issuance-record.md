# First Starter customer documents — 2 October 2026

**Email send completed — 18:15:19 UTC:** Rajat explicitly approved sending the
original pair to Justin’s registered email. Gmail reports SENT; customer inbox
receipt/reading remain unproven. Old Ambala setup was reviewed as ready at
18:18:05 UTC after Rajat confirmed Justin’s own genuine plan. The dated issuance
checks below remain preserved; see the [setup/delivery record](subscription-justin-setup-delivery-record.md).

Justin's genuine initial subscription sale has one issued ordinary commercial
invoice and one payment receipt. Issuance completed at **12:57:24.866979 UTC**
(6:27:24 pm IST), with actual operator attribution, without impersonating his
owner approval. No document delivery or additional money movement was performed.

| Evidence             | Verified value                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request              | `9e7cdc5f-f287-496a-a3cd-257ecaff6999`                                                                                                                   |
| Issue                | `5bea21ad-70e5-4b70-a7de-8ab74f2c222f`                                                                                                                   |
| Invoice              | `UM/2026-27/000001`; 23,001 final PDF bytes                                                                                                              |
| Receipt              | `UM-R/2026-27/000001`; 23,134 final PDF bytes                                                                                                            |
| Invoice SHA-256      | `af40c3f8f8d2e4d56443ba6ce786f9ae3a017502c849d2a807c7c4110bbb6198`                                                                                       |
| Receipt SHA-256      | `ec45b5b49bf6eb9d07452bee247e1b18c54f1fa8ec68a8eaf1a2618e06c82965`                                                                                       |
| Money / method       | Genuine verified INR 79900, captured UPI payment; fresh provider GET matches original order, captured state and zero refunded amount                     |
| Service              | 2 October 12:24:56 UTC through 2 November 12:24:56 UTC; unchanged paid access version 5                                                                  |
| Exact treatment      | `justin-C01-20261002-v1`; ₹799 total; no separate GST; “GST not charged — supplier unregistered.”                                                        |
| Production migration | `20261002125119`; source `20261002124500_starter_subscription_documents.sql`, SHA-256 `c689f34d6cff21bc0520d6cd46f12edb84666caf7c91ef9b925605fe95b91a52` |

Private supplier/buyer details were reused from the supplied issuer draft and
saved billing profile. Final single-page PDFs passed visual and extracted-text
review against the exact private snapshot. The registry preserves both original
PDF byte arrays, hashes, frozen transaction/party/review facts, actual operator,
issue timestamp and verification reference. Local copies remain in the owner's
private UsefulMade document directory, outside Git. Database `issued_at` is the
issuance authority; PDF filesystem/metadata clocks are not financial evidence.

## Issuance controls and acceptance

`private.subscription_live_document_issues` is RLS-enabled and immutable.
Browsers have no access. Service can select and execute the reviewed issuance
RPC, but cannot directly insert/update/delete/truncate. One global transaction
lock and a unique financial-year sequence allocate both numbers only when the
pair is inserted; failed preparation/issuance consumes no number. Request and
payment uniqueness prevent a second issue. An exact Production retry returned
`already_issued` with the same issue, numbers and hashes. Corrections must retain
the originals and need a separately reviewed correction process.

The candidate requires the genuine customer-sale review, exact approved ordinary
document treatment, verified initial Starter payment, committed matching term,
current matching unsuspended paid access and complete saved billing identity.
Internal Home office, held money and refunded/expired/renewal terms do not qualify.
The final transaction locks mutable access/review/profile facts and rechecks the
entire candidate. Concurrent changes or a stale next-number preview fail closed.
The SQL verifies PDF envelope and hashes; it deliberately does not claim that
these replace the operator's final content/render review.

Local rollback/replay checks passed private authorization, atomic pair issuance,
failed-call numbering, changed facts/bytes, exact retry and financial/access/gym
preservation. A fresh reviewer found a concurrent direct-access-write race;
separate-session acceptance reproduced it, then passed after compatible row
locks were added. Concurrent duplicate calls produce one pair. The generated
local clone was removed; the source database remained unchanged. Billing Staging
connector rollback acceptance passed and restored zero documents/payments/customer
reviews, capabilities false and original initiation closed. Production installation
verified RLS/grants and zero issues before genuine issuance. All **22** existing
relation fingerprints match immediately before/after issuance and its retry.

[Full encrypted backup 37007943428](https://github.com/aarkay1805/UsefulDesk/actions/runs/37007943428)
verified database and 44 Storage objects / 2,737,820 bytes / five buckets at
12:44:28 UTC before the migration. Its checkout cleanup warning did not fail the
backup job. This is an export/upload proof, not a new restore proof. [Post-issuance full backup 37009932872](https://github.com/aarkay1805/UsefulDesk/actions/runs/37009932872)
verified database and the same Storage totals at **13:04:45 UTC**, before
capability migration/activation. It includes the durable issued PDF bytes; this
is not a new restore proof.

## Renewal, refund and delivery ownership

Rajat owns renewal/refund support through `contact@usefulmade.com`. Justin's
initial term ends **2 November, 5:54:56 pm IST**. No automatic debit exists;
later renewal remains separately closed and needs a fresh owner-reviewed quote
and verified payment after expiry. Support must preserve the current term and
must not reset his trial or represent renewal as currently self-service.

The first-payment policy permits a full-refund request through the end of
**9 October in the frozen Asia/Kolkata billing timezone**, payment date as day 0.
Keep the actual received timestamp/evidence, acknowledge within two business
days and initiate an eligible refund within two business days after review.
Provider/bank timing depends on the method. Customer refund initiation remains
closed; an actual refund needs specific human money authorization, original SaaS
payment-rail verification and the existing separately reviewed claim/recovery
process. Pending/failed/partial/unknown results preserve paid access. Only a
verified full processed refund may end access, preserving data/sign-in/support
and linking any later confirmation to these immutable originals.

The original pair was emailed through the explicitly approved channel at
18:15:19 UTC. Send evidence is recorded separately from the immutable issue;
customer inbox receipt/reading remain unproven. Justin’s WhatsApp setup and
messages remain deferred. The later setup review used Justin’s own approved
active plan and pricing; this issuance created no plan or setup-ready stamp.
