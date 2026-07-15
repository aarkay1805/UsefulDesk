-- 065_lead_delete_admin.sql
--
-- Deleting a lead/contact is destructive and unrecoverable, so restrict the
-- table-level DELETE to admin+ (was agent+ from 017). Mirrors the
-- canDeleteLead() predicate in src/lib/auth/roles.ts and the UI gates on the
-- lead sheet, the leads table row action, the board card menu, and the bulk
-- toolbar.
--
-- Member deletion is unaffected: it runs through the SECURITY DEFINER
-- delete_member RPC (056), which enforces its own is_account_member(…, 'admin')
-- check and bypasses this policy.

DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts
  FOR DELETE USING (is_account_member(account_id, 'admin'));
