-- Service-aware, resumable member import.
-- Phase 1 establishes one contact-backed customer row without inventing a
-- membership for customers who only bought duration-based services.

CREATE OR REPLACE VIEW public.member_customer_directory
WITH (security_invoker = true) AS
SELECT
  contact.account_id,
  contact.id AS contact_id,
  CASE
    WHEN membership.id IS NULL THEN 'service'::TEXT
    ELSE 'membership'::TEXT
  END AS customer_kind,
  membership.id AS membership_id,
  membership.member_number,
  membership.user_id AS membership_user_id,
  membership.plan_id,
  membership.pricing_option_id,
  membership.start_date AS membership_start_date,
  membership.end_date AS membership_end_date,
  membership.status AS membership_status,
  membership.fee_amount AS membership_fee_amount,
  membership.fee_status AS membership_fee_status,
  COALESCE(membership.is_trial, false) AS membership_is_trial,
  membership.frozen_at AS membership_frozen_at,
  membership.collection_mode AS membership_collection_mode,
  membership.created_at AS membership_created_at,
  membership.updated_at AS membership_updated_at,
  services.service_expiry,
  CASE
    WHEN membership.id IS NULL THEN services.service_expiry
    ELSE membership.end_date
  END AS display_expiry,
  services.service_count,
  COALESCE(billing.generic_balance, 0)::NUMERIC(12, 2) AS generic_balance,
  follow_ups.open_follow_up_count,
  contact.name AS contact_name,
  contact.phone AS contact_phone,
  contact.email AS contact_email,
  contact.avatar_url AS contact_avatar_url,
  contact.assigned_to AS contact_assigned_to,
  contact.churn_risk AS contact_churn_risk,
  to_jsonb(contact) AS contact,
  CASE WHEN plan.id IS NULL THEN NULL ELSE to_jsonb(plan) END AS plan
FROM public.contacts contact
JOIN public.accounts account ON account.id = contact.account_id
LEFT JOIN LATERAL (
  SELECT candidate.*
  FROM public.memberships candidate
  WHERE candidate.account_id = contact.account_id
    AND candidate.contact_id = contact.id
  ORDER BY candidate.updated_at DESC, candidate.id DESC
  LIMIT 1
) membership ON true
LEFT JOIN public.membership_plans plan ON plan.id = membership.plan_id
JOIN LATERAL (
  SELECT
    COALESCE(
      MIN(service.end_date) FILTER (
        WHERE service.status = 'active'
          AND service.end_date >= (NOW() AT TIME ZONE account.timezone)::DATE
      ),
      MAX(service.end_date)
    ) AS service_expiry,
    COUNT(service.id)::INTEGER AS service_count
  FROM public.member_services service
  WHERE service.account_id = contact.account_id
    AND service.contact_id = contact.id
) services ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(invoice.collectible_balance), 0)::NUMERIC(12, 2)
    AS generic_balance
  FROM public.invoice_balances invoice
  WHERE invoice.account_id = contact.account_id
    AND invoice.contact_id = contact.id
    AND invoice.state = 'open'
) billing ON true
LEFT JOIN LATERAL (
  SELECT COUNT(follow_up.id)::INTEGER AS open_follow_up_count
  FROM public.follow_ups follow_up
  WHERE follow_up.account_id = contact.account_id
    AND follow_up.contact_id = contact.id
    AND follow_up.status = 'open'
) follow_ups ON true
WHERE membership.id IS NOT NULL OR services.service_count > 0;

GRANT SELECT ON public.member_customer_directory TO authenticated, service_role;
REVOKE ALL ON public.member_customer_directory FROM anon;

