-- ============================================================
-- 035_trial_memberships.sql — Trial / lead tracking (Phase 2)
--
-- A trial is a prospect on a free/short pass before they buy. It's
-- NOT a new table — a trial is just a `memberships` row flagged
-- `is_trial=true`: same person (contacts), same expiry column
-- (end_date = when the trial lapses), same action-list machinery.
-- Converting to a paid member mutates the row in place (flip
-- is_trial→false, stamp converted_at, set plan/fee/dates) — exactly
-- how renewals already work.
--
-- Two columns:
--   1. is_trial     — true while the row is a trial. Trials are kept
--                     OUT of the renewal action lists and the active-
--                     member KPI (they aren't paying members yet); they
--                     drive the dedicated Trials action lists instead.
--   2. converted_at — set the moment a trial becomes a paid member.
--                     NULL on an expired trial = an unconverted lead
--                     (the win-back bucket). A converted row keeps the
--                     timestamp for funnel reporting later.
--
-- "Trial ending today / this week / expired-unconverted" is DERIVED at
-- read time from (is_trial, end_date, converted_at) against IST today —
-- no cron, mirroring the renewal wedge (031).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; partial index guarded by IF NOT
-- EXISTS. No enum change, no RLS change (same table — the memberships
-- policies from 031 already govern these columns). gen_random_uuid()
-- not needed here.
-- ============================================================

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS is_trial     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

-- Partial index over just the trial rows, keyed on the hot column the
-- Trials action lists scan (end_date). Trials are a small slice of
-- memberships, so a partial index stays tiny and keeps the renewal
-- scans (which now filter is_trial=false) off these rows.
CREATE INDEX IF NOT EXISTS idx_memberships_account_trial_end
  ON memberships(account_id, end_date)
  WHERE is_trial;
