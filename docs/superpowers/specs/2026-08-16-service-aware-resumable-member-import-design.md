# Service-aware, resumable member import design

## Goal

Extend the Members CSV/XLSX import so a source row may create a membership, a service purchase, or both, while preserving historical sold prices and service dates. Service-only customers must remain first-class and manageable without a fabricated membership. An unfinished import must be author-private, autosaved, resumable across devices, and safely discardable through **Start fresh**.

## Audience and outcome

Owners, admins, and front-desk agents use import while migrating a gym from another system. Their files commonly mix memberships, personal-training packages, other duration-based services, repeated rows for one customer, historical sold prices, and incomplete catalogue names.

The completed workflow must let an operator:

1. upload a CSV or XLSX workbook;
2. map membership and service columns, including a mixed package column;
3. resolve plans, services, options, trainers, duplicate purchases, identities, and payment equations;
4. save and close the import to configure a missing plan, service, option, trainer, or trainer rate;
5. resume the exact draft later, including on another device;
6. review a source-row equation before import;
7. commit each ready customer without partial financial state; and
8. download a privacy-safe receipt explaining every included, excluded, partial, or failed source row.

Success means imported service-only customers remain visible and actionable in Members, membership metrics remain truthful, and a retry or resume cannot duplicate contacts, memberships, invoices, services, or payments.

## Selected approach

Use a contact-backed customer aggregate throughout Members, then extend the existing conflict-resolving import candidate model with optional membership and service purchase components.

The work ships in two dependent phases:

1. **Service-customer foundation:** make contacts with services but no membership visible and manageable across All members, customer detail, Add membership, Add purchase, and service renewals.
2. **Service-aware, resumable import:** add service mapping and resolution, an import-specific transactional database boundary, private server-side drafts, resume, Start fresh, and expiry cleanup.

No synthetic membership is created for a service-only customer. A hidden or placeholder membership would corrupt membership counts, attendance eligibility, membership renewal queues, dues, plan revenue, and AutoPay semantics.

## Explicit non-goals

- Importing merchandise, stock, fulfilment, classes, payroll, commission, or PT session allowances.
- Importing multiple services from numbered columns on one row. Multiple services use repeated source rows.
- Persisting older membership rows as membership history. The existing current-membership-only boundary remains.
- Creating plans, services, catalogue options, trainers, or trainer rates from inside the import wizard.
- Sharing or handing off a draft to another teammate.
- Applying member credit to historical imported invoices.
- Triggering tag-added automations or unsolicited WhatsApp messages from imported rows.
- Inventing a membership for service-only customers.

## Customer foundation

### Contact-backed customer identity

Members gains a canonical account-scoped customer directory with one row per contact that has either:

- a membership, or
- at least one member-service record.

The directory is keyed by `contact_id`. It projects an optional current membership plus service and generic-billing summaries. Existing membership rows keep their current membership identity and actions. A service-only row has no `membership_id`, plan, member number, membership fee status, attendance eligibility, membership renewal state, or AutoPay state.

The database view or RPC that owns this projection must choose the current membership deterministically using the existing membership lifecycle rules. It must not duplicate a contact because that contact has several services or historical invoices.

### All members

All members reads from the contact-backed directory rather than directly assuming every row has a membership.

For a service-only customer:

- **Name:** the canonical `MemberIdentity` contact presentation;
- **Member ID:** `—`;
- **Plan:** `—`;
- **Expiry:** the nearest active/upcoming service expiry, otherwise the most recent service expiry;
- **Status:** the canonical neutral **Service customer** badge;
- **Assigned to:** the contact assignee;
- **Fee:** the outstanding generic invoice balance, without presenting it as membership fee status.

The Status filter includes **Service customers**. Plan filters do not treat a service as a membership plan. Membership, attendance, plan, and AutoPay metrics continue to count only real memberships.

### Customer detail

The existing member detail surface becomes contact-backed. Its host accepts `contact_id` and an optional `membership_id`; existing membership call sites continue to open the same surface without a second design.

Every customer may see:

- identity and contact details;
- Products & services;
- generic Billing and payments;
- Notes & follow-ups;
- Add purchase; and
- Add membership when no membership exists.

