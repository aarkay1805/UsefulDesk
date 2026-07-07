-- ============================================================
-- 045_follow_up_note_link.sql — tie a follow-up to the note that
-- spawned it. The lead detail's note cards render their follow-up
-- strip ("Call due in 8 days" + mark-done) via this link. SET NULL:
-- deleting a note orphans the task rather than killing it — the
-- chase still matters.
--
-- Idempotent.
-- ============================================================

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS note_id UUID REFERENCES contact_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_follow_ups_note
  ON follow_ups (note_id)
  WHERE note_id IS NOT NULL;
