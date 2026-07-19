-- ============================================================
-- Sales accountability: lead outcomes + completion invariant
--
-- Follow-ups already provide one owner, one due date, and one open follow-up
-- per contact. Lead work needs two additional observable outcomes,
-- and "done" must never be an outcome-free escape hatch.
--
-- Existing historical done rows are labelled Other before the invariant is
-- added. RLS is unchanged: this is the existing follow_ups table and its
-- account-scoped agent-write policies from migration 036.
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

UPDATE follow_ups
SET outcome = 'other'
WHERE status = 'done'
  AND outcome IS NULL;

ALTER TABLE follow_ups
  DROP CONSTRAINT IF EXISTS follow_ups_done_requires_outcome;

ALTER TABLE follow_ups
  ADD CONSTRAINT follow_ups_done_requires_outcome
  CHECK (status <> 'done' OR outcome IS NOT NULL);