Membership details, plan lifecycle, AutoPay, attendance, membership invoices, and membership renewal actions render only when a real membership exists. Add membership attaches the new membership to the same contact through the canonical join checkout and never creates a duplicate contact.

### Service renewal and sales

Standalone sale and service-renewal checkout accept an authoritative `contact_id` with an optional `membership_id`. A service-only customer can therefore renew a service or buy another service without a membership. The invoice and member-service record retain `membership_id = NULL` and the real `contact_id`.

Membership join, conversion, and renewal continue to require their existing membership intent. Attendance and membership-renewal queues remain membership-only. Service renewal queues and reminder actions resolve the contact and service directly and must not fetch a nullable membership as a prerequisite.

## Import field vocabulary

The searchable mapping picker keeps the canonical grouped field vocabulary and adds the following destinations.

### Offering destinations

- **Plan or service** — for a mixed Package/Offering column. Each distinct source value is classified during Resolve issues.
- **Membership plan** — explicit membership-plan column.
- **Billing option** — explicit membership billing/duration column.
- **Service** — explicit duration-based catalogue service column.
- **Service option** — explicit service duration/option column.

### Service detail destinations

- **Service trainer**
- **Service start date**
- **Service expiry**
- **Service sold price**
- **Service status** — optional; blank/current values remain active and expiry is derived from dates, while an explicit cancelled value creates a cancelled service without inventing a refund or credit.

Phone remains required. Mapping is valid when Phone plus at least one of Plan or service, Membership plan, or Service is mapped. A membership plan is no longer universally required.

The existing generic **Fee**, **Amount paid**, **Payment method**, and **Paid at** fields describe the complete purchase represented by that source row. When one row contains both membership and service, the fee/payment equation covers their combined invoice. A service-only row applies the same fields to its service invoice.

Header auto-mapping must stop treating generic `service`, `package`, and `product` aliases as unconditionally equivalent to membership Plan. Exact service headers prefer Service; exact membership headers prefer Membership plan; ambiguous package/offering headers prefer Plan or service and remain reviewable.

## Candidate and aggregation model

### Source-row preservation

Every source row remains a persistent candidate with:

- stable source key and source row number;
- original mapped values;
- editable draft values;
- optional membership component;
- optional service component;
- existing-contact match;
- customer grouping key;
- grouped resolutions;
- disposition and exclusion reason;
- stable import idempotency key; and
- receipt outcome.

The source row is never silently dropped during mapping or resolution.

### Customer grouping

Repeated rows form one customer only when their normalized phone and, when present, legacy member identity agree. Compatible profile values are merged through the existing mapped-field rules. Conflicting names or identity values require an explicit resolution rather than last-write-wins.

Within one customer group:

- at most one current membership is imported;
- the latest valid membership start wins under the existing current-membership rule;
- older membership rows remain visible as membership-history exclusions;
- every distinct service purchase row remains eligible;
- a row containing both membership and service retains both components; and
- a service-only customer group remains valid without any membership component.

Repeated phone numbers with conflicting legacy identities or incompatible profile values remain blocking. They are not automatically collapsed merely because the phone matches.

### Duplicate service purchase detection

A service purchase is the same logical purchase when customer, resolved service option, source start, source expiry, sold price, and trainer match. An exact repeated purchase is blocking until one row is excluded or the operator confirms/corrects distinct source values. Stable idempotency remains a second defense and never replaces review-time duplicate detection.

## Resolution behavior

### Offering classification

A Plan or service source value is resolved once per normalized distinct value. The operator chooses either:

- an active membership plan plus active billing option; or
- an active service plus active service option.

The grouped resolution applies to every compatible candidate. Explicit Membership plan and Service destinations skip the classification choice but still require matching active records and options.

### Services and options

An unmatched, archived, or ambiguous service or service option is a blocking grouped issue. The wizard offers only active account-owned catalogue items of kind `service` and their active duration options. Merchandise never appears in service import resolution.

### Trainer resolution

A trainer name maps only to an existing active account trainer. Trainer creation is never implicit.

For a trainer-required service:

- an active trainer must be selected;
- that trainer must have an active rate for the resolved service option; and
- no other trainer's rate or standard fallback may be substituted.

An unmatched trainer, archived trainer, or missing trainer-option rate remains blocking until resolved, the service is changed, or the row is excluded.

