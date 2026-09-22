-- Separate the signing-in person's profile identity from the business identity
-- created for a new organization. Existing organizations are grandfathered at
-- this migration's transaction timestamp; a rerun must not complete tenants
-- that were provisioned as pending after the first application.

DO $migration$
DECLARE
  v_column_already_exists BOOLEAN;
  v_backfill_at TIMESTAMPTZ := pg_catalog.transaction_timestamp();
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute attribute
    WHERE attribute.attrelid = 'public.organizations'::pg_catalog.regclass
      AND attribute.attname = 'name_setup_completed_at'
      AND NOT attribute.attisdropped
  )
  INTO v_column_already_exists;

  IF NOT v_column_already_exists THEN
    ALTER TABLE public.organizations
      ADD COLUMN IF NOT EXISTS name_setup_completed_at TIMESTAMPTZ;

    EXECUTE $sql$
      UPDATE public.organizations
      SET name_setup_completed_at = $1
      WHERE name_setup_completed_at IS NULL
    $sql$ USING v_backfill_at;
  END IF;
END
$migration$;

COMMENT ON COLUMN public.organizations.name_setup_completed_at IS
  'Database authority for whether the organization business identity has been completed.';

-- String.prototype.trim() removes this exact ECMAScript WhiteSpace and
-- LineTerminator set. PostgreSQL char_length then measures Unicode code points,
-- matching the shared 1-80-code-point name contract (including astral text).
CREATE OR REPLACE FUNCTION private.trim_javascript_whitespace(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
  SELECT pg_catalog.btrim(
    p_value,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
$function$;

ALTER FUNCTION private.trim_javascript_whitespace(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.trim_javascript_whitespace(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the latest atomic provisioning definition and every localization
-- field. gym_name is untrusted input: an absent key creates a provisional
-- tenant, while a present non-string or invalid value aborts the Auth insert.
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
      RAISE EXCEPTION 'Gym name must be 1 to 80 characters'
        USING ERRCODE = '22023';
    END IF;

    v_gym_name := private.trim_javascript_whitespace(v_meta->>'gym_name');
    IF v_gym_name = '' OR pg_catalog.char_length(v_gym_name) > 80 THEN
      RAISE EXCEPTION 'Gym name must be 1 to 80 characters'
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
    v_org, v_business_name, v_business_name, v_currency
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

-- A table-returning function cannot gain an output column through CREATE OR
-- REPLACE, so recreate the latest projection and append the completion state.
DROP FUNCTION IF EXISTS public.my_branch_accounts();
CREATE FUNCTION public.my_branch_accounts()
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
    legal_entity.name,
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

-- Complete one provisional tenant. Identity membership deliberately remains
-- available outside the product-access gate, matching branch discovery and
-- allowing setup/recovery. Normal operational APIs retain their existing gate.
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
    RAISE EXCEPTION 'Gym name must be 1 to 80 characters'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.organizations
  SET name = v_gym_name,
      name_setup_completed_at = pg_catalog.now()
  WHERE id = v_organization_id;

  UPDATE public.legal_entities
  SET name = v_gym_name,
      legal_name = v_gym_name
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

NOTIFY pgrst, 'reload schema';
