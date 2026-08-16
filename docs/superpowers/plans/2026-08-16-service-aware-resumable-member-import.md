# Service-aware Resumable Member Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Members import so each preserved source row can atomically import a membership, a duration-based service, or both, while service-only customers remain manageable and author-private import drafts resume safely across devices.

**Architecture:** Introduce a security-invoker contact-backed customer directory and make customer detail/sales accept `contact_id` plus an optional membership. Extend the existing pure import-candidate state machine with membership and service components, then persist each ready customer group through one agent-gated, account-validating, idempotent SQL transaction. Store resumable normalized wizard state in an author-only RLS table and the original workbook in an author-only private Storage bucket, coordinated by authenticated Route Handlers with compare-and-swap revisions.

**Tech Stack:** Next.js 16 App Router Route Handlers, React 19, TypeScript, Vitest, Supabase Postgres/Auth/Storage/RLS, Tailwind v4, Base UI/shadcn primitives, XLSX workbook parsing.

## Global Constraints

- Work directly on `codex/member-import-resolution`; preserve every pre-existing uncommitted import change and never reset or discard it.
- Keep the existing four steps: Upload → Map columns → Resolve issues → Confirm.
- Preserve every original source row and its stable source key, row number, disposition, exclusion reason, idempotency key, and receipt outcome.
- Keep membership-only import behavior and current-membership-only history semantics unchanged.
- A customer is a contact with a membership or at least one member service; never create a placeholder membership for a service-only customer.
- Phone plus at least one of Plan or service, Membership plan, or Service is required.
- A trainer-required service has no fallback trainer or price; it requires an active trainer and active trainer-option rate.
- Preserve explicit historical service sold price and expiry through the import-only database boundary; normal checkout pricing rules remain unchanged.
- One ready customer group commits atomically; different groups may succeed or fail independently.
- Drafts are author-private, branch-scoped, compare-and-swap revisioned, private-storage-backed, and expire 30 days after the last acknowledged save.
- Use authenticated `src/app/api/**/route.ts` handlers, never server actions.
- Use named authorization predicates and `requireRole('agent')`; viewer remains read-only.
- All public tables enable RLS and receive explicit Data API grants; all views use `security_invoker = true`; every public `SECURITY DEFINER` function revokes default execution and rechecks `auth.uid()`/account role internally.
- Inspect `supabase/migrations/`, create the migration with `npx supabase@latest migration new service_aware_resumable_member_import`, ensure its final filename sorts after the then-current latest migration, and never run `supabase db push`.
- Apply the finished migration only through the approved Supabase migration connector; verify tables, functions, views, indexes, grants, RLS, Storage policies, and advisors afterward.
- Use `useLocale()` / account locale helpers for dates, times, currency, and account-local today; all money DOM output uses `tabular-nums`.
- Reuse existing UI primitives and variants. Do not edit `src/components/ui/*` without explicit user approval.
- Run each behavioral change through RED → GREEN → REFACTOR and commit coherent deployable milestones.

---

### Task 1: Preserve and checkpoint the current membership-import foundation

**Files:**