For a service that does not require a trainer, a mapped trainer value is ignored only after a visible notice; it must not create assignment history.

### Sold price

When Service sold price is present and valid, import preserves it as the immutable sold amount and invoice-line unit amount. The import database path records an import-specific override reason and acting user. This is a migration-only privilege and must not weaken the normal admin-plus-reason catalogue price-override rule.

When Service sold price is blank, the active configured standard price or selected trainer rate is used. A negative, malformed, or unavailable price is blocking. Zero remains valid only when the catalogue/import financial constraints already allow a zero-value line.

### Dates and status

Service start defaults to the mapped source start, then the membership start on the same row, then account-local today.

Service expiry is calculated from the resolved option when absent. A valid mapped source expiry overrides the calculated duration so migrated sold terms remain historically accurate. A mismatch produces a notice showing both dates; it does not silently rewrite the source expiry.

Expiry must be after start. Account date order and timezone handling use the existing locale layer. Explicit cancelled status creates a cancelled service snapshot but does not create a refund, credit, or voided invoice. Other service states are derived from status and dates.

### Payments

Each source row owns its purchase equation. A row with both membership and service creates one combined invoice and applies Amount paid to that invoice. A repeated service-only row creates a separate service invoice and applies its own Amount paid.

Paid, balance, fee, and line totals must reconcile to the existing paise tolerance. The operator may trust paid, trust balance, correct the values manually, import the customer/purchase without a payment, or exclude the row. Payments allocate proportionally across active invoice-line balances through the existing deterministic largest-remainder rule. The membership due uses only the membership line.

## Resolve issues and confirmation UI

The existing four steps remain:

1. Upload
2. Map columns
3. Resolve issues
4. Confirm

Resolve issues continues to own a vertically scrollable body. The search and counted filters remain Search → All / Needs resolution / Ready / Excluded. Grouped resolutions add offering classification, service/option mapping, trainer mapping, and duplicate-service decisions alongside existing membership and payment groups.

Each candidate visibly identifies its outcome type:

- **Membership**
- **Service**
- **Membership + service**

Desktop and mobile candidates show the resolved plan or service, trainer when applicable, dates, sold price, import check, and disposition using existing shared primitives. No page-specific replacement control is introduced.

Confirmation presents an exact equation covering:

- source rows;
- unique customers;
- memberships;
- services;
- combined invoices;
- service-only invoices;
- payments;
- automatic exclusions;
- explicit exclusions; and
- remaining unresolved rows.

Confirmation and import remain disabled while any included row is unresolved or while zero customer groups are ready.

## Transaction and accounting contract

### Import-specific database boundary

The normal checkout transaction intentionally derives current price and duration. Import must preserve historical sold terms, cancellation state, and explicit expiry. Therefore, service-aware import uses a dedicated account-scoped, agent-gated transaction rather than browser-side fragmented inserts or a weakened normal checkout.

One call persists one ready customer group atomically. It receives resolved identifiers and import intent, reloads all account-owned references, and independently validates tenancy, authorization, catalogue state, trainer state/rate, dates, prices, payment totals, existing-contact rules, and idempotency.

### Per-customer atomicity

For one customer group the transaction:

1. creates or attaches the contact under existing dedupe and immutable-origin rules;
2. optionally creates one membership and membership period;
3. creates the combined membership/service invoice for a source row containing both;
4. creates a separate sale invoice for every additional service source row;
5. inserts immutable invoice-line snapshots;
6. creates each member-service record with contact and optional membership references;
7. creates trainer-assignment history and trainer snapshots when applicable;
8. records row payments and proportional allocations;
9. preserves membership-line-only due semantics; and
10. returns reconciled source-row outcomes.

A failure rolls back the complete customer group. It must never leave a service without its invoice line, a payment without allocations, a membership without its opening period, or a combined row split across partial financial facts.

Different customer groups may succeed or fail independently, preserving the existing import receipt model. Tag and custom-field assignment remain best-effort after the financial/customer transaction and are reported separately.

### Invoice rules

- Membership plus service from one source row share one invoice.
- Each additional repeated service row creates a separate invoice because it represents a separate source purchase.
- A service-only invoice carries the real `contact_id` and a null `membership_id`.
- Imported invoices do not consume existing member credit.
- Membership fees and dues continue to use only the membership line.
- Service cancellation alone creates no refund or credit.
- Issued invoices are never reopened to append later rows.

