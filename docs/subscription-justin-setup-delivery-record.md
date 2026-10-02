# Justin gym setup and subscription document email — 2 October 2026

**Completed:** Old Ambala setup was reviewed at **18:18:05.211868 UTC /
11:48:05 pm IST**. The original issued subscription invoice and receipt were
sent to Justin's registered email at **18:15:19 UTC / 11:45:19 pm IST** after
Rajat explicitly approved the prepared Gmail draft. Gmail reports `SENT`;
customer inbox receipt and reading have not been established. WhatsApp remains
human-deferred.

## Genuine plan and configuration

Fresh inspection found the plan that Justin had already created at
**17:53:55 UTC**. Rajat confirmed in this chat: **“These were added by Justin
and approved by Justin.”** No plan or pricing option was created or changed by
this operator work.

| Item                   | Verified state                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Organization           | Justin’s fitness `4c549182-7ad3-4f0b-8977-ff8ca79d2992`                                               |
| Branch                 | Old Ambala `ffca6ffb-691b-4fa9-9b7f-481a22d00a2e`; active                                             |
| Legal entity           | Justin Credible Fitness; INR                                                                          |
| Regional configuration | India; `en-IN`; `Asia/Kolkata`; DMY; 12-hour time; Monday week start; metric                          |
| Plan                   | Standard `a17419b7-4360-4ce9-944f-910dda1fb79b`; active recurring membership                          |
| Active pricing         | 1 calendar month ₹1,000; 3 calendar months ₹2,700; 12 calendar months ₹9,000; ₹0 joining fee for each |
| Readiness              | `ready`; non-null review timestamp; active plan with active pricing                                   |
| Review attribution     | Rajat `94b588be-e996-47ec-9372-4a6e8bff8dc8`, as explicitly authorized delegated operator             |
| Setup audit            | `407b83dc-ecc7-4ba0-8813-90523494b321`; `branch.setup_completed_by_operator`                          |

The configured pricing uses calendar months. The plan's legacy `duration_days=30`
does not turn its one-month pricing option into an invented 30-day offer.
UPI collection details are absent and optional for this setup prerequisite.
WhatsApp has zero configuration rows and remains deferred; the setup stamp
does not establish reminder delivery readiness.

The authenticated branch-admin completion API already exists. Rajat has no
membership in Justin's branch, so this one-time delegated database operation
records its actual operator separately. It did not impersonate Justin's Auth
session, grant a branch role, change an API/RLS policy, or add a reusable bypass.
The guarded operator transaction remains in the owner's private document
directory, alongside its rollback and committed evidence.

## Original documents and authorized email

The issue remains `5bea21ad-70e5-4b70-a7de-8ab74f2c222f`, originally issued at
**12:57:24.866979 UTC**. The original pair, including its frozen buyer identity,
numbers, bytes, hashes and term, was preserved. Justin's registered email
differs from the frozen buyer email. Rajat explicitly selected the registered
email for delivery; that selection did not amend the documents.

| Attachment                                   |  Bytes | SHA-256                                                            |
| -------------------------------------------- | -----: | ------------------------------------------------------------------ |
| `UsefulMade-Invoice-UM-2026-27-000001.pdf`   | 23,001 | `af40c3f8f8d2e4d56443ba6ce786f9ae3a017502c849d2a807c7c4110bbb6198` |
| `UsefulMade-Receipt-UM-R-2026-27-000001.pdf` | 23,134 | `ec45b5b49bf6eb9d07452bee247e1b18c54f1fa8ec68a8eaf1a2618e06c82965` |

The saved Gmail draft's MIME attachment bytes matched those hashes before
sending. Rajat then selected **“Send this email”** for the exact recipient,
sender, reply address, subject and original pair. The sent message read-back
confirmed its `SENT` label, headers, both filenames and byte lengths. The sent
message’s raw MIME also passed both attachment hashes and is preserved privately
as `sent-subscription-documents.eml`. Exact email addresses and the private MIME
evidence remain outside Git.

- Sender: Rajat's connected Gmail account; recipient: Justin's registered email;
  Reply-To: `contact@usefulmade.com`; no Cc or Bcc.
- Subject: **Your UsefulDesk Starter invoice and payment receipt**.
- Body: original invoice `UM/2026-27/000001` and receipt `UM-R/2026-27/000001`,
  ₹799 received by UPI, and the existing term from 2 October to 2 November 2026,
  both at 5:54:56 pm IST, with the existing support contact.
- Gmail message `1a0fdd3ee797011e`; thread `1a0fdd2674a1be85`.
- Send audit `5e711ed2-82d3-4d58-b84d-aeed8fa2c9c1`;
  `subscription.documents_sent` stores authorization and evidence separately
  from the immutable issue ledger.

## Verification and remaining work

The setup/send-record transaction passed a rollback rehearsal. An intentionally
mismatched approved price failed closed; a fresh read verified no readiness
stamp or audit survived either rehearsal. The authorized commit then passed
all **28** relation fingerprints, excluding only this branch's permitted
readiness/reviewer/timestamp fields and its normal `updated_at`. The two
explicit audit additions were separately checked. An exact retry preserved
the same readiness timestamp and audit IDs without another update or record.

The read-only operator query
[`subscription-justin-setup-delivery-status.sql`](../scripts/subscription-justin-setup-delivery-status.sql)
rechecks setup, actual pricing, document checksums, saved send evidence,
registered-recipient match, WhatsApp configuration count and access. Its
Production acceptance returned `setup_complete=true`, one original document
pair and one email-send record. It returns no PDF bytes, addresses or secrets;
saved send evidence does not query Gmail or prove customer reading.

Main preserved both histories by merging remote invoice recovery into the
local closed-renewal implementation (`ba3134c2`). On the merged source,
**537 files / 4,403 tests, lint, typecheck, Production build and isolated invoice
handler bundle acceptance passed**.
Existing branch-setup, document-immutability and renewal tests remain intact;
this step adds no app behavior or schema migration.

Justin's paid access remains unsuspended, version 5, through
**2 November 2026 at 5:54:56 pm IST**. This work initiated no payment/refund or
renewal, changed no runtime gate, and sent no WhatsApp message. There is no
remaining plan or document-send blocker for step 2. Customer acknowledgment,
optional UPI configuration and human-deferred WhatsApp setup are separate
operator/customer actions. Live renewal still needs the separate
[closed-release acceptance](subscription-starter-renewal-release.md).