- Modify: `src/lib/memberships/member-import-candidates.ts`
- Modify: `src/lib/memberships/member-import-candidates.test.ts`
- Modify: `src/lib/memberships/import-commit.ts`
- Modify: `src/lib/memberships/import-commit.test.ts`
- Modify: `src/lib/memberships/migration-recipe.ts`
- Modify: `src/lib/memberships/migration-recipe.test.ts`
- Modify: `src/app/api/members/import-analyze/route.ts`
- Modify: `src/app/api/members/import-analyze/route.test.ts`
- Modify: `src/components/members/import-members-csv-dialog.tsx`
- Modify: `src/components/members/import-members-csv-dialog.test.tsx`
- Modify: `src/components/members/import-members-preview.tsx`
- Modify: `src/components/members/import-members-preview.test.tsx`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`

**Interfaces:**

- Produces: `MemberImportCandidate`, `buildMemberImportCandidates`, `applyMemberMappingPreservingRows`, `commitMemberImportCandidates`, and aggregate-only `/api/members/import-analyze` behavior as the membership-only regression baseline.
- Consumes: existing `MembershipPlan`, locale date order, workbook limits, and the existing contact/membership/payment persistence adapters.

- [ ] **Step 1: Verify the preserved baseline**

Run:

```bash
npm test -- src/lib/memberships/import-workbook.test.ts src/lib/memberships/migration-recipe.test.ts src/lib/memberships/import-commit.test.ts src/lib/memberships/member-import-candidates.test.ts src/app/api/members/import-analyze/route.test.ts src/components/members/import-members-csv-dialog.test.tsx src/components/members/import-members-preview.test.tsx
```

Expected: all current candidate-continuity, aggregate-analysis, scrolling, grouped-resolution, commit, and receipt tests pass.

- [ ] **Step 2: Review the current diff for membership-only contract gaps**

Confirm the code and tests prove these literals without deleting rows:

```ts
expect(summary.source).toBe(inputs.length);
expect(confirmDisabled).toBe(
  summary.needsResolution > 0 || summary.ready === 0
);
expect(receipt.map((row) => row.source_row)).toEqual([2, 3, 4]);
```

Fix only any discovered baseline gap through a failing test first. Do not add service or draft behavior in this task.

- [ ] **Step 3: Re-run focused tests and formatting checks**

Run:

```bash
npm test -- src/lib/memberships/import-workbook.test.ts src/lib/memberships/migration-recipe.test.ts src/lib/memberships/import-commit.test.ts src/lib/memberships/member-import-candidates.test.ts src/app/api/members/import-analyze/route.test.ts src/components/members/import-members-csv-dialog.test.tsx src/components/members/import-members-preview.test.tsx
npx prettier --check src/lib/memberships/member-import-candidates.ts src/lib/memberships/member-import-candidates.test.ts src/lib/memberships/import-commit.ts src/lib/memberships/import-commit.test.ts src/lib/memberships/migration-recipe.ts src/lib/memberships/migration-recipe.test.ts src/app/api/members/import-analyze/route.ts src/app/api/members/import-analyze/route.test.ts src/components/members/import-members-csv-dialog.tsx src/components/members/import-members-csv-dialog.test.tsx src/components/members/import-members-preview.tsx src/components/members/import-members-preview.test.tsx
```

- [ ] **Step 4: Commit the membership-only foundation**

```bash
git add src/lib/memberships src/app/api/members/import-analyze src/components/members/import-members-csv-dialog.tsx src/components/members/import-members-csv-dialog.test.tsx src/components/members/import-members-preview.tsx src/components/members/import-members-preview.test.tsx docs/changelog.md PRDs/roadmap.md
git commit -m "feat: resolve member import conflicts"
```

---

### Task 2: Add the contact-backed customer directory and membership-only metric boundary

**Files:**

- Create: `supabase/migrations/20260816183000_service_aware_resumable_member_import.sql` (create first with the Supabase CLI, then use this exact sortable name)
- Create: `src/lib/memberships/customer-directory.ts`
- Create: `src/lib/memberships/customer-directory.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/memberships/filters.ts`
- Modify: `src/lib/memberships/filters.test.ts`
- Modify: `src/lib/memberships/search.ts`
- Modify: `src/lib/memberships/search.test.ts`
- Modify: `src/components/members/membership-status-badge.tsx`
- Modify: `src/components/members/members-filters.tsx`
- Modify: `src/components/members/members-table.tsx`
- Create: `src/components/members/members-table.test.tsx`
- Modify: `src/app/(dashboard)/members/page.tsx`

**Interfaces:**

- Produces: security-invoker view `public.member_customer_directory`; `MemberCustomerDirectoryRow`; `isMembershipCustomer(row)`; `customerExpiry(row)`; status filter value `service_customer`.
- Consumes: `contacts`, `memberships`, `membership_plans`, `member_services`, `invoice_balances`, open follow-ups, existing membership filters/search, and canonical member presentation.

- [ ] **Step 1: Write failing pure directory tests**

Add tests that independently prove one row per contact, nullable membership semantics, expiry selection, and generic balance presentation:

```ts
it('maps a service-only contact without fabricating membership fields', () => {
  const row = normalizeCustomerDirectoryRow({
    contact_id: 'contact-1',
    membership_id: null,
    service_expiry: '2026-10-01',
    generic_balance: 900,
  });
  expect(row.customer_kind).toBe('service');
  expect(row.membership_id).toBeNull();
  expect(row.member_number).toBeNull();
  expect(row.display_expiry).toBe('2026-10-01');
});
```

Run `npm test -- src/lib/memberships/customer-directory.test.ts` and verify RED because the module does not exist.

- [ ] **Step 2: Add the security-invoker directory view**

In the migration, create `member_customer_directory` with one row per qualifying contact. Use one deterministic lateral membership selection and aggregated service/invoice subqueries:

```sql
CREATE OR REPLACE VIEW public.member_customer_directory
WITH (security_invoker = true) AS
SELECT
  c.account_id,
  c.id AS contact_id,
  m.id AS membership_id,
  CASE WHEN m.id IS NULL THEN 'service' ELSE 'membership' END AS customer_kind,
  m.member_number,
  m.plan_id,
  m.pricing_option_id,
  m.start_date,
  m.end_date AS membership_end_date,
  m.status AS membership_status,
  m.fee_amount,
  m.fee_status,
  services.display_expiry AS service_expiry,
  COALESCE(billing.outstanding_balance, 0)::NUMERIC(12,2) AS generic_balance,
  to_jsonb(c) AS contact,
  CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END AS plan
FROM public.contacts c
LEFT JOIN LATERAL (
  SELECT membership.* FROM public.memberships membership
  WHERE membership.account_id = c.account_id AND membership.contact_id = c.id
  ORDER BY membership.updated_at DESC, membership.id DESC LIMIT 1
) m ON true
LEFT JOIN public.membership_plans p ON p.id = m.plan_id
JOIN LATERAL (
  SELECT
    CASE
      WHEN COUNT(ms.id) = 0 THEN NULL
      ELSE COALESCE(
        MIN(ms.end_date) FILTER (WHERE ms.status = 'active' AND ms.end_date >= CURRENT_DATE),
        MAX(ms.end_date)
      )
    END AS display_expiry,
    COUNT(ms.id) AS service_count
  FROM public.member_services ms
  WHERE ms.account_id = c.account_id AND ms.contact_id = c.id
) services ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(ib.collectible_balance), 0) AS outstanding_balance
  FROM public.invoice_balances ib
  WHERE ib.account_id = c.account_id AND ib.contact_id = c.id AND ib.state = 'open'
) billing ON true
WHERE m.id IS NOT NULL OR services.service_count > 0;
```

Use the final accepted `invoice_balances` balance column (`collectible_balance` if present) and account-local date semantics already exposed by the service detail view rather than `CURRENT_DATE` if the live schema requires it. Explicitly grant SELECT to `authenticated, service_role` and revoke anon.

- [ ] **Step 3: Implement directory types and filter/search adapters**

Define:

```ts
export type MemberCustomerKind = 'membership' | 'service';
export interface MemberCustomerDirectoryRow {
  account_id: string;
  contact_id: string;
  membership_id: string | null;
  customer_kind: MemberCustomerKind;
  member_number: number | null;
  plan_id: string | null;
  membership_end_date: string | null;
  service_expiry: string | null;
  generic_balance: number;
  contact: Contact;
  plan: MembershipPlan | null;
}
```

Extend the status facet with `{ value: 'service_customer', label: 'Service customers' }`. `applyMemberFilters` must exclude service-only rows when a plan or membership fee-status filter is active, while an empty plan filter leaves them visible. Add view-flat churn-risk filtering rather than relying on a relation embed.

- [ ] **Step 4: Convert All members to the directory source**

Keep the current table columns and presentation. Service-only rows render literal `—` for Member ID and Plan, a neutral `Service customer` badge, `display_expiry`, and generic balance without `FeeStatusBadge`. All membership actions and bulk payment/reminder/delete actions require `membership_id`; service-only rows retain Details, Follow up, Add purchase, assignment, and notes. Change `onSelect` to:

```ts
onSelect: (customer: { contactId: string; membershipId: string | null }) => void;
```

Keep membership-only rows byte-for-byte equivalent in visible values and action availability.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- src/lib/memberships/customer-directory.test.ts src/lib/memberships/filters.test.ts src/lib/memberships/search.test.ts src/components/members/members-table.test.tsx
```

