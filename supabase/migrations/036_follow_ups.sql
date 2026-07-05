-- ============================================================
-- 036_follow_ups.sql — Staff follow-up tasks with ownership (Phase 2)
--
-- PRD principle #8: "every exception should have an owner, status,
-- and next action." The renewal/trial/payment action lists tell the
-- owner WHO needs chasing; this table records WHO on staff owns the
-- chase, WHEN it's due, and WHAT happened (outcome), closing the
-- accountability loop the reminder send alone leaves open.
--
-- Shape
--   One row = one task: chase this member (contact) for this reason,
--   owned by this staff user, due on this IST date. `membership_id`
--   is convenience context (SET NULL so the task survives membership
--   deletion). A partial unique index allows at most ONE OPEN task
--   per member per account — a member being chased twice in parallel
--   is exactly the WhatsApp+Excel chaos this replaces; UIs catch the
--   23505 and surface the existing task instead.
--
--   `assigned_to` is SET NULL on staff removal (the task must outlive
--   the teammate — it shows as "unassigned" for re-assignment).
--   `outcome` is recorded when the task closes; text CHECKs (not
--   enums) mirror attendance.method from 032.
--
-- RLS: operational (agent-write) pattern from 017/032 — any account
-- member reads, agent+ writes.
--
-- Idempotent. Uses core gen_random_uuid() (NOT uuid_generate_v4() —
-- the migration runner's search_path excludes the extensions schema).
-- ============================================================

CREATE TABLE IF NOT EXISTS follow_ups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  -- Staff user who owns the next action. NULL = unassigned (owner left).
  assigned_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Who created the task. Audit only.
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL DEFAULT 'renewal'
                CHECK (reason IN ('renewal', 'payment', 'trial', 'inactive', 'other')),
  -- 'YYYY-MM-DD', IST semantics — same convention as memberships.end_date.
  due_date      DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'done', 'cancelled')),
  -- Recorded when the task closes; NULL while open.
  outcome       TEXT CHECK (outcome IN ('renewed', 'paid', 'promised', 'no_answer', 'not_interested', 'other')),
  note          TEXT,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one OPEN follow-up per member — the accountability model is
-- "one owner, one next action", not a pile of parallel chases.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_follow_ups_open_per_contact
  ON follow_ups(account_id, contact_id)
  WHERE status = 'open';

-- Hot paths: the pending list (account + status + due), "my tasks"
-- (assignee + status), and per-member history in the detail sheet.
CREATE INDEX IF NOT EXISTS idx_follow_ups_account_status_due
  ON follow_ups(account_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_assignee_status
  ON follow_ups(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_account_contact
  ON follow_ups(account_id, contact_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_follow_ups_updated_at ON follow_ups;
CREATE TRIGGER trg_follow_ups_updated_at
  BEFORE UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

-- Operational (agent writes) — mirrors contacts/memberships/attendance.
DROP POLICY IF EXISTS follow_ups_select ON follow_ups;
DROP POLICY IF EXISTS follow_ups_insert ON follow_ups;
DROP POLICY IF EXISTS follow_ups_update ON follow_ups;
DROP POLICY IF EXISTS follow_ups_delete ON follow_ups;
CREATE POLICY follow_ups_select ON follow_ups FOR SELECT USING (is_account_member(account_id));
CREATE POLICY follow_ups_insert ON follow_ups FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY follow_ups_update ON follow_ups FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY follow_ups_delete ON follow_ups FOR DELETE USING (is_account_member(account_id, 'agent'));
