# Operate immutable invoice documents

UsefulDesk assigns stable human invoice numbers and creates one immutable non-tax Portable Document Format (PDF) file per persisted invoice. The application can download and share the stored artifact, but WhatsApp delivery remains unavailable until the exact provider contract is Approved and synced.

## Current status and scope

Human invoice identity, Invoice details, document generation, download, and application-side WhatsApp sharing are shipped. Independent verification confirmed these four migrations in the connected UsefulDesk database:

- `20260824235500_immutable_invoice_identity.sql`
- `20260824235600_immutable_invoice_documents.sql`
- `20260825093309_fix_invoice_profile_save_guard_conflict.sql`
- `20260825093752_index_invoice_document_foreign_keys.sql`

The document is a charge snapshot, not a receipt or current balance statement. It excludes payment state, amount paid, balance due, payment method, credits, refunds, and later customer or profile edits.

Every PDF includes this notice: `Non-tax invoice - GST and tax calculations are not included.` Goods and Services Tax (GST) remains outside this release. GST-ready and statutory documents remain deferred. This release does not include GSTIN, HSN/SAC, place of supply, tax rates, CGST, SGST, IGST, reverse charge, e-invoice data, or statutory returns.

## Complete Invoice details before generation

Open **Settings → Payments → Invoice details** before generating the first document. A complete profile requires business name, address line 1, city, and country. Legal name, address line 2, state or region, postal code, phone, and email are optional; a supplied email must be valid.

Admin and owner roles can save Invoice details. Agent and viewer roles can inspect the profile but cannot change it. Until the required fields are complete, billing and human numbering continue, but document actions show `Finish Invoice details in Settings -> Payments first.`

Seller snapshots remain null after backfill until the first complete Invoice details save. That save fills only missing seller snapshots on existing invoices. Later profile edits apply to future invoices and do not rewrite a populated seller snapshot or an existing document.

## Human numbering and identity snapshots

Migration backfill assigns every persisted invoice one account-scoped sequence, a stored number in the form `INV-000001`, and a customer identity snapshot. More than six digits expand naturally. Numbers are allocated transactionally, never reused, and immutable after assignment. Upcoming projections remain numberless because they are not persisted invoices.

The backfill does not invent a seller identity, V1 payload, or document row. Seller identity becomes immutable when the first complete profile save fills a missing invoice seller snapshot.

When generation is reserved, `reserve_invoice_document` authors the immutable V1 `payload_snapshot` and creates or claims the `invoice_documents` row. That database-authored payload freezes the seller, customer, lines, issue date, currency, subtotal, immutable adjustments, and total used by the document. Browser-authored snapshot JSON is not trusted.

Historical backfill orders invoices within each account by `issued_at`, then `created_at`, then `id`. Connected verification found 557 invoices numbered and customer-snapshotted, zero profiles, zero invoice documents, and all 557 seller snapshots still null. This is the expected pre-profile, pre-generation state.

## Authorization matrix

The API, named role predicates, database row-level security, remote procedure calls, and private Storage boundary enforce these roles:

| Operation                    | Viewer | Agent | Admin | Owner |
| ---------------------------- | ------ | ----- | ----- | ----- |
| Inspect Invoice details      | Yes    | Yes   | Yes   | Yes   |
| Save Invoice details         | No     | No    | Yes   | Yes   |
| Download an invoice document | Yes    | Yes   | Yes   | Yes   |
| Share an invoice document    | No     | Yes   | Yes   | Yes   |

The download route resolves the invoice under the selected account before it uses service-role Storage access. The share route applies the same tenant boundary and requires current operational access. A missing invoice and a cross-tenant invoice both return `Invoice not found`.

## Private Storage and immutable reuse

Artifacts live in the private `invoice-documents` bucket at:

`account-<account_id>/<invoice_id>/invoice-<invoice_number>.pdf`

The bucket accepts PDFs only, has a 10 MiB limit, and has no public object policy. Browser roles cannot create, overwrite, or delete document rows or objects.

Generation records a format version, byte count, and lowercase SHA-256 checksum. A ready request downloads the object and verifies both the byte count and checksum before returning it. Every later download or share reuses the same stored bytes and must never regenerate a ready artifact.

The authenticated download route streams `application/pdf` as an attachment and sets `Cache-Control: private, no-store`. It does not create or expose a public URL.