Expected: membership contact once, service-only contact once, multiple services once, service expiry/balance correct, service status filter correct, membership-only actions unchanged.

- [ ] **Step 6: Commit the customer directory**

```bash
git add supabase/migrations/20260816183000_service_aware_resumable_member_import.sql src/lib/memberships/customer-directory.ts src/lib/memberships/customer-directory.test.ts src/lib/memberships/filters.ts src/lib/memberships/filters.test.ts src/lib/memberships/search.ts src/lib/memberships/search.test.ts src/types/index.ts src/components/members/membership-status-badge.tsx src/components/members/members-filters.tsx src/components/members/members-table.tsx src/components/members/members-table.test.tsx 'src/app/(dashboard)/members/page.tsx'
git commit -m "feat: list service customers in members"
```

---

### Task 3: Make customer detail, Add membership, sales, and service renewals contact-capable

**Files:**

- Modify: `src/components/members/member-detail-view.tsx`
- Create: `src/components/members/member-detail-view.test.tsx`
- Modify: `src/components/members/product-service-sale-checkout.tsx`
- Modify: `src/components/members/product-service-sale-checkout.test.tsx`
- Modify: `src/components/members/product-service-sale-dialog.tsx`
- Modify: `src/components/members/product-service-sale-dialog.test.tsx`
- Modify: `src/components/members/service-renewal-action-lists.tsx`
- Create: `src/components/members/service-renewal-action-lists.test.tsx`
- Modify: `src/app/api/member-checkouts/route.ts`
- Modify: `src/app/api/member-checkouts/route.test.ts`
- Modify: `supabase/migrations/20260816183000_service_aware_resumable_member_import.sql`
- Modify: `src/app/(dashboard)/members/page.tsx`

**Interfaces:**

- Produces: `CustomerRef { contact: Contact; membership: Membership | null }`; detail props `contactId` + optional `membershipId`; contact-only sale/service-renewal RPC path.
- Consumes: `MemberForm.seedContact`, `append_catalog_selections`, existing payment allocation trigger, `invoice_balances`, `member_service_details`, notes/follow-ups, and the member credit view only when a real membership exists.

- [ ] **Step 1: Write failing contact-only checkout route and component tests**

```ts
it('accepts a service renewal with contact_id and no membership_id', async () => {
  const response = await POST(
    jsonRequest({
      mode: 'service_renewal',
      contact_id: CONTACT_ID,
      selections: [SERVICE_SELECTION],
      collection: { amount: 0, method: 'cash' },
      idempotency_key: KEY,
    })
  );
  expect(response.status).toBe(201);
  expect(rpc).toHaveBeenCalledWith(
    'perform_contact_checkout',
    expect.anything()
  );
});
```

Run the route and checkout tests; verify RED because the current component requires `membership` and the route/RPC require membership for sale.

- [ ] **Step 2: Add `perform_contact_checkout(JSONB)`**

Implement an agent-gated, account-scoped transaction for `sale | service_renewal` that validates the contact, optionally locks and validates the supplied membership belongs to that contact/account, creates an invoice with nullable membership, calls `append_catalog_selections`, skips member credit when membership is null, inserts a payment when amount is positive, and returns the standard checkout result. Revoke `PUBLIC, anon`, grant only `authenticated`, and keep the internal auth check.

- [ ] **Step 3: Update the Route Handler dispatch**

For `sale | service_renewal`, allow `membership_id` to be omitted; for membership modes retain exact existing validation. Dispatch contact-only/optional membership sales to `perform_contact_checkout`; leave join/convert/renewal dispatch unchanged.

- [ ] **Step 4: Refactor sale UI around a customer reference**

Use:

```ts
interface ProductServiceSaleCheckoutProps {
  contact: Contact;
  membership?: Membership | null;
  // existing callbacks and mode props
}
```

Send the authoritative contact ID and include membership ID only when present. Query membership credit only when a membership exists; a service-only customer starts with zero credit and the copy says `Customer` rather than implying a fabricated member balance.

- [ ] **Step 5: Make detail contact-backed and conditionally render membership sections**

Load contact by `contactId`, then load an optional membership by supplied ID or contact. Query services, generic invoices, notes, and follow-ups by contact; query attendance, membership periods, mandates, and membership lifecycle only when membership exists. For service-only customers, retain identity, Products & services, Billing, Notes & follow-ups, Add purchase, and Add membership. Open Add membership with:

```tsx
<MemberForm
  seedContact={{
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
  }}
/>
```

Hide membership, AutoPay, attendance, plan renewal, freeze/cancel/edit sections when `membership === null`.

- [ ] **Step 6: Remove membership lookup from service renewal actions**

Use `row.contact_id` directly for detail, reminder, follow-up, and checkout. If `row.membership_id` is present, include it; otherwise renew with the same contact and null membership. The row click must open customer detail even for service-only rows.

- [ ] **Step 7: Run focused tests and commit**

