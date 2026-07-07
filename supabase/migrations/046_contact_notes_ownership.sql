-- ============================================================
-- 046: contact_notes — author-owned update/delete
--
-- Migration 017 gave every agent blanket UPDATE/DELETE on
-- contact_notes (`is_account_member(account_id, 'agent')`), so any
-- agent could delete or rewrite a teammate's note. Notes are
-- authored content: only the author may edit or delete their own
-- note; admins and owners may additionally delete (moderate) any
-- note in the account. The `user_id` column (kept by 017 for
-- audit/assignment) is the authorship record.
--
-- SELECT/INSERT policies from 017 are unchanged. SECURITY DEFINER
-- RPCs (merge_duplicate_contacts, invitation RPCs) bypass RLS and
-- are unaffected.
-- ============================================================

-- Update: author only. The author must still be an active agent+
-- member of the account — a member downgraded to viewer loses write
-- access to their own past notes too.
DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE
  USING (user_id = auth.uid() AND is_account_member(account_id, 'agent'));

-- Delete: author (agent+), or any admin/owner (moderation).
DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE
  USING (
    (user_id = auth.uid() AND is_account_member(account_id, 'agent'))
    OR is_account_member(account_id, 'admin')
  );
