-- ============================================================
-- 033_renewal_reminders.sql — Automated renewal reminders (Phase 2)
--
-- Turns the manual one-tap "Remind" button (M1) into a self-driving
-- loop: a scheduled job finds memberships expiring N days out and
-- sends the `gym_renewal_reminder` WhatsApp template automatically.
-- This is the wedge's money layer — recovering renewals without an
-- owner remembering to chase.
--
-- Two tables:
--   1. renewal_reminder_settings — per-account opt-in + which day
--      offsets to fire on. Settings-class (admin write), like
--      membership_plans.
--   2. renewal_reminders_sent — append-only dedupe log, one row per
--      reminder actually delivered. The UNIQUE(membership_id,
--      end_date, days_before) index is the dedupe key: a member gets
--      at most one reminder per offset per expiry. A renewal moves
--      end_date forward, which starts a fresh reminder cycle for free.
--
-- The cron writes via the service-role client (bypasses RLS), so the
-- write policies here only constrain the dashboard UI, not the job.
--
-- Idempotent. Uses core gen_random_uuid() (NOT uuid_generate_v4() —
-- the migration runner's search_path excludes the extensions schema)
-- and reuses update_updated_at_column() for the settings timestamp.
-- ============================================================

-- ------------------------------------------------------------
-- SETTINGS — per-account opt-in + offsets
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS renewal_reminder_settings (
  account_id  UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- Off by default: auto-messaging costs money + trust, so an owner
  -- opts in explicitly. Until then the manual button is the only path.
  enabled     BOOLEAN NOT NULL DEFAULT false,
  -- Whole days before end_date to send. {7,3,1} → a week out, 3 days
  -- out, and the day before. Deduped per (membership, end_date, offset)
  -- so overlapping offsets never double-send the same day.
  days_before INTEGER[] NOT NULL DEFAULT '{7,3,1}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE renewal_reminder_settings ENABLE ROW LEVEL SECURITY;

-- Settings-class: any member reads, admins+ write (mirrors 017).
DROP POLICY IF EXISTS rrs_select ON renewal_reminder_settings;
DROP POLICY IF EXISTS rrs_insert ON renewal_reminder_settings;
DROP POLICY IF EXISTS rrs_update ON renewal_reminder_settings;
DROP POLICY IF EXISTS rrs_delete ON renewal_reminder_settings;
CREATE POLICY rrs_select ON renewal_reminder_settings
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY rrs_insert ON renewal_reminder_settings
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY rrs_update ON renewal_reminder_settings
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY rrs_delete ON renewal_reminder_settings
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS trg_rrs_updated_at ON renewal_reminder_settings;
CREATE TRIGGER trg_rrs_updated_at
  BEFORE UPDATE ON renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- SENT LOG — append-only dedupe ledger
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS renewal_reminders_sent (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- The membership expiry this reminder was for. Part of the dedupe
  -- key: when a member renews, end_date changes → the same offset can
  -- fire again for the new period without a special reset.
  end_date      DATE NOT NULL,
  days_before   INTEGER NOT NULL,
  -- Meta message id when the send landed; NULL while a row is a
  -- pre-send claim (see the cron's claim-first dedupe).
  wa_message_id TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedupe key AND the cron's claim lock: an INSERT that conflicts here
-- means this reminder was already sent (or is being sent) — skip it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_renewal_reminder_once
  ON renewal_reminders_sent(membership_id, end_date, days_before);
-- Recent-activity scans (per-account history / owner reporting later).
CREATE INDEX IF NOT EXISTS idx_renewal_reminders_account_time
  ON renewal_reminders_sent(account_id, sent_at DESC);

ALTER TABLE renewal_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Read-only from the dashboard (members see the history); all writes
-- go through the service-role cron, which bypasses RLS. Admin-gated
-- writes are kept as defense-in-depth against a direct client insert.
DROP POLICY IF EXISTS rr_sent_select ON renewal_reminders_sent;
DROP POLICY IF EXISTS rr_sent_insert ON renewal_reminders_sent;
DROP POLICY IF EXISTS rr_sent_delete ON renewal_reminders_sent;
CREATE POLICY rr_sent_select ON renewal_reminders_sent
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY rr_sent_insert ON renewal_reminders_sent
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY rr_sent_delete ON renewal_reminders_sent
  FOR DELETE USING (is_account_member(account_id, 'admin'));
