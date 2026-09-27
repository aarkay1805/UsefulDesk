-- Google ID-token signup creates an Auth user before the client can supply the
-- selected country. Finish the provisional gym and apply its regional preset
-- in one transaction. The existing completion function owns the locks and
-- authorization; an already-complete gym never has its locale overwritten.
CREATE OR REPLACE FUNCTION public.complete_organization_name_setup_with_locale(
  p_account_id UUID,
  p_gym_name TEXT,
  p_locale JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result JSONB;
  v_legal_entity_id UUID;
  v_organization_id UUID;
BEGIN
  IF p_locale IS NULL
     OR pg_catalog.jsonb_typeof(p_locale) <> 'object'
     OR NOT (p_locale ?& ARRAY[
       'country_code', 'locale', 'default_currency', 'timezone',
       'date_order', 'time_format', 'week_start', 'phone_country_code',
       'measurement_system'
     ])
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_locale)) <> 9
     OR (p_locale->>'country_code') !~ '^[A-Z]{2}$'
     OR (p_locale->>'locale') !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
     OR (p_locale->>'default_currency') !~ '^[A-Z]{3}$'
     OR (p_locale->>'timezone') !~ '^[A-Za-z0-9_+/-]{1,64}$'
     OR (p_locale->>'date_order') NOT IN ('DMY', 'MDY', 'YMD')
     OR (p_locale->>'time_format') NOT IN ('12h', '24h')
     OR (p_locale->>'week_start') NOT IN ('0', '1', '6')
     OR (p_locale->>'phone_country_code') !~ '^$|^\+[0-9]{1,4}$'
     OR (p_locale->>'measurement_system') NOT IN ('metric', 'imperial')
  THEN
    RAISE EXCEPTION 'Invalid signup regional settings' USING ERRCODE = '22023';
  END IF;

  v_result := public.complete_organization_name_setup(p_account_id, p_gym_name);
  IF v_result->>'status' <> 'completed' THEN
    RETURN v_result;
  END IF;

  UPDATE public.accounts
  SET country_code = p_locale->>'country_code',
      locale = p_locale->>'locale',
      default_currency = p_locale->>'default_currency',
      timezone = p_locale->>'timezone',
      date_order = p_locale->>'date_order',
      time_format = p_locale->>'time_format',
      week_start = (p_locale->>'week_start')::SMALLINT,
      phone_country_code = p_locale->>'phone_country_code',
      measurement_system = p_locale->>'measurement_system'
  WHERE id = p_account_id
  RETURNING legal_entity_id, organization_id
  INTO v_legal_entity_id, v_organization_id;

  IF v_legal_entity_id IS NULL OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Completed gym has no branch' USING ERRCODE = '23505';
  END IF;

  UPDATE public.legal_entities
  SET default_currency = p_locale->>'default_currency'
  WHERE id = v_legal_entity_id AND organization_id = v_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completed gym has no registered business' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  ) VALUES (
    v_organization_id, p_account_id, (SELECT auth.uid()),
    'organization.signup_locale_set',
    pg_catalog.jsonb_build_object('country_code', p_locale->>'country_code')
  );

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.complete_organization_name_setup_with_locale(UUID, TEXT, JSONB)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_organization_name_setup_with_locale(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_organization_name_setup_with_locale(UUID, TEXT, JSONB)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
