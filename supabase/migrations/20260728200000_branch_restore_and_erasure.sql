-- ============================================================
-- Branch restore and permanent branch erasure.
--
-- Storage objects are purged through the Storage API before delete_branch
-- runs. These RPCs own the transactional relational changes and re-check the
-- caller as both an organization owner and an owner of the target branch.
-- ============================================================

ALTER TABLE public.data_deletion_requests
  DROP CONSTRAINT IF EXISTS data_deletion_requests_source_check,
  ADD CONSTRAINT data_deletion_requests_source_check
    CHECK (source IN (
      'meta_callback',
      'account_erasure',
      'organization_erasure',
      'branch_erasure'
    ));

CREATE OR REPLACE FUNCTION public.restore_branch(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_target public.accounts%ROWTYPE;
BEGIN
  SELECT *
  INTO v_target
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF auth.uid() IS NULL
     OR v_target.id IS NULL
     OR NOT public.is_organization_owner(v_target.organization_id)
     OR NOT public.has_account_membership(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can restore it'
      USING ERRCODE = '42501';
  END IF;

  IF v_target.branch_status <> 'archived' THEN
    RAISE EXCEPTION 'Only an archived branch can be restored'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.accounts
  SET branch_status = 'active',
      readiness_state = 'attention',
      archived_at = NULL
  WHERE id = p_account_id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation
  )
  VALUES (
    v_target.organization_id,
    p_account_id,
    auth.uid(),
    'branch.restored'
  );
END;
$$;

ALTER FUNCTION public.restore_branch(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.restore_branch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_branch(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_branch(p_account_id UUID)
RETURNS TABLE (next_account_id UUID, deleted_account_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_target public.accounts%ROWTYPE;
  v_next_account_id UUID;
BEGIN
  SELECT *
  INTO v_target
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF auth.uid() IS NULL
     OR v_target.id IS NULL
     OR NOT public.is_organization_owner(v_target.organization_id)
     OR NOT public.has_account_membership(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can delete it'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize lifecycle changes across the organization. Deleting the final
  -- branch belongs to delete_organization, which also removes organization
  -- parents and organization-scoped data.
  PERFORM 1
  FROM public.organizations
  WHERE id = v_target.organization_id
  FOR UPDATE;

  IF (
    SELECT COUNT(*)
    FROM public.accounts
    WHERE organization_id = v_target.organization_id
  ) <= 1 THEN
    RAISE EXCEPTION 'The final branch cannot be deleted. Delete the organization instead.'
      USING ERRCODE = '55000';
  END IF;

  -- A lifecycle action must never strand an organization with only archived
  -- history. This also gives the caller a valid branch to enter afterward.
  SELECT a.id
  INTO v_next_account_id
  FROM public.accounts a
  WHERE a.organization_id = v_target.organization_id
    AND a.id <> p_account_id
    AND a.branch_status = 'active'
  ORDER BY a.created_at, a.id
  LIMIT 1;

  IF v_next_account_id IS NULL THEN
    RAISE EXCEPTION 'At least one other active branch must remain'
      USING ERRCODE = '55000';
  END IF;

  -- An organization owner may own only the branch being removed (for example
  -- after accounts were grouped). Preserve their organization access by
  -- attaching them to the surviving active branch before profile re-homing.
  INSERT INTO public.account_memberships (
    account_id, user_id, role, created_by_user_id
  )
  SELECT
    v_next_account_id,
    om.user_id,
    'owner'::public.account_role_enum,
    auth.uid()
  FROM public.organization_memberships om
  JOIN public.profiles p
    ON p.user_id = om.user_id
   AND p.account_id = p_account_id
  WHERE om.organization_id = v_target.organization_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.account_memberships existing
      JOIN public.accounts existing_account
        ON existing_account.id = existing.account_id
      WHERE existing.user_id = om.user_id
        AND existing.account_id <> p_account_id
        AND existing_account.branch_status = 'active'
    )
  ON CONFLICT (account_id, user_id) DO UPDATE
  SET role = 'owner'::public.account_role_enum,
      updated_at = now();

  -- profiles.account_id/account_role are compatibility metadata. Point every
  -- user with another membership at their best surviving branch before the
  -- target account cascade runs. Branch-only users are intentionally removed
  -- from profiles and the API subsequently deletes their unused Auth users.
  WITH replacements AS (
    SELECT DISTINCT ON (p.user_id)
      p.id AS profile_id,
      am.account_id,
      am.role
    FROM public.profiles p
    JOIN public.account_memberships am
      ON am.user_id = p.user_id
     AND am.account_id <> p_account_id
    JOIN public.accounts survivor
      ON survivor.id = am.account_id
    WHERE p.account_id = p_account_id
    ORDER BY
      p.user_id,
      CASE
        WHEN survivor.organization_id = v_target.organization_id THEN 0
        ELSE 1
      END,
      CASE survivor.branch_status
        WHEN 'active' THEN 0
        WHEN 'read_only' THEN 1
        ELSE 2
      END,
      am.created_at,
      am.account_id
  )
  UPDATE public.profiles p
  SET account_id = replacements.account_id,
      account_role = replacements.role,
      updated_at = now()
  FROM replacements
  WHERE p.id = replacements.profile_id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  VALUES (
    v_target.organization_id,
    p_account_id,
    auth.uid(),
    'branch.deleted',
    jsonb_build_object(
      'account_id', p_account_id,
      'account_name', v_target.name,
      'previous_status', v_target.branch_status
    )
  );

  -- These two account foreign keys are intentionally RESTRICT. Every other
  -- operational account_id relation cascades or nulls its audit pointer.
  DELETE FROM public.contact_consent_events
  WHERE account_id = p_account_id;

  DELETE FROM public.account_memberships
  WHERE account_id = p_account_id;

  DELETE FROM public.accounts
  WHERE id = p_account_id;

  RETURN QUERY SELECT v_next_account_id, v_target.name;
END;
$$;

ALTER FUNCTION public.delete_branch(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_branch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_branch(UUID) TO authenticated;
