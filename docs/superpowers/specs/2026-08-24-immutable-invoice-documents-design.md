# Immutable invoice identity and non-tax document sharing

> Status: draft for written review
> Date: 2026-08-24
> Scope: human invoice numbering, configurable invoice identity, immutable non-tax PDF documents, download, and WhatsApp sharing

## Decision

Ship the pending Phase 3 invoice-document foundation without pulling GST into the release. Every persisted invoice receives one immutable, account-scoped human number. A branch configures the seller identity used on its documents, invoices snapshot seller and customer identity, and a server-only document pipeline generates one private, checksummed PDF artifact per invoice. Account members may download it; agents and above may share it through an exact Approved/synced WhatsApp Utility template.

This release is deliberately a non-tax invoice release. It must not calculate or display GST, CGST, SGST, IGST, tax rates, HSN/SAC codes, place of supply, reverse charge, e-invoice identifiers, or statutory-return data.

## Product outcomes

- A gym can quote a stable invoice number in person, in WhatsApp, and in support conversations.
- A member receives the same document every time it is downloaded or shared.
- Editing branch invoice details never rewrites a historical document.
- The feature uses the existing generic invoice ledger; it does not create a parallel billing model.
- WhatsApp remains an operational delivery channel, while Business -> Invoices remains the account-wide discovery surface.

## Non-goals

- GST-ready or statutory tax invoices
- Tax configuration or inclusive/exclusive tax pricing
- Credit notes, debit notes, or e-invoice integration
- Payment receipts or live payment-status documents
- Custom invoice-number formats, fiscal-year resets, or cross-branch sequences
- Customer/member self-service document portals
- Replacing Business -> Invoices, member billing, or the existing payment ledger

## User experience

### Settings -> Payments -> Invoice details

Add one `Invoice details` card to the existing Payments settings panel. It reuses `Card`, `Input`, `Label`, `Button`/`GatedButton`, and the established settings loading, recovery, read-only, and save patterns. No shared `src/components/ui/` master changes are required.

Fields:

- Business name - required; prefilled from the current branch name.
- Legal name - optional; prefilled from the branch legal entity when available.
- Address line 1 - required.
- Address line 2 - optional.
- City - required.
- State / region - optional in this non-tax phase.
- Postal code - optional.
- Country - required; prefilled from the account country preset.
- Phone - optional and rendered as an ordinary business identifier input, not `PhoneInput`.
- Email - optional and syntactically validated.

Admin/owner can save. Agent/viewer can inspect the configured values but receives the normal read-only gate. The first complete save also finalizes seller snapshots for invoices that still have no seller snapshot. Later edits affect only future invoices.

Until the profile is complete, billing continues normally. Invoice download and WhatsApp actions remain disabled with the reason `Finish Invoice details in Settings -> Payments first.`

### Invoice discovery and detail

The immutable human number becomes the primary invoice label across:

- Business -> Invoices desktop table and responsive cards;
- invoice detail;
- member and service-customer billing lists;
- search, sorting, and CSV export;
- payment-link and template presentation;
- WhatsApp invoice parameters.

The internal UUID remains available only in technical support data and as the database identity. It is not presented as a second competing invoice number.

`InvoiceDetailDialog` adds:

- `Download invoice` for every branch member;
- `Send on WhatsApp` for agent+ when the customer has a phone, WhatsApp is connected, the document is ready or generatable, and the exact template contract is Approved/synced.

The actions use existing Button/GatedButton behavior, including in-control pending feedback and actionable disabled reasons. The invoice table does not gain more row-action clutter; document actions live in the shared detail flow.

Upcoming projections remain numberless and cannot open document actions. A voided invoice may expose an already-created artifact to authorized staff for audit, but it cannot generate or send a new customer document. An unresolved refund-review invoice cannot generate or send a document.

## PDF visual design

The supplied Figma invoice is loose visual inspiration, not a component or content specification. UsefulDesk adopts the useful hierarchy while removing SaaS-shipping and tax-specific content:

- A4 portrait page with generous margins and whitespace.
- Large `Invoice` title with compact number and issue-date metadata beneath it.
- Seller and `Bill to` blocks in two columns on wider page space; they stack cleanly when content is long.
- A prominent immutable `Invoice total` headline rather than a live `Amount due` claim.
- A restrained line-item table: description and service/billing period, quantity, unit price, and amount.
- A right-aligned totals block with subtotal, immutable invoice adjustments when present, and invoice total.
- Quiet monochrome rules, high-contrast type, and no account-accent dependency so printing remains dependable.
- Repeated table headers, controlled row splitting, and `Page N of M` on multi-page invoices.
- A footer stating `Non-tax invoice - GST and tax calculations are not included.`

There is no `Ship to` block, gym/customer GSTIN, HSN/SAC data, tax summary, payment state, amount paid, balance due, payment method, or receipt claim. Those facts either do not apply or can change after invoice issue. The PDF snapshots charge facts only.

Use a bundled Unicode-capable Noto Sans font so Indian-script and other non-ASCII customer/business names do not degrade to missing glyphs. PDF generation is server-only and verified by rendering the resulting pages to images.

