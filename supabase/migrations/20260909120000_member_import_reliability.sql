-- Member import reliability: bind every group to the persisted private draft,
-- revalidate configured prices, and make cancellation debt an explicit,
-- fact-bound write-off. The established import function remains the atomic
-- writer; this guard deliberately runs before it claims the idempotency row.

ALTER TABLE public.member_import_runs
  ADD COLUMN IF NOT EXISTS import_job_id UUID;

ALTER TABLE public.member_import_runs
  ADD COLUMN IF NOT EXISTS request_payload_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_member_import_runs_import_job
  ON public.member_import_runs(account_id, import_job_id, created_at DESC)
  WHERE import_job_id IS NOT NULL;

DO $$
BEGIN
  IF to_regprocedure('public.perform_member_import_group_unchecked(jsonb)')
       IS NULL THEN
    ALTER FUNCTION public.perform_member_import_group(JSONB)
      RENAME TO perform_member_import_group_unchecked;
  END IF;
END;
$$;

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
  v_job_id UUID := NULLIF(p_payload->>'import_job_id', '')::UUID;
  v_contact JSONB := COALESCE(p_payload->'contact', '{}'::JSONB);
  v_contact_id UUID := NULLIF(v_contact->>'id', '')::UUID;
  v_contact_phone TEXT;
  v_input_phone TEXT := regexp_replace(COALESCE(v_contact->>'phone', ''), '\D', '', 'g');
  v_row JSONB;
  v_membership JSONB;
  v_service JSONB;
  v_option_price NUMERIC(12, 2);
  v_service_price NUMERIC(12, 2);
  -- Do not coerce untrusted JSON into the column's scale before deciding
  -- whether it is a paise amount: NUMERIC(12,2) would round 1.999 to 2.00.
  v_fee NUMERIC;
  v_sold NUMERIC;
  v_total NUMERIC;
  v_paid NUMERIC;
  v_balance NUMERIC;
  v_expected_total NUMERIC;
  v_historical BOOLEAN;
  v_expected_fingerprint TEXT;
  v_inner_payload JSONB := p_payload;
  v_inner_hash TEXT;
  v_request_hash TEXT := MD5(p_payload::TEXT);
  v_result JSONB;
  v_existing_run public.member_import_runs%ROWTYPE;
  v_membership_id UUID;
  v_membership_debt NUMERIC(12, 2);
  v_cancel_requested BOOLEAN := FALSE;
  v_debt_decision TEXT;
  v_debt_fingerprint TEXT;
  v_index INTEGER := 0;
