# Immutable Invoice Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every persisted invoice an immutable human number and identity snapshot, then let authorized staff download or explicitly share one stable non-tax PDF artifact.

**Architecture:** Postgres owns number allocation, trusted identity snapshots, profile finalization, and document-generation leases. A Node.js-only Next.js service renders a database-authored payload to a private, checksummed PDF object; authenticated routes reuse that artifact for downloads and pass a short-lived signed URL to the existing WhatsApp send core while persisting a stable application URL.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres/RLS/Storage, `@react-pdf/renderer`, bundled Noto Sans fonts, Vitest, Testing Library, Tailwind v4, existing Base UI/shadcn primitives.

**Spec:** `docs/superpowers/specs/2026-08-24-immutable-invoice-documents-design.md`

## Global Constraints

- This is a non-tax invoice release: do not add GST, CGST, SGST, IGST, tax rates, GSTIN, HSN/SAC, place of supply, reverse charge, e-invoice, or statutory-return fields or copy.
- The stored account-scoped number format is exactly `INV-000001`; sequences exceed six digits naturally and are never reused.
- Upcoming projections remain numberless; only persisted `invoices` rows receive identity or document actions.
- Seller/customer identity and ready document artifacts are immutable; edits, payments, credits, refunds, and later profile changes never rewrite a ready PDF.
- The PDF displays immutable charge facts and `Invoice total`, never payment state, amount paid, balance due, payment method, or receipt claims.
- Storage bucket `invoice-documents` is private; browser clients cannot write document rows or objects.
- Download is viewer+; invoice-profile save is admin+; WhatsApp share is agent+ and additionally requires operational access.
- The WhatsApp provider contract is exactly `gym_invoice_document`, Utility, `en_US`, POSITIONAL, document header, and body parameters customer name, invoice number, invoice total, business name.
- Do not submit the Meta template or send a real WhatsApp message without separate user authorization.
- Use no `"use server"` actions and add no Zod dependency.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md`, and `node_modules/next/dist/docs/01-app/02-guides/package-bundling.md` completely before writing the routes or renderer.
- Apply the additive migration only through the available Supabase migration connector; never run `supabase db push`.
- Preserve existing user changes, use `apply_patch` for hand edits, and finish with focused tests, full tests, lint, typecheck, production build, rendered-PDF inspection, live schema verification, and Supabase advisors.

## File map

### Database boundary

- Create `supabase/migrations/20260824235500_immutable_invoice_identity.sql`: profile, counter, invoice identity columns/backfill, profile-save RPC, insert allocator/snapshot trigger, immutability trigger, view refresh, grants, and RLS.
- Create `supabase/migrations/20260824235600_immutable_invoice_documents.sql`: document status enum/table, private bucket/policies, reserve/finalize/fail RPCs, grants, and RLS.
- Create `src/lib/finance/invoice-identity-schema-contract.test.ts`: migration-source assertions for the irreversible identity invariants.
- Create `src/lib/finance/invoice-document-schema-contract.test.ts`: migration-source assertions for lease, storage, and authorization invariants.

### Shared domain boundary

- Modify `src/types/index.ts`: invoice number/snapshot columns on persisted invoice types.
- Modify `src/lib/auth/roles.ts` and `src/lib/auth/roles.test.ts`: named profile/download/share predicates.
- Modify `src/lib/currency.ts`, `src/lib/currency.test.ts`, `src/lib/locale/format.ts`, and its existing formatter tests: exact native-minor-unit money rendering for documents.
- Modify `src/lib/finance/invoices.ts` and `src/lib/finance/invoices.test.ts`: human reference normalization, search, sort, and CSV.
- Create `src/lib/finance/invoice-profile.ts` and `.test.ts`: form normalization and completeness validation.
- Create `src/lib/finance/invoice-documents.ts` and `.test.ts`: payload types, eligibility, stable route/filename, and renderer-independent invariants.

### Server document boundary

- Modify `package.json`, `package-lock.json`, and `next.config.ts`: PDF renderer and bundled font dependencies/runtime packaging.
- Create `src/lib/finance/invoice-pdf.tsx` and `.test.tsx`: deterministic A4 React-PDF renderer.
- Create `src/lib/finance/invoice-document-service.ts` and `.test.ts`: reserve/render/hash/upload/finalize orchestration.
- Create `src/app/api/invoices/[invoiceId]/document/route.ts` and `.test.ts`: authenticated download/generation route.

### Settings and invoice UI boundary

- Create `src/components/settings/invoice-details-card.tsx` and `.test.tsx`: profile load, role gate, validation, recovery, and save.
- Modify `src/components/settings/deals-settings.tsx`: mount the card in Payments.
- Create `src/components/finance/invoice-document-actions.tsx` and `.test.tsx`: download/share readiness and pending UI.
- Modify `src/components/finance/invoice-detail-dialog.tsx`, `src/components/finance/finance-invoices.tsx`, `src/components/members/member-detail-view.tsx`, and `src/components/members/service-customer-detail-view.tsx`: human number and shared detail actions.

### WhatsApp boundary

- Modify `src/lib/whatsapp/template-contracts.ts` and its registry/preset/documentation/readiness tests: tenth exact contract.
- Modify `src/lib/whatsapp/template-send-presentation.ts` and tests: invoice document parameters use the immutable number and exact money.
- Modify `src/lib/whatsapp/send-message.ts` and `src/lib/whatsapp/send-message.test.ts`: server-owned `persistedMediaUrl` override.
- Create `src/lib/whatsapp/resolve-contact-conversation.ts` and `.test.ts`, and modify `src/app/api/whatsapp/send/route.ts`: extract the existing account/contact find-or-create path so invoice sharing reuses it.
- Create `src/app/api/invoices/[invoiceId]/share/route.ts` and `.test.ts`: readiness, signed URL, and existing send-core integration.

### Delivery evidence

- Create `docs/invoice-documents.md`: canonical operator contract for invoice profiles, non-tax artifacts, authorization, recovery, and `gym_invoice_document` readiness.
- Modify `docs/changelog.md`, `PRDs/roadmap.md`, `PRDs/finance_master_section.md`, `docs/gym-domain.md`, and `src/lib/whatsapp/template-documentation-contract.test.ts`.
- Create `artifacts/invoice-documents/` only if the repository already tracks implementation evidence; otherwise keep rendered PNG/PDF evidence in a `mktemp -d` directory and report its paths before cleanup.

---

### Task 1: Database-owned invoice identity and profile

**Files:**
- Create: `supabase/migrations/20260824235500_immutable_invoice_identity.sql`
- Create: `src/lib/finance/invoice-identity-schema-contract.test.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: existing `accounts`, `profiles`, `contacts`, `members`, `memberships`, `invoices`, `invoice_lines`, `legal_entities`, `is_account_member(account_id, min_role)`, and `update_updated_at_column()`.
- Produces: `invoice_profiles`; private `account_invoice_number_counters`; invoice columns `invoice_sequence`, `invoice_number`, `seller_snapshot`, `customer_snapshot`, `identity_snapshot_version`; RPC `save_invoice_profile(...)`; helper functions `build_invoice_seller_snapshot(account_id)` and `build_invoice_customer_snapshot(invoice)`; refreshed `invoice_balances` view carrying all identity columns.