## Data model

### `invoice_profiles`

One account-scoped profile per branch:

- `account_id` primary key and FK to `accounts`;
- the fields listed in the settings section;
- `is_complete`, derived or database-maintained from the required fields;
- `created_at`, `updated_at`, `updated_by`.

RLS allows every current account member to select. Writes go through a database-authoritative admin+ RPC so saving a profile and finalizing missing invoice snapshots occur in one transaction. Direct browser insert/update/delete is not a second path.

### `account_invoice_number_counters`

One private counter row per account:

- `account_id` primary key;
- `last_value` positive bigint;
- `updated_at`.

Browser roles receive no direct table access. Invoice-number allocation locks/upserts this row transactionally.

### `invoices` additions

- `invoice_sequence BIGINT`;
- `invoice_number TEXT`;
- `seller_snapshot JSONB`;
- `customer_snapshot JSONB`;
- `identity_snapshot_version INTEGER`.

`invoice_number` uses the neutral stored format `INV-000001`, is unique within `account_id`, and has no fiscal-year or branch-name encoding. More than six digits expand naturally. The sequence and display string are both stored and immutable.

`seller_snapshot` contains business/legal name, branch name, structured address, phone, and email. `customer_snapshot` contains customer name, phone, email, structured address, and Member ID when applicable. Snapshot JSON is versioned, object-shaped, and validated by the database-authoritative construction functions; browser-authored JSON is never trusted.

An immutable-identity trigger rejects changes to invoice sequence, number, seller snapshot, customer snapshot, or snapshot version once populated. It still permits the existing append-preserving lifecycle and link-invalidation behavior outside those columns.

### `invoice_documents`

One document record per invoice:

- `id`, `account_id`, `invoice_id` with unique `invoice_id`;
- `status: generating | ready | failed`;
- database-authored `payload_snapshot JSONB`;
- deterministic private `storage_path`;
- `sha256`, `byte_count`, `format_version`;
- generation lease/token and expiry fields;
- `generated_at`, `generated_by`, `last_error`, timestamps.

Members may read metadata through account RLS. Browser roles cannot insert, update, delete, or overwrite document records or Storage objects. Server-only reserve/finalize/fail operations own state transitions.

### Private Storage

Create a private `invoice-documents` bucket with a bounded PDF size and deterministic paths:

`account-<account_id>/<invoice_id>/invoice-<invoice_number>.pdf`

The object is never public and never overwritten. Downloads are streamed by an authenticated route. WhatsApp receives a short-lived signed URL only for Meta's immediate fetch.

## Numbering and snapshot lifecycle

### Migration backfill

For each account, existing persisted invoices are ordered by:

1. `issued_at` ascending;
2. `created_at` ascending;
3. `id` ascending.

They receive sequences starting at one and stored `INV-` numbers. The counter is then set to that account's maximum. Customer snapshots are built deterministically from existing invoice snapshots plus the current contact only where legacy invoice facts are absent.

Existing invoices initially have no seller snapshot unless a complete invoice profile can be constructed from already-configured data. The first complete Invoice details save fills only `seller_snapshot IS NULL` rows. This is the sole controlled legacy-finalization path. It never replaces a non-null snapshot.

### New invoices

A `BEFORE INSERT` trigger:

1. allocates the next account sequence under a row lock;
2. stores the formatted number;
3. builds the customer snapshot from trusted invoice/contact/membership facts;
4. copies the current complete invoice profile into the seller snapshot, otherwise leaves it null;
5. stamps the snapshot version.

This keeps every existing checkout, renewal, import, plan-change, service, and adjustment path on the same invoice identity boundary without duplicating allocation logic in their RPCs.

Numbers are allocated even when Invoice details are incomplete. They are never reused after voiding or deletion of related customer data. Upcoming projections are TypeScript-only and never enter this allocator.

## Immutable document pipeline

`reserve_invoice_document(invoice_id)` is the database-authoritative gate. It verifies account membership, persisted/open invoice state, no refund-review hold, human number, complete seller/customer snapshots, and at least one documentable charge fact. It then:

- returns the existing ready artifact;
- returns a live generating state for a concurrent caller; or
- claims a new/stale/failed generation lease and stores the exact payload snapshot used by the renderer.

The payload contains invoice number, issue date, currency, seller/customer snapshots, active line snapshots, gross subtotal, immutable invoice adjustments already present, and final invoice total. It excludes payments, credits, refunds, balance, and every live membership/contact field.

The server renderer turns that payload into PDF bytes, calculates SHA-256 and byte count, uploads once to the deterministic private path, and calls a token-bound finalize operation. On failure it removes a partial object when safe and records a bounded operator-readable error, leaving the document retryable. A stale lease can be reclaimed. A concurrent request never overwrites an artifact.

Once ready, every download and share reuses the same object and checksum. Later payments, refunds, profile edits, contact edits, or invoice corrections do not rewrite it. Later GST work must add credit/debit-note documents rather than mutate this artifact.

## API boundaries

### `GET /api/invoices/[invoiceId]/document`

