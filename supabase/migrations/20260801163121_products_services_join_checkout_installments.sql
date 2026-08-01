-- Correct RPC-only write execution, add atomic join/lead-conversion checkout,
-- and attach the established 60/40 promise to the full generic invoice.

ALTER FUNCTION public.perform_member_checkout(JSONB) SECURITY DEFINER;
ALTER FUNCTION public.record_invoice_payment(UUID, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID)
  SECURITY DEFINER;
ALTER FUNCTION public.cancel_member_service(UUID, TEXT) SECURITY DEFINER;
ALTER FUNCTION public.void_invoice_line(UUID, TEXT) SECURITY DEFINER;
ALTER FUNCTION public.void_invoice_payment(UUID, TEXT) SECURITY DEFINER;
ALTER FUNCTION public.reassign_member_service_trainer(UUID, UUID, DATE, TEXT, UUID)
  SECURITY DEFINER;

ALTER TABLE public.membership_installment_plans
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id) ON DELETE RESTRICT;
UPDATE public.membership_installment_plans installment
SET invoice_id = invoice.id
FROM public.invoices invoice
JOIN public.membership_periods period ON period.id = invoice.membership_period_id
WHERE period.membership_id = installment.membership_id
  AND period.period_end = installment.period_end
  AND installment.invoice_id IS NULL;
ALTER TABLE public.membership_installment_plans
  ALTER COLUMN period_end DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_installment_invoice
  ON public.membership_installment_plans(invoice_id) WHERE invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_membership_installment_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_total NUMERIC(12, 2);
  v_payment public.payments%ROWTYPE;
  v_timezone TEXT;
  v_expected_first NUMERIC(12, 2);