- [ ] **Step 1: Write the migration contract test**

Create a Vitest test which reads the migration as text and asserts all irreversible boundaries:

```ts
expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.invoice_profiles');
expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.account_invoice_number_counters');
expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS invoice_sequence BIGINT/i);
expect(sql).toMatch(/UNIQUE \(account_id, invoice_sequence\)/i);
expect(sql).toMatch(/UNIQUE \(account_id, invoice_number\)/i);
expect(sql).toContain("'INV-' || LPAD");
expect(sql).toContain('ORDER BY issued_at, created_at, id');
expect(sql).toContain('FOR UPDATE');
expect(sql).toContain('save_invoice_profile');
expect(sql).toContain("seller_snapshot IS NULL");
expect(sql).toContain('prevent_invoice_identity_mutation');
expect(sql).toContain("is_account_member(account_id, 'admin')");
```

Also assert the migration recreates `invoice_balances` with `invoice_sequence`, `invoice_number`, `seller_snapshot`, `customer_snapshot`, and `identity_snapshot_version`, and revokes direct counter/profile writes from `authenticated`.

- [ ] **Step 2: Run the contract test and confirm the missing migration failure**

Run: `npx vitest run src/lib/finance/invoice-identity-schema-contract.test.ts`

Expected: FAIL because `20260824235500_immutable_invoice_identity.sql` does not exist.

- [ ] **Step 3: Implement the additive identity migration**

Use guarded enum-free DDL and explicit constraints. The allocator must use this transaction shape:

```sql
INSERT INTO public.account_invoice_number_counters(account_id, last_value)
VALUES (NEW.account_id, 1)
ON CONFLICT (account_id) DO UPDATE
SET last_value = public.account_invoice_number_counters.last_value + 1,
    updated_at = NOW()
RETURNING last_value INTO NEW.invoice_sequence;

NEW.invoice_number := 'INV-' || LPAD(NEW.invoice_sequence::TEXT, 6, '0');
```

Backfill with one `ROW_NUMBER()` window partitioned by account and ordered exactly by `issued_at, created_at, id`; initialize each counter to `MAX(invoice_sequence)`. Build customer JSON only from invoice snapshots first, then contact/member values when legacy facts are absent. `save_invoice_profile` must validate required trimmed fields, validate optional email syntax, upsert the profile, update only `invoices.seller_snapshot IS NULL`, and return the saved row. Install a `BEFORE INSERT` allocator/snapshot trigger and a separate `BEFORE UPDATE` identity trigger that rejects any changed non-null identity value with SQLSTATE `22000`.

Define profile policies as member select only; direct writes have no policy. Grant `save_invoice_profile` only to `authenticated`, and assert admin+ inside the function. Recreate the complete current `invoice_balances` definition from the latest migration rather than dropping existing financial columns.

- [ ] **Step 4: Add matching TypeScript fields**

Add object-shaped snapshot interfaces and nullable migration-safe fields:

```ts
export interface InvoicePartySnapshot {
  business_name?: string | null;
  legal_name?: string | null;
  branch_name?: string | null;
  customer_name?: string | null;
  member_number?: string | null;
  phone?: string | null;
  email?: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
}
```

Extend the persisted invoice interfaces with `invoice_sequence: number | null`, `invoice_number: string | null`, both snapshot fields, and `identity_snapshot_version: number | null`. Do not add them to upcoming-only projections.

- [ ] **Step 5: Run focused schema/type verification**

Run: `npx vitest run src/lib/finance/invoice-identity-schema-contract.test.ts && npm run typecheck`

Expected: PASS; TypeScript may reveal existing fixtures that need explicit nullable identity fields, which must be updated in this task.

- [ ] **Step 6: Commit the identity boundary**

```bash
git add supabase/migrations/20260824235500_immutable_invoice_identity.sql src/lib/finance/invoice-identity-schema-contract.test.ts src/types/index.ts
git commit -m "feat: add immutable invoice identity"
```

### Task 2: Document lease, metadata, and private Storage boundary

