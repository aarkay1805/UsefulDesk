# Handoff — member import: pricing, trainer identity, same-day rows

Written 18 Aug 2026. Delete this file once the branch merges; the durable
rules already live in `docs/gym-domain.md` and `docs/changelog.md`, and this
only carries session state that does not belong there.

---

## What this work was

The Map columns step of Members → Import was restructured, and the money it
was silently discarding is now imported. Membership and service each own a
complete field group (plan/service, option, dates, status, list price,
discount amount, discount %, charged amount); collection stays row-level.
A member gained a real trainer identity. All of it is verified against a
real 501-row gym export and against a live database.

Two things it fixed that were losing data outright: a list-price column the
recipe captured and consumed nowhere (₹42.3L of discount across the reference
file), and a balance column read invisibly off the source row while its
column displayed "Don't import".

---

## Repo state

Branch `codex/member-import-resolution`, in sync with `origin`.
Last commit `c55b272`.

**Uncommitted** (all of it post-`c55b272`, all verified):

```
docs/changelog.md
docs/gym-domain.md
src/components/members/import-members-preview.tsx
src/lib/memberships/import-commit.test.ts
src/lib/memberships/import-commit.ts
src/lib/memberships/import-pricing.test.ts
src/lib/memberships/member-import-candidates.ts
```

`npx vitest run` → 1957 pass. `npx tsc --noEmit` and `npx eslint src` clean.

Note the repo has pre-existing Prettier drift in files this work never
touched, so `prettier --check` on the whole tree is not a useful gate. Format
only the files you edit.

---

## Database state

| project | id | member import |
|---|---|---|
| `UsefulDesk` | `fwqthstqrkrwtaehefks` | applied 18 Aug |
| `UsefulDesk Razorpay Test` | `hkuqzmgnhhgecqcbwupb` | applied earlier |

`UsefulDesk` versions:

```
20260818154722  service_aware_resumable_member_import
20260818154731  harden_member_import_grants
20260818154902  import_pricing_and_member_trainer
```

Test carries the same work as `20260818131046 import_pricing_and_member_trainer`
on top of its own earlier chain.

Both projects were structurally diffed after the apply and returned an
**identical 28-object inventory** (two tables, five policies, eight indexes,
four functions with matching `SECURITY DEFINER` flags, four storage policies,
the private bucket, the `member_customer_directory` view, `contacts.trainer_id`,
and the composite FK). That diff is what proves the hand-applied SQL matched
the repo — see "Applying migrations here" below for why it had to be checked.

### Test-data residue in VBF — read this before touching finance numbers

Account `VBF` (`9c50dcd9-ed4a-427c-a2fc-07d452f0aec7`) on **production**
currently holds import test data:

- **3 contacts / 3 memberships**, all `received_via='import'` — Kunwarjeet
  Singh, Shivam sharma, Steven. Not real members.
- **11 `member_import_runs`**, 8 of which have `contact_id IS NULL` because
  those members were deleted between the two test runs.
- **8 orphaned payments totalling ₹1,08,200 and 8 orphaned invoices**, left
  behind by that deletion.

The orphans are by design — `delete_member` preserves the ledger and sets
payment FKs to NULL — but VBF's finance and reporting totals now include
₹1,08,200 of test money. Clean that up before anyone reads those numbers.

---

## What was verified, and how

Not "tests pass" — these are live-database observations on VBF:

- **Discount write-through**: 8/8 rows reconciled, e.g. DILPREET list 48,000 /
  discount 28,000 / charged 20,000, with `invoice_lines.list_amount` = 48,000.
  `broken_pricing_rows` = **0** database-wide.
- **No-discount path**: Steven imported with `list_price` NULL, `discount_type`
  NULL, `discount_amount` 0.00. This was the last unproven path.
- **Trainer**: resolves case-insensitively to an independent gym identity with
  no login seat — CSV `Anand kumar` → trainer `ANAND KUMAR`.
- **Amount due**: Karn pratap total 21,000 / paid 14,700 / collectible balance
  6,300 / `fee_status` due.
- **History dedupe**: Akash UK's four source rows → one membership, the latest.
- **Same-day rows**: all 12 in the reference file build a membership, 0 blocked,
  and exactly 4 carry the duration notice.

---

## Rules that are load-bearing — do not re-litigate

1. **`MEMBER_IMPORT_FIELDS` order matters.** `autoMapColumns` claims the first
   unused match, so every membership field must precede its service twin, and
   `membership_trainer` must precede `service_trainer`.
2. **`resolveImportedPricing` works in integer paise.** The
   `membership_periods` CHECK constraint recomputes
   `ROUND(list_price * discount_value / 100, 2)` and rejects float drift. A
   percentage that cannot land on a whole paise is stored as an equivalent
   flat amount rather than forced.