```bash
npm test -- src/app/api/member-checkouts/route.test.ts src/components/members/product-service-sale-checkout.test.tsx src/components/members/product-service-sale-dialog.test.tsx src/components/members/member-detail-view.test.tsx src/components/members/service-renewal-action-lists.test.tsx
git add supabase/migrations/20260816183000_service_aware_resumable_member_import.sql src/app/api/member-checkouts/route.ts src/app/api/member-checkouts/route.test.ts src/components/members/product-service-sale-checkout.tsx src/components/members/product-service-sale-checkout.test.tsx src/components/members/product-service-sale-dialog.tsx src/components/members/product-service-sale-dialog.test.tsx src/components/members/member-detail-view.tsx src/components/members/member-detail-view.test.tsx src/components/members/service-renewal-action-lists.tsx src/components/members/service-renewal-action-lists.test.tsx 'src/app/(dashboard)/members/page.tsx'
git commit -m "feat: manage service-only customers"
```

---

### Task 4: Add author-private, revision-safe import draft storage and APIs

**Files:**

- Modify: `supabase/migrations/20260816183000_service_aware_resumable_member_import.sql`
- Create: `src/lib/memberships/import-draft.ts`
- Create: `src/lib/memberships/import-draft.test.ts`
- Create: `src/lib/memberships/import-draft-admin.ts`
- Create: `src/app/api/members/import-draft/route.ts`
- Create: `src/app/api/members/import-draft/route.test.ts`
- Create: `src/app/api/members/import-draft/cleanup/route.ts`
- Create: `src/app/api/members/import-draft/cleanup/route.test.ts`
- Modify: `next.config.ts`
- Modify: `vercel.json`

**Interfaces:**

- Produces: `MemberImportDraftRecord`, `MemberImportDraftState`, stable API errors `draft_conflict | draft_expired | draft_unavailable | source_mismatch`, GET/POST/PATCH/DELETE draft lifecycle, service-only cleanup route.
- Consumes: `MAX_IMPORT_WORKBOOK_BYTES`, `memberImportFileKind`, `requireRole('agent')`, `AUTOMATION_CRON_SECRET`, Supabase authenticated Storage client for user operations, server-only service client for cleanup.

- [ ] **Step 1: Write failing validation and CAS tests**

```ts
it('rejects a stale revision without accepting its state', async () => {
  const result = await saveDraft(
    { id: 'draft', revision: 4, state: STATE },
    fakeDb({ revision: 5 })
  );
  expect(result).toEqual({ ok: false, code: 'draft_conflict', revision: 5 });
});

it('does not serialize signed urls in draft state', () => {
  expect(
    validateDraftState({ ...STATE, signedUrl: 'https://example.test' })
  ).toEqual({ ok: false, code: 'invalid_state' });
});
```

Run `npm test -- src/lib/memberships/import-draft.test.ts` and verify RED.

- [ ] **Step 2: Add draft table, CAS RPC, bucket, and policies**

Create `member_import_drafts` with UUID PK, `account_id`, `author_id`, source metadata, selected sheet, wizard step, mapping/date order, aggregate recipe metadata, normalized JSONB state, revision, saved/expiry timestamps, and status. Add a partial unique index for one active draft per `(account_id, author_id)`, FK indexes, and `updated_at` trigger.

RLS predicates for SELECT/INSERT/UPDATE/DELETE must require both:

```sql
author_id = (SELECT auth.uid())
AND public.is_account_member(account_id, 'agent')
```

The CAS function must update only when `revision = p_expected_revision`, increment exactly once, extend expiry by 30 days, and return a distinguishable conflict without overwriting. Revoke default execution.

Create private bucket `member-import-drafts` with the existing workbook MIME types and file-size limit. Object paths are `{account_id}/{author_id}/{draft_id}/{filename}`. Storage SELECT/INSERT/UPDATE/DELETE policies require path account/author to match the selected branch membership and `auth.uid()`. Never persist a signed URL.

- [ ] **Step 3: Implement server validation and draft routes**

`POST` accepts multipart `file`, hashes bytes with SHA-256, validates kind/size before Storage upload, creates the draft immediately, and compensates by removing the object if row creation fails. `PATCH` validates normalized JSON shape and calls CAS. `DELETE` deletes through the Storage API first, tolerates missing object, then deletes the current author's current-account row. `GET` returns only the current author's current-account unexpired active draft and creates a short-lived signed read URL only for the response.

Increase `experimental.proxyClientMaxBodySize` to `'12mb'` so a 10 MiB workbook plus multipart framing is not truncated. Add a daily Vercel cron for the cleanup route.

- [ ] **Step 4: Implement idempotent expiry cleanup**

The cron uses the service client only after shared-secret authorization, claims a bounded batch with `FOR UPDATE SKIP LOCKED`, removes each object through the Storage API, treats missing objects as success, then deletes or terminally marks its claimed row. It must never delete directly from `storage.objects`.

- [ ] **Step 5: Run tests and schema contract checks**

```bash
npm test -- src/lib/memberships/import-draft.test.ts src/app/api/members/import-draft/route.test.ts src/app/api/members/import-draft/cleanup/route.test.ts
```

Add SQL contract assertions that the table has RLS, the view is security-invoker, public execution is revoked, storage bucket is private, and every FK/filter path is indexed.

- [ ] **Step 6: Commit private drafts**

```bash
git add supabase/migrations/20260816183000_service_aware_resumable_member_import.sql src/lib/memberships/import-draft.ts src/lib/memberships/import-draft.test.ts src/lib/memberships/import-draft-admin.ts src/app/api/members/import-draft src/app/api/members/import-draft/cleanup next.config.ts vercel.json
git commit -m "feat: persist private member import drafts"
```

---

### Task 5: Wire autosave, save-before-close, resume, conflict recovery, and Start fresh into the existing dialog

**Files:**

- Create: `src/hooks/use-member-import-draft.ts`
- Create: `src/hooks/use-member-import-draft.test.tsx`
- Modify: `src/components/members/import-members-csv-dialog.tsx`
- Modify: `src/components/members/import-members-csv-dialog.test.tsx`
- Modify: `src/lib/memberships/import-workbook.ts`
- Modify: `src/lib/memberships/import-workbook.test.ts`

**Interfaces:**