-- Contact-backed checkout for standalone sales and service renewals. A real
-- membership remains optional and is validated when present; no synthetic
-- membership is created for a service-only customer.
CREATE OR REPLACE FUNCTION public.perform_contact_checkout(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mode TEXT := p_payload->>'mode';
  v_account_id UUID := (p_payload->>'account_id')::UUID;
  v_contact_id UUID := (p_payload->>'contact_id')::UUID;
  v_membership_id UUID := NULLIF(p_payload->>'membership_id', '')::UUID;
  v_key UUID := (p_payload->>'idempotency_key')::UUID;
  v_collection JSONB := COALESCE(p_payload->'collection', '{}'::JSONB);
  v_existing public.invoice_balances%ROWTYPE;
  v_result public.invoice_balances%ROWTYPE;
  v_invoice_id UUID;
  v_payment_id UUID;
  v_collect NUMERIC(12, 2) := COALESCE((v_collection->>'amount')::NUMERIC, 0);
  v_name TEXT;
  v_member_number BIGINT;
  v_currency TEXT;
BEGIN
  IF v_mode NOT IN ('sale', 'service_renewal') THEN
    RAISE EXCEPTION 'Unsupported contact checkout mode';
  END IF;
  IF NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Agent access is required';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;

  SELECT balance.* INTO v_existing
  FROM public.invoice_balances balance
  JOIN public.invoices invoice ON invoice.id = balance.id
  WHERE invoice.account_id = v_account_id
    AND invoice.idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'membership_id', v_existing.membership_id,
      'member_number', v_existing.member_number_snapshot,
      'invoice_id', v_existing.id,
      'total', v_existing.total,
      'cash_paid', v_existing.amount_paid,
      'credit_applied', v_existing.credit_applied,
      'balance', v_existing.balance
    );
  END IF;

  SELECT contact.name, account.default_currency
  INTO v_name, v_currency
  FROM public.contacts contact
  JOIN public.accounts account ON account.id = contact.account_id
  WHERE contact.id = v_contact_id
    AND contact.account_id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer contact not found';
  END IF;

  IF v_membership_id IS NOT NULL THEN
    SELECT membership.member_number INTO v_member_number
    FROM public.memberships membership
    WHERE membership.id = v_membership_id
      AND membership.account_id = v_account_id
      AND membership.contact_id = v_contact_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membership not found';
    END IF;
  END IF;

  INSERT INTO public.invoices (
    account_id,
    contact_id,
    membership_id,
    source,
    issued_at,
    customer_name_snapshot,
    member_number_snapshot,
    currency,
    created_by,
    idempotency_key
  ) VALUES (
    v_account_id,
    v_contact_id,
    v_membership_id,
    CASE WHEN v_mode = 'service_renewal' THEN 'service_renewal' ELSE 'sale' END,
    COALESCE((p_payload->>'issued_at')::TIMESTAMPTZ, NOW()),
    v_name,
    v_member_number,
    v_currency,
    (SELECT auth.uid()),
    v_key
  ) RETURNING id INTO v_invoice_id;

  PERFORM public.append_catalog_selections(
    v_invoice_id,
    v_membership_id,
    v_contact_id,
    COALESCE(p_payload->'selections', '[]'::JSONB)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_lines WHERE invoice_id = v_invoice_id
  ) THEN
    RAISE EXCEPTION 'Select at least one product or service';
  END IF;

  IF v_membership_id IS NOT NULL THEN
    PERFORM public.apply_oldest_member_credit(v_invoice_id);
  END IF;

  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  WHERE balance.id = v_invoice_id;
  IF v_collect < 0 OR v_collect > v_result.balance THEN
    RAISE EXCEPTION 'Collected amount must be between zero and the invoice balance';
  END IF;

  IF v_collect > 0 THEN
    PERFORM set_config('app.payment_purpose', 'sale', TRUE);
    INSERT INTO public.payments (
      account_id,
      membership_id,
      contact_id,
      user_id,
      invoice_id,
      amount,
      method,
      status,
      paid_at,
      receipt_bucket,
      screenshot_path,
      note,
      idempotency_key
    ) VALUES (
      v_account_id,
      v_membership_id,
      v_contact_id,
      (SELECT auth.uid()),
      v_invoice_id,
      v_collect,
      COALESCE(NULLIF(v_collection->>'method', ''), 'cash'),
      'paid',
      COALESCE((v_collection->>'paid_at')::TIMESTAMPTZ, NOW()),
      CASE
        WHEN NULLIF(v_collection->>'receipt_path', '') IS NULL THEN NULL
        ELSE 'payment-receipts'
      END,
      NULLIF(v_collection->>'receipt_path', ''),
      NULLIF(BTRIM(v_collection->>'note'), ''),
      v_key
    ) RETURNING id INTO v_payment_id;
    PERFORM set_config('app.payment_purpose', '', TRUE);
  END IF;

  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  WHERE balance.id = v_invoice_id;
  RETURN jsonb_build_object(
    'membership_id', v_membership_id,
    'member_number', v_member_number,
    'invoice_id', v_result.id,
    'total', v_result.total,
    'cash_paid', v_result.amount_paid,
    'credit_applied', v_result.credit_applied,
    'balance', v_result.balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.perform_contact_checkout(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_contact_checkout(JSONB)
  TO authenticated;

-- Private, author-owned import drafts. The original workbook lives in a
-- private Storage bucket; normalized wizard state is revisioned here.
CREATE TABLE IF NOT EXISTS public.member_import_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_filename TEXT NOT NULL CHECK (LENGTH(BTRIM(source_filename)) > 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('csv', 'xlsx')),
  source_size BIGINT NOT NULL CHECK (source_size > 0 AND source_size <= 10485760),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  object_path TEXT NOT NULL UNIQUE,
  selected_worksheet TEXT,
  wizard_step TEXT NOT NULL DEFAULT '1',
  mapping JSONB NOT NULL DEFAULT '{}'::JSONB,
  date_order TEXT NOT NULL DEFAULT 'DMY' CHECK (date_order IN ('DMY', 'MDY')),
  recipe_metadata JSONB,
  state JSONB NOT NULL DEFAULT '{}'::JSONB,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleanup')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_import_drafts_one_active_author
  ON public.member_import_drafts(account_id, author_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_member_import_drafts_author
  ON public.member_import_drafts(author_id, account_id);
CREATE INDEX IF NOT EXISTS idx_member_import_drafts_expiry
  ON public.member_import_drafts(expires_at, id)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS set_updated_at ON public.member_import_drafts;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.member_import_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.member_import_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authors can read member import drafts"
  ON public.member_import_drafts;
CREATE POLICY "Authors can read member import drafts"
  ON public.member_import_drafts FOR SELECT TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    AND public.is_account_member(account_id, 'agent')
  );

DROP POLICY IF EXISTS "Authors can create member import drafts"
  ON public.member_import_drafts;
CREATE POLICY "Authors can create member import drafts"
  ON public.member_import_drafts FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND public.is_account_member(account_id, 'agent')
  );

DROP POLICY IF EXISTS "Authors can update member import drafts"
  ON public.member_import_drafts;
CREATE POLICY "Authors can update member import drafts"
  ON public.member_import_drafts FOR UPDATE TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    AND public.is_account_member(account_id, 'agent')
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND public.is_account_member(account_id, 'agent')
  );

