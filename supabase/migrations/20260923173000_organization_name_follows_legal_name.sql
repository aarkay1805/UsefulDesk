-- A one-entity gym group has the same public name as its legal business.
-- Keep legal_entities.legal_name canonical; organizations.name is the legacy
-- group label used by branch discovery and deletion confirmations.
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
  v_organization public.organizations%ROWTYPE;
  v_entity public.legal_entities%ROWTYPE;
  v_previous_name TEXT;
  v_name TEXT := NULLIF(pg_catalog.btrim(p_legal_name), '');
  v_entity_count BIGINT;
BEGIN
  IF v_name IS NULL OR pg_catalog.char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Legal business name must be 1 to 120 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Read the parent id first, then lock the group before its branch and legal
  -- entity. Branch creation and name setup lock the group first as well.
  SELECT * INTO v_account
  FROM public.accounts
  WHERE id = p_account_id;

  IF auth.uid() IS NULL
     OR v_account.id IS NULL
     OR NOT public.has_account_membership(p_account_id, 'owner')
     OR NOT public.is_organization_owner(v_account.organization_id) THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can change its legal business name'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_organization
  FROM public.organizations
  WHERE id = v_account.organization_id
  FOR UPDATE;

  SELECT * INTO v_account
  FROM public.accounts
  WHERE id = p_account_id
    AND organization_id = v_organization.id
  FOR UPDATE;

  IF v_account.id IS NULL
     OR NOT public.has_account_membership(p_account_id, 'owner')
     OR NOT public.is_organization_owner(v_organization.id) THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can change its legal business name'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_entity
  FROM public.legal_entities
  WHERE id = v_account.legal_entity_id
    AND organization_id = v_organization.id
  FOR UPDATE;
  IF v_entity.id IS NULL THEN
    RAISE EXCEPTION 'Legal entity not found'
      USING ERRCODE = '23503';
  END IF;

  v_previous_name := COALESCE(NULLIF(pg_catalog.btrim(v_entity.legal_name), ''), v_entity.name);

  IF v_name IS DISTINCT FROM v_previous_name THEN
    UPDATE public.legal_entities
    SET legal_name = v_name
    WHERE id = v_entity.id;

    UPDATE public.invoice_profiles AS profile
    SET legal_name = v_name
    WHERE profile.account_id IN (
      SELECT account.id FROM public.accounts AS account
      WHERE account.legal_entity_id = v_entity.id
    )
      AND pg_catalog.btrim(profile.legal_name) = v_previous_name;
  END IF;

  SELECT pg_catalog.count(*) INTO v_entity_count
  FROM public.legal_entities
  WHERE organization_id = v_organization.id;

  IF v_entity_count = 1 AND v_organization.name IS DISTINCT FROM v_name THEN
    UPDATE public.organizations
    SET name = v_name
    WHERE id = v_organization.id;
  END IF;

  IF v_name IS DISTINCT FROM v_previous_name
     OR (v_entity_count = 1 AND v_organization.name IS DISTINCT FROM v_name) THEN
    INSERT INTO public.organization_audit_log (
      organization_id, account_id, actor_user_id, operation, details
    ) VALUES (
      v_organization.id, p_account_id, auth.uid(),
      'legal_entity.legal_name_updated',
      pg_catalog.jsonb_build_object(
        'legal_entity_id', v_entity.id,
        'previous_name', v_previous_name,
        'new_name', v_name,
        'previous_organization_name', v_organization.name,
        'organization_name_updated', v_entity_count = 1
      )
    );
  END IF;

  RETURN v_name;
END;
$$;

-- Reconcile existing single-entity groups, including ones whose legal name
-- changed before this migration. Do not invent one label for multi-entity groups.
WITH single_entity AS (
  SELECT organization_id,
         MIN(COALESCE(NULLIF(pg_catalog.btrim(legal_name), ''), name)) AS legal_name
  FROM public.legal_entities
  GROUP BY organization_id
  HAVING pg_catalog.count(*) = 1
)
UPDATE public.organizations AS organization
SET name = single_entity.legal_name
FROM single_entity
WHERE organization.id = single_entity.organization_id
  AND organization.name IS DISTINCT FROM single_entity.legal_name;

ALTER FUNCTION public.save_legal_business_name(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_legal_business_name(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_legal_business_name(UUID, TEXT) TO authenticated;
