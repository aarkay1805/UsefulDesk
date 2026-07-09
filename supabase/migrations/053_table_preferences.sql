-- ============================================================
-- 053_table_preferences.sql — per-user, per-account saved table
-- views (column visibility / order / widths / page size / sort /
-- frozen count / view mode).
--
-- Until now the leads table stored these in the browser under a
-- single global localStorage key ('usefuldesk:leads:table-prefs'):
-- not scoped to the account (prefs bled across accounts in one
-- browser) and not cross-device. This table makes a saved view a
-- first-class, per-USER-per-account record so a teammate's column
-- layout follows them across devices and never leaks to others.
--
--   table_preferences — one row per (account_id, user_id, view_key).
--   `view_key` names the surface ('leads' today; 'contacts',
--   'members', … later). `prefs` is the opaque JSON blob the client
--   owns (shape = TablePrefs in the leads page); the DB never reads
--   into it, so adding a pref field needs no migration.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS table_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The teammate this saved view belongs to. Each user keeps their
  -- own layout within an account.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Which table surface these prefs apply to ('leads', 'contacts', …).
  view_key TEXT NOT NULL,
  -- Client-owned settings blob (column order/hidden/widths/pageSize/
  -- viewMode/view/sort/frozenCount). Opaque to Postgres.
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id, view_key)
);

CREATE INDEX IF NOT EXISTS idx_table_preferences_lookup
  ON table_preferences (account_id, user_id, view_key);

-- updated_at maintenance (reuses the shared trigger function).
DROP TRIGGER IF EXISTS update_table_preferences_updated_at ON table_preferences;
CREATE TRIGGER update_table_preferences_updated_at
  BEFORE UPDATE ON table_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — a saved view is private to its owner. A teammate may only
-- read/write their OWN row, and only while an active member of the
-- account (a downgraded/removed member loses access). No admin
-- moderation path: these are personal UI prefs, not shared content.
ALTER TABLE table_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS table_preferences_select ON table_preferences;
DROP POLICY IF EXISTS table_preferences_insert ON table_preferences;
DROP POLICY IF EXISTS table_preferences_update ON table_preferences;
DROP POLICY IF EXISTS table_preferences_delete ON table_preferences;
CREATE POLICY table_preferences_select ON table_preferences
  FOR SELECT USING (
    user_id = auth.uid() AND is_account_member(account_id)
  );
CREATE POLICY table_preferences_insert ON table_preferences
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND is_account_member(account_id)
  );
CREATE POLICY table_preferences_update ON table_preferences
  FOR UPDATE USING (
    user_id = auth.uid() AND is_account_member(account_id)
  );
CREATE POLICY table_preferences_delete ON table_preferences
  FOR DELETE USING (
    user_id = auth.uid() AND is_account_member(account_id)
  );