- Produces: controlled draft hook with `load`, `initialize`, debounced `save`, `flush`, `discard`, `reload`, `saveState`, and `lastAcknowledgedRevision`.
- Consumes: draft APIs from Task 4 and the dialog's existing workbook, sheet, mapping, candidate, resolution, exclusion, and step state.

- [ ] **Step 1: Write failing hook lifecycle tests**

Use fake timers and deferred fetch promises to prove:

```ts
expect(status.current).toBe('saving');
await acknowledgeRevision(3);
expect(status.current).toBe('saved');
expect(await close()).toBe(true);
```

Also prove close remains false on failed flush, stale revision stops autosave, Reload replaces stale memory, and Start fresh deletes only after confirmation.

- [ ] **Step 2: Implement normalized draft serialization**

Persist `step`, `worksheet`, `mapping`, `dateOrder`, recipe metadata, candidates including stable keys/idempotency keys, edits, grouped resolutions, exclusions, and receipt outcomes. Exclude raw workbook bytes and signed URLs. Hash/filename/kind/size must match the server record on resume.

- [ ] **Step 3: Add immediate initialize and debounced autosave**

Upload/source candidate initialization saves immediately. Meaningful state changes debounce briefly, carry the last acknowledged revision, and show only `Saving…`, `Saved just now`/localized saved time, or `Couldn’t save draft` with Retry. Use a polite live region.

- [ ] **Step 4: Enforce save-before-close for every dismissal path**

`Save & close`, cross icon, overlay/escape dismissal all call the same `requestClose()` and await `flush()`. An untouched Upload step closes without creating a draft. A failed close-save leaves the dialog open and offers Retry or confirmed Discard draft.

- [ ] **Step 5: Resume and revalidation entry point**

On Import open, GET the active draft. Parse the signed private workbook, restore normalized state, re-run local workbook/hash checks, then revalidate mutable references through the candidate builder. Show the compact filename/last-saved continuation notice and only then expose Start fresh.

- [ ] **Step 6: Verify the complete draft UI matrix**

```bash
npm test -- src/hooks/use-member-import-draft.test.tsx src/components/members/import-members-csv-dialog.test.tsx src/lib/memberships/import-workbook.test.ts
```

Cover another-device resume, autosave payload completeness, failed close-save, stale conflict, expired draft, Start fresh confirmation text naming the file, and untouched close.

- [ ] **Step 7: Commit resumable wizard behavior**

```bash
git add src/hooks/use-member-import-draft.ts src/hooks/use-member-import-draft.test.tsx src/components/members/import-members-csv-dialog.tsx src/components/members/import-members-csv-dialog.test.tsx src/lib/memberships/import-workbook.ts src/lib/memberships/import-workbook.test.ts
git commit -m "feat: resume member imports across devices"
```

---

### Task 6: Extend mapping vocabulary and candidate aggregation for membership, service, and combined rows

**Files:**

- Modify: `src/lib/memberships/member-field-registry.ts`
- Modify: `src/lib/memberships/member-field-registry.test.ts`
- Modify: `src/lib/memberships/import-commit.ts`
- Modify: `src/lib/memberships/import-commit.test.ts`
- Modify: `src/lib/memberships/migration-recipe.ts`
- Modify: `src/lib/memberships/migration-recipe.test.ts`
- Modify: `src/lib/memberships/member-import-candidates.ts`
- Modify: `src/lib/memberships/member-import-candidates.test.ts`
- Modify: `src/components/members/import-members-csv-dialog.tsx`

**Interfaces:**

- Produces: new field keys `offering`, `membership_plan`, `membership_option`, `service`, `service_option`, `service_trainer`, `service_start`, `service_end`, `service_sold_price`, `service_status`; `MemberImportMembershipComponent`; `MemberImportServiceComponent`; customer grouping and duplicate-service detection.
- Consumes: `MembershipPlan[]`, active `CatalogItem[]`, active `Trainer[]`, active `TrainerRate[]`, date order/today, existing candidate row preservation.

- [ ] **Step 1: Write failing field-registry tests**

```ts
expect(autoMapMemberColumns(['Package'])).toEqual(['offering']);
expect(autoMapMemberColumns(['Service'])).toEqual(['service']);
expect(validateMemberMapping(['phone', 'service']).ok).toBe(true);
expect(validateMemberMapping(['phone']).ok).toBe(false);
```

Verify RED before editing registry/auto-map code.

- [ ] **Step 2: Add exact grouped vocabulary and aliases**

Rename visible Plan destination to Membership plan while retaining legacy key compatibility during draft deserialization. Generic Package/Offering maps to Plan or service. Exact membership headers prefer Membership plan; exact service headers prefer Service. Merchandise never appears.

- [ ] **Step 3: Write failing candidate aggregation tests**

Cover service-only readiness, explicit combined components, repeated compatible rows becoming one customer, latest membership plus retained services, conflicting identity, and exact duplicate purchase:

```ts
expect(group.membership?.sourceKey).toBe('sheet:4');
expect(group.services.map((service) => service.sourceKey)).toEqual([
  'sheet:2',
  'sheet:3',
  'sheet:4',
]);
expect(duplicate.issues).toContainEqual(
  expect.objectContaining({
    code: 'duplicate-service-purchase',
    severity: 'blocking',
  })
);
```

- [ ] **Step 4: Implement customer grouping without shared-phone false positives**

Group by normalized phone plus compatible legacy identity. Merge compatible profile values, block conflicting names/identities, keep at most the latest valid membership component, retain every distinct service purchase, and let a combined row carry both components. Stable group and purchase idempotency keys are created once and survive rebuilds/resume.

- [ ] **Step 5: Extend summary/filter/search counts**

