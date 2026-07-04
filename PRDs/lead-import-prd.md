# PRD: Lead Import Feature (CRM)

## 1. Purpose
Allow users to bulk-import lead records from an external file into the CRM, with control over how records are matched, mapped, validated, defaulted, and post-processed.

## 2. Import Wizard Structure
A linear 5-step wizard with a persistent step indicator and back/forward navigation (Previous/Next), and the ability to Cancel at any point.

Steps: Upload -> Actions -> Module/File Mapping -> Field Mapping -> Assign.

## 3. Step 1 - File Upload
- Drag-and-drop zone plus a "Browse Files" button.
- Supported formats: CSV, XLSX, XLS, VCF.
- Constraints enforced: max file size (25MB), max records per import (100,000), only one file per import session.
- Downloadable sample/template files (CSV and XLSX) to show expected structure.
- Charset selector (Auto-Detect plus manual override) for encoding issues.
- Optional "Notify Email" checkbox to email the user when the import job finishes.
- Secondary entry point: "Migrate Data from another CRM" - a separate guided tool supporting named integrations (Salesforce, Dynamics 365, SugarCRM, Act!, Pipedrive, Capsule, HubSpot, Insightly, Highrise, Maximizer, Bitrix24, Freshsales, Bigin, and a generic "Other CRM" option).

## 4. Step 2 - Actions (how records should be processed)
Three mutually exclusive modes:
- Add as new Leads - with a "Skip Leads based on" duplicate-check field (None / Email / Record ID) to avoid creating duplicates.
- Update existing Leads only - requires a "Find existing Leads based on" match field, includes a "Don't update empty values for existing Leads" toggle (on by default, prevents blank source fields from wiping existing data), and displays a non-dismissible warning that updates via import cannot be undone.
- Both - combines add + update logic, with the same match-field and empty-value protections.

## 5. Step 3 - Module / File Mapping
- Shows uploaded file(s) grouped by target CRM module (auto-detected).
- Tabs to filter by All Modules / Mapped Modules / Unmapped Modules, with a search box.
- Supports multiple files mapped to multiple modules in one import batch (Unmapped Files / Unsupported Files sections shown separately).

## 6. Step 4 - Field Mapping
- Two-column mapping table: file column -> CRM field, with live sample data (first rows) shown per column for verification.
- Column-level view filters: All Columns / Mapped Columns / Unmapped Columns.
- Per-field dropdown to (re)map any file column to any existing CRM field (searchable list of all standard + custom fields for the module).
- Type-aware formatting controls appear conditionally:
  - Number fields: pattern selector (e.g., 12345, 123,456.789, 123.456,789) to correctly parse numeric formats.
  - Date/DateTime fields: pattern selector with a large library of date and date-time formats, auto-detected from sample data with manual override.
  - "Replace Empty Values" per-field input to substitute a fallback value when a source cell is blank.
- Assign Default Value: a separate modal to set a static default for any CRM field not present in the file at all - critical for satisfying mandatory fields the source file lacks (e.g., Company, Last Name). Supports multiple field/value pairs in one action, and shows a running count ("Manage Default Value (n)").
- Create New Fields: lets users create a brand-new custom CRM field on the fly for a file column that has no existing match (disabled/blocked automatically when every column is already mapped).
- Validation warning indicator (warning count) at the table header flags unresolved mandatory-field or format issues before proceeding; wizard blocks progress until resolved.
- "Auto Map" (re-run automatic name-based matching) and "Reset Mapping" (clear all mappings) utility actions.
- "Go to Module Mapping" shortcut back to Step 3 without losing progress.

## 7. Step 5 - Assign
- Assignment Rules: optional toggle to auto-assign lead owner via pre-configured assignment rules instead of defaulting to the importing user.
- Manual Record Approval: optional toggle to route newly imported records through an approval process before they go live.
- Trigger Automation and Process Management: optional toggle to fire existing workflows/automations for the imported (new/updated) records; off by default so bulk imports don't flood automations.
- Assign follow-up tasks: optional dropdown to attach a pre-built workflow task template (supports merge fields such as Last Name and Company) to every imported record, assigned to the record owner; includes a shortcut to create a new workflow task template inline.
- Compliance confirmation checkbox: mandatory acknowledgment that imported email addresses will only be used with consent/legitimate business interest, linked to the platform's anti-spam policy - must be checked before Submit is enabled.

## 8. Post-Import
- Immediate toast confirmation ("Import scheduled") since large imports process asynchronously in the background.
- Import History log (Setup -> Data Administration -> Import History), grouped by date, each entry showing status (success indicator), timestamp, and initiating user.
- Per-import drill-down ("View Imported Modules") showing a results table per module: records Added, Updated, Skipped (each count is a clickable link to view those specific records).
- Undo Import action available directly from the history entry, to reverse a bad import.

## 9. Key Non-Functional Behaviors Observed
- Wizard state persists across Previous/Next navigation (selections aren't lost going back).
- Field mapping is CSV-header-name-aware - it auto-suggests mappings when file column names closely match existing CRM field names or previously-created custom fields.
- Hard validation prevents submission while any mandatory field remains unmapped and without a default.