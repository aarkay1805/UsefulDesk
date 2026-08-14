-- A tenant owner must never exist in Auth without the organization, branch,
-- profile, and membership rows created by this trigger. Normalize the required
-- name at the database boundary and let provisioning failures abort signup.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT := btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  v_meta JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name TEXT;
  v_org UUID;
  v_legal UUID;
  v_account UUID;
  v_currency TEXT;
BEGIN
  IF v_full_name = '' THEN
    RAISE EXCEPTION 'Full name is required for user provisioning'
      USING ERRCODE = '22023';
  END IF;

  v_name := v_full_name;
  v_currency := CASE WHEN v_meta->>'default_currency' ~ '^[A-Z]{3}$'
                     THEN v_meta->>'default_currency' ELSE 'INR' END;
  INSERT INTO public.organizations (name) VALUES (v_name) RETURNING id INTO v_org;
  INSERT INTO public.legal_entities (
    organization_id, name, legal_name, default_currency
  ) VALUES (v_org, v_name, v_name, v_currency) RETURNING id INTO v_legal;
  INSERT INTO public.accounts (
    name, owner_user_id, organization_id, legal_entity_id,
    country_code, locale, default_currency, timezone,
    date_order, time_format, week_start,
    phone_country_code, measurement_system
  )
  VALUES (
    v_name, NEW.id, v_org, v_legal,
    CASE WHEN v_meta->>'country_code' ~ '^[A-Z]{2}$'
         THEN v_meta->>'country_code' ELSE 'IN' END,
    CASE WHEN v_meta->>'locale' ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
         THEN v_meta->>'locale' ELSE 'en-IN' END,
    v_currency,
    CASE WHEN v_meta->>'timezone' ~ '^[A-Za-z0-9_+/-]{1,64}$'
         THEN v_meta->>'timezone' ELSE 'Asia/Kolkata' END,
    CASE WHEN v_meta->>'date_order' IN ('DMY', 'MDY', 'YMD')
         THEN v_meta->>'date_order' ELSE 'DMY' END,
    CASE WHEN v_meta->>'time_format' IN ('12h', '24h')
         THEN v_meta->>'time_format' ELSE '12h' END,
    CASE WHEN v_meta->>'week_start' IN ('0', '1', '6')
         THEN (v_meta->>'week_start')::smallint ELSE 1 END,
    CASE WHEN v_meta->>'phone_country_code' = ''
           OR v_meta->>'phone_country_code' ~ '^\+[0-9]{1,4}$'
         THEN v_meta->>'phone_country_code' ELSE '+91' END,
    CASE WHEN v_meta->>'measurement_system' IN ('metric', 'imperial')
         THEN v_meta->>'measurement_system' ELSE 'metric' END
  )
  RETURNING id INTO v_account;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''), v_account, 'owner');
  INSERT INTO public.account_memberships (account_id, user_id, role, created_by_user_id)
  VALUES (v_account, NEW.id, 'owner', NEW.id);
  INSERT INTO public.organization_memberships (
    organization_id, user_id, role, created_by_user_id
  ) VALUES (v_org, NEW.id, 'owner', NEW.id);
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
