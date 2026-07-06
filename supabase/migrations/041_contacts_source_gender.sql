-- ============================================================
-- 041_contacts_source_gender.sql — lead attributes for filtering
--
-- The Leads table's Filters panel needs two attributes the schema
-- didn't carry yet:
--   source  — how the lead was acquired (walk-in, referral, Instagram…)
--   gender  — for segmented outreach / class planning
--
-- Both are free-text (the UI offers a preset list, but gyms use their
-- own labels, so we don't lock them behind a CHECK/enum). Existing
-- lead fields already cover the other five filters: contact owner =
-- contacts.user_id, assigned to = contacts.assigned_to, lead status =
-- contacts.lead_status, tags = contact_tags, create date = created_at.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gender text;

-- Filters query these account-scoped, so index by (account_id, col).
CREATE INDEX IF NOT EXISTS idx_contacts_source ON contacts (account_id, source);
CREATE INDEX IF NOT EXISTS idx_contacts_gender ON contacts (account_id, gender);