DROP POLICY IF EXISTS "Authors can delete member import drafts"
  ON public.member_import_drafts;
CREATE POLICY "Authors can delete member import drafts"
  ON public.member_import_drafts FOR DELETE TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    AND public.is_account_member(account_id, 'agent')
  );

CREATE OR REPLACE FUNCTION public.save_member_import_draft(
  p_draft_id UUID,
  p_expected_revision INTEGER,
  p_state JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row public.member_import_drafts%ROWTYPE;
  v_current public.member_import_drafts%ROWTYPE;
BEGIN
  UPDATE public.member_import_drafts draft
  SET
    selected_worksheet = NULLIF(p_state->>'worksheet', ''),
    wizard_step = COALESCE(NULLIF(p_state->>'step', ''), draft.wizard_step),
    mapping = COALESCE(p_state->'mapping', '{}'::JSONB),
    date_order = COALESCE(NULLIF(p_state->>'dateOrder', ''), draft.date_order),
    recipe_metadata = p_state->'recipe',
    state = p_state,
    revision = draft.revision + 1,
    saved_at = NOW(),
    expires_at = NOW() + INTERVAL '30 days'
  WHERE draft.id = p_draft_id
    AND draft.author_id = (SELECT auth.uid())
    AND public.is_account_member(draft.account_id, 'agent')
    AND draft.status = 'active'
    AND draft.expires_at > NOW()
    AND draft.revision = p_expected_revision
  RETURNING draft.* INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'revision', v_row.revision,
      'saved_at', v_row.saved_at,
      'expires_at', v_row.expires_at
    );
  END IF;

  SELECT draft.* INTO v_current
  FROM public.member_import_drafts draft
  WHERE draft.id = p_draft_id
    AND draft.author_id = (SELECT auth.uid())
    AND public.is_account_member(draft.account_id, 'agent');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'draft_unavailable');
  END IF;
  IF v_current.status <> 'active' OR v_current.expires_at <= NOW() THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'draft_expired',
      'revision', v_current.revision
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', FALSE,
    'code', 'draft_conflict',
    'revision', v_current.revision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_member_import_draft(UUID, INTEGER, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_member_import_draft(UUID, INTEGER, JSONB)
  TO authenticated;

-- Claiming is service-only. Rows are marked before returning so concurrent
-- cleanup workers never delete the same object.
CREATE OR REPLACE FUNCTION public.claim_expired_member_import_drafts(
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.member_import_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT draft.id
    FROM public.member_import_drafts draft
    WHERE draft.status = 'active'
      AND draft.expires_at <= NOW()
    ORDER BY draft.expires_at, draft.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 200)
  )
  UPDATE public.member_import_drafts draft
  SET status = 'cleanup'
  FROM claimed
  WHERE draft.id = claimed.id
  RETURNING draft.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_expired_member_import_drafts(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expired_member_import_drafts(INTEGER)
  TO service_role;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'member-import-drafts',
  'member-import-drafts',
  FALSE,
  10485760,
  ARRAY[
    'text/csv',
    'application/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Authors can read member import draft files"
  ON storage.objects;
CREATE POLICY "Authors can read member import draft files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'member-import-drafts'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
    AND public.is_account_member(
      ((storage.foldername(name))[1])::UUID,
      'agent'
    )
  );

DROP POLICY IF EXISTS "Authors can upload member import draft files"
  ON storage.objects;
CREATE POLICY "Authors can upload member import draft files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'member-import-drafts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
    AND public.is_account_member(
      ((storage.foldername(name))[1])::UUID,
      'agent'
    )
  );