Summary includes source rows, unique customers, memberships, services, combined invoices, service-only invoices, payments, automatic exclusions, explicit exclusions, and unresolved rows. Search includes customer/service/trainer/offering labels without exposing data to analysis APIs.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- src/lib/memberships/member-field-registry.test.ts src/lib/memberships/import-commit.test.ts src/lib/memberships/migration-recipe.test.ts src/lib/memberships/member-import-candidates.test.ts
git add src/lib/memberships/member-field-registry.ts src/lib/memberships/member-field-registry.test.ts src/lib/memberships/import-commit.ts src/lib/memberships/import-commit.test.ts src/lib/memberships/migration-recipe.ts src/lib/memberships/migration-recipe.test.ts src/lib/memberships/member-import-candidates.ts src/lib/memberships/member-import-candidates.test.ts src/components/members/import-members-csv-dialog.tsx
git commit -m "feat: model service-aware member imports"
```

---

### Task 7: Implement offering, service-option, trainer, sold-price, dates, status, and payment resolution

**Files:**

- Create: `src/lib/memberships/member-import-services.ts`
- Create: `src/lib/memberships/member-import-services.test.ts`
- Modify: `src/lib/memberships/member-import-candidates.ts`
- Modify: `src/lib/memberships/member-import-candidates.test.ts`
- Modify: `src/components/members/import-members-preview.tsx`
- Modify: `src/components/members/import-members-preview.test.tsx`
- Modify: `src/components/members/import-members-csv-dialog.tsx`

**Interfaces:**

- Produces: `resolveGroupedOffering`, `resolveGroupedService`, `resolveGroupedTrainer`, `resolveDuplicateService`, `buildImportedServiceIntent`; outcome kind `membership | service | combined`.
- Consumes: active catalogue/trainer/rate facts and existing `Select`, `DatePicker`, `CurrencyInput`, `Accordion`, `Badge`, `SearchInput`, `Chip` primitives.

- [ ] **Step 1: Write failing pure service-resolution tests**

Cover active-only matching, trainer-required rate enforcement, no fallback, blank sold price, explicit sold price, explicit expiry override notice, invalid date range, cancelled status, and independent combined/service-only equations.

```ts
expect(resolveImportedSoldPrice({ source: '', option, trainerRate })).toBe(
  1800
);
expect(resolveImportedSoldPrice({ source: '1450', option, trainerRate })).toBe(
  1450
);
expect(buildServiceIntent(noRequiredTrainerRate).errors).toContain(
  'trainer-rate-required'
);
```

- [ ] **Step 2: Implement active account-owned reference resolution**

Mixed offering values resolve once to either plan+option or service+option. Explicit columns skip classification but still require active references. Revalidation drops stale/archived/cross-account IDs and returns explicit blocking reasons.

- [ ] **Step 3: Implement sold price, dates, status, and duplicate rules**

Blank price uses configured standard/trainer rate; mapped valid price is preserved. Service start fallback order is mapped start → same-row membership start → account-local today. Explicit expiry wins with a mismatch notice; expiry must be after start. Only explicit cancelled persists cancelled; other status is date-derived. Ignore trainer on non-trainer service only with visible notice.

- [ ] **Step 4: Extend Resolve issues UI**

Grouped cards resolve offering classification, service/option, trainer, missing trainer rate, and duplicates. Every candidate shows an unmodified neutral/type badge for Membership, Service, or Membership + service, resolved offering, trainer, dates, sold price, payment equation, and disposition. Preserve body scrolling and Search → counted filters order on desktop/mobile.

- [ ] **Step 5: Verify UI and engine**

```bash
npm test -- src/lib/memberships/member-import-services.test.ts src/lib/memberships/member-import-candidates.test.ts src/components/members/import-members-preview.test.tsx src/components/members/import-members-csv-dialog.test.tsx
```

- [ ] **Step 6: Commit service resolution**

```bash
git add src/lib/memberships/member-import-services.ts src/lib/memberships/member-import-services.test.ts src/lib/memberships/member-import-candidates.ts src/lib/memberships/member-import-candidates.test.ts src/components/members/import-members-preview.tsx src/components/members/import-members-preview.test.tsx src/components/members/import-members-csv-dialog.tsx src/components/members/import-members-csv-dialog.test.tsx
git commit -m "feat: resolve imported services and trainers"
```

---

### Task 8: Add the import-specific atomic customer transaction and typed executor

**Files:**

- Modify: `supabase/migrations/20260816183000_service_aware_resumable_member_import.sql`
- Create: `src/lib/memberships/import-executor.ts`
- Create: `src/lib/memberships/import-executor.test.ts`
- Modify: `src/lib/memberships/import-commit.ts`
- Modify: `src/lib/memberships/import-commit.test.ts`
- Create: `src/lib/memberships/member-import-schema-contract.test.ts`

**Interfaces:**

- Produces: agent-only RPC `perform_member_import_customer(JSONB)`; typed `executeMemberImportCustomerGroup`; reconciled source-row results for contact, membership, service, invoice, and payment.
- Consumes: resolved customer-group intent, existing contact dedupe/origin rules, membership period/invoice triggers, invoice/payment allocation helpers, immutable line/service/trainer snapshots, stable idempotency keys.

- [ ] **Step 1: Write failing executor contract tests**

Assert exact JSON payload stripping browser-authored account/author, result mapping, group-level error containment, and stable retry behavior.

- [ ] **Step 2: Add import audit/idempotency schema**

Create a durable account-scoped import outcome table keyed by group/purchase idempotency keys, source key, and source row. Store only IDs/outcomes needed for retries/receipts, not raw notes/full addresses. Enable RLS with agent read for the account and transaction-only writes. Index every account/group/purchase lookup.

- [ ] **Step 3: Implement `perform_member_import_customer(JSONB)`**

The function must:

1. require `is_account_member(account_id, 'agent')` using the selected account supplied by the authenticated API boundary;
2. return prior durable outcomes on the same stable group key;
3. lock/revalidate contact and every account-owned plan/option/catalogue/trainer/rate reference;
4. attach/create the deduped contact while preserving immutable automated origin/ownership;
5. optionally insert one membership and allow its initial period trigger to create the membership invoice/line;
6. merge a same-source membership+service onto that just-created invoice only inside this transaction;
7. create one separate invoice for each other service source purchase;
8. snapshot explicit imported sold price/expiry/cancelled state with `override_reason = 'Historical member import'` and `overridden_by = auth.uid()`;
9. insert member service and trainer assignment with nullable membership but real contact;
10. record row payments and rely on deterministic proportional allocation;
11. skip member credit consumption;
12. persist privacy-safe source outcomes; and
13. raise on any invariant failure so the entire customer group rolls back.

Do not dispatch automations or WhatsApp messages. Revoke all execution from `PUBLIC, anon`; grant `authenticated` only and retain the internal agent check.

- [ ] **Step 4: Add SQL schema/security contract tests**

Read the generated migration and assert behaviorally meaningful clauses: security-invoker view, RLS enabled, author-only draft policies, agent check inside import RPC, explicit revokes, unique idempotency constraints, private bucket, CAS predicate, and required indexes.

- [ ] **Step 5: Run focused tests and commit**

```bash
npm test -- src/lib/memberships/import-executor.test.ts src/lib/memberships/import-commit.test.ts src/lib/memberships/member-import-schema-contract.test.ts
git add supabase/migrations/20260816183000_service_aware_resumable_member_import.sql src/lib/memberships/import-executor.ts src/lib/memberships/import-executor.test.ts src/lib/memberships/import-commit.ts src/lib/memberships/import-commit.test.ts src/lib/memberships/member-import-schema-contract.test.ts
git commit -m "feat: import customer purchases atomically"
```

---

### Task 9: Enable service-aware confirmation, commit, receipts, revalidation, and draft cleanup

**Files:**

- Modify: `src/components/members/import-members-csv-dialog.tsx`
- Modify: `src/components/members/import-members-csv-dialog.test.tsx`
- Modify: `src/components/members/import-members-preview.tsx`
- Modify: `src/components/members/import-members-preview.test.tsx`
- Modify: `src/lib/memberships/import-commit.ts`
- Modify: `src/lib/memberships/import-commit.test.ts`
- Modify: `src/lib/memberships/import-executor.ts`
- Modify: `src/app/api/members/import-draft/route.ts`

**Interfaces:**

- Produces: exact service-aware confirmation equation, customer-group commit loop, expanded privacy-safe receipt, post-success draft cleanup warning/retry.
- Consumes: candidate summaries, transaction executor, draft hook, locale formatting, original source order.

- [ ] **Step 1: Write failing summary and receipt tests**

```ts
expect(summary).toMatchObject({
  sourceRows: 4,
  customers: 2,
  memberships: 1,
  services: 3,
  combinedInvoices: 1,
  serviceOnlyInvoices: 2,
  payments: 3,
});
expect(receipt[0]).toMatchObject({
  offering_type: 'membership + service',
  service_outcome: 'created',
});
```

- [ ] **Step 2: Render the exact confirmation equation**

Show source rows, unique customers, memberships, services, combined invoices, service-only invoices, payments, automatic exclusions, explicit exclusions, and unresolved. Confirm/import stays disabled while any included row is unresolved or no customer group is ready.

- [ ] **Step 3: Commit ready groups and retain every source result**

Process groups independently through `executeMemberImportCustomerGroup`. A group failure yields failed receipt rows for all its source rows without affecting other groups. Tag/custom fields remain best-effort after the transaction and produce partial receipt detail.

- [ ] **Step 4: Expand privacy-safe receipt**

Include source row/key-safe identifier, disposition, offering type/name, created/attached customer, membership, service, invoice, payment, and recovery/error message. Continue emitting only phone suffix, never full phone, contact/membership IDs, raw notes, addresses, or signed URLs.

- [ ] **Step 5: Complete and clean the draft**

After successful import and receipt creation, call draft cleanup. If object/row cleanup fails, keep committed purchases, display a cleanup warning, and let expiry cleanup retry. A stable retry must return existing transaction outcomes.

- [ ] **Step 6: Run regression matrix and commit**

```bash
npm test -- src/lib/memberships/import-commit.test.ts src/lib/memberships/member-import-candidates.test.ts src/lib/memberships/member-import-services.test.ts src/lib/memberships/import-executor.test.ts src/components/members/import-members-preview.test.tsx src/components/members/import-members-csv-dialog.test.tsx
git add src/components/members/import-members-csv-dialog.tsx src/components/members/import-members-csv-dialog.test.tsx src/components/members/import-members-preview.tsx src/components/members/import-members-preview.test.tsx src/lib/memberships/import-commit.ts src/lib/memberships/import-commit.test.ts src/lib/memberships/import-executor.ts src/app/api/members/import-draft/route.ts
git commit -m "feat: commit service-aware member imports"
```

---

### Task 10: Apply and verify the migration through the approved Supabase connector

**Files:**

- Modify if verification finds defects: `supabase/migrations/20260816183000_service_aware_resumable_member_import.sql`

**Interfaces:**

- Produces: applied test-environment schema with verified grants/RLS/Storage and clean advisors.
- Consumes: Supabase connector `list_projects`, `apply_migration`, `execute_sql`, `list_tables`, `get_advisors`.

- [ ] **Step 1: Preflight the migration locally**

Run:

```bash
npx supabase@latest migration list --local
npm test -- src/lib/memberships/member-import-schema-contract.test.ts
```

Confirm the file sorts after the current latest migration and contains no `auth.role()`, no public view without `security_invoker`, and no storage-object metadata deletion.

- [ ] **Step 2: Apply once to the approved Test project**

Use the Supabase connector migration tool with the complete reviewed SQL. Do not run `supabase db push` and do not apply to Production during this task unless separately authorized.

- [ ] **Step 3: Verify schema and security with read-only SQL**

Check:

```sql
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('member_import_drafts', 'member_import_outcomes');
SELECT viewname, definition FROM pg_views WHERE viewname = 'member_customer_directory';
SELECT bucket.id, bucket.public, bucket.file_size_limit FROM storage.buckets bucket WHERE bucket.id = 'member-import-drafts';
SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename IN ('member_import_drafts', 'objects');
SELECT routine_name, security_type FROM information_schema.routines WHERE routine_name IN ('save_member_import_draft', 'perform_member_import_customer');
```

Exercise author A/author B, branch A/branch B, viewer/agent, stale revision, exact retry, service-only transaction, combined transaction, rollback failure, and idempotent cleanup in a transaction that rolls back test fixtures.

- [ ] **Step 4: Run advisors and repair before proceeding**

Run security and performance advisors through the connector. Fix missing FK/RLS indexes, mutable search paths, default function grants, and policy initplan warnings, then reapply only through an approved migration mechanism consistent with the project’s migration-history rules.

- [ ] **Step 5: Commit any verification repairs**

```bash
git add supabase/migrations/20260816183000_service_aware_resumable_member_import.sql src/lib/memberships/member-import-schema-contract.test.ts
git commit -m "fix: harden member import persistence"
```

Skip this commit when verification required no file changes.

---

### Task 11: Update domain/product documentation and operational configuration

**Files:**

- Modify: `docs/gym-domain.md`
- Modify: `PRDs/products_services_and_trainer_pricing.md`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Modify: `docs/superpowers/specs/2026-08-16-service-aware-resumable-member-import-design.md` only if implementation uncovered a necessary approved-design clarification

**Interfaces:**

- Produces: durable documentation of shipped customer identity, import transaction, draft privacy, operational cleanup, and non-goals.
- Consumes: verified implementation and final migration name/application evidence.

- [ ] **Step 1: Update domain rules**

Document that Members is a contact-backed customer directory, service-only customers have null membership identifiers, membership/attendance/AutoPay metrics remain membership-only, contact-only sales/renewals are allowed, import preserves historical sold price/expiry through a dedicated audited transaction, and drafts are private/revisioned/30-day expiring.

- [ ] **Step 2: Update product scope and roadmap**

Move service-aware resumable import to shipped/built, remove stale pending language, preserve explicit non-goals, and record the cleanup cron/private bucket operational requirement.

- [ ] **Step 3: Add a terse changelog entry**

Name the migration and key code paths; call out author-private drafts, contact-backed service customers, per-customer atomicity, stable idempotency, and that merchandise/multiple numbered service columns remain out of scope.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/gym-domain.md PRDs/products_services_and_trainer_pricing.md docs/changelog.md PRDs/roadmap.md docs/superpowers/specs/2026-08-16-service-aware-resumable-member-import-design.md
git commit -m "docs: record resumable service imports"
```

