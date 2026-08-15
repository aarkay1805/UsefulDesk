-- Database-authoritative membership checkout shared by join, lead conversion,
-- trial conversion, and renewal. Browser payloads carry offer/collection intent;
-- configured price, dates, snapshots, credit, and collection are derived here.

CREATE OR REPLACE FUNCTION public.quote_membership_checkout_offer(
  p_account_id UUID,
  p_mode TEXT,
  p_plan_id UUID,
  p_pricing_option_id UUID,
  p_period_start DATE,
  p_discount_type TEXT,
  p_discount_value NUMERIC,
  p_bonus_months INTEGER
)
RETURNS TABLE(
  list_price NUMERIC,
  discount_amount NUMERIC,
  fee_amount NUMERIC,
  standard_period_end DATE,
  period_end DATE,
  bonus_months INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_option public.plan_pricing_options%ROWTYPE;
  v_discount_type TEXT := NULLIF(BTRIM(p_discount_type), '');
  v_discount_value NUMERIC := p_discount_value;
  v_bonus_months INTEGER := COALESCE(p_bonus_months, 0);
BEGIN
  IF p_mode NOT IN ('join', 'convert', 'membership_renewal') THEN
    RAISE EXCEPTION 'Unsupported membership checkout mode';
  END IF;
  IF p_period_start IS NULL THEN
    RAISE EXCEPTION 'Membership start date is required';
  END IF;

  SELECT option.* INTO v_option
  FROM public.plan_pricing_options option
  JOIN public.membership_plans plan
    ON plan.id = option.plan_id
   AND plan.account_id = option.account_id
  WHERE option.id = p_pricing_option_id
    AND option.plan_id = p_plan_id
    AND option.account_id = p_account_id
    AND option.is_active
    AND plan.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership pricing option is unavailable';
  END IF;

  IF v_option.duration_count <= 0
    OR v_option.duration_unit NOT IN ('day', 'week', 'month', 'year')
  THEN
    RAISE EXCEPTION 'Membership pricing option has an invalid duration';
  END IF;

  list_price := ROUND(
    CASE
      WHEN p_mode = 'membership_renewal' THEN v_option.price
      ELSE v_option.price + COALESCE(v_option.setup_fee, 0)
    END,
    2
  );
  IF list_price < 0 THEN
    RAISE EXCEPTION 'Membership pricing option has an invalid price';
  END IF;

  IF v_discount_type IS NULL THEN
    IF COALESCE(v_discount_value, 0) <> 0 THEN
      RAISE EXCEPTION 'Select a discount type for the discount value';
    END IF;
    v_discount_value := NULL;
    discount_amount := 0;
  ELSIF v_discount_type = 'amount' THEN
    IF v_discount_value IS NULL OR v_discount_value <= 0 THEN
      RAISE EXCEPTION 'Discount must be greater than zero';
    END IF;
    IF v_discount_value > list_price THEN
      RAISE EXCEPTION 'Discount cannot exceed the membership price';
    END IF;
    discount_amount := ROUND(v_discount_value, 2);
    v_discount_value := discount_amount;
  ELSIF v_discount_type = 'percentage' THEN
    IF v_discount_value IS NULL OR v_discount_value <= 0 THEN
      RAISE EXCEPTION 'Discount must be greater than zero';
    END IF;
    IF v_discount_value > 100 THEN
      RAISE EXCEPTION 'Percentage discount cannot exceed 100%%';
    END IF;
    discount_amount := ROUND(list_price * v_discount_value / 100, 2);
  ELSE
    RAISE EXCEPTION 'Discount type must be amount or percentage';
  END IF;
  fee_amount := ROUND(list_price - discount_amount, 2);

  standard_period_end := (
    CASE v_option.duration_unit
      WHEN 'day' THEN p_period_start
        + pg_catalog.make_interval(days => v_option.duration_count)
      WHEN 'week' THEN p_period_start
        + pg_catalog.make_interval(days => v_option.duration_count * 7)
      WHEN 'month' THEN p_period_start
        + pg_catalog.make_interval(months => v_option.duration_count)
      WHEN 'year' THEN p_period_start
        + pg_catalog.make_interval(years => v_option.duration_count)
    END
  )::DATE;
  IF standard_period_end <= p_period_start THEN
    RAISE EXCEPTION 'Membership period end must be after its start';
  END IF;

  IF v_bonus_months < 0 OR v_bonus_months > 120 THEN
    RAISE EXCEPTION 'Bonus months must be between zero and 120';
  END IF;
  bonus_months := v_bonus_months;
  period_end := CASE
    WHEN bonus_months > 0 THEN (
      standard_period_end + pg_catalog.make_interval(months => bonus_months)
    )::DATE
    ELSE standard_period_end
  END;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.quote_membership_checkout_offer(
  UUID, TEXT, UUID, UUID, DATE, TEXT, NUMERIC, INTEGER
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_membership_installment_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_timezone TEXT;
  v_remaining NUMERIC(12, 2);
  v_cash_due_before_first NUMERIC(12, 2);
  v_expected_first NUMERIC(12, 2);
BEGIN
  IF NEW.invoice_id IS NULL THEN
    SELECT invoice.id INTO NEW.invoice_id
    FROM public.invoices invoice
    JOIN public.membership_periods period
      ON period.id = invoice.membership_period_id
    WHERE period.membership_id = NEW.membership_id
      AND period.period_end = NEW.period_end;
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = NEW.invoice_id;
  IF NOT FOUND
    OR v_invoice.account_id <> NEW.account_id
    OR v_invoice.membership_id <> NEW.membership_id
    OR v_invoice.contact_id <> NEW.contact_id
    OR NOT public.is_account_member(NEW.account_id, 'agent')
  THEN
    RAISE EXCEPTION 'Invoice not found or access denied';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = NEW.first_payment_id
    AND invoice_id = v_invoice.id
    AND status = 'paid';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The first installment payment was not recorded';
  END IF;

  SELECT balance INTO v_remaining
  FROM public.invoice_balances
  WHERE id = v_invoice.id;
  v_cash_due_before_first := ROUND(v_remaining + v_payment.amount, 2);
  v_expected_first := ROUND(v_cash_due_before_first * 0.60, 2);

  IF NEW.first_amount <> v_expected_first
    OR NEW.second_amount <>
      ROUND(v_cash_due_before_first - v_expected_first, 2)
    OR v_payment.amount <> NEW.first_amount
    OR NEW.split_percent_now <> 60
  THEN
    RAISE EXCEPTION
      'Installment amounts must use the 60/40 post-credit balance split';
  END IF;

  SELECT timezone INTO v_timezone
  FROM public.accounts
  WHERE id = NEW.account_id;
  IF NEW.second_due_on <>
    ((v_payment.paid_at AT TIME ZONE COALESCE(v_timezone, 'Asia/Kolkata'))::DATE + 28)
  THEN
    RAISE EXCEPTION 'The second installment must be due 28 days after payment';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_membership_installment_plan()
  FROM PUBLIC, anon, authenticated;

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
  v_quote RECORD;
  v_membership_id UUID;
  v_member_number INTEGER;
  v_period public.membership_periods%ROWTYPE;
  v_invoice_id UUID;
  v_line_id UUID;
  v_total NUMERIC(12, 2);
  v_credit_applied NUMERIC(12, 2);
  v_cash_due NUMERIC(12, 2);
  v_collect NUMERIC(12, 2) := 0;
  v_later NUMERIC(12, 2) := 0;
  v_payment_id UUID;
  v_result public.invoice_balances%ROWTYPE;
  v_collect_now BOOLEAN := COALESCE((v_collection->>'collect_now')::BOOLEAN, TRUE);
  v_timing TEXT := COALESCE(NULLIF(v_collection->>'timing', ''), 'full');
  v_paid_at TIMESTAMPTZ := COALESCE((v_collection->>'paid_at')::TIMESTAMPTZ, NOW());
BEGIN
  IF v_mode NOT IN ('join', 'convert') THEN
    RAISE EXCEPTION 'Unsupported join mode';
  END IF;
  IF NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Agent access is required';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;

  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  JOIN public.invoices invoice ON invoice.id = balance.id
  WHERE invoice.account_id = v_account_id
    AND invoice.idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'membership_id', v_result.membership_id,
      'member_number', v_result.member_number_snapshot,
      'invoice_id', v_result.id,
      'total', v_result.total,
      'cash_paid', v_result.amount_paid,
      'credit_applied', v_result.credit_applied,
      'balance', v_result.balance
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.contacts
    WHERE id = v_contact_id AND account_id = v_account_id
  ) THEN
    RAISE EXCEPTION 'Member contact not found';
  END IF;

  SELECT * INTO v_quote
  FROM public.quote_membership_checkout_offer(
    v_account_id,
    v_mode,
    NULLIF(v_membership_data->>'plan_id', '')::UUID,
    NULLIF(v_membership_data->>'pricing_option_id', '')::UUID,
    NULLIF(v_membership_data->>'period_start', '')::DATE,
    NULLIF(v_membership_data->>'discount_type', ''),
    NULLIF(v_membership_data->>'discount_value', '')::NUMERIC,
    COALESCE(NULLIF(v_membership_data->>'bonus_months', '')::INTEGER, 0)
  );

  INSERT INTO public.memberships (
    account_id, contact_id, user_id, plan_id, pricing_option_id,
    start_date, end_date, status, fee_amount, fee_status, is_trial, notes,
    conversion_list_price, conversion_discount_type,
    conversion_discount_value, conversion_discount_amount,
    conversion_standard_end_date, conversion_bonus_months
  ) VALUES (
    v_account_id, v_contact_id, (SELECT auth.uid()),
    (v_membership_data->>'plan_id')::UUID,
    (v_membership_data->>'pricing_option_id')::UUID,
    (v_membership_data->>'period_start')::DATE,
    v_quote.period_end,
    'active', v_quote.fee_amount, 'due', FALSE,
    NULLIF(BTRIM(v_membership_data->>'notes'), ''),
    v_quote.list_price,
    NULLIF(v_membership_data->>'discount_type', ''),
    CASE
      WHEN NULLIF(v_membership_data->>'discount_type', '') IS NULL THEN NULL
      ELSE NULLIF(v_membership_data->>'discount_value', '')::NUMERIC
    END,
    v_quote.discount_amount,
    CASE WHEN v_quote.bonus_months > 0 THEN v_quote.standard_period_end END,
    v_quote.bonus_months
  ) RETURNING id, member_number
  INTO v_membership_id, v_member_number;

  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = v_membership_id
  ORDER BY created_at, id
  LIMIT 1;
  v_line_id := v_period.invoice_line_id;
  SELECT invoice_id INTO v_invoice_id
  FROM public.invoice_lines
  WHERE id = v_line_id;
  UPDATE public.invoices
  SET idempotency_key = v_key
  WHERE id = v_invoice_id;

  PERFORM public.append_catalog_selections(
    v_invoice_id,
    v_membership_id,
    v_contact_id,
    COALESCE(p_payload->'selections', '[]'::JSONB)
  );
  PERFORM public.apply_oldest_member_credit(v_invoice_id);

  SELECT total, credit_applied, balance
  INTO v_total, v_credit_applied, v_cash_due
  FROM public.invoice_balances
  WHERE id = v_invoice_id;

  IF v_timing NOT IN ('full', 'installments') THEN
    RAISE EXCEPTION 'Collection timing must be full or installments';
  END IF;
  v_collect := CASE
    WHEN NOT v_collect_now OR v_cash_due <= 0 THEN 0
    WHEN v_timing = 'installments' THEN ROUND(v_cash_due * 0.60, 2)
    ELSE v_cash_due
  END;
  v_later := ROUND(v_cash_due - v_collect, 2);
  IF v_collect_now AND v_cash_due > 0 AND v_timing = 'installments'
    AND (v_collect <= 0 OR v_later <= 0)
  THEN
    RAISE EXCEPTION 'Cash due cannot be split into two positive installments';
  END IF;

  IF v_collect > 0 THEN
    PERFORM set_config('app.payment_purpose', 'joining', TRUE);
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id, invoice_id,
      amount, method, status, paid_at, period_start, period_end,
      idempotency_key
    ) VALUES (
      v_account_id, v_membership_id, v_contact_id,
      (v_membership_data->>'plan_id')::UUID, (SELECT auth.uid()), v_invoice_id,
      v_collect, COALESCE(NULLIF(v_collection->>'method', ''), 'cash'),
      'paid', v_paid_at, v_period.period_start, v_period.period_end, v_key
    ) RETURNING id INTO v_payment_id;
    PERFORM set_config('app.payment_purpose', '', TRUE);
  END IF;

  IF v_collect_now AND v_cash_due > 0 AND v_timing = 'installments' THEN
    INSERT INTO public.membership_installment_plans (
      account_id, membership_id, contact_id, period_end, invoice_id,
      first_payment_id, first_amount, second_amount, second_due_on,
      split_percent_now, created_by
    ) VALUES (
      v_account_id, v_membership_id, v_contact_id, v_period.period_end,
      v_invoice_id, v_payment_id, v_collect, v_later,
      (v_paid_at AT TIME ZONE COALESCE((
        SELECT timezone FROM public.accounts WHERE id = v_account_id
      ), 'Asia/Kolkata'))::DATE + 28,
      60, (SELECT auth.uid())
    );
  END IF;

  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  WHERE id = v_invoice_id;
  RETURN jsonb_build_object(
    'membership_id', v_membership_id,
    'member_number', v_member_number,
    'invoice_id', v_invoice_id,
    'total', v_result.total,
    'cash_paid', v_result.amount_paid,
    'credit_applied', v_result.credit_applied,
    'balance', v_result.balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.perform_join_checkout(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_join_checkout(JSONB)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.perform_member_checkout(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mode TEXT := p_payload->>'mode';
  v_account_id UUID := (p_payload->>'account_id')::UUID;
  v_contact_id UUID := (p_payload->>'contact_id')::UUID;
  v_membership_id UUID := NULLIF(p_payload->>'membership_id', '')::UUID;
  v_key UUID := (p_payload->>'idempotency_key')::UUID;
  v_membership_data JSONB := COALESCE(p_payload->'membership', '{}'::JSONB);
  v_collection JSONB := COALESCE(p_payload->'collection', '{}'::JSONB);
  v_membership public.memberships%ROWTYPE;
  v_quote RECORD;
  v_invoice_id UUID;
  v_period_id UUID;
  v_line_id UUID;
  v_existing public.invoice_balances%ROWTYPE;
  v_result public.invoice_balances%ROWTYPE;
  v_collect NUMERIC(12, 2) := 0;
  v_cash_due NUMERIC(12, 2) := 0;
  v_later NUMERIC(12, 2) := 0;
  v_payment_id UUID;
  v_purpose TEXT;
  v_name TEXT;
  v_member_number INTEGER;
  v_currency TEXT;
  v_period_start DATE;
  v_today DATE;
  v_timing TEXT := COALESCE(NULLIF(v_collection->>'timing', ''), 'full');
  v_collect_now BOOLEAN := COALESCE((v_collection->>'collect_now')::BOOLEAN, TRUE);
  v_paid_at TIMESTAMPTZ := COALESCE((v_collection->>'paid_at')::TIMESTAMPTZ, NOW());
BEGIN
  IF v_mode NOT IN ('join', 'convert', 'membership_renewal', 'sale', 'service_renewal') THEN
    RAISE EXCEPTION 'Unsupported checkout mode';
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

  IF NOT EXISTS (
    SELECT 1 FROM public.contacts
    WHERE id = v_contact_id AND account_id = v_account_id
  ) THEN
    RAISE EXCEPTION 'Member contact not found';
  END IF;

  IF v_mode = 'join' THEN
    IF v_membership_id IS NOT NULL THEN
      RAISE EXCEPTION 'Join creates a new membership';
    END IF;
    RETURN public.perform_join_checkout(p_payload);
  ELSIF v_mode IN ('convert', 'membership_renewal') THEN
    IF v_membership_id IS NULL THEN
      RAISE EXCEPTION 'Membership is required';
    END IF;

    SELECT membership.* INTO v_membership
    FROM public.memberships membership
    WHERE membership.id = v_membership_id
      AND membership.account_id = v_account_id
      AND membership.contact_id = v_contact_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membership not found';
    END IF;

    SELECT (NOW() AT TIME ZONE COALESCE(account.timezone, 'Asia/Kolkata'))::DATE
    INTO v_today
    FROM public.accounts account
    WHERE account.id = v_account_id;
    v_period_start := CASE
      WHEN v_mode = 'convert' THEN v_today
      ELSE GREATEST(v_membership.end_date, v_today)
    END;

    SELECT * INTO v_quote
    FROM public.quote_membership_checkout_offer(
      v_account_id,
      v_mode,
      NULLIF(v_membership_data->>'plan_id', '')::UUID,
      NULLIF(v_membership_data->>'pricing_option_id', '')::UUID,
      v_period_start,
      NULLIF(v_membership_data->>'discount_type', ''),
      NULLIF(v_membership_data->>'discount_value', '')::NUMERIC,
      COALESCE(NULLIF(v_membership_data->>'bonus_months', '')::INTEGER, 0)
    );

    PERFORM public.renew_membership_transaction(
      v_membership_id,
      (v_membership_data->>'plan_id')::UUID,
      v_period_start,
      v_quote.period_end,
      v_quote.fee_amount,
      0,
      'cash',
      v_mode = 'convert',
      v_key,
      (v_membership_data->>'pricing_option_id')::UUID
    );

    SELECT period.id, period.invoice_line_id
    INTO v_period_id, v_line_id
    FROM public.membership_periods period
    WHERE period.membership_id = v_membership_id
      AND period.period_end = v_quote.period_end
    ORDER BY period.created_at DESC, period.id DESC
    LIMIT 1;
    IF v_period_id IS NULL OR v_line_id IS NULL THEN
      RAISE EXCEPTION 'Membership period invoice was not created';
    END IF;

    UPDATE public.membership_periods
    SET list_price = v_quote.list_price,
        discount_type = NULLIF(v_membership_data->>'discount_type', ''),
        discount_value = CASE
          WHEN NULLIF(v_membership_data->>'discount_type', '') IS NULL THEN NULL
          ELSE NULLIF(v_membership_data->>'discount_value', '')::NUMERIC
        END,
        discount_amount = v_quote.discount_amount,
        standard_period_end = CASE
          WHEN v_quote.bonus_months > 0 THEN v_quote.standard_period_end
          ELSE NULL
        END,
        bonus_months = v_quote.bonus_months
    WHERE id = v_period_id;

    UPDATE public.invoice_lines
    SET list_amount = v_quote.list_price,
        unit_amount = v_quote.fee_amount,
        line_amount = v_quote.fee_amount,
        service_start = v_period_start,
        service_end = v_quote.period_end,
        updated_at = NOW()
    WHERE id = v_line_id;

    IF v_mode = 'convert' THEN
      UPDATE public.memberships
      SET conversion_list_price = v_quote.list_price,
          conversion_discount_type = NULLIF(v_membership_data->>'discount_type', ''),
          conversion_discount_value = CASE
            WHEN NULLIF(v_membership_data->>'discount_type', '') IS NULL THEN NULL
            ELSE NULLIF(v_membership_data->>'discount_value', '')::NUMERIC
          END,
          conversion_discount_amount = v_quote.discount_amount,
          conversion_standard_end_date = CASE
            WHEN v_quote.bonus_months > 0 THEN v_quote.standard_period_end
            ELSE NULL
          END,
          conversion_bonus_months = v_quote.bonus_months
      WHERE id = v_membership_id;
    END IF;

    SELECT invoice_id INTO v_invoice_id
    FROM public.invoice_lines
    WHERE id = v_line_id;
    SELECT member_number INTO v_member_number
    FROM public.memberships
    WHERE id = v_membership_id;
  ELSE
    SELECT membership.member_number, contact.name, account.default_currency
    INTO v_member_number, v_name, v_currency
    FROM public.memberships membership
    JOIN public.contacts contact ON contact.id = membership.contact_id
    JOIN public.accounts account ON account.id = membership.account_id
    WHERE membership.id = v_membership_id
      AND membership.account_id = v_account_id
      AND membership.contact_id = v_contact_id
    FOR UPDATE OF membership;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membership not found';
    END IF;

    INSERT INTO public.invoices (
      account_id, contact_id, membership_id, source, issued_at,
      customer_name_snapshot, member_number_snapshot, currency,
      created_by, idempotency_key
    ) VALUES (
      v_account_id, v_contact_id, v_membership_id,
      CASE
        WHEN v_mode = 'service_renewal' THEN 'service_renewal'
        ELSE 'sale'
      END,
      COALESCE((p_payload->>'issued_at')::TIMESTAMPTZ, NOW()),
      v_name, v_member_number, v_currency, (SELECT auth.uid()), v_key
    ) RETURNING id INTO v_invoice_id;
  END IF;

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Checkout invoice was not created';
  END IF;
  UPDATE public.invoices
  SET idempotency_key = v_key
  WHERE id = v_invoice_id;

  PERFORM public.append_catalog_selections(
    v_invoice_id,
    v_membership_id,
    v_contact_id,
    COALESCE(p_payload->'selections', '[]'::JSONB)
  );
  IF v_mode IN ('sale', 'service_renewal') AND NOT EXISTS (
    SELECT 1 FROM public.invoice_lines WHERE invoice_id = v_invoice_id
  ) THEN
    RAISE EXCEPTION 'Select at least one product or service';
  END IF;

  PERFORM public.apply_oldest_member_credit(v_invoice_id);
  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  WHERE id = v_invoice_id;

  IF v_mode IN ('convert', 'membership_renewal') THEN
    IF v_timing NOT IN ('full', 'installments') THEN
      RAISE EXCEPTION 'Collection timing must be full or installments';
    END IF;
    v_cash_due := v_result.balance;
    v_collect := CASE
      WHEN NOT v_collect_now OR v_cash_due <= 0 THEN 0
      WHEN v_timing = 'installments' THEN ROUND(v_cash_due * 0.60, 2)
      ELSE v_cash_due
    END;
    v_later := ROUND(v_cash_due - v_collect, 2);
    IF v_collect_now AND v_cash_due > 0 AND v_timing = 'installments'
      AND (v_collect <= 0 OR v_later <= 0)
    THEN
      RAISE EXCEPTION 'Cash due cannot be split into two positive installments';
    END IF;
  ELSE
    v_collect := COALESCE((v_collection->>'amount')::NUMERIC, 0);
    IF v_collect < 0 OR v_collect > v_result.balance THEN
      RAISE EXCEPTION 'Collected amount must be between zero and the invoice balance';
    END IF;
  END IF;

  IF v_collect > 0 THEN
    v_purpose := CASE v_mode
      WHEN 'join' THEN 'joining'
      WHEN 'convert' THEN 'joining'
      WHEN 'membership_renewal' THEN 'renewal'
      ELSE 'sale'
    END;
    PERFORM set_config('app.payment_purpose', v_purpose, TRUE);
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id,
      invoice_id, amount, method, status, paid_at, period_start,
      period_end, receipt_bucket, screenshot_path, note, idempotency_key
    ) VALUES (
      v_account_id, v_membership_id, v_contact_id,
      NULLIF(v_membership_data->>'plan_id', '')::UUID, (SELECT auth.uid()),
      v_invoice_id, v_collect,
      COALESCE(NULLIF(v_collection->>'method', ''), 'cash'),
      'paid', v_paid_at,
      CASE WHEN v_mode IN ('convert', 'membership_renewal') THEN v_period_start END,
      CASE WHEN v_mode IN ('convert', 'membership_renewal') THEN v_quote.period_end END,
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

  IF v_mode IN ('convert', 'membership_renewal')
    AND v_collect_now AND v_cash_due > 0 AND v_timing = 'installments'
  THEN
    INSERT INTO public.membership_installment_plans (
      account_id, membership_id, contact_id, period_end, invoice_id,
      first_payment_id, first_amount, second_amount, second_due_on,
      split_percent_now, created_by
    ) VALUES (
      v_account_id, v_membership_id, v_contact_id, v_quote.period_end,
      v_invoice_id, v_payment_id, v_collect, v_later,
      (v_paid_at AT TIME ZONE COALESCE((
        SELECT timezone FROM public.accounts WHERE id = v_account_id
      ), 'Asia/Kolkata'))::DATE + 28,
      60, (SELECT auth.uid())
    );
  END IF;

  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  WHERE id = v_invoice_id;
  RETURN jsonb_build_object(
    'membership_id', v_membership_id,
    'member_number', COALESCE(v_member_number, v_result.member_number_snapshot),
    'invoice_id', v_result.id,
    'total', v_result.total,
    'cash_paid', v_result.amount_paid,
    'credit_applied', v_result.credit_applied,
    'balance', v_result.balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.perform_member_checkout(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_member_checkout(JSONB)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.renew_membership_transaction(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, TEXT, BOOLEAN, UUID, UUID
) FROM PUBLIC, anon, authenticated;
