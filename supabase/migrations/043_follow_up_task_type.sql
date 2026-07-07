-- ============================================================
-- 043_follow_up_task_type.sql — task type on follow-ups
--
-- The note composer's "create a follow-up task" row (HubSpot-style)
-- lets staff say WHAT the next action is: a call, an email/WhatsApp,
-- or a generic to-do. `reason` keeps answering WHY (renewal, payment,
-- trial…) — lead-note tasks use reason 'other'.
--
-- Idempotent.
-- ============================================================

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'todo';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_task_type_check'
  ) THEN
    ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_task_type_check
      CHECK (task_type IN ('call', 'email', 'todo'));
  END IF;
END $$;
