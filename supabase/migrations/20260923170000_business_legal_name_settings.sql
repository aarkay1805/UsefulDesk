-- One canonical legal name per legal entity. Existing invoice profiles that
-- still follow that name move with it; explicit issuer-name overrides stay put.
CREATE OR REPLACE FUNCTION public.save_legal_business_name(
  p_account_id UUID,
  p_legal_name TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account public.accounts%ROWTYPE;
  v_entity public.legal_entities%ROWTYPE;
  v_previous_name TEXT;
  v_name TEXT := NULLIF(pg_catalog.btrim(p_legal_name), '');
BEGIN
  SELECT * INTO v_account
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF auth.uid() IS NULL
     OR v_account.id IS NULL
     OR NOT public.has_account_membership(p_account_id, 'owner')
     OR NOT public.is_organization_owner(v_account.organization_id) THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can change its legal business name'
      USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR pg_catalog.char_length(v_name) > 160 THEN
    RAISE EXCEPTION 'Legal business name must be 1 to 160 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_entity
  FROM public.legal_entities
  WHERE id = v_account.legal_entity_id
    AND organization_id = v_account.organization_id
  FOR UPDATE;
  IF v_entity.id IS NULL THEN
    RAISE EXCEPTION 'Legal entity not found'
      USING ERRCODE = '23503';
  END IF;

  v_previous_name := COALESCE(NULLIF(pg_catalog.btrim(v_entity.legal_name), ''), v_entity.name);
  IF v_name = v_previous_name THEN
    RETURN v_name;
  END IF;

  UPDATE public.legal_entities
  SET legal_name = v_name
  WHERE id = v_entity.id;

  UPDATE public.invoice_profiles AS profile
  SET legal_name = v_name
  WHERE profile.account_id IN (
    SELECT account.id FROM public.accounts AS account
    WHERE account.legal_entity_id = v_entity.id
  )
    AND (profile.legal_name IS NULL OR pg_catalog.btrim(profile.legal_name) = v_previous_name);

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  ) VALUES (
    v_account.organization_id, p_account_id, auth.uid(),
    'legal_entity.legal_name_updated',
    pg_catalog.jsonb_build_object(
      'legal_entity_id', v_entity.id,
      'previous_name', v_previous_name,
      'new_name', v_name
    )
  );

  RETURN v_name;
END;
$$;

ALTER FUNCTION public.save_legal_business_name(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_legal_business_name(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_legal_business_name(UUID, TEXT) TO authenticated;