### Idempotency and receipt

Every customer group and source purchase receives a stable idempotency key when its draft candidate is first created. Autosave, close, resume, retry, and cross-device continuation preserve those keys.

A retry returns the original customer and source-row outcomes without creating duplicate contacts, memberships, periods, invoices, invoice lines, services, trainer assignments, payments, or allocations.

The downloadable receipt is keyed to original source row and contains privacy-safe identifiers, disposition, matched offering type/name, created or attached customer result, membership result, service result, invoice/payment result, and error/recovery message. It does not include raw notes, full addresses, or other unnecessary PII.

## Resumable draft lifecycle

### Ownership and scope

There is at most one active member-import draft per authenticated user and account/branch. The draft belongs only to its author. A teammate, admin, or owner who did not create it cannot read, resume, overwrite, or discard it merely because they share the account.

Switching branches resolves a different draft. **Start fresh** affects only the current user and current branch.

### Storage model

Use an author-private `member_import_drafts` table for metadata and normalized wizard state, plus a private `member-import-drafts` Storage bucket for the original CSV/XLSX.

The draft record owns:

- account and author identity;
- source filename, kind, size, content hash, and private object path;
- selected worksheet;
- current wizard step;
- column mapping and date order;
- aggregate-only analysis recipe metadata;
- normalized candidate state, edits, grouped resolutions, exclusions, and stable idempotency keys;
- monotonic revision;
- last-saved timestamp; and
- expiry timestamp.

The database record never stores a signed Storage URL. Resume creates a short-lived signed read or uses an authenticated private download. The file and JSON state are sensitive member data and must never use a public bucket, browser local storage, application logs, error telemetry, or aggregate-analysis requests.

RLS permits select, insert, update, and delete only when `auth.uid()` is the author and the author remains a member of the draft account. Cleanup uses a service-only boundary. The unique active-draft constraint is scoped to author plus account.

### Save behavior

Meaningful state changes autosave after a short debounce. File upload and candidate initialization save immediately because later state depends on them. The UI exposes exactly these states:

- **Saving…**
- **Saved just now** or an account-local saved time
- **Couldn’t save draft** with Retry

**Save & close** flushes the pending debounce, waits for both file/state persistence and the latest revision acknowledgement, and closes only after success. The cross icon and escape dismissal invoke the same save-before-close behavior once meaningful draft data exists. Closing an untouched Upload step creates no empty draft.

If close-save fails, the wizard remains open and offers:

- **Retry** — attempt the same revision again; or
- **Discard draft** — confirmed destructive deletion, then close.

The UI never reports a draft as saved before the server acknowledges its revision.

### Resume behavior

Clicking Import with an active unexpired draft opens the wizard at its saved step. A compact continuation notice shows the filename and last-saved time and exposes **Start fresh**.

Resume reloads the original file and saved normalized state, then revalidates every mutable account reference and external fact:

- membership plans and billing options;
- services and service options;
- trainers and trainer rates;
- configured prices;
- contacts and profile conflicts;
- existing memberships; and
- already-imported source idempotency outcomes.

Archived, changed, deleted, newly conflicting, or already-imported facts move affected candidates back to Resolve issues with an explicit reason. Resume never trusts stale catalogue IDs, trainer rates, contact state, or readiness booleans from the saved JSON.

### Multi-tab concurrency

Every update supplies the last acknowledged revision. The database performs compare-and-swap and returns a conflict when another tab/device has advanced the draft. A stale client stops autosaving and offers **Reload saved draft** or **Start fresh**; it never overwrites the newer revision.

### Start fresh, completion, and expiry

**Start fresh** is available only while continuing a saved draft. It requires confirmation that the previous import progress and uploaded file will be deleted. After successful deletion, the wizard returns to a clean Upload step.

Successful import generates the receipt, then deletes the active draft record and private source object. Draft cleanup failure does not roll back committed customer purchases; it is surfaced as a cleanup warning and retried by the expiry worker.

An unfinished draft expires 30 days after its last acknowledged save. Each successful save advances `expires_at`. A scheduled service-only cleanup claims expired records, deletes private objects, and then removes or terminally marks database rows idempotently. Cleanup must tolerate a missing object or repeated execution.

