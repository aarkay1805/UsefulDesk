-- Keep the gym brand and legal identity independent. Existing legal names are
-- untouched. Newly provisioned gyms have no legal business name until an owner
-- enters one in Business details.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_meta JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::JSONB);
  v_full_name TEXT := COALESCE(
    NULLIF(pg_catalog.btrim(v_meta->>'full_name'), ''),
    NULLIF(pg_catalog.btrim(v_meta->>'name'), '')
  );
  v_has_gym_name BOOLEAN;
  v_gym_name TEXT;
  -- Display label only. A signup brand is not a legal business name.
  v_business_name TEXT;
  v_org UUID;
  v_legal UUID;
  v_account UUID;
  v_currency TEXT;
BEGIN
  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'Full name is required for user provisioning'
      USING ERRCODE = '22023';
  END IF;

  v_has_gym_name := v_meta ? 'gym_name';
  IF v_has_gym_name THEN
    IF pg_catalog.jsonb_typeof(v_meta->'gym_name') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Gym brand must be 1 to 80 characters'
        USING ERRCODE = '22023';
    END IF;

    v_gym_name := private.trim_javascript_whitespace(v_meta->>'gym_name');
    IF v_gym_name = '' OR pg_catalog.char_length(v_gym_name) > 80 THEN
      RAISE EXCEPTION 'Gym brand must be 1 to 80 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_business_name := CASE WHEN v_has_gym_name THEN v_gym_name ELSE v_full_name END;
  v_currency := CASE WHEN v_meta->>'default_currency' ~ '^[A-Z]{3}$'
                     THEN v_meta->>'default_currency' ELSE 'INR' END;

  INSERT INTO public.organizations (name, name_setup_completed_at)
  VALUES (
    v_business_name,
    CASE WHEN v_has_gym_name THEN pg_catalog.now() ELSE NULL END
  )
  RETURNING id INTO v_org;

  INSERT INTO public.legal_entities (
    organization_id, name, legal_name, default_currency
  ) VALUES (
    v_org, v_business_name, NULL, v_currency
  ) RETURNING id INTO v_legal;

  INSERT INTO public.accounts (
    name, owner_user_id, organization_id, legal_entity_id,
    country_code, locale, default_currency, timezone,
    date_order, time_format, week_start,
    phone_country_code, measurement_system
  )
  VALUES (
    v_business_name, NEW.id, v_org, v_legal,
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
         THEN (v_meta->>'week_start')::SMALLINT ELSE 1 END,
    CASE WHEN v_meta->>'phone_country_code' = ''
           OR v_meta->>'phone_country_code' ~ '^\+[0-9]{1,4}$'
         THEN v_meta->>'phone_country_code' ELSE '+91' END,
    CASE WHEN v_meta->>'measurement_system' IN ('metric', 'imperial')
         THEN v_meta->>'measurement_system' ELSE 'metric' END
  )
  RETURNING id INTO v_account;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''), v_account, 'owner');

  INSERT INTO public.account_memberships (
    account_id, user_id, role, created_by_user_id
  ) VALUES (v_account, NEW.id, 'owner', NEW.id);

  INSERT INTO public.organization_memberships (
    organization_id, user_id, role, created_by_user_id
  ) VALUES (v_org, NEW.id, 'owner', NEW.id);

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_organization_name_setup(
  p_account_id UUID,
  p_gym_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor UUID := (SELECT auth.uid());
  v_branch_role public.account_role_enum;
  v_organization_role public.organization_role_enum;
  v_organization_id UUID;
  v_legal_entity_id UUID;
  v_organization public.organizations%ROWTYPE;
  v_legal_entity public.legal_entities%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_branch_count BIGINT;
  v_legal_entity_count BIGINT;
  v_gym_name TEXT;
BEGIN
  IF v_actor IS NULL OR p_account_id IS NULL
     OR NOT public.has_account_membership(p_account_id) THEN
    RAISE EXCEPTION 'Branch access is required'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the membership before reading completion state so a concurrent
  -- revocation or role change cannot authorize this transaction transiently.
  SELECT membership.role
  INTO v_branch_role
  FROM public.account_memberships membership
  WHERE membership.account_id = p_account_id
    AND membership.user_id = v_actor
  FOR UPDATE;

  IF v_branch_role IS NULL THEN
    RAISE EXCEPTION 'Branch access is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT account.organization_id, account.legal_entity_id
  INTO v_organization_id, v_legal_entity_id
  FROM public.accounts account
  WHERE account.id = p_account_id;

  IF v_organization_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'Branch access is required'
      USING ERRCODE = '42501';
  END IF;

  -- Match the organization -> legal entity -> account lock order used by the
  -- existing branch-creation transaction. The parent locks also serialize FK
  -- inserts, so the later one-branch/one-entity checks cannot race creation.
  SELECT *
  INTO v_organization
  FROM public.organizations organization
  WHERE organization.id = v_organization_id
  FOR UPDATE;

  SELECT *
  INTO v_legal_entity
  FROM public.legal_entities legal_entity
  WHERE legal_entity.id = v_legal_entity_id
    AND legal_entity.organization_id = v_organization_id
  FOR UPDATE;

  SELECT *
  INTO v_account
  FROM public.accounts account
  WHERE account.id = p_account_id
    AND account.organization_id = v_organization_id
    AND account.legal_entity_id = v_legal_entity_id
  FOR UPDATE;

  IF v_organization.id IS NULL
     OR v_legal_entity.id IS NULL
     OR v_account.id IS NULL
     OR NOT public.has_account_membership(p_account_id) THEN
    RAISE EXCEPTION 'Branch access is required'
      USING ERRCODE = '42501';
  END IF;

  -- Any branch member may receive this idempotent success only after the
  -- membership check and locks above. It never validates or applies the input.
  IF v_organization.name_setup_completed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'already_complete');
  END IF;

  -- Pending mutation additionally locks and revalidates organization ownership.
  SELECT membership.role
  INTO v_organization_role
  FROM public.organization_memberships membership
  WHERE membership.organization_id = v_organization_id
    AND membership.user_id = v_actor
  FOR UPDATE;

  IF v_branch_role <> 'owner'
     OR v_organization_role IS DISTINCT FROM 'owner'
     OR NOT public.has_account_membership(p_account_id, 'owner')
     OR NOT public.is_organization_owner(v_organization_id) THEN
    RAISE EXCEPTION 'Branch and organization owner access is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_branch_count
  FROM public.accounts account
  WHERE account.organization_id = v_organization_id;

  SELECT pg_catalog.count(*)
  INTO v_legal_entity_count
  FROM public.legal_entities legal_entity
  WHERE legal_entity.organization_id = v_organization_id;

  IF v_branch_count <> 1 OR v_legal_entity_count <> 1 THEN
    RAISE EXCEPTION 'Pending organization structure requires operator review'
      USING ERRCODE = '23505';
  END IF;

  v_gym_name := private.trim_javascript_whitespace(p_gym_name);
  IF v_gym_name IS NULL
     OR v_gym_name = ''
     OR pg_catalog.char_length(v_gym_name) > 80 THEN
    RAISE EXCEPTION 'Gym brand must be 1 to 80 characters'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.organizations
  SET name = v_gym_name,
      name_setup_completed_at = pg_catalog.now()
  WHERE id = v_organization_id;

  UPDATE public.legal_entities
  SET name = v_gym_name
  WHERE id = v_legal_entity_id;

  UPDATE public.accounts
  SET name = v_gym_name
  WHERE id = p_account_id;

  INSERT INTO public.organization_audit_log (
    organization_id,
    account_id,
    actor_user_id,
    operation,
    details
  ) VALUES (
    v_organization_id,
    p_account_id,
    v_actor,
    'organization.name_setup_completed',
    pg_catalog.jsonb_build_object(
      'previous_organization_name', v_organization.name,
      'previous_legal_entity_name', v_legal_entity.name,
      'previous_legal_name', v_legal_entity.legal_name,
      'previous_branch_name', v_account.name,
      'final_name', v_gym_name
    )
  );

  RETURN pg_catalog.jsonb_build_object('status', 'completed');
