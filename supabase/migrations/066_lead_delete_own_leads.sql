-- 066_lead_delete_own_leads.sql
--
-- Refines the admin-only lead delete from 065: an AGENT may also delete a lead
-- they personally created via a human action — i.e. a manual/import (or NULL)
-- origin whose created_by is them. Auto-captured leads (whatsapp/meta/api/
-- automation/form) and leads created by other teammates stay admin-only.
--
-- Mirrors canDeleteLead() in src/lib/auth/roles.ts exactly:
--   · admin+                       → any lead
--   · agent, created_by = self,    → deletable
--     human origin (NULL/manual/import)
--   · everything else              → denied
--
-- created_by is the immutable original creator (051); received_via the
-- immutable origin channel (048). Member deletion is unaffected — it runs
-- through the SECURITY DEFINER delete_member RPC (056), which bypasses RLS.

DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts
  FOR DELETE USING (
    is_account_member(account_id, 'admin')
    OR (
      is_account_member(account_id, 'agent')
      AND created_by IS NOT NULL
      AND created_by = auth.uid()
      AND (received_via IS NULL OR received_via IN ('manual', 'import'))
    )
  );
