-- ============================================================
-- 044_follow_up_reminder.sql — optional reminder on follow-ups
--
-- The note composer's follow-up row grows a "remind me" time: an
-- IST wall-clock slot on the task's due date, stored resolved as a
-- timestamptz. NULL = no reminder (the default). A delivery runner
-- (cron scan → notifications) is future work — this records intent.
--
-- Idempotent.
-- ============================================================

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ;

-- Delivery scan: "reminders coming due that are still open".
CREATE INDEX IF NOT EXISTS idx_follow_ups_remind_at
  ON follow_ups (remind_at)
  WHERE remind_at IS NOT NULL AND status = 'open';
