-- Whole-organization closure/erasure is a separate audited lifecycle. Keep at
-- least one active branch so archiving the selected branch cannot strand its
-- owner outside the organization reporting UI.

CREATE OR REPLACE FUNCTION public.archive_branch(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org
  FROM public.accounts
  WHERE id = p_account_id;

  IF auth.uid() IS NULL OR v_org IS NULL
     OR NOT public.is_organization_owner(v_org)
     OR NOT public.has_account_membership(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can archive it'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts a
    JOIN public.account_memberships am ON am.account_id = a.id
    WHERE a.organization_id = v_org
      AND a.id <> p_account_id
      AND a.branch_status = 'active'
      AND am.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Create or retain another active branch before archiving this one'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.accounts
  SET branch_status = 'archived',
      readiness_state = 'attention',
      archived_at = now()
  WHERE id = p_account_id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation
  )
  VALUES (v_org, p_account_id, auth.uid(), 'branch.archived');
END;
$$;

ALTER FUNCTION public.archive_branch(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.archive_branch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_branch(UUID) TO authenticated;