**Files:**
- Create: `supabase/migrations/20260824235600_immutable_invoice_documents.sql`
- Create: `src/lib/finance/invoice-document-schema-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 invoice identity/profile schema, existing invoice lifecycle/refund-review facts, `is_account_member`.
- Produces: enum `invoice_document_status`; table `invoice_documents`; private bucket `invoice-documents`; RPCs `reserve_invoice_document(p_invoice_id UUID)`, `finalize_invoice_document(p_invoice_id UUID, p_generation_token UUID, p_sha256 TEXT, p_byte_count BIGINT)`, and `fail_invoice_document(p_invoice_id UUID, p_generation_token UUID, p_error TEXT)`.

- [ ] **Step 1: Write the document schema contract test**

Assert the migration contains the unique invoice constraint, status check/enum values, database-built `payload_snapshot`, deterministic `storage_path`, SHA-256 hex check, positive byte count, generation UUID token, expiry, member-only metadata select policy, no browser mutations, private bucket creation, PDF MIME restriction, bounded size, and token-bound finalize/fail predicates.

```ts
expect(sql).toContain('UNIQUE (invoice_id)');
expect(sql).toContain("'generating'");
expect(sql).toContain("'ready'");
expect(sql).toContain("'failed'");
expect(sql).toContain('reserve_invoice_document');
expect(sql).toContain('generation_token = p_generation_token');
expect(sql).toContain("account-" );
expect(sql).toContain("invoice-documents");
expect(sql).toContain("application/pdf");
expect(sql).toContain('REVOKE ALL ON public.invoice_documents FROM authenticated');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/lib/finance/invoice-document-schema-contract.test.ts`

Expected: FAIL because the document migration is missing.

- [ ] **Step 3: Implement reservation and payload construction in SQL**

`reserve_invoice_document` must return a fixed row shape including `outcome`, document ID/status, token, payload, path, checksum, byte count, and last error. Lock the invoice/document row, return `ready` without mutation, return `generating` for an unexpired lease, and reclaim failed or expired leases. Reject generation for voided or refund-review invoices, incomplete snapshots, missing human number, or no active line facts.

Construct the JSON payload in SQL with integer minor units:

```json
{
  "format_version": 1,
  "invoice_number": "INV-000001",
  "issued_at": "2026-08-24",
  "currency": "INR",
  "seller": {},
  "customer": {},
  "lines": [{"description":"Monthly membership","period":null,"quantity":1,"unit_amount_minor":250000,"amount_minor":250000}],
  "subtotal_minor": 250000,
  "adjustments_minor": 0,
  "total_minor": 250000
}
```

Do not select payments, credits, refunds, balance, or current contact/profile data into this payload. Store the payload and path only when claiming a lease. `finalize` must transition only the matching generating token to ready; `fail` must store at most 500 operator-readable characters and remain retryable.

- [ ] **Step 4: Add private bucket and Storage policy DDL**

Insert/update the bucket idempotently with `public = false`, `allowed_mime_types = ARRAY['application/pdf']`, and a 10 MiB limit. Add no authenticated insert/update/delete object policy. Service-role bypass is the only write path; authenticated downloads go through the API route rather than direct signed URLs.

- [ ] **Step 5: Run both database contract tests**

Run: `npx vitest run src/lib/finance/invoice-identity-schema-contract.test.ts src/lib/finance/invoice-document-schema-contract.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the document state machine**

```bash
git add supabase/migrations/20260824235600_immutable_invoice_documents.sql src/lib/finance/invoice-document-schema-contract.test.ts
git commit -m "feat: add invoice document state machine"
```

### Task 3: Shared authorization, profile validation, exact money, and human references

**Files:**
- Create: `src/lib/finance/invoice-profile.ts`
- Create: `src/lib/finance/invoice-profile.test.ts`
- Modify: `src/lib/auth/roles.ts`
- Modify: `src/lib/auth/roles.test.ts`
- Modify: `src/lib/currency.ts`
- Modify: `src/lib/currency.test.ts`
- Modify: `src/lib/locale/format.ts`
- Modify: `src/lib/locale/format.test.ts`
- Modify: `src/lib/finance/invoices.ts`
- Modify: `src/lib/finance/invoices.test.ts`

**Interfaces:**
- Produces: `canManageInvoiceProfile(role)`, `canDownloadInvoiceDocuments(role)`, `canShareInvoiceDocuments(role)`; `InvoiceProfileInput`; `normalizeInvoiceProfile(input)`; `validateInvoiceProfile(input): Record<string,string>`; `formatCurrencyExact(value,currency,locale?)`; `LocaleFormatters.moneyExact`; `financeInvoiceReference(invoice: Pick<MembershipPeriodInvoice,'id'|'invoice_number'>)`.

- [ ] **Step 1: Add failing predicate and validation tests**

Assert owner/admin can manage, agent/viewer cannot; all four roles can download; owner/admin/agent can share and viewer cannot. For profiles, assert required trimmed fields, lowercase-trimmed email, ordinary phone preservation, syntactically invalid email rejection, and prefill acceptance.

```ts
expect(canManageInvoiceProfile('admin')).toBe(true);
expect(canManageInvoiceProfile('agent')).toBe(false);
expect(canDownloadInvoiceDocuments('viewer')).toBe(true);
expect(canShareInvoiceDocuments('viewer')).toBe(false);
expect(validateInvoiceProfile(validProfile)).toEqual({});
expect(validateInvoiceProfile({ ...validProfile, email: 'bad@' })).toEqual({ email: 'Enter a valid email address.' });
```

- [ ] **Step 2: Add failing exact-money and reference tests**

Assert `formatCurrencyExact(1234.5, 'INR', 'en-IN')` retains the currency's native two minor digits, `JPY` uses zero digits, invalid currency falls back without throwing, and `buildFormatters(...).moneyExact` delegates correctly. Change invoice references to prefer `invoice_number`, with the UUID fragment only as a migration-safe fallback. Assert search, number sorting, and CSV use `INV-...`.

- [ ] **Step 3: Run focused tests and confirm failures**

Run: `npx vitest run src/lib/auth/roles.test.ts src/lib/finance/invoice-profile.test.ts src/lib/currency.test.ts src/lib/finance/invoices.test.ts`

