-- Branch owners may rename any branch they own, including a non-selected or
-- archived branch. Normal accounts UPDATE RLS intentionally follows the
-- selected active branch, so this audited SECURITY DEFINER boundary owns the
-- cross-branch metadata mutation.

CREATE OR REPLACE FUNCTION public.rename_branch(
  p_account_id UUID,
  p_name TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_target public.accounts%ROWTYPE;
  v_name TEXT := btrim(p_name);
BEGIN
  SELECT *
  INTO v_target
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF auth.uid() IS NULL
     OR v_target.id IS NULL
     OR NOT public.has_account_membership(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Only the branch owner can rename it'
      USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR v_name = '' OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'Branch name must be 1 to 80 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_name = v_target.name THEN
    RETURN v_target.name;
  END IF;

  UPDATE public.accounts
  SET name = v_name
  WHERE id = p_account_id;

  INSERT INTO public.organization_audit_log (
    organization_id,
    account_id,
    actor_user_id,
    operation,
    details
  )
  VALUES (
    v_target.organization_id,
    p_account_id,
    auth.uid(),
    'branch.renamed',
    jsonb_build_object(
      'previous_name', v_target.name,
      'new_name', v_name
    )
  );

  RETURN v_name;
END;
$$;

ALTER FUNCTION public.rename_branch(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rename_branch(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_branch(UUID, TEXT) TO authenticated;
