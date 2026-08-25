-- Preserve the public RPC argument name while removing PL/pgSQL ambiguity in
-- the private guard upsert. The original column-list conflict target could be
-- parsed as either the account_id argument or the guard-table column.

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
BEGIN
  IF NOT public.is_account_member(account_id, 'admin') THEN
    RAISE EXCEPTION 'Only an owner or admin can save Invoice details';
  END IF;

  IF NULLIF(btrim(p_business_name), '') IS NULL THEN
    RAISE EXCEPTION 'Business name is required';
  END IF;
  IF NULLIF(btrim(p_address_line1), '') IS NULL THEN
    RAISE EXCEPTION 'Address line 1 is required';
  END IF;
  IF NULLIF(btrim(p_city), '') IS NULL THEN
    RAISE EXCEPTION 'City is required';
  END IF;
  IF NULLIF(btrim(p_country), '') IS NULL THEN
    RAISE EXCEPTION 'Country is required';
  END IF;
  IF NULLIF(btrim(p_email), '') IS NOT NULL
     AND btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

  PERFORM 1
  FROM public.accounts a
  WHERE a.id = $1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  INSERT INTO public.invoice_profiles (
    account_id,
    business_name,
    legal_name,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    phone,
    email,
    updated_by
  )
  VALUES (
    $1,
    btrim(p_business_name),
    NULLIF(btrim(p_legal_name), ''),
    btrim(p_address_line1),
    NULLIF(btrim(p_address_line2), ''),
    btrim(p_city),
    NULLIF(btrim(p_state), ''),
    NULLIF(btrim(p_postal_code), ''),
    btrim(p_country),
    NULLIF(btrim(p_phone), ''),
    NULLIF(btrim(p_email), ''),
    auth.uid()
  )
  ON CONFLICT ON CONSTRAINT invoice_profiles_pkey DO UPDATE
  SET
    business_name = EXCLUDED.business_name,
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
    updated_at = NOW()
  RETURNING * INTO v_profile;

  v_seller_snapshot := public.build_invoice_seller_snapshot($1);

  INSERT INTO private.invoice_profile_save_guards (
    transaction_id,
    account_id,
    seller_snapshot
  )
  VALUES (pg_catalog.txid_current(), $1, v_seller_snapshot)
  ON CONFLICT ON CONSTRAINT invoice_profile_save_guards_pkey DO UPDATE
  SET seller_snapshot = EXCLUDED.seller_snapshot;

  UPDATE public.invoices i
  SET seller_snapshot = v_seller_snapshot
  WHERE i.account_id = $1
    AND i.seller_snapshot IS NULL;

  DELETE FROM private.invoice_profile_save_guards guard
  WHERE guard.transaction_id = pg_catalog.txid_current()
    AND guard.account_id = $1;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.save_invoice_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_invoice_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