Expected: FAIL for missing predicates/helpers and the old `#UUID8` expectation.

- [ ] **Step 4: Implement the minimal shared domain helpers**

Use the existing role hierarchy/capability style. Implement exact currency output with the existing guarded `Intl.NumberFormat` construction but without forcing zero fraction digits. Use this reference signature so call sites cannot accidentally pass a raw ID:

```ts
export function financeInvoiceReference(
  invoice: Pick<MembershipPeriodInvoice, 'id' | 'invoice_number'>
): string {
  return invoice.invoice_number ?? `#${invoice.id.slice(0, 8).toUpperCase()}`;
}
```

Normalize profile strings once, return field-specific errors, and leave database authorization to the RPC.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx vitest run src/lib/auth/roles.test.ts src/lib/finance/invoice-profile.test.ts src/lib/currency.test.ts src/lib/finance/invoices.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the shared domain contract**

```bash
git add src/lib/auth/roles.ts src/lib/auth/roles.test.ts src/lib/finance/invoice-profile.ts src/lib/finance/invoice-profile.test.ts src/lib/currency.ts src/lib/currency.test.ts src/lib/locale/format.ts src/lib/locale src/lib/finance/invoices.ts src/lib/finance/invoices.test.ts
git commit -m "feat: expose invoice identity capabilities"
```

### Task 4: Invoice details Settings card

**Files:**
- Create: `src/components/settings/invoice-details-card.tsx`
- Create: `src/components/settings/invoice-details-card.test.tsx`
- Modify: `src/components/settings/deals-settings.tsx`

**Interfaces:**
- Consumes: `InvoiceProfileInput`, `normalizeInvoiceProfile`, `validateInvoiceProfile`, `canManageInvoiceProfile`, `useAuth()`, account locale/country context, Supabase RLS select, and RPC `save_invoice_profile`.
- Produces: `<InvoiceDetailsCard />` mounted after existing Payments configuration cards.

- [ ] **Step 1: Write loading, prefill, role, validation, save, and recovery tests**

Mock the existing auth/Supabase patterns and assert:

- a missing row prefills Business name from branch, Legal name from legal entity, and Country from the account preset;
- a saved row renders all fields;
- viewer/agent inputs and save are gated read-only;
- admin/owner invalid required fields/email show field errors;
- successful RPC passes normalized values and displays the standard success feedback;
- load/save errors use `getErrorMessage`, retain entered data, and expose Retry.

- [ ] **Step 2: Run the component test and confirm failure**

Run: `npx vitest run src/components/settings/invoice-details-card.test.tsx`

Expected: FAIL because `InvoiceDetailsCard` does not exist.

- [ ] **Step 3: Implement with canonical settings primitives**

Reuse only `Card`, `Input`, `Label`, `Button`/`GatedButton`, existing skeleton/recovery/toast patterns, and the Payments column width. Fetch profile and legal-entity prefill in one cancel-safe effect. Save only via `supabase.rpc('save_invoice_profile', normalizedInput)` and require a returned row; zero rows are failure. Use exact recovery copy:

`Finish Invoice details in Settings -> Payments first.`

Do not add a shared UI master or page-specific token overrides.

- [ ] **Step 4: Mount and verify**

Run: `npx vitest run src/components/settings/invoice-details-card.test.tsx src/components/settings/expense-categories-card.test.tsx && npm run typecheck`

Expected: PASS with existing Payments settings behavior unchanged.

- [ ] **Step 5: Commit the settings experience**

```bash
git add src/components/settings/invoice-details-card.tsx src/components/settings/invoice-details-card.test.tsx src/components/settings/deals-settings.tsx
git commit -m "feat: add invoice details settings"
```

### Task 5: Renderer-independent document contract and PDF renderer

**Files:**
- Create: `src/lib/finance/invoice-documents.ts`
- Create: `src/lib/finance/invoice-documents.test.ts`
- Create: `src/lib/finance/invoice-pdf.tsx`
- Create: `src/lib/finance/invoice-pdf.test.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.ts`

**Interfaces:**
- Produces: `InvoiceDocumentPayloadV1`, `InvoiceDocumentReservation`, `invoiceDocumentFilename(number)`, `invoiceDocumentRoute(id)`, `assertInvoiceDocumentPayload(value)`, `renderInvoicePdf(payload): Promise<Buffer>`.

- [ ] **Step 1: Read the required local Next.js 16 documentation**

Read the four files listed in Global Constraints from start to finish. Record no copied documentation in code; use the result to keep the renderer on `nodejs` and package it consistently with current Next.js rules.

- [ ] **Step 2: Install deterministic renderer/font dependencies**

Run:

```bash
npm install @react-pdf/renderer @fontsource/noto-sans @fontsource/noto-sans-devanagari
```

Add `@react-pdf/renderer` to `serverExternalPackages` in `next.config.ts` only if the local Next bundling guide or a production build demonstrates that externalization is required. Do not add a browser import path to the renderer.

- [ ] **Step 3: Write failing payload/eligibility tests**

Use a frozen V1 fixture and assert filename sanitization, stable route, strict integer minor units, reconciliation (`sum(lines) + adjustments = total`), required complete party snapshots, and rejection of mutable keys including `balance`, `paid`, `payment`, `refund`, and `contact`.

```ts
expect(invoiceDocumentFilename('INV-000042')).toBe('invoice-INV-000042.pdf');
expect(invoiceDocumentRoute(invoiceId)).toBe(`/api/invoices/${invoiceId}/document`);
expect(() => assertInvoiceDocumentPayload(validPayload)).not.toThrow();
expect(() => assertInvoiceDocumentPayload({ ...validPayload, balance_minor: 0 })).toThrow();
```

- [ ] **Step 4: Write a failing renderer test**

Assert the buffer begins `%PDF`, exceeds 1 KiB, and that extracted PDF strings/metadata include `Invoice`, `INV-000042`, `Invoice total`, and `Non-tax invoice`, while excluding `GST`, `Amount due`, `Paid`, `Balance`, and `Receipt`. Include Devanagari seller/customer names and a 70-line long-description fixture to force multiple pages.

- [ ] **Step 5: Run focused tests and confirm failure**

Run: `npx vitest run src/lib/finance/invoice-documents.test.ts src/lib/finance/invoice-pdf.test.tsx`

Expected: FAIL because the modules do not exist.

- [ ] **Step 6: Implement V1 validation and A4 React-PDF layout**

Register local WOFF font files from the installed packages, with Noto Sans as default and Noto Sans Devanagari for `\u0900-\u097F` runs. Render `<Document><Page size="A4">` with generous margins, fixed footer/page numbers, seller/Bill to blocks, repeated table header, `wrap={false}` for each line row, right-aligned totals, and exact footer:

`Non-tax invoice - GST and tax calculations are not included.`

Use `formatCurrencyExact`/locale-derived formatting outside React-PDF styles. Never import client hooks into this module.

- [ ] **Step 7: Run renderer tests and generate a visual fixture**

Run: `npx vitest run src/lib/finance/invoice-documents.test.ts src/lib/finance/invoice-pdf.test.tsx`

Then render the long fixture to a temporary PDF, run `pdftoppm -png -r 144`, and inspect first, middle, and last pages with the local image viewer. Expected: no clipping/overlap, repeated headers, readable Devanagari, correct totals, and `Page N of M`.

- [ ] **Step 8: Commit the renderer**

```bash
git add package.json package-lock.json next.config.ts src/lib/finance/invoice-documents.ts src/lib/finance/invoice-documents.test.ts src/lib/finance/invoice-pdf.tsx src/lib/finance/invoice-pdf.test.tsx
git commit -m "feat: render immutable invoice PDFs"
```

### Task 6: Document generation service and authenticated download route

**Files:**
- Create: `src/lib/finance/invoice-document-service.ts`
- Create: `src/lib/finance/invoice-document-service.test.ts`
- Create: `src/app/api/invoices/[invoiceId]/document/route.ts`
- Create: `src/app/api/invoices/[invoiceId]/document/route.test.ts`

**Interfaces:**
- Consumes: `renderInvoicePdf`, `assertInvoiceDocumentPayload`, Task 2 RPC fixed result shape, private Storage bucket, `getCurrentAccount`, `canDownloadInvoiceDocuments`.
- Produces: `ensureInvoiceDocument({ accountId, invoiceId, userId }): Promise<ReadyInvoiceDocument>` and a Node.js GET route streaming the stable artifact.

- [ ] **Step 1: Write failing service state-machine tests**

Inject a narrow dependency object for reserve RPC, Storage, renderer, and hashing. Assert:

- ready reservations download existing bytes without render/upload;
- claimed reservations validate payload, render once, SHA-256 hash, upload with `upsert: false`, finalize with the same token, and return bytes/metadata;
- live generating returns a retryable `InvoiceDocumentPreparingError`;
- render/upload failure removes only the just-attempted path when safe and calls token-bound fail with a bounded error;
- ready metadata with a missing object fails loudly and never regenerates;
- returned checksum and byte count match bytes.

- [ ] **Step 2: Write failing route authorization/response tests**

Mock `getCurrentAccount` and the service. Assert generic 404 for missing/cross-account, 403 for absent capability, 409 with `{ error }` for concurrent preparation/profile/invoice-state conflicts, and 200 with:

```ts
expect(headers.get('content-type')).toBe('application/pdf');
expect(headers.get('content-disposition')).toContain('invoice-INV-000042.pdf');
expect(headers.get('cache-control')).toBe('private, no-store');
```

- [ ] **Step 3: Run tests and confirm failure**

Run: `npx vitest run src/lib/finance/invoice-document-service.test.ts 'src/app/api/invoices/[invoiceId]/document/route.test.ts'`

Expected: FAIL because service and route are absent.

- [ ] **Step 4: Implement service-role orchestration**

Create the service client only after an account-scoped invoice lookup succeeds. Use Web Crypto/Node crypto SHA-256, exact byte length, `contentType: 'application/pdf'`, and `upsert: false`. Treat reserve/finalize/fail zero rows and malformed rows as errors. Never return signed Storage URLs from this service.

- [ ] **Step 5: Implement the Node.js route**

Export `runtime = 'nodejs'`. Validate UUID shape, authenticate selected account, apply the named capability, resolve invoice under `account_id`, call `ensureInvoiceDocument`, and stream bytes with the human filename and no-store headers. Map internal eligibility details to actionable same-tenant errors but collapse missing/cross-tenant into one 404.

- [ ] **Step 6: Run focused and regression tests**

Run: `npx vitest run src/lib/finance/invoice-document-service.test.ts 'src/app/api/invoices/[invoiceId]/document/route.test.ts' src/lib/finance/invoice-detail-presentation.test.ts src/lib/finance/invoices.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit generation and download**

