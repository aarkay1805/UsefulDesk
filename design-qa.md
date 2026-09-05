# Member import worksheet — Option 2

final result: passed

## Follow-up: issue groups restored

The user requested a blend of the original issue grouping and the new worksheet.
Needs review now groups rows by Billing, Missing phones, Invalid phones,
Duplicate phones, Plan matching, and other issue types. The active group selects
the matching resolver, including for rows with multiple problems. Group counts
deduplicate rows without expanding the scope of grouped mutations.

Visual evidence in the directory below: `grouped-billing.png`,
`grouped-phones.png`, `grouped-mobile-final.png`, and
`grouped-mobile-inspector.png`. Desktop was captured at 1440 × 1024 CSS pixels;
mobile at 400 × 844, with the same DPR/crop normalization described below.
The prior worksheet and the new billing/phone views were opened together for
comparison. Typography, semantic colors, spacing and standard icons remain
unchanged; the additional group navigation is the requested difference.

The first mobile capture hid the selected group beyond the horizontal chip
viewport (P2). The final mobile capture replaces this with the shared Select,
whose selected label and count remain visible. This correction was re-inspected
beside the first capture; no actionable P0/P1/P2 UI findings remain.

The real wizard could not save a new private draft during this follow-up, and
the browser session subsequently returned to login. No customer import was
attempted. A temporary development-only harness rendered the actual worksheet
and candidate resolvers against six synthetic rows, with all changes kept in
local React state. Browser acceptance covered selecting Billing, saving one
payment correction, seeing its count fall and Ready increase, opening Duplicate
phones, and switching groups through the mobile picker. Its browser error and
warning log was empty. The harness was removed after capture; this is component
acceptance, not an end-to-end claim about draft saving or database imports.
Automated regressions additionally cover multi-issue row membership, unique
counts, search/page reset, resolver targeting, bounded bulk mapping, and
remaining phone issues after a billing correction.
The final selection passed 84 tests across five suites, targeted ESLint,
TypeScript `--noEmit`, formatting, and diff whitespace checks.

## Comparison target and evidence

- Source visual truth: `/Users/rajatkashyap/.codex/generated_images/01a0724b-c9e6-7a11-afc2-056eedd2eedf/exec-003642d2-3df8-4c2c-8663-762e325b0ce5.png` (the second displayed option, Migration worksheet).
- Implementation: `http://localhost:3000/members`, Import Members → Resolve issues.
- Evidence directory: `/Users/rajatkashyap/.codex/visualizations/2026/09/05/01a0724b-c9e6-7a11-afc2-056eedd2eedf/member-import-worksheet/`.
- Final desktop screenshot: `desktop-final.png`; focused comparison: `inspector-reference.png` and `inspector-final.png`; responsive evidence: `mobile-list-final.png`, `mobile-inspector.png`, and `mobile-action.png` in that directory.
- State: light theme, Needs review, source row 90 selected, “Keep fee and paid amount” staged. The real existing draft contains 692 rows: 252 ready, 12 needing review, 428 excluded. No correction was saved and no member import was executed.

The source artboard is 1545 × 1018 pixels; the implementation was verified at
1440 × 1024 CSS pixels, DPR 1.5, plus 400 × 844 CSS pixels for mobile. CDP
captures included a larger padded canvas: the desktop content was cropped from
2160 × 1536 and downsampled to 1440 × 1024; mobile content was cropped from
600 × 1266 and downsampled to 400 × 844. The source inspector crop was scaled
from 425px to 384px wide for the focused comparison. Full source and rendered
views, followed by both focused crops, were opened together in one comparison.
This is a responsive product adaptation, not a pixel-identical artboard claim.

## Findings and comparison history

1. The initial rendered inspector let the selected member's identity scroll
   away. Identity and row navigation now sit above the scrolling resolver;
   `desktop-final.png` and the scrolled `mobile-action.png` verify the repair.
2. **P2, fixed:** the first 400px row-list capture compressed the filters beside
   the search field into a nearly invisible strip (`mobile-list.png`). Filters
   now occupy their own row below the small breakpoint. The follow-up capture
   `mobile-list-final.png` shows readable Needs review and Ready controls with
   the canonical overflow affordance.
3. The correction grid inherited a four-column viewport breakpoint despite
   living inside the narrow inspector. It now responds to container width,
   using one or two columns. The search placeholder was shortened to fit its
   shared 240px control without truncation.

No actionable P0/P1/P2 visual issues remain in the inspected states.

## Required fidelity surfaces

- **Typography:** retained the product's shared font and controls, 18px dialog
  title, 14px reading text and 12px metadata. Money is tabular and aligned;
  long plan labels truncate in the table and wrap in the inspector.
- **Layout:** retained the reference's table/inspector relationship, row
  selection, contextual payment preview and excluded-row recovery. The 1320px
  dialog and 384px inspector use product spacing. Mobile switches between list
  and details, preserving Back, row navigation and independently scrolling work.
- **Colors:** canonical neutral surfaces, account accent, semantic amber issues
  and emerald reconciliation. Neutral selected table rows, pill filters and
  an unboxed result section deliberately follow shared product components.
- **Assets:** this screen needs standard interface icons only; existing Lucide
  icons and MemberIdentity are reused. No generated illustration is required.
- **Copy/content:** the real file's member names and source balances differ
  from synthetic mock content. The header reports the actual file and source
  row count; no unsupported migration-date capability is implied. Canonical
  Name, Plan, Balance and Status labels replace the mock's alternative wording.
  The existing draft-save controls remain truthful to current persistence.

## Verification and limits

- 81 tests passed across the two import UI suites and three relevant candidate,
  service and commit suites. Coverage includes staged corrections/mappings,
  invalid amounts, phone edits, notices, excluded CSV escaping, and retaining
  the next unresolved row when a saved row leaves a page boundary.
- Targeted ESLint, TypeScript `--noEmit`, formatting and diff whitespace checks
  passed.
- Browser verification covered selection, payment dropdown and result amounts,
  search, clear-search, excluded review resetting search, mobile list/detail
  navigation, scrolling to Save and readable notices. Browser warning/error
  log returned empty. Emulation was reset and the local preview left open.
- Confirm and real database writes were not exercised against the existing gym
  draft. General ERP compatibility, financial-engine consistency and durable
  failure recovery remain separate roadmap work; this visual pass does not
  certify those contracts. Native-device and dark-theme acceptance are not
  claimed.

## Implementation checklist

- [x] Worksheet and responsive inspector integrated into the existing wizard.
- [x] Staged payment and group decisions use existing callbacks and context.
- [x] Notices and excluded original rows are recoverable for review.
- [x] Visual findings corrected and final captures compared to Option 2.
- [x] Focused checks passed; changelog and roadmap updated.

P3 follow-up: on very long row lists, a shared sticky-header treatment could
keep column captions visible while scrolling. This should be a table-master
capability rather than a page-specific visual override.
