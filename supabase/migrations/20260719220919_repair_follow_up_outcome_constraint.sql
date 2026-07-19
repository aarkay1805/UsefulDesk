-- ============================================================
-- Repair the follow-up outcome contract
--
-- The lead completion UI writes `contacted` and `trial_booked`. Some
-- environments still have migration 036's original member-only CHECK,
-- even though migration 20260719080908 widened it. Reassert the complete
-- contract in a new idempotent migration so those environments converge.
-- ============================================================

ALTER TABLE follow_ups
  DROP CONSTRAINT IF EXISTS follow_ups_outcome_check;

ALTER TABLE follow_ups
  ADD CONSTRAINT follow_ups_outcome_check
  CHECK (
    outcome IS NULL
    OR outcome IN (
      'renewed',
      'paid',
      'promised',
      'contacted',
      'trial_booked',
      'no_answer',
      'not_interested',
      'other'
    )
  );

-- Preserve the completion invariant if the earlier accountability
-- migration was skipped as a whole.
UPDATE follow_ups
SET outcome = 'other'
WHERE status = 'done'
  AND outcome IS NULL;

ALTER TABLE follow_ups
  DROP CONSTRAINT IF EXISTS follow_ups_done_requires_outcome;

ALTER TABLE follow_ups
  ADD CONSTRAINT follow_ups_done_requires_outcome
  CHECK (status <> 'done' OR outcome IS NOT NULL);