## Draft API boundary

Use authenticated `src/app/api/**/route.ts` handlers, not server actions, for draft lifecycle coordination.

The boundary supports:

- load the current user's active draft for the selected account;
- create the draft and upload/associate the private source file;
- compare-and-swap save normalized state;
- discard the current draft and private object; and
- complete/cleanup the draft after import.

Every handler derives user/account identity from authenticated membership. It never trusts browser-supplied author or account ownership. File kind, size, content hash, and existing workbook limits are validated before storage. Error responses use stable categories that the wizard maps to actionable save, conflict, expiry, or unavailable messages.

## Privacy, security, and authorization

- Agent+ may run member import under the existing named capability; viewer remains read-only.
- Draft visibility is stricter than ordinary account content: author-only within the account.
- The original file, mapped values, and candidate JSON are sensitive PII and use private storage/RLS.
- Aggregate-only optional analysis retains the existing privacy contract: no names, phones, IDs, notes, sample values, raw prices, raw workbook, or candidate JSON leaves the application boundary.
- Import-specific sold-price preservation is audited and cannot be called as a normal arbitrary-price checkout.
- Automated lead ownership remains immutable. A matched auto-captured contact keeps its ownership unless the existing approval-gated transfer path is used.
- All imported contact, membership, service, invoice, trainer, payment, and allocation writes are account-scoped and database-validated.
- No import path dispatches tag-added automations or sends WhatsApp messages.
- Destructive draft discard requires explicit confirmation and removes only the current author's current-branch draft.

## Errors and recovery

The wizard fails closed for:

- no mapped offering;
- unknown, ambiguous, archived, or cross-account plan/service/option;
- trainer-required service without an active trainer and active option rate;
- invalid or negative price;
- invalid service date range;
- conflicting repeated identity;
- duplicate service purchase;
- more than one current membership candidate;
- inconsistent fee, paid, and balance values;
- source file/state hash mismatch;
- expired draft;
- stale draft revision; or
- transaction reference changes between resolution and commit.

The row must be corrected, re-resolved, or explicitly excluded. There is no silent fallback to another plan, service, trainer, rate, date, contact, or payment allocation.

If no active services exist, service resolution explains that the operator must configure them in **Settings → Products & services**. **Save & close** makes that recovery path safe. Membership-only rows and imports remain usable.

Network loss during autosave retains the current in-memory work, marks it unsaved, and retries only through bounded user-visible behavior. The wizard never closes as though saved after a failed request.

## Responsive and accessibility behavior

- Preserve the existing large import dialog, four-step structure, fixed header/footer, and scrollable body.
- Desktop and mobile keep the same task order and candidate semantics.
- Mapping uses the existing searchable Combobox and grouped destination vocabulary.
- Grouped resolutions reuse Accordion, Select, Input, DatePicker, CurrencyInput, Badge, Button, SearchInput, Chip, and other canonical primitives without page-specific visual overrides.
- Money uses account currency and tabular numerals; dates use the locale layer and account timezone.
- Save status is exposed as polite live status without stealing focus.
- Save & close, Retry, Reload saved draft, Start fresh, and discard confirmation are keyboard reachable and precisely labelled.
- The cross icon and Escape follow the same save-before-close contract as Save & close.
- Start fresh confirmation names the file and consequence.
- Long filenames, many grouped issues, narrow phones, zoom, localization, empty catalogues, and expired/stale drafts retain reachable actions and correct focus order.

## Component and module boundaries

Expected boundaries are:

- a contact-backed customer-directory query/view and types;
- a contact-backed customer detail host with optional membership sections;
- contact-capable standalone sale and service-renewal checkout;
- the existing member field registry extended with offering/service vocabulary;
- a pure service resolution and customer-group candidate model colocated with the member import engine;
- a dedicated import transaction and typed client executor;
- an author-private draft persistence module and authenticated route handlers;
- a small controlled draft-status/resume layer in the existing import dialog; and
- existing shared UI primitives and locale helpers.

Do not add or modify a `src/components/ui/` master unless implementation proves that no existing primitive can express a required interaction and the user explicitly approves the shared change and affected call sites.

## Verification

### Customer-foundation tests