```bash
git add src/lib/finance/invoice-document-service.ts src/lib/finance/invoice-document-service.test.ts 'src/app/api/invoices/[invoiceId]/document/route.ts' 'src/app/api/invoices/[invoiceId]/document/route.test.ts'
git commit -m "feat: generate and download invoice documents"
```

### Task 7: Exact WhatsApp contract and stable media persistence

**Files:**
- Modify: `src/lib/whatsapp/template-contracts.ts`
- Modify: `src/lib/whatsapp/template-contracts.test.ts`
- Modify: `src/lib/whatsapp/template-presets.test.ts`
- Modify: `src/lib/whatsapp/template-documentation-contract.test.ts`
- Modify: `src/components/settings/template-manager.test.tsx`
- Modify: `src/lib/whatsapp/template-send-presentation.ts`
- Create: `src/lib/whatsapp/template-send-presentation.test.ts`
- Modify: `src/lib/whatsapp/send-message.ts`
- Modify: `src/lib/whatsapp/send-message.test.ts`

**Interfaces:**
- Produces: contract ID `invoice_document`; presentation builder returning document header plus exactly four body values; optional `persistedMediaUrl?: string` on the internal send request, permitted only with an actual provider `headerMediaUrl`.

- [ ] **Step 1: Add failing tenth-contract tests**

