-- ============================================================
-- 068_member_churn_risk.sql
--
-- Staff-managed retention signal for members. A member is a contact
-- with a membership, so the signal lives with the contact profile and
-- is available to every member read that already embeds contacts(*).
-- Existing contacts_update RLS is agent-level, matching the product
-- permission for owners/admins/agents while viewers remain read-only.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS churn_risk BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS churn_risk_note TEXT;

COMMENT ON COLUMN contacts.churn_risk IS
  'Staff-managed flag indicating that this member may leave.';

COMMENT ON COLUMN contacts.churn_risk_note IS
  'Optional staff context explaining why the member is marked as a churn risk.';
