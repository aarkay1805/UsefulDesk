-- ============================================================
-- 040_lead_status_funnel.sql — milestone-based lead statuses
--
-- 039 shipped opinion-based statuses (interested / not_interested /
-- high_opportunity / low_opportunity). Research (PRDs/Lead Statuses…)
-- says gym statuses should map to observable milestones with a clear
-- next action, and that "opportunity" is a scoring layer, not a
-- pipeline stage. So we move to a short, event-driven funnel:
--
--   New (NULL) → Contacted → Interested → Trial Booked → Lost
--
-- Won + Trial Active stay implicit: a lead that converts gains a
-- membership row and leaves the lead pool automatically (leads =
-- contacts without a membership), and trials are memberships too
-- (is_trial, migration 035). So neither needs a lead status.
--
-- Data remap (old → new):
--   interested        → interested   (kept)
--   high_opportunity  → interested   (showed intent; drop the score)
--   low_opportunity   → interested   (same — temperature deferred)
--   not_interested    → lost         (terminal inactive)
--   NULL              → NULL         (New)
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Drop the old CHECK first so the remap UPDATE can't trip it midway.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_lead_status_check;

UPDATE contacts
SET lead_status = CASE lead_status
  WHEN 'high_opportunity' THEN 'interested'
  WHEN 'low_opportunity'  THEN 'interested'
  WHEN 'not_interested'   THEN 'lost'
  ELSE lead_status
END
WHERE lead_status IN ('high_opportunity', 'low_opportunity', 'not_interested');

ALTER TABLE contacts ADD CONSTRAINT contacts_lead_status_check
  CHECK (
    lead_status IS NULL
    OR lead_status IN ('contacted', 'interested', 'trial_booked', 'lost')
  );
