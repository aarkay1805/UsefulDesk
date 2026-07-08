-- ============================================================
-- 048_lead_received_via.sql — how a lead entered the system
--
-- "Received By" column on the Leads table. Distinct from:
--   - assigned_to (047): who OWNS the follow-up now (reassignable)
--   - user_id (001):     the audit/creator user — but auto-created
--                        leads (inbound WhatsApp, public API) are all
--                        attributed to the WhatsApp config owner
--                        (resolve-conversation.ts / webhook), so
--                        user_id alone can't tell "a human added this"
--                        from "automation captured this".
--
-- received_via records the ORIGIN channel at create time, immutable:
--   'manual'     — a human added the lead in the dashboard UI
--   'import'     — CSV import / bulk create (still a human action)
--   'whatsapp'   — inbound WhatsApp message find-or-create
--   'meta'       — Meta lead ads (reserved — no ingest path yet)
--   'api'        — public API POST /api/v1/contacts
--   'automation' — an internal automation/flow rule (reserved)
--
-- The Leads column renders a teammate (user_id) for the human origins
-- and an "Auto · <channel>" pill for the automated ones.
--
-- NULL = pre-048 rows (unknown origin). Readers treat NULL as a human
-- origin and fall back to the creator — the honest default for the
-- early manual-entry rows that dominate at this stage; historical
-- auto-created rows can't be reclassified retroactively.
--
-- No RLS changes: the column rides the existing contacts policies
-- (read = member, write = agent+, migration 017).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS received_via TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_received_via_check'
  ) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_received_via_check
      CHECK (
        received_via IS NULL
        OR received_via IN ('manual', 'import', 'whatsapp', 'meta', 'api', 'automation')
      );
  END IF;
END $$;