Assert registry length ten and exact payload:

```ts
expect(contract).toMatchObject({
  id: 'invoice_document',
  category: 'Utility',
  consentScope: 'whatsapp_account_updates',
  wired: true,
  payload: {
    name: 'gym_invoice_document',
    category: 'Utility',
    language: 'en_US',
    header_type: 'document',
  },
});
expect(contract.parameterLabels).toEqual(['Customer name', 'Invoice number', 'Invoice total', 'Business name']);
```

Snapshot the exact proposed body from the spec and update gallery/documentation expectations from nine to ten without loosening the other nine contracts. The managed preset leaves the creation-time document sample URL/handle empty so Settings requires the operator to upload a harmless sample document before an authorized Meta submission; the runtime invoice route supplies the real signed document URL only at send time.

- [ ] **Step 2: Add failing presentation and persisted-media tests**

Assert invoice presentation uses snapshotted customer/business names, human number, and `moneyExact`, not UUID or live balance. In send-core tests, pass a short-lived signed `headerMediaUrl` plus stable `/api/invoices/11111111-1111-4111-8111-111111111111/document`; assert Meta receives the signed URL while the inserted message/media row stores the stable route. Assert a persisted override without provider media is rejected.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npx vitest run src/lib/whatsapp/template-contracts.test.ts src/lib/whatsapp/template-presets.test.ts src/lib/whatsapp/template-documentation-contract.test.ts src/components/settings/template-manager.test.tsx src/lib/whatsapp/send-message.test.ts`

Expected: FAIL on nine-contract counts and absent media override.

- [ ] **Step 4: Add the exact registry contract and presentation**

Use the registry as the only source for setup gallery, validation, readiness, and presentation. The body must remain exactly:

`Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.`

- [ ] **Step 5: Add narrowly scoped persistence override**

Keep provider construction unchanged except for allowing `persistedMediaUrl` to replace the URL written to UsefulDesk history after provider acceptance. Validate it begins `/api/invoices/` and ends `/document`; do not expose this field on the public generic `/api/whatsapp/send` body.

- [ ] **Step 6: Run all WhatsApp-focused tests**

Run: `npx vitest run src/lib/whatsapp/template-contracts.test.ts src/lib/whatsapp/template-presets.test.ts src/lib/whatsapp/template-documentation-contract.test.ts src/components/settings/template-manager.test.tsx src/lib/whatsapp/template-send-builder.test.ts src/lib/whatsapp/send-message.test.ts`

Expected: PASS with ten exact contracts and unchanged provider-media behavior for all existing callers.

- [ ] **Step 7: Commit the WhatsApp core contract**

```bash
git add src/lib/whatsapp src/components/settings/template-manager.test.tsx
git commit -m "feat: define invoice document WhatsApp contract"
```

### Task 8: Share route with readiness and signed provider URL

**Files:**
- Create: `src/lib/whatsapp/resolve-contact-conversation.ts`
- Create: `src/lib/whatsapp/resolve-contact-conversation.test.ts`
- Modify: `src/app/api/whatsapp/send/route.ts`
- Create: `src/app/api/invoices/[invoiceId]/share/route.ts`
- Create: `src/app/api/invoices/[invoiceId]/share/route.test.ts`

**Interfaces:**
- Consumes: `requireOperationalAccess`/account auth, `canShareInvoiceDocuments`, `ensureInvoiceDocument`, `evaluateTemplateReadiness('invoice_document', ...)`, Storage `createSignedUrl`, invoice presentation builder, `sendMessageToConversation(db, accountId, params)` with stable `persistedMediaUrl`.
- Produces: `resolveContactConversation(db, accountId, userId, contactId): Promise<string>` shared by the generic send and invoice-share routes; POST route returning the existing send-success shape or `{ error }`.

- [ ] **Step 1: Write failing route matrix tests**

Cover unauthenticated, viewer, agent, admin/owner; missing/cross-tenant invoice; missing customer phone; disconnected WhatsApp; missing/drifted/not-Approved template; incomplete profile; void/refund review; concurrent preparation; signed URL failure; send failure; and success. On success assert:

```ts
expect(createSignedUrl).toHaveBeenCalledWith(storagePath, 300);
expect(sendMessageToConversation).toHaveBeenCalledWith(
  expect.anything(),
  accountId,
  expect.objectContaining({
    conversationId,
    messageType: 'template',
    templateName: 'gym_invoice_document',
    templateLanguage: 'en_US',
    templateMessageParams: {
      headerMediaUrl: signedUrl,
      body: ['Asha', 'INV-000042', '₹2,500.00', 'FitZone Gym'],
    },
    persistedMediaUrl: `/api/invoices/${invoiceId}/document`,
  })
);
```

- [ ] **Step 2: Run the route test and confirm failure**

Run: `npx vitest run 'src/app/api/invoices/[invoiceId]/share/route.test.ts'`

Expected: FAIL because the shared contact resolver and route are absent.

- [ ] **Step 3: Extract and test the existing contact-conversation resolver**

Move the current account/contact-scoped lookup/insert from `src/app/api/whatsapp/send/route.ts` into `resolveContactConversation`. Preserve caller-RLS behavior, `user_id` audit attribution, oldest existing conversation selection, and unique-race recovery. Make both the generic send route and invoice-share route call it. Run:

`npx vitest run src/lib/whatsapp/resolve-contact-conversation.test.ts src/app/api/whatsapp/send/route.test.ts`

Expected: PASS with no generic-send response change.

- [ ] **Step 4: Implement authorization and readiness order**

Authenticate/authorize and resolve the account-scoped invoice before service-role work. Check phone, connection, and exact Approved/synced `en_US` contract; then ensure the document, create a 300-second signed URL, and call the existing send core with the exact header/body presentation. Do not duplicate conversation creation, provider persistence, consent audit, or outbound status handling.

- [ ] **Step 5: Implement actionable error mapping**

Use exact UI recovery messages where applicable:

- `Add a phone number before sending on WhatsApp.`
- `Connect WhatsApp in Settings before sending.`
- `Approve and sync gym_invoice_document in en_US before sending.`
- `Finish Invoice details in Settings -> Payments first.`

Return generic 404 for missing/cross-tenant and retryable 409 for live generation.

- [ ] **Step 6: Run route and send-core tests**

Run: `npx vitest run 'src/app/api/invoices/[invoiceId]/share/route.test.ts' src/lib/whatsapp/resolve-contact-conversation.test.ts src/lib/whatsapp/send-message.test.ts src/lib/whatsapp/template-readiness.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit explicit sharing**

