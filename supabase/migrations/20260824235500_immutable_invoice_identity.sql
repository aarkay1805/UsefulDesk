-- Database-owned invoice numbering, party profiles, and immutable snapshots.
-- Invoice documents consume this boundary; browser-authored identity is ignored.

CREATE TABLE IF NOT EXISTS public.invoice_profiles (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  legal_name TEXT,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT,
  postal_code TEXT,
  country TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  is_complete BOOLEAN GENERATED ALWAYS AS (
    length(btrim(business_name)) > 0
    AND length(btrim(address_line1)) > 0
    AND length(btrim(city)) > 0
    AND length(btrim(country)) > 0
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT invoice_profiles_business_name_present
    CHECK (length(btrim(business_name)) > 0),
  CONSTRAINT invoice_profiles_address_line1_present
    CHECK (length(btrim(address_line1)) > 0),
  CONSTRAINT invoice_profiles_city_present
    CHECK (length(btrim(city)) > 0),
  CONSTRAINT invoice_profiles_country_present
    CHECK (length(btrim(country)) > 0),
  CONSTRAINT invoice_profiles_legal_name_not_blank
    CHECK (legal_name IS NULL OR length(btrim(legal_name)) > 0),
  CONSTRAINT invoice_profiles_address_line2_not_blank
    CHECK (address_line2 IS NULL OR length(btrim(address_line2)) > 0),
  CONSTRAINT invoice_profiles_state_not_blank
    CHECK (state IS NULL OR length(btrim(state)) > 0),
  CONSTRAINT invoice_profiles_postal_code_not_blank
    CHECK (postal_code IS NULL OR length(btrim(postal_code)) > 0),
  CONSTRAINT invoice_profiles_phone_not_blank
    CHECK (phone IS NULL OR length(btrim(phone)) > 0),
  CONSTRAINT invoice_profiles_email_syntax
    CHECK (
      email IS NULL
      OR btrim(email) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )
);

DROP TRIGGER IF EXISTS set_updated_at ON public.invoice_profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.invoice_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.invoice_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_profiles_select ON public.invoice_profiles;
CREATE POLICY invoice_profiles_select ON public.invoice_profiles
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.account_invoice_number_counters (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  last_value BIGINT NOT NULL CHECK (last_value > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.account_invoice_number_counters ENABLE ROW LEVEL SECURITY;

-- A transaction-scoped capability for the one allowed legacy seller-snapshot
-- transition. Browser and service roles cannot mint it, and the profile RPC
-- removes it before returning so later SECURITY DEFINER work cannot inherit it.
CREATE TABLE IF NOT EXISTS private.invoice_profile_save_guards (
  transaction_id BIGINT NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  seller_snapshot JSONB NOT NULL,
  PRIMARY KEY (transaction_id, account_id)
);

ALTER TABLE private.invoice_profile_save_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.invoice_profile_save_guards
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON public.invoice_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoice_profiles TO authenticated;
GRANT ALL ON public.invoice_profiles TO service_role;

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
    COALESCE(le.legal_name, le.name),
    a.country_code
  FROM public.accounts a
  JOIN public.legal_entities le ON le.id = a.legal_entity_id
  WHERE a.id = p_account_id;
END;
$$;

REVOKE ALL ON public.account_invoice_number_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_invoice_number_counters TO service_role;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS seller_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS customer_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS identity_snapshot_version INTEGER;

CREATE OR REPLACE FUNCTION public.build_invoice_seller_snapshot(account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.invoice_profiles%ROWTYPE;
  v_branch_name TEXT;
BEGIN
  -- Serializes the first complete profile save with invoice inserts so a new
  -- invoice cannot miss a seller snapshot that committed concurrently.
  SELECT a.name
  INTO v_branch_name
  FROM public.accounts a
  WHERE a.id = $1
  FOR UPDATE;

  SELECT ip.*
  INTO v_profile
  FROM public.invoice_profiles ip
  WHERE ip.account_id = $1;

  IF NOT FOUND OR NOT v_profile.is_complete THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'business_name', v_profile.business_name,
    'legal_name', v_profile.legal_name,
    'branch_name', v_branch_name,
    'phone', v_profile.phone,
    'email', v_profile.email,
    'address', jsonb_build_object(
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

CREATE OR REPLACE FUNCTION public.build_invoice_customer_snapshot(invoice public.invoices)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts%ROWTYPE;
  v_membership public.memberships%ROWTYPE;
  v_customer_name TEXT;
  v_member_number TEXT;
BEGIN
  IF invoice.contact_id IS NOT NULL THEN
    SELECT c.*
    INTO v_contact
    FROM public.contacts c
    WHERE c.id = invoice.contact_id
      AND c.account_id = invoice.account_id;
  END IF;

  IF invoice.membership_id IS NOT NULL THEN
    SELECT m.*
    INTO v_membership
    FROM public.memberships m
    WHERE m.id = invoice.membership_id
      AND m.account_id = invoice.account_id;
  ELSIF invoice.contact_id IS NOT NULL THEN
    SELECT m.*
    INTO v_membership
    FROM public.memberships m
    WHERE m.contact_id = invoice.contact_id
      AND m.account_id = invoice.account_id;
  END IF;

  -- Existing immutable invoice facts win. Live contact/member data only fills
  -- fields that old invoices never snapshotted or left absent.
  v_customer_name := COALESCE(
    NULLIF(btrim(invoice.customer_name_snapshot), ''),
    NULLIF(btrim(v_contact.name), '')
  );
  v_member_number := COALESCE(
    invoice.member_number_snapshot::TEXT,
    v_membership.member_number::TEXT
  );

  RETURN jsonb_build_object(
    'customer_name', v_customer_name,
    'member_number', v_member_number,
    'phone', NULLIF(btrim(v_contact.phone), ''),
    'email', NULLIF(btrim(v_contact.email), ''),
    'address', jsonb_build_object(
      'line1', NULLIF(btrim(v_contact.address_line1), ''),
      'line2', NULLIF(btrim(v_contact.address_line2), ''),
      'city', NULLIF(btrim(v_contact.city), ''),
      'state', NULLIF(btrim(v_contact.state), ''),
      'postal_code', NULLIF(btrim(v_contact.postal_code), ''),
      'country', NULLIF(btrim(v_contact.country), '')
    )
  );
END;
$$;

-- Existing rows receive stable account-local identities in one deterministic
-- window. COALESCE keeps an idempotent rerun from replacing populated facts.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY account_id
      ORDER BY issued_at, created_at, id
    )::BIGINT AS invoice_sequence
  FROM public.invoices
)
UPDATE public.invoices i
SET
  invoice_sequence = COALESCE(i.invoice_sequence, ranked.invoice_sequence),
  invoice_number = COALESCE(
    i.invoice_number,
    CASE
      WHEN ranked.invoice_sequence >= 1000000
        THEN 'INV-' || ranked.invoice_sequence::TEXT
      ELSE 'INV-' || LPAD(ranked.invoice_sequence::TEXT, 6, '0')
    END
  ),
  customer_snapshot = COALESCE(
    i.customer_snapshot,
    public.build_invoice_customer_snapshot(i)
  ),
  identity_snapshot_version = COALESCE(i.identity_snapshot_version, 1)
FROM ranked
WHERE ranked.id = i.id;

-- The stored maximum is the last allocated value. GREATEST prevents an
-- idempotent rerun from moving a live counter backwards.
INSERT INTO public.account_invoice_number_counters(account_id, last_value)
SELECT account_id, MAX(invoice_sequence)
FROM public.invoices
WHERE invoice_sequence IS NOT NULL
GROUP BY account_id
ON CONFLICT (account_id) DO UPDATE
SET last_value = GREATEST(
  public.account_invoice_number_counters.last_value,
  EXCLUDED.last_value
),
updated_at = NOW();

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_account_invoice_sequence_key,
  DROP CONSTRAINT IF EXISTS invoices_account_invoice_number_key,
  DROP CONSTRAINT IF EXISTS invoices_invoice_sequence_positive,
  DROP CONSTRAINT IF EXISTS invoices_invoice_number_format,
  DROP CONSTRAINT IF EXISTS invoices_invoice_number_matches_sequence,
  DROP CONSTRAINT IF EXISTS invoices_seller_snapshot_object,
  DROP CONSTRAINT IF EXISTS invoices_customer_snapshot_object,
  DROP CONSTRAINT IF EXISTS invoices_identity_snapshot_version_positive;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_account_invoice_sequence_key
    UNIQUE (account_id, invoice_sequence),
  ADD CONSTRAINT invoices_account_invoice_number_key
    UNIQUE (account_id, invoice_number),
  ADD CONSTRAINT invoices_invoice_sequence_positive
    CHECK (invoice_sequence IS NULL OR invoice_sequence > 0),
  ADD CONSTRAINT invoices_invoice_number_format
    CHECK (invoice_number IS NULL OR invoice_number ~ '^INV-[0-9]{6,}$'),
  ADD CONSTRAINT invoices_invoice_number_matches_sequence
    CHECK (
      invoice_sequence IS NULL
      OR invoice_number IS NULL
      OR invoice_number = CASE
        WHEN invoice_sequence >= 1000000
          THEN 'INV-' || invoice_sequence::TEXT
        ELSE 'INV-' || LPAD(invoice_sequence::TEXT, 6, '0')
      END
    ),
  ADD CONSTRAINT invoices_seller_snapshot_object
    CHECK (
      seller_snapshot IS NULL
      OR (
        jsonb_typeof(seller_snapshot) = 'object'
        AND COALESCE(jsonb_typeof(seller_snapshot->'address'), '') = 'object'
      )
    ),
  ADD CONSTRAINT invoices_customer_snapshot_object
    CHECK (
      customer_snapshot IS NULL
      OR (
        jsonb_typeof(customer_snapshot) = 'object'
        AND COALESCE(jsonb_typeof(customer_snapshot->'address'), '') = 'object'
      )
    ),
  ADD CONSTRAINT invoices_identity_snapshot_version_positive
    CHECK (
      identity_snapshot_version IS NULL OR identity_snapshot_version > 0
    );

CREATE OR REPLACE FUNCTION public.assign_invoice_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Ignore caller-authored values: sequence, number, and party snapshots are
  -- all constructed by this database boundary.
  INSERT INTO public.account_invoice_number_counters(account_id, last_value)
  VALUES (NEW.account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
  SET last_value = public.account_invoice_number_counters.last_value + 1,
      updated_at = NOW()
  RETURNING last_value INTO NEW.invoice_sequence;

  NEW.invoice_number := 'INV-' || LPAD(NEW.invoice_sequence::TEXT, 6, '0');
  IF NEW.invoice_sequence >= 1000000 THEN
    NEW.invoice_number := 'INV-' || NEW.invoice_sequence::TEXT;
  END IF;
  NEW.seller_snapshot := public.build_invoice_seller_snapshot(NEW.account_id);
  NEW.customer_snapshot := public.build_invoice_customer_snapshot(NEW);
  NEW.identity_snapshot_version := 1;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_invoice_identity ON public.invoices;
CREATE TRIGGER trg_assign_invoice_identity
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_identity();

CREATE OR REPLACE FUNCTION public.prevent_invoice_identity_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.invoice_sequence IS DISTINCT FROM OLD.invoice_sequence THEN
    RAISE EXCEPTION 'Invoice sequence is immutable' USING ERRCODE = '22000';
  END IF;
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    RAISE EXCEPTION 'Invoice number is immutable' USING ERRCODE = '22000';
  END IF;
  IF NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot THEN
    RAISE EXCEPTION 'Invoice customer snapshot is immutable' USING ERRCODE = '22000';
  END IF;
  IF NEW.identity_snapshot_version IS DISTINCT FROM OLD.identity_snapshot_version THEN
    RAISE EXCEPTION 'Invoice snapshot version is immutable' USING ERRCODE = '22000';
  END IF;

  IF NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot THEN
    IF OLD.seller_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Invoice seller snapshot is immutable'
        USING ERRCODE = '22000';
    END IF;

    IF NOT EXISTS (
         SELECT 1
         FROM private.invoice_profile_save_guards guard
         WHERE guard.transaction_id = pg_catalog.txid_current()
           AND guard.account_id = NEW.account_id
           AND guard.seller_snapshot = NEW.seller_snapshot
       )
       OR NEW.seller_snapshot IS DISTINCT FROM
          public.build_invoice_seller_snapshot(NEW.account_id) THEN
      RAISE EXCEPTION 'Invoice seller snapshot can only be finalized by Invoice details save'
        USING ERRCODE = '22000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_invoice_identity_mutation ON public.invoices;
CREATE TRIGGER trg_prevent_invoice_identity_mutation
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_identity_mutation();

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

  -- Shares the account-row lock used by invoice snapshot construction.
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
  ON CONFLICT (transaction_id, account_id) DO UPDATE
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

-- Keep the complete refund-aware financial view from the latest definition.
-- Existing columns retain their exact order; identity fields append at the end
-- because CREATE OR REPLACE VIEW cannot insert columns into the middle.
CREATE OR REPLACE VIEW public.invoice_balances WITH (security_invoker=true) AS
WITH header_refunds AS (
 SELECT invoice_id,SUM(amount)::NUMERIC(12,2) processed_refund_amount,
   BOOL_OR(disposition IS NULL) requires_refund_review
 FROM public.payment_refunds WHERE status='processed' GROUP BY invoice_id
)
SELECT i.id,i.account_id,i.contact_id,i.membership_id,i.membership_period_id,i.source,i.state,i.issued_at,
 i.customer_name_snapshot,i.member_number_snapshot,i.currency,i.created_by,i.created_at,
 COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)::NUMERIC(12,2) total,
 (COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0))::NUMERIC(12,2) amount_paid,
 COALESCE(SUM(il.credit_applied),0)::NUMERIC(12,2) credit_applied,
 CASE WHEN i.state='void' OR COALESCE(header_refunds.requires_refund_review,FALSE) THEN 0 ELSE
  GREATEST(COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)-COALESCE(SUM(il.invoice_adjustment_amount),0)
   -COALESCE(SUM(il.credit_applied),0)-(COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0)),0) END::NUMERIC(12,2) balance,
 COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)::NUMERIC(12,2) gross_total,
 COALESCE(SUM(il.gross_amount_paid),0)::NUMERIC(12,2) gross_amount_paid,
 COALESCE(header_refunds.processed_refund_amount,0)::NUMERIC(12,2) processed_refund_amount,
 (COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0))::NUMERIC(12,2) net_amount_paid,
 COALESCE(SUM(il.invoice_adjustment_amount),0)::NUMERIC(12,2) invoice_adjustment_amount,
 GREATEST(COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)-COALESCE(SUM(il.invoice_adjustment_amount),0),0)::NUMERIC(12,2) net_total,
 GREATEST(COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)-COALESCE(SUM(il.invoice_adjustment_amount),0)
  -COALESCE(SUM(il.credit_applied),0)-(COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0)),0)::NUMERIC(12,2) accounting_balance,
 COALESCE(header_refunds.requires_refund_review,FALSE) requires_refund_review,
 CASE WHEN i.state='void' OR COALESCE(header_refunds.requires_refund_review,FALSE) THEN 0 ELSE
  GREATEST(COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)-COALESCE(SUM(il.invoice_adjustment_amount),0)
   -COALESCE(SUM(il.credit_applied),0)-(COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0)),0) END::NUMERIC(12,2) collectible_balance,
 i.invoice_sequence,i.invoice_number,i.seller_snapshot,i.customer_snapshot,i.identity_snapshot_version
FROM public.invoices i LEFT JOIN public.invoice_line_balances il ON il.invoice_id=i.id
LEFT JOIN header_refunds ON header_refunds.invoice_id=i.id GROUP BY i.id,header_refunds.processed_refund_amount,header_refunds.requires_refund_review;

GRANT SELECT ON public.invoice_balances TO authenticated, service_role;
REVOKE ALL ON public.invoice_balances FROM anon;

REVOKE ALL ON FUNCTION public.build_invoice_seller_snapshot(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_invoice_customer_snapshot(public.invoices)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_invoice_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_invoice_identity_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_invoice_seller_snapshot(UUID),
  public.build_invoice_customer_snapshot(public.invoices),
  public.assign_invoice_identity(),
  public.prevent_invoice_identity_mutation()
  TO service_role;

REVOKE ALL ON FUNCTION public.save_invoice_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_invoice_profile_prefill(UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_invoice_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoice_profile_prefill(UUID)
  TO authenticated;