END;
$function$;

ALTER FUNCTION public.complete_organization_name_setup(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_organization_name_setup(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_organization_name_setup(UUID, TEXT)
  TO authenticated;

-- Retain the descriptive legal-entity label for branch selection, and expose
-- its actual legal name separately for messages. The extra output column needs
-- a drop/recreate because PostgreSQL does not replace a function's row shape.
DROP FUNCTION IF EXISTS public.my_branch_accounts();
CREATE OR REPLACE FUNCTION public.my_branch_accounts()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  organization_id UUID,
  organization_name TEXT,
  legal_entity_id UUID,
  legal_entity_name TEXT,
  legal_entity_legal_name TEXT,
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
    NULLIF(pg_catalog.btrim(legal_entity.legal_name), ''),
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

ALTER FUNCTION public.my_branch_accounts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_branch_accounts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_branch_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_organization_brand_name(
  p_account_id UUID,
  p_brand_name TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor UUID := (SELECT auth.uid());
  v_branch_role public.account_role_enum;
  v_organization_role public.organization_role_enum;
  v_account public.accounts%ROWTYPE;
  v_organization public.organizations%ROWTYPE;
  v_brand_name TEXT := private.trim_javascript_whitespace(p_brand_name);
BEGIN
  IF v_brand_name IS NULL OR v_brand_name = ''
     OR pg_catalog.char_length(v_brand_name) > 80 THEN
    RAISE EXCEPTION 'Gym brand must be 1 to 80 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account
  FROM public.accounts
  WHERE id = p_account_id;

  IF v_actor IS NULL OR v_account.id IS NULL
     OR NOT public.has_account_membership(p_account_id)
     OR NOT public.is_organization_owner(v_account.organization_id) THEN
    RAISE EXCEPTION 'Only an organization owner can change the gym brand'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_organization
  FROM public.organizations organization
  WHERE organization.id = v_account.organization_id
  FOR UPDATE;

  -- Recheck authority after locking the group and selected branch. A role
  -- revocation or branch move cannot authorize a stale name write.
  SELECT * INTO v_account
  FROM public.accounts account
  WHERE account.id = p_account_id
    AND account.organization_id = v_organization.id
  FOR UPDATE;

  SELECT membership.role INTO v_branch_role
  FROM public.account_memberships membership
  WHERE membership.account_id = p_account_id
    AND membership.user_id = v_actor
  FOR UPDATE;

  SELECT membership.role INTO v_organization_role
  FROM public.organization_memberships membership
  WHERE membership.organization_id = v_organization.id
    AND membership.user_id = v_actor
  FOR UPDATE;

  IF v_account.id IS NULL
     OR v_branch_role IS NULL
     OR v_organization_role IS DISTINCT FROM 'owner'
     OR NOT public.has_account_membership(p_account_id)
     OR NOT public.is_organization_owner(v_organization.id) THEN
    RAISE EXCEPTION 'Only an organization owner can change the gym brand'
      USING ERRCODE = '42501';
  END IF;

  IF v_organization.name IS NOT DISTINCT FROM v_brand_name THEN
    RETURN v_brand_name;
  END IF;

  UPDATE public.organizations
  SET name = v_brand_name
  WHERE id = v_organization.id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  ) VALUES (
    v_organization.id, p_account_id, v_actor,
    'organization.brand_name_updated',
    pg_catalog.jsonb_build_object(
      'previous_name', v_organization.name,
      'new_name', v_brand_name
    )
  );

  RETURN v_brand_name;
END;
$function$;

ALTER FUNCTION public.save_organization_brand_name(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_organization_brand_name(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_organization_brand_name(UUID, TEXT)
  TO authenticated;

-- Editing the legal name must never overwrite the independently editable brand.
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

  v_previous_name := NULLIF(pg_catalog.btrim(v_entity.legal_name), '');

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
      AND v_previous_name IS NOT NULL
      AND pg_catalog.btrim(profile.legal_name) = v_previous_name;
  END IF;

  IF v_name IS DISTINCT FROM v_previous_name THEN
    INSERT INTO public.organization_audit_log (
      organization_id, account_id, actor_user_id, operation, details
    ) VALUES (
      v_organization.id, p_account_id, auth.uid(),
      'legal_entity.legal_name_updated',
      pg_catalog.jsonb_build_object(
        'legal_entity_id', v_entity.id,
        'previous_name', v_previous_name,
        'new_name', v_name
      )
    );
  END IF;

  RETURN v_name;
END;
$$;

ALTER FUNCTION public.save_legal_business_name(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_legal_business_name(UUID, TEXT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_legal_business_name(UUID, TEXT)
  TO authenticated;

-- Invoice fields are explicit: display name may be the branch label, but the
-- legal-name field stays null until the owner records a legal identity.
CREATE OR REPLACE FUNCTION public.get_invoice_profile_prefill(
  p_account_id UUID
)
RETURNS TABLE (
  business_name TEXT,
  legal_name TEXT,
  country_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_account_member(p_account_id, 'viewer') THEN
    RAISE EXCEPTION 'You do not have access to this account';
  END IF;

  RETURN QUERY
  SELECT
    a.name,
    NULLIF(pg_catalog.btrim(le.legal_name), ''),
    a.country_code
  FROM public.accounts a
  JOIN public.legal_entities le ON le.id = a.legal_entity_id
  WHERE a.id = p_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_invoice_seller_snapshot(account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.invoice_profiles%ROWTYPE;
  v_branch_name TEXT;
  v_legal_name TEXT;
BEGIN
  -- The same lock order is used by both name-edit and invoice-profile writes.
  SELECT a.name, NULLIF(pg_catalog.btrim(le.legal_name), '')
  INTO v_branch_name, v_legal_name
  FROM public.accounts a
  JOIN public.legal_entities le ON le.id = a.legal_entity_id
  WHERE a.id = $1
  FOR UPDATE OF a, le;

  SELECT ip.* INTO v_profile
  FROM public.invoice_profiles ip
  WHERE ip.account_id = $1;

  IF NOT FOUND OR NOT v_profile.is_complete OR v_legal_name IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'business_name', v_profile.business_name,
    'legal_name', CASE WHEN v_legal_name = v_profile.business_name
      THEN NULL ELSE v_legal_name END,
    'branch_name', CASE WHEN v_branch_name = v_profile.business_name
      OR v_branch_name = v_legal_name THEN NULL ELSE v_branch_name END,
    'phone', v_profile.phone,
    'email', v_profile.email,
    'address', pg_catalog.jsonb_build_object(
      'line1', v_profile.address_line1,
      'line2', v_profile.address_line2,
      'city', v_profile.city,
      'state', v_profile.state,
      'postal_code', v_profile.postal_code,
      'country', v_profile.country
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_invoice_profile(
  account_id UUID,
  p_business_name TEXT,
  p_legal_name TEXT,
  p_address_line1 TEXT,
  p_address_line2 TEXT,
  p_city TEXT,
  p_state TEXT,
  p_postal_code TEXT,
  p_country TEXT,
  p_phone TEXT,
  p_email TEXT
)
RETURNS public.invoice_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.invoice_profiles%ROWTYPE;
  v_seller_snapshot JSONB;
  v_legal_name TEXT;
BEGIN
  IF NOT public.is_account_member(account_id, 'admin') THEN
    RAISE EXCEPTION 'Only an owner or admin can save Invoice details';
  END IF;

  IF NULLIF(pg_catalog.btrim(p_business_name), '') IS NULL THEN
    RAISE EXCEPTION 'Name on invoices is required';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_address_line1), '') IS NULL THEN
    RAISE EXCEPTION 'Address line 1 is required';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_city), '') IS NULL THEN
    RAISE EXCEPTION 'City is required';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_country), '') IS NULL THEN
    RAISE EXCEPTION 'Country is required';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_email), '') IS NOT NULL
     AND pg_catalog.btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

  SELECT NULLIF(pg_catalog.btrim(le.legal_name), '')
  INTO v_legal_name
  FROM public.accounts a
  JOIN public.legal_entities le ON le.id = a.legal_entity_id
  WHERE a.id = $1
  FOR UPDATE OF a, le;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
  IF v_legal_name IS NULL THEN
    RAISE EXCEPTION 'Set the legal business name before saving Invoice details'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoice_profiles (
    account_id, business_name, legal_name, address_line1, address_line2,
    city, state, postal_code, country, phone, email, updated_by
  ) VALUES (
    $1,
    pg_catalog.btrim(p_business_name),
    v_legal_name,
    pg_catalog.btrim(p_address_line1),
    NULLIF(pg_catalog.btrim(p_address_line2), ''),
    pg_catalog.btrim(p_city),
    NULLIF(pg_catalog.btrim(p_state), ''),
    NULLIF(pg_catalog.btrim(p_postal_code), ''),
    pg_catalog.btrim(p_country),
    NULLIF(pg_catalog.btrim(p_phone), ''),
    NULLIF(pg_catalog.btrim(p_email), ''),
    auth.uid()
  )
  ON CONFLICT ON CONSTRAINT invoice_profiles_pkey DO UPDATE
  SET business_name = EXCLUDED.business_name,
      legal_name = EXCLUDED.legal_name,
      address_line1 = EXCLUDED.address_line1,
      address_line2 = EXCLUDED.address_line2,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      postal_code = EXCLUDED.postal_code,
      country = EXCLUDED.country,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      updated_by = EXCLUDED.updated_by,
      updated_at = pg_catalog.now()
  RETURNING * INTO v_profile;

  v_seller_snapshot := public.build_invoice_seller_snapshot($1);

  INSERT INTO private.invoice_profile_save_guards (
    transaction_id, account_id, seller_snapshot
  ) VALUES (
    pg_catalog.txid_current(), $1, v_seller_snapshot
  )
  ON CONFLICT ON CONSTRAINT invoice_profile_save_guards_pkey DO UPDATE
  SET seller_snapshot = EXCLUDED.seller_snapshot;

  UPDATE public.invoices i
  SET seller_snapshot = v_seller_snapshot
  WHERE i.account_id = $1 AND i.seller_snapshot IS NULL;

  DELETE FROM private.invoice_profile_save_guards guard
  WHERE guard.transaction_id = pg_catalog.txid_current()
    AND guard.account_id = $1;

  RETURN v_profile;
END;
$$;

ALTER FUNCTION public.get_invoice_profile_prefill(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_invoice_profile_prefill(UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_invoice_profile_prefill(UUID)
  TO authenticated;
ALTER FUNCTION public.build_invoice_seller_snapshot(UUID) OWNER TO postgres;
ALTER FUNCTION public.save_invoice_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_invoice_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_invoice_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';