DROP POLICY IF EXISTS "Authors can update member import draft files"
  ON storage.objects;
CREATE POLICY "Authors can update member import draft files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'member-import-drafts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
    AND public.is_account_member(
      ((storage.foldername(name))[1])::UUID,
      'agent'
    )
  )
  WITH CHECK (
    bucket_id = 'member-import-drafts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
    AND public.is_account_member(
      ((storage.foldername(name))[1])::UUID,
      'agent'
    )
  );

DROP POLICY IF EXISTS "Authors can delete member import draft files"
  ON storage.objects;
CREATE POLICY "Authors can delete member import draft files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'member-import-drafts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
    AND public.is_account_member(
      ((storage.foldername(name))[1])::UUID,
      'agent'
    )
  );

-- Import financial/customer work is private to the transaction boundary. The
-- run row is both the group-level idempotency claim and the durable receipt
-- returned by retries; clients never receive table access.
CREATE TABLE IF NOT EXISTS public.member_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  outcome JSONB,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_member_import_runs_contact
  ON public.member_import_runs(account_id, contact_id, created_at DESC);
ALTER TABLE public.member_import_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_import_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.member_import_runs TO service_role;

CREATE OR REPLACE FUNCTION public.perform_member_import_group(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor UUID := (SELECT auth.uid());
  v_account_id UUID := NULLIF(p_payload->>'account_id', '')::UUID;
  v_key UUID := NULLIF(p_payload->>'idempotency_key', '')::UUID;
  v_payload_hash TEXT := MD5(p_payload::TEXT);
  v_run public.member_import_runs%ROWTYPE;
  v_contact_data JSONB := COALESCE(p_payload->'contact', '{}'::JSONB);
  v_contact_id UUID := NULLIF(v_contact_data->>'id', '')::UUID;
  v_membership_id UUID;
  v_membership_period_id UUID;
  v_membership_line_id UUID;
  v_membership_invoice_id UUID;
  v_membership_cancel_after_payment BOOLEAN := FALSE;
  v_member_number BIGINT;
  v_currency TEXT;
  v_customer_name TEXT;
  v_row JSONB;
  v_membership_data JSONB;
  v_service_data JSONB;
  v_invoice_id UUID;
  v_invoice_line_id UUID;
  v_service_id UUID;
  v_payment_id UUID;
  v_row_total NUMERIC(12, 2);
  v_line_total NUMERIC(12, 2);
  v_paid NUMERIC(12, 2);
  v_balance NUMERIC(12, 2);
  v_configured_price NUMERIC(12, 2);
  v_results JSONB := '[]'::JSONB;
  membership_plan public.membership_plans%ROWTYPE;
  membership_option public.plan_pricing_options%ROWTYPE;
  catalog_item public.catalog_items%ROWTYPE;
  catalog_option public.catalog_options%ROWTYPE;
  selected_trainer public.trainers%ROWTYPE;
  trainer_rate public.trainer_rates%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_account_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'Authenticated account and idempotency key are required';
  END IF;
  IF NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Agent access is required';
  END IF;
  IF JSONB_TYPEOF(p_payload->'rows') <> 'array'
     OR JSONB_ARRAY_LENGTH(p_payload->'rows') = 0 THEN
    RAISE EXCEPTION 'At least one import purchase row is required';
  END IF;

  INSERT INTO public.member_import_runs (
    account_id, idempotency_key, payload_hash, created_by
  ) VALUES (
    v_account_id, v_key, v_payload_hash, v_actor
  )
  ON CONFLICT (account_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_run;
  IF NOT FOUND THEN
    SELECT run.* INTO v_run
    FROM public.member_import_runs run
    WHERE run.account_id = v_account_id
      AND run.idempotency_key = v_key;
    IF v_run.payload_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'Conflicting member import idempotency key';
    END IF;
    IF v_run.outcome IS NULL THEN
      RAISE EXCEPTION 'Member import group is still being processed';
    END IF;
    RETURN v_run.outcome;
  END IF;

  SELECT account.default_currency INTO v_currency
  FROM public.accounts account
  WHERE account.id = v_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;

  IF v_contact_id IS NULL THEN
    IF NULLIF(BTRIM(v_contact_data->>'phone'), '') IS NULL THEN
      RAISE EXCEPTION 'A customer phone is required';
    END IF;
    INSERT INTO public.contacts (
      user_id, account_id, phone, name, email, company, date_of_birth,
      gender, nickname, height_cm, weight_kg, address_line1, address_line2,
      city, state, postal_code, country, assigned_to, received_via, churn_risk
    ) VALUES (
      v_actor, v_account_id, v_contact_data->>'phone',
      NULLIF(BTRIM(v_contact_data->>'name'), ''),
      NULLIF(LOWER(BTRIM(v_contact_data->>'email')), ''),
      NULLIF(BTRIM(v_contact_data->>'company'), ''),
      NULLIF(v_contact_data->>'date_of_birth', '')::DATE,
      NULLIF(BTRIM(v_contact_data->>'gender'), ''),
      NULLIF(BTRIM(v_contact_data->>'nickname'), ''),
      NULLIF(v_contact_data->>'height_cm', '')::NUMERIC,
      NULLIF(v_contact_data->>'weight_kg', '')::NUMERIC,
      NULLIF(BTRIM(v_contact_data->>'address_line1'), ''),
      NULLIF(BTRIM(v_contact_data->>'address_line2'), ''),
      NULLIF(BTRIM(v_contact_data->>'city'), ''),
      NULLIF(BTRIM(v_contact_data->>'state'), ''),
      NULLIF(BTRIM(v_contact_data->>'postal_code'), ''),
      NULLIF(BTRIM(v_contact_data->>'country'), ''),
      COALESCE(NULLIF(v_contact_data->>'assigned_to', '')::UUID, v_actor),
      'import', COALESCE((v_contact_data->>'churn_risk')::BOOLEAN, FALSE)
    ) RETURNING id, name INTO v_contact_id, v_customer_name;
  ELSE
    SELECT contact.name INTO v_customer_name
    FROM public.contacts contact
    WHERE contact.id = v_contact_id AND contact.account_id = v_account_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer contact not found'; END IF;

    IF COALESCE((v_contact_data->>'use_csv')::BOOLEAN, FALSE) THEN
      UPDATE public.contacts contact
      SET
        name = CASE WHEN v_contact_data ? 'name'
          THEN NULLIF(BTRIM(v_contact_data->>'name'), '') ELSE contact.name END,
        email = CASE WHEN v_contact_data ? 'email'
          THEN NULLIF(LOWER(BTRIM(v_contact_data->>'email')), '') ELSE contact.email END,
        company = CASE WHEN v_contact_data ? 'company'
          THEN NULLIF(BTRIM(v_contact_data->>'company'), '') ELSE contact.company END,
        date_of_birth = CASE WHEN v_contact_data ? 'date_of_birth'
          THEN NULLIF(v_contact_data->>'date_of_birth', '')::DATE ELSE contact.date_of_birth END,
        gender = CASE WHEN v_contact_data ? 'gender'
          THEN NULLIF(BTRIM(v_contact_data->>'gender'), '') ELSE contact.gender END,
        nickname = CASE WHEN v_contact_data ? 'nickname'
          THEN NULLIF(BTRIM(v_contact_data->>'nickname'), '') ELSE contact.nickname END,
        height_cm = CASE WHEN v_contact_data ? 'height_cm'
          THEN NULLIF(v_contact_data->>'height_cm', '')::NUMERIC ELSE contact.height_cm END,
        weight_kg = CASE WHEN v_contact_data ? 'weight_kg'
          THEN NULLIF(v_contact_data->>'weight_kg', '')::NUMERIC ELSE contact.weight_kg END,
        address_line1 = CASE WHEN v_contact_data ? 'address_line1'
          THEN NULLIF(BTRIM(v_contact_data->>'address_line1'), '') ELSE contact.address_line1 END,
        address_line2 = CASE WHEN v_contact_data ? 'address_line2'
          THEN NULLIF(BTRIM(v_contact_data->>'address_line2'), '') ELSE contact.address_line2 END,
        city = CASE WHEN v_contact_data ? 'city'
          THEN NULLIF(BTRIM(v_contact_data->>'city'), '') ELSE contact.city END,
        state = CASE WHEN v_contact_data ? 'state'
          THEN NULLIF(BTRIM(v_contact_data->>'state'), '') ELSE contact.state END,
        postal_code = CASE WHEN v_contact_data ? 'postal_code'
          THEN NULLIF(BTRIM(v_contact_data->>'postal_code'), '') ELSE contact.postal_code END,
        country = CASE WHEN v_contact_data ? 'country'
          THEN NULLIF(BTRIM(v_contact_data->>'country'), '') ELSE contact.country END,
        churn_risk = CASE WHEN v_contact_data ? 'churn_risk'
          THEN (v_contact_data->>'churn_risk')::BOOLEAN ELSE contact.churn_risk END,
        assigned_to = CASE
          WHEN contact.received_via IS NULL
            OR contact.received_via IN ('manual', 'import')
          THEN COALESCE(NULLIF(v_contact_data->>'assigned_to', '')::UUID, contact.assigned_to)
          ELSE contact.assigned_to
        END
      WHERE contact.id = v_contact_id
      RETURNING contact.name INTO v_customer_name;
    END IF;
  END IF;

  -- Create the group's one current membership first, even when its source row
  -- follows service rows. This keeps later services consistently attached.
  FOR v_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_payload->'rows') LOOP
    v_membership_data := v_row->'membership';
    IF v_membership_data IS NULL OR JSONB_TYPEOF(v_membership_data) = 'null' THEN
      CONTINUE;
    END IF;
    IF v_membership_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only one current membership may be imported per customer';
    END IF;

    SELECT plan.* INTO membership_plan
    FROM public.membership_plans plan
    WHERE plan.id = (v_membership_data->>'plan_id')::UUID
      AND plan.account_id = v_account_id
      AND plan.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active membership plan not found'; END IF;
    SELECT option.* INTO membership_option
    FROM public.plan_pricing_options option
    WHERE option.id = (v_membership_data->>'pricing_option_id')::UUID
      AND option.account_id = v_account_id
      AND option.plan_id = membership_plan.id
      AND option.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active membership billing option not found'; END IF;
    IF (v_membership_data->>'end_date')::DATE <=
       (v_membership_data->>'start_date')::DATE THEN
      RAISE EXCEPTION 'Membership expiry must be after start';
    END IF;
    IF (v_membership_data->>'fee_amount')::NUMERIC < 0 THEN
      RAISE EXCEPTION 'Membership fee cannot be negative';
    END IF;

    v_membership_cancel_after_payment :=
      v_membership_data->>'status' = 'cancelled';
    INSERT INTO public.memberships (
      account_id, contact_id, user_id, plan_id, pricing_option_id,
      start_date, end_date, status, frozen_at, fee_amount, fee_status,
      is_trial, notes
    ) VALUES (
      v_account_id, v_contact_id, v_actor, membership_plan.id,
      membership_option.id, (v_membership_data->>'start_date')::DATE,
      (v_membership_data->>'end_date')::DATE,
      CASE WHEN v_membership_cancel_after_payment THEN 'active'
        ELSE COALESCE(NULLIF(v_membership_data->>'status', ''), 'active')::public.membership_status_enum END,
      NULLIF(v_membership_data->>'frozen_at', '')::DATE,
      (v_membership_data->>'fee_amount')::NUMERIC, 'due', FALSE,
      NULLIF(BTRIM(v_membership_data->>'notes'), '')
    ) RETURNING id, member_number INTO v_membership_id, v_member_number;

    SELECT period.id, period.invoice_line_id, line.invoice_id
    INTO v_membership_period_id, v_membership_line_id, v_membership_invoice_id
    FROM public.membership_periods period
    JOIN public.invoice_lines line ON line.id = period.invoice_line_id
    WHERE period.membership_id = v_membership_id
    ORDER BY period.created_at, period.id
    LIMIT 1;
    IF v_membership_invoice_id IS NULL THEN
      RAISE EXCEPTION 'Membership invoice was not created';
    END IF;
  END LOOP;

  FOR v_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_payload->'rows') LOOP
    IF NULLIF(v_row->>'idempotency_key', '') IS NULL THEN
      RAISE EXCEPTION 'Every source purchase requires an idempotency key';
    END IF;
    v_membership_data := v_row->'membership';
    v_service_data := v_row->'service';
    IF (v_membership_data IS NULL OR JSONB_TYPEOF(v_membership_data) = 'null')
       AND (v_service_data IS NULL OR JSONB_TYPEOF(v_service_data) = 'null') THEN
      RAISE EXCEPTION 'Import row has no purchase component';
    END IF;

    IF v_membership_data IS NOT NULL AND JSONB_TYPEOF(v_membership_data) <> 'null' THEN
      v_invoice_id := v_membership_invoice_id;
      UPDATE public.invoices invoice
      SET idempotency_key = (v_row->>'idempotency_key')::UUID
      WHERE invoice.id = v_invoice_id;
    ELSE
      INSERT INTO public.invoices (
        account_id, contact_id, membership_id, source, issued_at,
        customer_name_snapshot, member_number_snapshot, currency,
        created_by, idempotency_key
      ) VALUES (
        v_account_id, v_contact_id, v_membership_id, 'sale',
        COALESCE(NULLIF(v_row->>'issued_at', '')::TIMESTAMPTZ, NOW()),
        v_customer_name, v_member_number, v_currency, v_actor,
        (v_row->>'idempotency_key')::UUID
      ) RETURNING id INTO v_invoice_id;
    END IF;

    IF v_service_data IS NOT NULL AND JSONB_TYPEOF(v_service_data) <> 'null' THEN
      SELECT item.* INTO catalog_item
      FROM public.catalog_items item
      WHERE item.id = (v_service_data->>'item_id')::UUID
        AND item.account_id = v_account_id
        AND item.kind = 'service'
        AND item.is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Active service not found'; END IF;
      SELECT option.* INTO catalog_option
      FROM public.catalog_options option
      WHERE option.id = (v_service_data->>'option_id')::UUID
        AND option.account_id = v_account_id
        AND option.item_id = catalog_item.id
        AND option.is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Active service option not found'; END IF;
      IF (v_service_data->>'end_date')::DATE <=
         (v_service_data->>'start_date')::DATE THEN
        RAISE EXCEPTION 'service_end <= service_start';
      END IF;
      IF (v_service_data->>'sold_amount')::NUMERIC < 0 THEN
        RAISE EXCEPTION 'Service sold price cannot be negative';
      END IF;

      IF catalog_item.requires_trainer THEN
        SELECT trainer.* INTO selected_trainer
        FROM public.trainers trainer
        WHERE trainer.id = NULLIF(v_service_data->>'trainer_id', '')::UUID
          AND trainer.account_id = v_account_id
          AND trainer.is_active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Active trainer is required'; END IF;
      SELECT rate.* INTO trainer_rate
      FROM public.trainer_rates rate
        WHERE rate.account_id = v_account_id
          AND rate.trainer_id = selected_trainer.id
          AND rate.option_id = catalog_option.id
          AND rate.is_active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Active trainer rate not found'; END IF;
        v_configured_price := trainer_rate.price;
      ELSE
        IF NULLIF(v_service_data->>'trainer_id', '') IS NOT NULL THEN
          RAISE EXCEPTION 'Trainer is not allowed for this service';
        END IF;
        v_configured_price := catalog_option.standard_price;
      END IF;
      IF v_configured_price IS NULL
         AND NOT COALESCE((v_service_data->>'explicit_price')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION 'Configured service price is unavailable';
      END IF;

      INSERT INTO public.invoice_lines (
        account_id, invoice_id, kind, catalog_item_id, catalog_option_id,
        trainer_id, description, quantity, unit_amount, line_amount,
        service_start, service_end, list_amount, override_amount,
        override_reason, overridden_by, sort_order
      ) VALUES (
        v_account_id, v_invoice_id, 'service', catalog_item.id,
        catalog_option.id,
        CASE WHEN catalog_item.requires_trainer THEN selected_trainer.id END,
        catalog_item.name, 1, (v_service_data->>'sold_amount')::NUMERIC,
        (v_service_data->>'sold_amount')::NUMERIC,
        (v_service_data->>'start_date')::DATE,
        (v_service_data->>'end_date')::DATE, v_configured_price,
        CASE WHEN COALESCE((v_service_data->>'explicit_price')::BOOLEAN, FALSE)
          THEN (v_service_data->>'sold_amount')::NUMERIC END,
        CASE WHEN COALESCE((v_service_data->>'explicit_price')::BOOLEAN, FALSE)
          THEN 'Imported historical sold price' END,
        CASE WHEN COALESCE((v_service_data->>'explicit_price')::BOOLEAN, FALSE)
          THEN v_actor END,
        CASE WHEN v_membership_data IS NULL OR JSONB_TYPEOF(v_membership_data) = 'null'
          THEN 0 ELSE 1 END
      ) RETURNING id INTO v_invoice_line_id;

      INSERT INTO public.member_services (
        account_id, membership_id, contact_id, invoice_line_id,
        catalog_item_id, catalog_option_id, item_name_snapshot,
        option_duration_count, option_duration_unit, start_date, end_date,
        sold_amount, status, cancelled_at, cancelled_by, cancel_reason,
        created_by
      ) VALUES (
        v_account_id, v_membership_id, v_contact_id, v_invoice_line_id,
        catalog_item.id, catalog_option.id, catalog_item.name,
        catalog_option.duration_count, catalog_option.duration_unit,
        (v_service_data->>'start_date')::DATE,
        (v_service_data->>'end_date')::DATE,
        (v_service_data->>'sold_amount')::NUMERIC,
        CASE WHEN v_service_data->>'status' = 'cancelled' THEN 'cancelled' ELSE 'active' END,
        CASE WHEN v_service_data->>'status' = 'cancelled' THEN NOW() END,
        CASE WHEN v_service_data->>'status' = 'cancelled' THEN v_actor END,
        CASE WHEN v_service_data->>'status' = 'cancelled'
          THEN 'Imported cancelled service' END,
        v_actor
      ) RETURNING id INTO v_service_id;
      UPDATE public.invoice_lines
      SET member_service_id = v_service_id
      WHERE id = v_invoice_line_id;

      IF catalog_item.requires_trainer THEN
        INSERT INTO public.service_trainer_assignments (
          account_id, member_service_id, trainer_id, trainer_name_snapshot,
          trainer_title_snapshot, full_package_rate, starts_on, reason,
          assigned_by
        ) VALUES (
          v_account_id, v_service_id, selected_trainer.id,
          selected_trainer.display_name, selected_trainer.title,
          trainer_rate.price, (v_service_data->>'start_date')::DATE,
          'Imported historical trainer assignment', v_actor
        );
      END IF;
    END IF;

    SELECT COALESCE(SUM(line.line_amount), 0)::NUMERIC(12, 2)
    INTO v_line_total
    FROM public.invoice_lines line
    WHERE line.invoice_id = v_invoice_id AND line.state = 'active';
    v_row_total := (v_row->>'total')::NUMERIC;
    v_paid := COALESCE(NULLIF(v_row->>'amount_paid', '')::NUMERIC, 0);
    v_balance := NULLIF(v_row->>'balance', '')::NUMERIC;
    IF v_row_total < 0 OR ABS(v_line_total - v_row_total) > 0.01 THEN
      RAISE EXCEPTION 'Purchase total does not match imported invoice lines';
    END IF;
    IF v_paid < 0 OR v_paid - v_row_total > 0.01 THEN
      RAISE EXCEPTION 'Imported payment exceeds purchase total';
    END IF;
    IF v_balance IS NOT NULL
       AND ABS(v_paid + v_balance - v_row_total) > 0.01 THEN
      RAISE EXCEPTION 'Paid, balance, and purchase total do not reconcile';
    END IF;

    IF v_paid > 0 THEN
      PERFORM set_config(
        'app.payment_purpose',
        CASE WHEN v_membership_data IS NOT NULL
          AND JSONB_TYPEOF(v_membership_data) <> 'null'
          THEN 'joining' ELSE 'sale' END,
        TRUE
      );
      INSERT INTO public.payments (
        account_id, membership_id, contact_id, plan_id, user_id, invoice_id,
        amount, method, status, paid_at, period_start, period_end, note,
        idempotency_key
      ) VALUES (
        v_account_id, v_membership_id, v_contact_id,
        CASE WHEN v_membership_data IS NOT NULL
          AND JSONB_TYPEOF(v_membership_data) <> 'null'
          THEN membership_plan.id END,
        v_actor, v_invoice_id, v_paid,
        COALESCE(NULLIF(v_row->>'payment_method', ''), 'cash'), 'paid',
        COALESCE(NULLIF(v_row->>'paid_at', '')::TIMESTAMPTZ, NOW()),
        CASE WHEN v_membership_data IS NOT NULL
          AND JSONB_TYPEOF(v_membership_data) <> 'null'
          THEN (v_membership_data->>'start_date')::DATE END,
        CASE WHEN v_membership_data IS NOT NULL
          AND JSONB_TYPEOF(v_membership_data) <> 'null'
          THEN (v_membership_data->>'end_date')::DATE END,
        'Imported historical purchase', (v_row->>'idempotency_key')::UUID
      ) RETURNING id INTO v_payment_id;
      PERFORM set_config('app.payment_purpose', '', TRUE);
    ELSE
      v_payment_id := NULL;
    END IF;

    v_results := v_results || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'source_key', v_row->>'source_key',
      'source_row', (v_row->>'source_row')::INTEGER,
      'contact_id', v_contact_id,
      'membership_id', CASE WHEN v_membership_data IS NOT NULL
        AND JSONB_TYPEOF(v_membership_data) <> 'null' THEN v_membership_id END,
      'service_id', v_service_id,
      'invoice_id', v_invoice_id,
      'payment_id', v_payment_id,
      'status', 'imported'
    ));
    v_service_id := NULL;
    v_invoice_line_id := NULL;
  END LOOP;

  IF v_membership_cancel_after_payment THEN
    PERFORM public.set_membership_cancellation(v_membership_id, TRUE);
  END IF;

  v_run.outcome := JSONB_BUILD_OBJECT(
    'contact_id', v_contact_id,
    'membership_id', v_membership_id,
    'member_number', v_member_number,
    'rows', v_results
  );
  UPDATE public.member_import_runs run
  SET contact_id = v_contact_id, membership_id = v_membership_id,
      outcome = v_run.outcome, completed_at = NOW()
  WHERE run.id = v_run.id;
  RETURN v_run.outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.perform_member_import_group(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_member_import_group(JSONB)
  TO authenticated;