- A contact with a membership appears once with unchanged membership fields.
- A contact with services and no membership appears once as Service customer.
- Several services do not duplicate the directory row.
- Service-only customers show nearest applicable service expiry and generic outstanding balance.
- Service-only rows do not change membership, attendance, renewal, plan revenue, fee-status, or AutoPay counts.
- Contact-backed detail hides membership-only sections without hiding services, generic billing, notes, Add purchase, or Add membership.
- Service renewal succeeds with contact and null membership; membership renewal still requires membership.
- Adding a membership upgrades the same contact without duplicate identity.

### Candidate-engine tests

- Mapping requires Phone plus at least one offering destination.
- Ambiguous package headers map to Plan or service, not silently to Plan.
- A mixed offering value can resolve to either a membership plan or service option.
- Explicit membership and service columns create a combined candidate.
- A service-only row is ready without a plan after service resolution.
- Repeated compatible rows aggregate one customer and retain distinct services.
- Older membership rows remain exclusions while service rows remain importable.
- Conflicting identities and exact duplicate service purchases block readiness.
- Sold price is preserved; blank price uses configured standard/trainer rate.
- Trainer-required services fail without an active matching rate and never fall back.
- Source expiry overrides calculated duration with a notice.
- Combined and service-only payment equations resolve independently.
- Summary/search/filter/receipt counts reconcile source rows, customers, memberships, services, invoices, payments, and exclusions.

### Transaction and authorization tests

- Account and role checks reject viewer, former member, cross-account contact, catalogue, trainer, and option references.
- One combined row creates one invoice with membership and service lines.
- Repeated service rows create separate sale invoices.
- Service-only import creates contact, invoice, line, service, and optional trainer assignment with null membership.
- Payments allocate proportionally and reconcile exactly at paise precision.
- Membership due remains membership-line-only on combined invoices.
- Imported invoices do not consume member credit.
- Source sold-price override is audited and limited to the import transaction.
- Customer-group failure rolls back every financial/customer write in that group.
- Stable retries return original outcomes and create no duplicate records.
- Tags and custom fields remain best-effort and receipt-visible.

### Draft lifecycle tests

- One active draft is allowed per author/account and separate branches keep separate drafts.
- Another teammate cannot read, update, resume, or delete the draft.
- Original files are private and signed URLs are never persisted.
- Autosave preserves step, worksheet, mapping, edits, resolutions, exclusions, and idempotency keys.
- Save & close and cross/escape flush the latest revision before dismissal.
- Failed close-save keeps the wizard open with Retry and Discard draft.
- Resume works on another device and revalidates mutable domain references.
- Changed catalogue/contact facts return affected candidates to Resolve issues.
- Compare-and-swap rejects stale tabs without overwriting newer progress.
- Start fresh confirmation deletes only the current author/current-account draft and file.
- Successful import removes the draft/file without rolling back purchases if cleanup must retry.
- Thirty-day cleanup is idempotent and removes expired database and Storage state.

### UI and product verification

- Exercise membership-only, service-only, combined, repeated-service, missing-catalogue, stale-resume, save-failure, and start-fresh states on desktop and mobile.
- Verify reading order, keyboard order, focus visibility, save live status, confirmation focus restoration, footer reachability, and scroll containment.
- Preserve membership-only import behavior and receipt semantics.
- Run targeted Vitest coverage, migration/transaction verification, TypeScript, lint for changed files, formatting, and the Impeccable detector.
- Apply migrations through the approved Supabase migration tool and verify tables, functions, indexes, grants, RLS policies, Storage policies, and cleanup behavior. Never use `supabase db push`.
- Update `PRDs/products_services_and_trainer_pricing.md`, `docs/gym-domain.md`, `docs/changelog.md`, and `PRDs/roadmap.md` before declaring the feature complete.

## Rollout order

1. Ship and verify the contact-backed service-customer foundation.
2. Ship and verify private resumable drafts without changing import semantics.
3. Add offering/service mapping and candidate resolution.
4. Add the import-specific customer transaction and service persistence.
5. Enable service-aware confirmation/import only after membership-only and draft-resume regressions pass.

Each step must leave the application in a deployable state. The importer must not expose a service mapping that can produce records the customer directory, detail surface, checkout, and renewal actions cannot manage.
