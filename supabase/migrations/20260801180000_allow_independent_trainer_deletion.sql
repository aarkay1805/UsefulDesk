-- Independent trainers are standalone directory entries, so admins may remove
-- them permanently. Linked team-member trainer identities remain switch-only.
-- Rate rows cascade; invoice and assignment history retain their snapshots.
DROP POLICY IF EXISTS trainers_delete ON public.trainers;
CREATE POLICY trainers_delete ON public.trainers
  FOR DELETE TO authenticated
  USING (
    linked_user_id IS NULL
    AND public.is_account_member(account_id, 'admin')
  );

GRANT DELETE ON public.trainers TO authenticated;
REVOKE DELETE ON public.trainers FROM anon;