Only add the spec file if it actually changed.

---

### Task 12: Full verification, browser hardening, and branch handoff

**Files:**

- Modify only for defects found: all task files above

**Interfaces:**

- Produces: fresh evidence for tests, types, lint, formatting, build, migration security, and desktop/mobile behavior.
- Consumes: completed implementation, applied Test schema, Impeccable hardening guidance, and the finishing-a-development-branch workflow.

- [ ] **Step 1: Load the UI craft floor immediately before final UI edits**

Read `.agents/skills/impeccable/reference/craft-floor.md`, then run the Impeccable detector against the changed member import/detail/table files. Fix all in-scope accessibility, overflow, responsive, focus, and state findings in one bounded pass.

- [ ] **Step 2: Run the complete automated verification**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Read full outputs and fix every feature regression. Do not claim completion from partial commands.

- [ ] **Step 3: Run migration/security verification again**

Re-run the schema contract test, connector table/function/policy checks, and Supabase security/performance advisors after final edits.

- [ ] **Step 4: Start the app and perform one bounded browser pass**

Run `npm run dev`, then verify desktop and mobile together:

- membership-only import and unchanged receipt;
- service-only import;
- combined membership + service row;
- repeated service rows for one customer;
- missing catalogue/trainer rate then Save & close;
- cross-device-style resume/reload;
- autosave failure and Retry;
- stale revision and Reload saved draft;
- Start fresh confirmation;
- successful receipt and draft cleanup;
- service-only All members row, detail, Add membership, Add purchase, and service renewal.