WhatsApp sharing creates a signed URL valid for five minutes so Meta can fetch the document header. UsefulDesk message history stores the stable authenticated document route and does not persist the signed URL.

## Download and share flow

The invoice detail flow owns both actions:

1. **Download invoice** resolves the current-account invoice, reserves or reuses its document row, renders only when no ready object exists, verifies integrity, and streams the attachment.
2. **Send on WhatsApp** checks the customer phone, connected WhatsApp account, exact provider readiness, invoice lifecycle, and refund-review state before it prepares the artifact.
3. The share route signs the private object, sends the exact template through `sendMessageToConversation`, and persists the stable authenticated route.

A viewer can download but cannot share. Agents, admins, and owners can share. A voided or refund-review invoice cannot generate or send a new document. If a ready artifact already exists, authorized staff can still download it for audit. Synthetic upcoming projections expose neither action.

## Exact WhatsApp contract

The registry in `src/lib/whatsapp/template-contracts.ts` contains ten exact template contracts. The invoice entry is:

| Field            | Required value                                              |
| ---------------- | ----------------------------------------------------------- |
| Contract ID      | `invoice_document`                                          |
| Provider name    | `gym_invoice_document`                                      |
| Category         | Utility                                                     |
| Consent scope    | `whatsapp_account_updates`                                  |
| Language         | `en_US`                                                     |
| Parameter format | POSITIONAL                                                  |
| Header           | document header                                             |
| Body parameters  | Customer name, Invoice number, Invoice total, Business name |

The parameter order is load-bearing. Call sites must use the registry and `invoiceDocumentTemplateParams`; they must not reconstruct the provider payload.

A harmless sample for preview and provider review is `Asha`, `INV-000042`, `₹2,500.00`, and `FitZone Gym`. Sample validation does not authorize a submission or message.

The exact `gym_invoice_document`, Utility, `en_US`, POSITIONAL, document-header row is not present, Approved, or synced at the provider. Therefore the application-side share path is shipped, but provider delivery is not ready. No Meta submission or customer send occurred.

Creating or submitting the template requires separate, explicit authorization for the Meta submission. After Meta approval, an authenticated **Sync from Meta** must prove the exact name, language, category, parameter format, and components. A real send requires separate action-time authorization; verification must never send a real customer message.

## Troubleshoot document actions

Use the exact recovery copy shown by the product:

| State                           | Recovery                                                                    |
| ------------------------------- | --------------------------------------------------------------------------- |
| Invoice details incomplete      | `Finish Invoice details in Settings -> Payments first.`                     |
| Customer phone missing          | `Add a phone number before sending on WhatsApp.`                            |
| WhatsApp disconnected           | `Connect WhatsApp in Settings before sending.`                              |
| Invoice template unavailable    | `Approve and sync gym_invoice_document in en_US before sending.`            |
| Another request owns generation | `Invoice document generation is already in progress. Please retry shortly.` |
| Voided invoice                  | `Voided invoices cannot generate documents`                                 |
| Refund review open              | `Resolve the invoice refund review before generating a document`            |

Template readiness requires an exact provider-backed row with Approved status, successful sync, Utility category, `en_US`, POSITIONAL parameters, one document header, and the exact four body parameters. Submission, a local row, or a returned WhatsApp message ID does not prove readiness or delivery.

## Recover immutable artifacts

Generation uses a database lease. A failed or stale lease can be reclaimed, and a failed attempt records a bounded operator-readable error. The service removes a partial object only when it can prove that the current attempt uploaded it and finalization failed.

If ready metadata exists but its object is missing, fail loudly and do not regenerate. Keep the document ID, deterministic path, byte count, and checksum as recovery evidence. Repair or restore the exact object instead of creating different bytes under the same immutable identity.

If the stored byte count or SHA-256 checksum does not match, treat the artifact as corrupt. Do not overwrite it. Later payments, refunds, profile edits, contact edits, and invoice corrections do not change an issued document; future correction work must add a new credit or debit-note document.

## Verification safety boundary

Tests may validate payload construction, use the harmless sample, render local PDFs, and exercise rollback-only or disposable data. They must not submit a template to Meta, select a real customer, or send a customer message. Keep this no-real-send rule in force. Only separate, explicit action-time authorization for one exact send can change it.