- Requires authenticated membership in the selected branch and the named download capability.
- Resolves the invoice under account scope before any service-role Storage work.
- Returns the existing artifact or synchronously generates/finalizes the first artifact.
- Streams `application/pdf` with an attachment filename based on the human invoice number.
- Uses `Cache-Control: private, no-store` at the authenticated HTTP boundary.

### `POST /api/invoices/[invoiceId]/share`

- Requires authenticated operational access and the named agent+ share capability.
- Verifies current-branch invoice, current contact phone, WhatsApp connection, exact template readiness, and share-eligible invoice/document state.
- Ensures the immutable artifact exists.
- Creates a short-lived signed Storage URL for Meta and calls `sendMessageToConversation` rather than duplicating conversation/send persistence.
- Sends the exact document-header template parameters.
- Persists the stable authenticated document route in UsefulDesk message history, not the expiring provider URL. The shared send core gains a narrowly scoped persisted-media override for this server-owned case.

Responses use the established `{ error }` shape and `getErrorMessage` at the client. Cross-tenant and missing resources do not reveal which condition failed.

## WhatsApp contract

Add a tenth exact registry contract:

- ID: `invoice_document`
- Provider name: `gym_invoice_document`
- Category: Utility
- Consent scope: `whatsapp_account_updates`
- Header: document
- Body parameters: customer name, invoice number, invoice total, business name
- Trigger: explicit `Send on WhatsApp` from an eligible persisted invoice

Proposed body:

`Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.`

The template gallery, payload validation, documentation contract, readiness checks, send presentation, and tests use this one registry source. The button remains disabled until the exact `en_US` row is connected and Approved/synced. Code completion does not authorize a Meta submission or a real customer send.

## Authorization

Add and test named predicates in `src/lib/auth/roles.ts`:

- `canManageInvoiceProfile`: admin+;
- `canDownloadInvoiceDocuments`: viewer+;
- `canShareInvoiceDocuments`: agent+.

Database/RPC/API guards mirror these capabilities. Call sites do not inline role comparisons. Invoice-profile writes and document state writes return concrete rows/results; RLS-blocked zero-row writes are failures, not success.

## Error and recovery behavior

- Incomplete profile: conflict with a direct Settings -> Payments recovery path.
- Missing customer phone: disable WhatsApp with `Add a phone number before sending on WhatsApp.`
- WhatsApp disconnected or template unavailable: retain Download and explain the exact setup action.
- Generating concurrently: show the pressed action pending; a second request receives a retryable preparation response and may retry without creating another artifact.
- Render/upload failure: no ready metadata, no silently accepted partial artifact, and a retryable bounded error.
- Voided/refund-review invoice: no new generation or send. An existing ready artifact remains downloadable for authorized audit.
- Cross-tenant/missing invoice: generic not-found response.
- Storage object missing despite ready metadata: fail loudly and retain the checksum/path evidence; do not silently generate a different artifact over the same identity.

## Testing and acceptance

### Database and migration

- Deterministic multi-account backfill ordering.
- Counter starts after each account's backfill maximum.
- Concurrent allocations remain unique and gap reuse is impossible.
- Upcoming projections have no persistence path.
- First complete profile save fills only null seller snapshots.
- Later profile changes leave historical snapshots unchanged.
- Identity mutation attempts fail.
- RLS and RPC role/tenant matrices cover owner, admin, agent, viewer, and a different account.
- Document reserve/finalize/fail lease transitions are idempotent and token-bound.

### TypeScript and UI

- Human invoice display/search/sort/CSV behavior.
- Invoice profile validation, load/retry/read-only/save behavior.
- Download/share capability gates and readiness reasons.
- Document payload construction excludes mutable payment/refund/contact/profile facts.
- Existing payment-link, invoice-detail, refunds, adjustments, and member billing behavior remains intact.
- WhatsApp contract, document-header send components, persisted-media override, and exact readiness checks.

### PDF

- Renderer produces a non-empty `%PDF` artifact from the database-authored payload.
- Unicode business/customer fixtures render without missing-glyph boxes.
- Line totals and summary totals reconcile independently in integer minor units.
- Long names, addresses, descriptions, and enough lines for multiple pages render without clipping or overlap.
- Generated PDFs are rendered to PNG after meaningful layout changes and visually inspected.
- Repeated download proves the same document row, path, byte count, and checksum.

### Repository and live verification

- Focused tests, full Vitest suite, lint, type checking, and production build pass.
- The additive migration is applied only through the available Supabase migration connector; never `supabase db push`.
- Verify live schema, policies, functions, storage bucket, deterministic backfill, counter state, and security/performance advisors.
- Do not submit the Meta template or send a real WhatsApp message without separate user authorization.

## Delivery and documentation

The implementation updates in the same change:

- `docs/changelog.md`;
- `PRDs/roadmap.md`;
- `PRDs/finance_master_section.md`;
- `docs/gym-domain.md`;
- WhatsApp template documentation and exact contract count.

The roadmap may mark human numbering, invoice-profile snapshots, PDF generation, and application-side WhatsApp sharing as built. Provider delivery readiness must remain explicitly gated until Meta returns the exact Approved/synced contract.
