-- 067_onboarding_dismissed.sql — Get Started checklist dismissal
--
-- Null = show the Get Started onboarding to admins+; set = hidden.
-- Set either by an explicit "Hide" action or automatically once every
-- setup step is detected complete (the client writes now() at that
-- point, so mature accounts never re-run the status queries).
-- accounts_update RLS (017) already lets admin+ write this column —
-- no policy change needed.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS onboarding_dismissed_at TIMESTAMPTZ;