```bash
git add src/lib/whatsapp/resolve-contact-conversation.ts src/lib/whatsapp/resolve-contact-conversation.test.ts src/app/api/whatsapp/send/route.ts 'src/app/api/invoices/[invoiceId]/share/route.ts' 'src/app/api/invoices/[invoiceId]/share/route.test.ts'
git commit -m "feat: share invoice documents on WhatsApp"
```

### Task 9: Human invoice number and document actions in the UI

**Files:**
- Create: `src/components/finance/invoice-document-actions.tsx`
- Create: `src/components/finance/invoice-document-actions.test.tsx`
- Modify: `src/components/finance/invoice-detail-dialog.tsx`
- Modify: `src/components/finance/finance-invoices.tsx`
- Modify: `src/components/members/member-detail-view.tsx`
- Modify: `src/components/members/service-customer-detail-view.tsx`
- Modify: `src/lib/whatsapp/template-send-presentation.ts` call sites if TypeScript identifies them
- Modify: `src/components/members/member-detail-view.test.tsx`

**Interfaces:**
- Consumes: human `reference`, invoice status/refund-review/customer phone, role capabilities, authenticated GET and POST routes, `getErrorMessage`.
- Produces: shared `<InvoiceDocumentActions invoice={...} />` inside persisted invoice detail only.

- [ ] **Step 1: Write failing action-state tests**

Assert Download appears for viewer+ when profile/snapshots are complete; Share appears agent+; upcoming has neither; void/refund-review cannot generate/share; an already-ready void can download; missing profile/phone/connection/template each expose exact gated reason; clicks show independent pending state; API errors surface through `getErrorMessage`; download uses a browser navigation/blob path that preserves the attachment filename; successful share shows confirmation.

- [ ] **Step 2: Write failing number propagation tests**

Update invoice fixtures with `invoice_number` and assert the number is primary in table/card/detail/member/service views, search and sort use it, CSV header/value says `Invoice number`, and no visible `#UUID8` remains for migrated persisted invoices. Assert upcoming rows remain labeled by their existing projected period/state, not a fabricated number.

- [ ] **Step 3: Run focused UI tests and confirm failure**

Run: `npx vitest run src/components/finance/invoice-document-actions.test.tsx src/lib/finance/invoices.test.ts src/lib/finance/invoice-detail-presentation.test.ts`

Expected: FAIL because actions are absent and old references remain.

- [ ] **Step 4: Implement the shared actions**

Use existing Button/GatedButton/loading/toast patterns. Keep actions in `InvoiceDetailDialog`; do not add invoice table row actions. Derive readiness through one pure presentation helper so desktop/mobile/detail do not invent different reasons. GET download remains available when POST share is unavailable.

- [ ] **Step 5: Replace raw ID reference call sites**

Pass the invoice object to `financeInvoiceReference`, keep the UUID only in React/database keys and technical payloads, and use the immutable number in displayed labels, filtering, sorting, export, payment-link presentation, and template parameters.

- [ ] **Step 6: Run UI regression suite and typecheck**

Run: `npx vitest run src/components/finance/invoice-document-actions.test.tsx src/components/finance/payment-link-actions.test.tsx src/lib/finance/invoices.test.ts src/lib/finance/invoice-detail-presentation.test.ts && npm run typecheck`

Expected: PASS with payment link, payment recording, refunds, adjustments, and invoice detail behavior intact.

- [ ] **Step 7: Commit the invoice UI**

```bash
git add src/components/finance src/components/members/member-detail-view.tsx src/components/members/member-detail-view.test.tsx src/components/members/service-customer-detail-view.tsx src/lib/finance src/lib/whatsapp/template-send-presentation.ts
git commit -m "feat: expose invoice documents in billing UI"
```

### Task 10: Full local verification and live migration verification

**Files:**
- Modify only files required by failures attributable to this feature.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: repeatable local and connected-database evidence; no provider template submission and no customer send.

- [ ] **Step 1: Run focused feature tests as one gate**

Run:

