-- Keep one editable invoice display name. The legal name is always the shared
-- entity's canonical name, even when an older client submits p_legal_name.
ALTER TABLE public.legal_entities
  DROP CONSTRAINT IF EXISTS legal_entities_legal_name_invoice_limit;
ALTER TABLE public.legal_entities
  ADD CONSTRAINT legal_entities_legal_name_invoice_limit
  CHECK (legal_name IS NULL OR pg_catalog.char_length(legal_name) <= 120);

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
  SELECT a.name, COALESCE(NULLIF(pg_catalog.btrim(le.legal_name), ''), le.name)
  INTO v_branch_name, v_legal_name
  FROM public.accounts a
  JOIN public.legal_entities le ON le.id = a.legal_entity_id
  WHERE a.id = $1
  FOR UPDATE OF a, le;

  SELECT ip.* INTO v_profile
  FROM public.invoice_profiles ip
  WHERE ip.account_id = $1;

  IF NOT FOUND OR NOT v_profile.is_complete THEN
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

  SELECT COALESCE(NULLIF(pg_catalog.btrim(le.legal_name), ''), le.name)
  INTO v_legal_name
  FROM public.accounts a
  JOIN public.legal_entities le ON le.id = a.legal_entity_id
  WHERE a.id = $1
  FOR UPDATE OF a, le;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
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