3. **Import writes only `memberships.conversion_*`.**
   `create_initial_membership_period` copies them to the period and
   `ensure_membership_period_invoice` derives the line's `list_amount`. Do not
   write `membership_periods` directly.
4. **Any row guard added to the RPC needs a local twin in
   `buildMembershipRow`.** A customer group commits as one transaction, so a
   row the preview calls ready but the database rejects aborts every other row
   for that member. This is how the same-day bug shipped.
5. **A same-day source row is a one-day membership, not an error.** Legacy
   exports repeat one date because they cannot express a duration. Expiry
   derives as start + 1 day; only a backwards expiry blocks.
6. **`expiryMismatch` judges auto-dated rows by their stored expiry**, not the
   source date. Otherwise every corrected per-session row nags and the genuinely
   odd rows stop standing out.
7. **`contacts.assigned_to` is FK → `auth.users`** and always costs a login
   seat; `contacts.trainer_id` is the gym identity whose `linked_user_id` is
   optional. They are not interchangeable. There is no membership-level trainer
   column beyond `trainer_id`.
8. **One CSV row is one invoice**, so payment is row-level. Two rows for one
   member produce two invoices and no allocation split. Only a single row
   mapping both a membership *and* a service produces a combined invoice, whose
   payment `allocate_invoice_payment` spreads proportionally by line balance.
   Per-line collection is deferred, not rejected.
9. **The members table seeds default column visibility once per
   `LAYOUT_VERSION`**, computed in render because `react-hooks/set-state-in-effect`
   is enforced. Any visibility edit stamps the version so the seed cannot
   override an arranged layout.
10. **Watch `??` merging a nullable success field against a failure default.**
    `MemberImportCommitResult.reason` is `null` on success, which is how every
    imported row in a real receipt came out stamped `candidate-not-committed`.

---

## Open items

**Product calls, not defects:**

- **INACTIVE + future expiry → `cancelled` → invoice voided → outstanding dues
  erased.** This deleted vivek vashisht's ₹7,000 on import. Correct for a real
  cancellation, lossy for a migration. The lever is
  `normalizeMemberMigrationStatus` in `migration-recipe.ts`, not the void.
  Affects 4 rows in the reference file, 1 carrying money.
- **`unknown-assignee` imports silently.** `built.warnings` gained a consumer
  for `unknown-trainer` (grouped `trainer-unmatched` notice) but not for
  assignee, so an unmatched staff name still vanishes without a word.

**Smaller gaps:**

- `GROUP` (batch — morning/evening) has no field; a custom field covers it.
- Case-variant plan names create duplicate plans (`FITNESS` vs `Fitness`).
- `splitPlanDuration` only matches a duration *suffix*, so
  `3 Months Personal Training`, `12 SESSION` and `17 months memebersip` fall to
  plan resolution.
- The Trainer cell and the layout-version seed have registry-level contract
  tests but no component test.

**Release note owed:** the layout seed hides "Assigned to" from every user's
members table once, on next load. It is re-addable from the column controls,
but it will read as a missing column if nobody says so.

---

## Applying migrations here

There is **no `psql` and no database URL** in `.env.local` — only REST and
service-role keys, which cannot run DDL. Migrations must go through the
Supabase MCP `apply_migration` tool with the SQL inline, which means
transcribing the file by hand. Always structurally diff the result against a
known-good project afterwards; that is the only real check that the
transcription was faithful.

`CLAUDE.md` names `fwqthstqrkrwtaehefks` as the apply target. Do not use
`supabase db push` — MCP-applied versions diverge from repo filenames by
design, and the version numbers above will not match the filenames.

One correction worth recording, because an earlier session got it wrong and it
would send someone reconstructing SQL that exists: **the repo is the complete
migration source.** Test showed five member-import version rows against two
repo files, but those were incremental applies consolidated into
`20260816122505` and `20260816130000`. Every live object is created by a repo
file — verified object by object.

---

## Test kit

Built for the end-to-end run, still usable. In the session scratchpad, so copy
anything worth keeping:

- `import-test-slice.csv` — 14 rows from the real export covering discount,
  no-discount, dues, write-offs, trainers, frozen, cancelled, expired, and the
  repeat-Member-ID case
- `import-verification.sql` — 8 self-scoping queries, each stating its own PASS
  condition; all dry-run clean
- `import-test-run.md` — the run guide with expected values per member
- `seed-test-catalogue.sql` — now redundant for VBF, which already has the full
  catalogue and all four trainers

The source export is `~/Downloads/tableConvert.com_yhugwc.csv` (501 rows).
