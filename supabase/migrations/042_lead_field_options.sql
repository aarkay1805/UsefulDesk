-- ============================================================
-- 042_lead_field_options.sql — per-account editable option lists
-- for the lead attribute fields (status / source / gender).
--
-- Until now these lists were code constants (LEAD_COLUMNS in
-- src/lib/leads/status.ts, SOURCE_OPTIONS / GENDER_OPTIONS in
-- src/lib/leads/attributes.ts) and lead_status was pinned by a
-- CHECK constraint. Gyms want to rename/add pipeline stages and
-- acquisition sources, so the lists move to a table:
--
--   lead_field_options — one row per option, per account, per
--   field. An account with NO rows for a field uses the built-in
--   defaults (the app falls back in code); the first save from
--   the "Edit options" dialog materialises the full list.
--
-- Keys are stable slugs stored in contacts.lead_status /
-- contacts.source / contacts.gender; labels and colours are the
-- editable presentation. The status CHECK constraint is dropped —
-- validation moves to the app against the account's list (or the
-- defaults). 'new' remains a pseudo-status (NULL in the column)
-- and is never stored here.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_field_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Which option list this row belongs to.
  field TEXT NOT NULL CHECK (field IN ('status', 'source', 'gender')),
  -- Stable slug stored on contacts rows (never re-written on rename).
  key TEXT NOT NULL,
  -- Editable presentation.
  label TEXT NOT NULL,
  -- Hex colour — used by status pills; NULL for source/gender.
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, field, key)
);

CREATE INDEX IF NOT EXISTS idx_lead_field_options_account_field
  ON lead_field_options (account_id, field, sort_order);

-- updated_at maintenance (reuses the shared trigger function).
DROP TRIGGER IF EXISTS update_lead_field_options_updated_at ON lead_field_options;
CREATE TRIGGER update_lead_field_options_updated_at
  BEFORE UPDATE ON lead_field_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — settings-class list: anyone in the account reads, admins write
-- (same posture as membership_plans in 031).
ALTER TABLE lead_field_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_field_options_select ON lead_field_options;
DROP POLICY IF EXISTS lead_field_options_insert ON lead_field_options;
DROP POLICY IF EXISTS lead_field_options_update ON lead_field_options;
DROP POLICY IF EXISTS lead_field_options_delete ON lead_field_options;
CREATE POLICY lead_field_options_select ON lead_field_options
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_field_options_insert ON lead_field_options
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY lead_field_options_update ON lead_field_options
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY lead_field_options_delete ON lead_field_options
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Custom statuses can now exist — the fixed-list CHECK has to go.
-- (App-side validation replaces it; see src/lib/leads/field-options.ts.)
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_lead_status_check;