```bash
npx vitest run \
  src/lib/finance/invoice-identity-schema-contract.test.ts \
  src/lib/finance/invoice-document-schema-contract.test.ts \
  src/lib/finance/invoice-profile.test.ts \
  src/lib/finance/invoice-documents.test.ts \
  src/lib/finance/invoice-pdf.test.tsx \
  src/lib/finance/invoice-document-service.test.ts \
  src/components/settings/invoice-details-card.test.tsx \
  src/components/finance/invoice-document-actions.test.tsx \
  'src/app/api/invoices/[invoiceId]/document/route.test.ts' \
  'src/app/api/invoices/[invoiceId]/share/route.test.ts' \
  src/lib/whatsapp/template-contracts.test.ts \
  src/lib/whatsapp/send-message.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository gates**

Run in order:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: all exit 0. Fix only regressions attributable to this feature; record unrelated pre-existing failures rather than hiding them.

- [ ] **Step 3: Apply migrations through the connected Supabase migration tool**

List connected projects, select the UsefulDesk project whose existing migration history ends at the repository's current latest migration, and apply `20260824235500_immutable_invoice_identity.sql` followed by `20260824235600_immutable_invoice_documents.sql`. Do not use CLI push or modify migration history manually.

- [ ] **Step 4: Verify connected schema and deterministic backfill**

Use read-only SQL to assert:

```sql
SELECT account_id,
       COUNT(*) AS invoice_count,
       COUNT(invoice_number) AS numbered_count,
       COUNT(DISTINCT invoice_number) AS unique_numbered_count,
       MIN(invoice_sequence) AS min_sequence,
       MAX(invoice_sequence) AS max_sequence
FROM public.invoices
GROUP BY account_id;

SELECT c.account_id, c.last_value, MAX(i.invoice_sequence) AS max_sequence
FROM public.account_invoice_number_counters c
LEFT JOIN public.invoices i ON i.account_id = c.account_id
GROUP BY c.account_id, c.last_value;

SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'invoice-documents';
```

Expected: every persisted invoice numbered uniquely, counter equals each account maximum, and the bucket is private/PDF-only/10 MiB.

- [ ] **Step 5: Verify authorization and state transitions transactionally**

Within rollback-only test transactions or disposable test rows, prove admin profile save succeeds, agent profile save fails, viewer metadata select succeeds, direct document mutation fails, identity update fails, concurrent allocator calls produce distinct increasing numbers, reserve/finalize rejects a wrong token, and the first complete profile save fills only null seller snapshots. Never mutate a real customer invoice for verification.

- [ ] **Step 6: Run Supabase security and performance advisors**

Run both advisor categories. Resolve new findings caused by these migrations; record unrelated existing findings separately.

- [ ] **Step 7: Re-render and visually inspect final PDF output**

Generate simple, long/multi-page, and Devanagari fixtures from the final renderer. Convert every page to PNG and inspect at least first/middle/last pages. Recompute SHA-256 twice from the same payload and assert byte-for-byte determinism; if renderer metadata prevents deterministic bytes, prove the persisted ready object/checksum is reused unchanged instead of regenerating.

- [ ] **Step 8: Commit any verification-only fixes**

```bash
git add -u -- src/lib/finance src/lib/whatsapp src/components/finance src/components/settings src/components/members src/app/api/invoices supabase/migrations package.json package-lock.json next.config.ts
git commit -m "fix: harden invoice document delivery"
```

Skip this commit when no files changed.

### Task 11: Product documentation and final evidence

**Files:**
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Modify: `PRDs/finance_master_section.md`
- Modify: `docs/gym-domain.md`
- Create: `docs/invoice-documents.md`
- Modify: `src/lib/whatsapp/template-documentation-contract.test.ts`
- Modify: `docs/superpowers/specs/2026-08-24-immutable-invoice-documents-design.md`

**Interfaces:**
- Consumes: verified shipped behavior and live/provider readiness state.
- Produces: honest Built/Pending status and future-agent operational guidance.

- [ ] **Step 1: Update the changelog and finance/domain docs**

Add a terse changelog entry naming the two migrations, renderer/service/routes, and the gotcha that ready PDFs are immutable while provider delivery still requires exact Approved/synced `gym_invoice_document`. Write `docs/invoice-documents.md` with profile requirements, numbering/snapshot invariants, download/share role matrix, private-storage behavior, exact template identity/category/language/header/body parameters, readiness troubleshooting, and the no-real-send rule. Update finance/domain docs with human numbering, profile snapshots, non-tax PDF semantics, authorization, private storage, and exact contract count ten. Extend `template-documentation-contract.test.ts` to require those statements from the new runbook.

- [ ] **Step 2: Update roadmap status without overstating provider readiness**

Move human numbering, Invoice details, non-tax PDF download, and application-side WhatsApp sharing to Built/Shipped. Keep GST-ready/statutory documents deferred. State that real WhatsApp delivery remains unavailable until the exact provider contract is Approved/synced; code completion is not provider approval.

- [ ] **Step 3: Mark the approved design implemented**

Change the spec header to `Status: implemented and verified` only after Task 10 passes. If live migration could not be applied, use `Status: implemented locally; live migration pending` and leave roadmap phase wording equally honest.

- [ ] **Step 4: Run documentation and repository consistency tests**

Run:

```bash
npx vitest run src/lib/whatsapp/template-documentation-contract.test.ts src/lib/whatsapp/template-contracts.test.ts
rg -n "nine exact|nine-template|all nine|nine contracts" docs PRDs src --glob '!docs/superpowers/plans/**' --glob '!docs/superpowers/specs/2026-08-21-gym-whatsapp-template-library-design.md'
git diff --check
git status --short
```

Expected: documentation tests pass; remaining historical nine-contract text is explicitly historical; no whitespace errors; only intended files are pending.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/changelog.md PRDs/roadmap.md PRDs/finance_master_section.md docs/gym-domain.md docs/invoice-documents.md docs/superpowers/specs/2026-08-24-immutable-invoice-documents-design.md src/lib/whatsapp/template-documentation-contract.test.ts
git commit -m "docs: record immutable invoice documents"
```

- [ ] **Step 6: Perform verification-before-completion**

Use `superpowers:verification-before-completion`, rerun the decisive commands it requires, inspect `git status`, and report exact test/build/migration/advisor/PDF evidence. Explicitly state that no Meta submission or real WhatsApp send was performed.
