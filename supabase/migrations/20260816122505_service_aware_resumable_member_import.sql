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