BEGIN
  IF NEW.invoice_id IS NULL THEN
    SELECT invoice.id INTO NEW.invoice_id
    FROM public.invoices invoice
    JOIN public.membership_periods period ON period.id = invoice.membership_period_id
    WHERE period.membership_id = NEW.membership_id
      AND period.period_end = NEW.period_end;
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND
    OR v_invoice.account_id <> NEW.account_id
    OR v_invoice.membership_id <> NEW.membership_id
    OR v_invoice.contact_id <> NEW.contact_id
    OR NOT public.is_account_member(NEW.account_id, 'agent')
  THEN RAISE EXCEPTION 'Invoice not found or access denied'; END IF;

  SELECT total INTO v_total FROM public.invoice_balances WHERE id = v_invoice.id;
  SELECT * INTO v_payment FROM public.payments
  WHERE id = NEW.first_payment_id AND invoice_id = v_invoice.id AND status = 'paid';
  IF NOT FOUND THEN RAISE EXCEPTION 'The first installment payment was not recorded'; END IF;

  v_expected_first := ROUND(v_total * 0.60, 2);
  IF NEW.first_amount <> v_expected_first
    OR NEW.second_amount <> ROUND(v_total - v_expected_first, 2)
    OR v_payment.amount <> NEW.first_amount
    OR NEW.split_percent_now <> 60
  THEN RAISE EXCEPTION 'Installment amounts must use the 60/40 invoice split'; END IF;

  SELECT timezone INTO v_timezone FROM public.accounts WHERE id = NEW.account_id;
  IF NEW.second_due_on <>
    ((v_payment.paid_at AT TIME ZONE COALESCE(v_timezone, 'Asia/Kolkata'))::DATE + 28)
  THEN RAISE EXCEPTION 'The second installment must be due 28 days after payment'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.perform_join_checkout(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mode TEXT := p_payload->>'mode';
  v_account_id UUID := (p_payload->>'account_id')::UUID;
  v_contact_id UUID := (p_payload->>'contact_id')::UUID;
  v_key UUID := (p_payload->>'idempotency_key')::UUID;
  v_membership_data JSONB := COALESCE(p_payload->'membership', '{}'::JSONB);
  v_collection JSONB := COALESCE(p_payload->'collection', '{}'::JSONB);
  v_membership_id UUID;
  v_member_number INTEGER;
  v_period public.membership_periods%ROWTYPE;
  v_invoice_id UUID;
  v_line_id UUID;
  v_total NUMERIC(12, 2);
  v_collect NUMERIC(12, 2);
  v_payment_id UUID;
  v_result public.invoice_balances%ROWTYPE;
  v_is_installment BOOLEAN := COALESCE((v_collection->>'installment')::BOOLEAN, FALSE);
  v_paid_at TIMESTAMPTZ := COALESCE((v_collection->>'paid_at')::TIMESTAMPTZ, NOW());
BEGIN
  IF v_mode NOT IN ('join', 'convert') THEN RAISE EXCEPTION 'Unsupported join mode'; END IF;
  IF NOT public.is_account_member(v_account_id, 'agent') THEN RAISE EXCEPTION 'Agent access is required'; END IF;

  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  JOIN public.invoices invoice ON invoice.id = balance.id
  WHERE invoice.account_id = v_account_id AND invoice.idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'membership_id', v_result.membership_id,
      'member_number', v_result.member_number_snapshot,
      'invoice_id', v_result.id, 'total', v_result.total,
      'cash_paid', v_result.amount_paid, 'credit_applied', v_result.credit_applied,
      'balance', v_result.balance
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = v_contact_id AND account_id = v_account_id) THEN
    RAISE EXCEPTION 'Member contact not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.membership_plans
    WHERE id = (v_membership_data->>'plan_id')::UUID AND account_id = v_account_id
  ) THEN RAISE EXCEPTION 'Membership plan not found'; END IF;
  IF NULLIF(v_membership_data->>'pricing_option_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.plan_pricing_options
    WHERE id = (v_membership_data->>'pricing_option_id')::UUID
      AND plan_id = (v_membership_data->>'plan_id')::UUID
      AND account_id = v_account_id AND is_active
  ) THEN RAISE EXCEPTION 'Membership pricing option not found'; END IF;

  INSERT INTO public.memberships (
    account_id, contact_id, user_id, plan_id, pricing_option_id,
    start_date, end_date, status, fee_amount, fee_status, is_trial, notes,
    conversion_list_price, conversion_discount_type, conversion_discount_value,
    conversion_discount_amount, conversion_standard_end_date, conversion_bonus_months
  ) VALUES (
    v_account_id, v_contact_id, (SELECT auth.uid()),
    (v_membership_data->>'plan_id')::UUID,
    NULLIF(v_membership_data->>'pricing_option_id', '')::UUID,
    (v_membership_data->>'period_start')::DATE,
    (v_membership_data->>'period_end')::DATE,
    'active', (v_membership_data->>'fee_amount')::NUMERIC, 'due', FALSE,
    NULLIF(BTRIM(v_membership_data->>'notes'), ''),
    NULLIF(v_membership_data->>'list_price', '')::NUMERIC,
    NULLIF(v_membership_data->>'discount_type', ''),
    NULLIF(v_membership_data->>'discount_value', '')::NUMERIC,
    COALESCE(NULLIF(v_membership_data->>'discount_amount', '')::NUMERIC, 0),
    NULLIF(v_membership_data->>'standard_period_end', '')::DATE,
    COALESCE(NULLIF(v_membership_data->>'bonus_months', '')::INTEGER, 0)
  ) RETURNING id, member_number INTO v_membership_id, v_member_number;

  SELECT * INTO v_period FROM public.membership_periods
  WHERE membership_id = v_membership_id ORDER BY created_at, id LIMIT 1;
  v_line_id := v_period.invoice_line_id;
  SELECT invoice_id INTO v_invoice_id FROM public.invoice_lines WHERE id = v_line_id;
  UPDATE public.invoices SET idempotency_key = v_key WHERE id = v_invoice_id;

  PERFORM public.append_catalog_selections(
    v_invoice_id, v_membership_id, v_contact_id,
    COALESCE(p_payload->'selections', '[]'::JSONB)
  );
  PERFORM public.apply_oldest_member_credit(v_invoice_id);
  SELECT total, balance INTO v_total, v_collect FROM public.invoice_balances WHERE id = v_invoice_id;

  v_collect := COALESCE((v_collection->>'amount')::NUMERIC, 0);
  IF v_is_installment THEN
    IF v_total <= 0 THEN RAISE EXCEPTION 'A zero invoice cannot use installments'; END IF;
    IF v_collect <> ROUND(v_total * 0.60, 2) THEN
      RAISE EXCEPTION 'The first installment must be 60%% of the combined invoice';
    END IF;
  END IF;
  IF v_collect < 0 OR v_collect > (SELECT balance FROM public.invoice_balances WHERE id = v_invoice_id) THEN
    RAISE EXCEPTION 'Collected amount must be between zero and the invoice balance';
  END IF;
  IF v_mode = 'convert' AND v_collect <= 0 THEN
    RAISE EXCEPTION 'Lead conversion requires a positive initial collection';
  END IF;

  IF v_collect > 0 THEN
    PERFORM set_config('app.payment_purpose', 'joining', TRUE);
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id, invoice_id,
      amount, method, status, paid_at, period_start, period_end, idempotency_key
    ) VALUES (
      v_account_id, v_membership_id, v_contact_id,
      (v_membership_data->>'plan_id')::UUID, (SELECT auth.uid()), v_invoice_id,
      v_collect, COALESCE(NULLIF(v_collection->>'method', ''), 'cash'), 'paid',
      v_paid_at, v_period.period_start, v_period.period_end, v_key
    ) RETURNING id INTO v_payment_id;
    PERFORM set_config('app.payment_purpose', '', TRUE);
  END IF;

  IF v_is_installment THEN
    INSERT INTO public.membership_installment_plans (
      account_id, membership_id, contact_id, period_end, invoice_id,
      first_payment_id, first_amount, second_amount, second_due_on,
      split_percent_now, created_by
    ) VALUES (
      v_account_id, v_membership_id, v_contact_id, v_period.period_end,
      v_invoice_id, v_payment_id, v_collect, ROUND(v_total - v_collect, 2),
      (v_paid_at AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id = v_account_id))::DATE + 28,
      60, (SELECT auth.uid())
    );
  END IF;

  SELECT balance.* INTO v_result FROM public.invoice_balances balance WHERE id = v_invoice_id;
  RETURN jsonb_build_object(
    'membership_id', v_membership_id, 'member_number', v_member_number,
    'invoice_id', v_invoice_id, 'total', v_result.total,
    'cash_paid', v_result.amount_paid, 'credit_applied', v_result.credit_applied,
    'balance', v_result.balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.perform_join_checkout(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_join_checkout(JSONB) TO authenticated;