BEGIN
  IF v_actor IS NULL OR v_account_id IS NULL OR v_key IS NULL OR v_job_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated account, import job, and idempotency key are required';
  END IF;
  IF NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Agent access is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_account_id::TEXT || ':' || v_key::TEXT, 0::BIGINT)
  );
  IF JSONB_TYPEOF(p_payload->'rows') <> 'array'
     OR JSONB_ARRAY_LENGTH(p_payload->'rows') = 0 THEN
    RAISE EXCEPTION 'At least one import purchase row is required';
  END IF;

  -- Keep the underlying writer's replay hash deterministic while deferring
  -- cancellation until after payment allocations expose the membership line.
  FOR v_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_payload->'rows') LOOP
    IF v_row->'membership'->>'status' = 'cancelled' THEN
      v_inner_payload := jsonb_set(
        v_inner_payload,
        ARRAY['rows', v_index::TEXT, 'membership', 'status'],
        '"active"'::JSONB
      );
    END IF;
    v_index := v_index + 1;
  END LOOP;
  v_inner_hash := MD5(v_inner_payload::TEXT);
  SELECT run.* INTO v_existing_run
  FROM public.member_import_runs run
  WHERE run.account_id = v_account_id AND run.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing_run.created_by IS DISTINCT FROM v_actor
       OR v_existing_run.import_job_id IS DISTINCT FROM v_job_id
       OR v_existing_run.request_payload_hash IS DISTINCT FROM v_request_hash
       OR v_existing_run.payload_hash IS DISTINCT FROM v_inner_hash THEN
      RAISE EXCEPTION 'Conflicting member import idempotency key';
    END IF;
    IF v_existing_run.outcome IS NULL THEN
      RAISE EXCEPTION 'Member import group is still being processed';
    END IF;
    RETURN v_existing_run.outcome;
  END IF;

  PERFORM 1
  FROM public.member_import_drafts draft
  WHERE draft.id = v_job_id
    AND draft.account_id = v_account_id
    AND draft.author_id = v_actor
    AND draft.status = 'active'
    AND draft.expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job is not an active draft owned by this author';
  END IF;

  -- A client-side re-match is advisory. The transaction itself must refuse a
  -- stale selected contact if the reviewed phone changed before commit.
  IF v_contact_id IS NOT NULL THEN
    SELECT contact.phone_normalized INTO v_contact_phone
    FROM public.contacts contact
    WHERE contact.id = v_contact_id
      AND contact.account_id = v_account_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer contact not found';
    END IF;
    IF v_input_phone = '' OR v_contact_phone <> v_input_phone THEN
      RAISE EXCEPTION 'Selected customer no longer matches the imported phone';
    END IF;
  END IF;

  v_index := 0;
  FOR v_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_payload->'rows') LOOP
    v_membership := v_row->'membership';
    v_service := v_row->'service';
    v_total := NULLIF(v_row->>'total', '')::NUMERIC;
    v_paid := NULLIF(v_row->>'amount_paid', '')::NUMERIC;
    v_balance := NULLIF(v_row->>'balance', '')::NUMERIC;
    IF v_total IS NULL OR v_paid IS NULL OR v_balance IS NULL
       OR v_total::TEXT IN ('NaN', 'Infinity', '-Infinity')
       OR v_paid::TEXT IN ('NaN', 'Infinity', '-Infinity')
       OR v_balance::TEXT IN ('NaN', 'Infinity', '-Infinity')
       OR v_total < 0 OR v_paid < 0 OR v_balance < 0
       OR v_total <> ROUND(v_total, 2)
       OR v_paid <> ROUND(v_paid, 2)
       OR v_balance <> ROUND(v_balance, 2) THEN
      RAISE EXCEPTION 'Import total, paid, and balance must be finite non-negative paise amounts';
    END IF;
    v_expected_total := 0;
    IF v_membership IS NOT NULL AND JSONB_TYPEOF(v_membership) <> 'null' THEN
      SELECT option.price INTO v_option_price
      FROM public.plan_pricing_options option
      JOIN public.membership_plans plan ON plan.id = option.plan_id
      WHERE option.id = NULLIF(v_membership->>'pricing_option_id', '')::UUID
        AND option.account_id = v_account_id
        AND option.is_active
        AND plan.id = NULLIF(v_membership->>'plan_id', '')::UUID
        AND plan.account_id = v_account_id
        AND plan.is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Active membership billing option not found'; END IF;
      v_fee := NULLIF(v_membership->>'fee_amount', '')::NUMERIC;
      v_historical := COALESCE((v_membership->>'historical_price')::BOOLEAN, FALSE);
      IF NOT v_historical
         AND COALESCE(NULLIF(v_membership->>'discount_amount', '')::NUMERIC, 0) = 0
         AND COALESCE(NULLIF(v_membership->>'list_price', '')::NUMERIC, v_fee) = v_fee
         AND v_fee <> v_option_price THEN
        RAISE EXCEPTION 'Configured membership price changed; review the historical price';
      END IF;
      IF v_fee IS NULL OR v_fee::TEXT IN ('NaN', 'Infinity', '-Infinity')
         OR v_fee < 0 OR v_fee <> ROUND(v_fee, 2) THEN
        RAISE EXCEPTION 'Membership fee must be a finite non-negative paise amount';
      END IF;
      v_expected_total := v_expected_total + v_fee;
      IF v_membership->>'status' = 'cancelled' THEN
        v_cancel_requested := TRUE;
        v_expected_fingerprint := concat_ws('|',
          v_membership->>'plan_id', v_membership->>'pricing_option_id',
          v_membership->>'start_date', v_membership->>'end_date',
          v_membership->>'status',
          to_char(v_fee, 'FM999999999990.00'),
          to_char(COALESCE(NULLIF(v_membership->>'list_price', '')::NUMERIC, 0), 'FM999999999990.00'),
          COALESCE(v_membership->>'discount_type', ''),
          CASE WHEN NULLIF(v_membership->>'discount_value', '') IS NULL THEN ''
            ELSE to_char((v_membership->>'discount_value')::NUMERIC, 'FM999999999990.00') END,
          to_char(COALESCE(NULLIF(v_membership->>'discount_amount', '')::NUMERIC, 0), 'FM999999999990.00'),
          to_char(COALESCE(NULLIF(v_service->>'sold_amount', '')::NUMERIC, 0), 'FM999999999990.00'),
          to_char((v_row->>'total')::NUMERIC, 'FM999999999990.00'),
          to_char(COALESCE(NULLIF(v_row->>'amount_paid', '')::NUMERIC, 0), 'FM999999999990.00'),
          to_char(COALESCE(NULLIF(v_row->>'balance', '')::NUMERIC, 0), 'FM999999999990.00')
        );
        v_debt_decision := v_row->'cancellation_debt'->>'decision';
        v_debt_fingerprint := v_row->'cancellation_debt'->>'fingerprint';
      END IF;
    END IF;
    IF v_service IS NOT NULL AND JSONB_TYPEOF(v_service) <> 'null' THEN
      SELECT CASE WHEN item.requires_trainer THEN rate.price ELSE option.standard_price END
      INTO v_service_price
      FROM public.catalog_items item
      JOIN public.catalog_options option ON option.id = NULLIF(v_service->>'option_id', '')::UUID
        AND option.account_id = v_account_id AND option.item_id = item.id AND option.is_active
      LEFT JOIN public.trainer_rates rate ON item.requires_trainer
        AND rate.account_id = v_account_id
        AND rate.trainer_id = NULLIF(v_service->>'trainer_id', '')::UUID
        AND rate.option_id = option.id AND rate.is_active
      WHERE item.id = NULLIF(v_service->>'item_id', '')::UUID
        AND item.account_id = v_account_id AND item.kind = 'service' AND item.is_active;
      IF NOT FOUND OR v_service_price IS NULL THEN
        RAISE EXCEPTION 'Configured service price is unavailable';
      END IF;
      v_sold := NULLIF(v_service->>'sold_amount', '')::NUMERIC;
      IF NOT COALESCE((v_service->>'explicit_price')::BOOLEAN, FALSE)
         AND v_sold <> v_service_price THEN
        RAISE EXCEPTION 'Configured service price changed; review the historical price';
      END IF;
      IF v_sold IS NULL OR v_sold::TEXT IN ('NaN', 'Infinity', '-Infinity')
         OR v_sold < 0 OR v_sold <> ROUND(v_sold, 2) THEN
        RAISE EXCEPTION 'Service sold price must be a finite non-negative paise amount';
      END IF;
      v_expected_total := v_expected_total + v_sold;
    END IF;
    IF v_total <> v_expected_total THEN
      RAISE EXCEPTION 'Purchase total does not match imported invoice lines';
    END IF;
    IF v_total <> v_paid + v_balance THEN
      RAISE EXCEPTION 'Paid, balance, and purchase total do not reconcile';
    END IF;
    v_index := v_index + 1;
  END LOOP;

  v_result := public.perform_member_import_group_unchecked(v_inner_payload);
  v_membership_id := NULLIF(v_result->>'membership_id', '')::UUID;
  IF v_cancel_requested AND v_membership_id IS NOT NULL THEN
    SELECT COALESCE(line.balance, 0) INTO v_membership_debt
    FROM public.membership_periods period
    JOIN public.invoice_line_balances line ON line.id = period.invoice_line_id
    WHERE period.membership_id = v_membership_id
    ORDER BY period.period_start DESC, period.created_at DESC
    LIMIT 1;
    IF v_membership_debt > 0
       AND (v_debt_decision IS DISTINCT FROM 'write_off'
         OR v_debt_fingerprint IS DISTINCT FROM v_expected_fingerprint) THEN
      RAISE EXCEPTION 'Cancelled membership debt needs an explicit current write-off decision';
    END IF;
    PERFORM public.set_membership_cancellation(v_membership_id, TRUE);
  END IF;
  UPDATE public.member_import_runs run
  SET import_job_id = v_job_id,
      request_payload_hash = v_request_hash
  WHERE run.account_id = v_account_id
    AND run.idempotency_key = v_key
    AND run.import_job_id IS NULL;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.perform_member_import_group_unchecked(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.perform_member_import_group(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_member_import_group(JSONB)
  TO authenticated;