Check keyboard order, Escape/save-before-close, live save announcement, focus restoration, scroll containment, long filename, narrow phone, zoom, empty catalogue, and footer reachability. Capture desktop/mobile screenshots, fix all observed defects in one batch, and confirm with at most one second pass.

- [ ] **Step 5: Review the final diff and commit verification fixes**

```bash
git status --short
git diff --check
git diff --stat d9b9fba..HEAD
```

Commit only actual verification repairs with a scoped message such as `fix: harden resumable member import`.

- [ ] **Step 6: Use the finishing workflow without publishing**

Invoke `superpowers:finishing-a-development-branch`, re-run the full test suite as required, and keep `codex/member-import-resolution` as-is because the user explicitly said not to publish or open a PR. Report commits, migration application environment/evidence, browser coverage, and any genuine external blocker.

---

## Self-review record

- **Spec coverage:** Tasks 2–3 cover the service-customer foundation; Tasks 4–5 cover author-private resumable drafts and CAS; Tasks 6–7 cover mapping/aggregation/service resolution; Tasks 8–9 cover atomic accounting/idempotency/receipts; Tasks 10–12 cover migration application, docs, security, and browser verification.
- **Membership-only preservation:** Task 1 checkpoints the existing behavior before schema/UI expansion; Tasks 2, 3, 6, 9, and 12 explicitly retain membership-only queries, actions, metrics, and receipt regressions.
- **Privacy/security:** Task 4 prevents signed URLs/raw workbooks from JSON state and enforces author+account RLS/Storage policies; Task 8 restricts the import override to one audited RPC; Task 10 verifies actual policies/grants/advisors.
- **Type consistency:** `MemberCustomerDirectoryRow.membership_id` and `CustomerRef.membership` remain nullable from directory through detail, checkout, renewal, and import. Candidate service components and transaction intent use the same active catalogue/trainer/rate identifiers.
- **Placeholder scan:** The plan contains no TBD/TODO/“implement later” steps; every implementation task names concrete behavior, files, interfaces, tests, commands, and expected results.
