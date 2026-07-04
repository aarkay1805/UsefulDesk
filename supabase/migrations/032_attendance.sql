-- ============================================================
-- 032_attendance.sql — Member check-ins / visit tracking (Phase 3)
--
-- Append-only log of gym visits. Powers the front-desk check-in
-- surface, per-member visit history, "checked in today" counts, and
-- the "inactive N+ days" retention signal on the owner dashboard.
--
-- A visit belongs to a `contacts` row (the person); `membership_id` is
-- captured for convenience but nullable/SET NULL so a visit survives a
-- membership being deleted. Parent-tenant table (carries account_id),
-- so RLS copies the operational (agent-write) pattern from 017 — no
-- child-join policies needed.
--
-- Idempotent. Uses core gen_random_uuid() (NOT uuid_generate_v4() —
-- the migration runner's search_path excludes the extensions schema).
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  -- Who recorded the check-in (front desk / trainer). Audit only.
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method        TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'qr', 'self')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot paths: "today's check-ins" (account + time), per-member history
-- and last-visit (account + contact + time), and the recent-activity
-- scan behind the inactive-members figure.
CREATE INDEX IF NOT EXISTS idx_attendance_account_time
  ON attendance(account_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_account_contact_time
  ON attendance(account_id, contact_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_membership
  ON attendance(membership_id);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Operational (agent writes) — mirrors contacts/memberships.
DROP POLICY IF EXISTS attendance_select ON attendance;
DROP POLICY IF EXISTS attendance_insert ON attendance;
DROP POLICY IF EXISTS attendance_update ON attendance;
DROP POLICY IF EXISTS attendance_delete ON attendance;
CREATE POLICY attendance_select ON attendance FOR SELECT USING (is_account_member(account_id));
CREATE POLICY attendance_insert ON attendance FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY attendance_update ON attendance FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY attendance_delete ON attendance FOR DELETE USING (is_account_member(account_id, 'agent'));
