-- Keep an explicitly blank invoice issuer name blank when the legal entity
-- changes. Only profiles that still contain the previous canonical name follow.
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
    AND pg_catalog.btrim(profile.legal_name) = v_previous_name;

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

-- Branch discovery labels the legal entity with the name members will see in
-- WhatsApp messages, not its original setup nickname.
CREATE OR REPLACE FUNCTION public.my_branch_accounts()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  organization_id UUID,
  organization_name TEXT,
  legal_entity_id UUID,
  legal_entity_name TEXT,
  role public.account_role_enum,
  branch_status public.branch_status_enum,
  readiness_state public.branch_readiness_enum,
  default_currency TEXT,
  timezone TEXT,
  is_organization_owner BOOLEAN,
  setup_reviewed_at TIMESTAMPTZ,
  setup_reviewed_by UUID,
  organization_name_setup_completed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    account.id,
    account.name,
    account.organization_id,
    organization.name,
    account.legal_entity_id,
    COALESCE(NULLIF(pg_catalog.btrim(legal_entity.legal_name), ''), legal_entity.name),
    membership.role,
    account.branch_status,
    account.readiness_state,
    account.default_currency,
    account.timezone,
    EXISTS (
      SELECT 1
      FROM public.organization_memberships organization_membership
      WHERE organization_membership.organization_id = account.organization_id
        AND organization_membership.user_id = (SELECT auth.uid())
        AND organization_membership.role = 'owner'
    ),
    account.setup_reviewed_at,
    account.setup_reviewed_by,
    organization.name_setup_completed_at
  FROM public.account_memberships membership
  JOIN public.accounts account ON account.id = membership.account_id
  JOIN public.organizations organization ON organization.id = account.organization_id
  JOIN public.legal_entities legal_entity ON legal_entity.id = account.legal_entity_id
  WHERE membership.user_id = (SELECT auth.uid())
  ORDER BY organization.name, account.name, account.id;
$function$;

ALTER FUNCTION public.save_legal_business_name(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_legal_business_name(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_legal_business_name(UUID, TEXT) TO authenticated;

ALTER FUNCTION public.my_branch_accounts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_branch_accounts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_branch_accounts() TO authenticated;
