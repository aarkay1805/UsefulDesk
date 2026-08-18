-- ============================================================
-- Imported discounts, service list prices, and the member's trainer
--
-- Gym exports almost always carry a list price beside the charged price
-- ("ACTUAL AMT" / "DISCOUNTED AMT"). Import previously kept only the charged
-- amount, so every migrated member lost the discount that explains it.
--
-- The columns already exist. `memberships.conversion_*` is copied onto the
-- initial `membership_periods` row by `create_initial_membership_period`,
-- and `ensure_membership_period_invoice` derives the membership line's
-- `list_amount` from `membership_periods.list_price` — so writing the four
-- conversion columns here lights up the existing invoice rendering with no
-- new UI. Service lines carry their own `list_amount` directly.
--
-- Money stays database-authoritative: the imported discount must reconcile
-- with the charged fee, and the existing CHECK constraints still apply.
--
-- `contacts.trainer_id` is the member's trainer as a GYM identity, not a
-- platform user. `contacts.assigned_to` is FK -> auth.users and therefore
-- always needs a login seat, which is why it could never hold the trainer
-- names a real gym export carries; `trainers.linked_user_id` stays optional
-- so an independent trainer needs no account. The two columns keep their
-- separate jobs: assigned_to owns notifications and follow-up ownership,
-- trainer_id owns "who trains this member".
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS trainer_id UUID;

-- Composite reference, matching trainer_rates: a branch's contact can never
-- point at another branch's trainer. Only trainer_id is cleared on delete
-- because account_id is NOT NULL; the trainer's own history is unaffected.
ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_trainer_account_fk;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_trainer_account_fk
    FOREIGN KEY (account_id, trainer_id)
    REFERENCES public.trainers(account_id, id)
    ON DELETE SET NULL (trainer_id);

CREATE INDEX IF NOT EXISTS idx_contacts_trainer
  ON public.contacts(trainer_id)
  WHERE trainer_id IS NOT NULL;

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
  v_list_price NUMERIC(12, 2);
  v_discount_type TEXT;
  v_discount_value NUMERIC(12, 2);
  v_discount_amount NUMERIC(12, 2);
  v_fee_amount NUMERIC(12, 2);
  v_service_list NUMERIC(12, 2);
  v_service_sold NUMERIC(12, 2);
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
      city, state, postal_code, country, assigned_to, received_via, churn_risk,
      trainer_id
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
      'import', COALESCE((v_contact_data->>'churn_risk')::BOOLEAN, FALSE),
      NULLIF(v_contact_data->>'trainer_id', '')::UUID
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
        -- A trainer is gym staffing, not lead ownership, so automated-origin
        -- ownership locking deliberately does not apply to it.
        trainer_id = CASE WHEN v_contact_data ? 'trainer_id'
          THEN NULLIF(v_contact_data->>'trainer_id', '')::UUID
          ELSE contact.trainer_id END,
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
    v_fee_amount := (v_membership_data->>'fee_amount')::NUMERIC;
    IF v_fee_amount < 0 THEN
      RAISE EXCEPTION 'Membership fee cannot be negative';
    END IF;

    -- Imported discount. The browser proposes it; this boundary re-derives
    -- and re-validates it so a tampered payload cannot invent revenue.
    v_discount_type := NULLIF(BTRIM(v_membership_data->>'discount_type'), '');
    v_discount_amount := COALESCE(
      NULLIF(v_membership_data->>'discount_amount', '')::NUMERIC, 0
    );
    v_discount_value := NULLIF(v_membership_data->>'discount_value', '')::NUMERIC;
    v_list_price := NULLIF(v_membership_data->>'list_price', '')::NUMERIC;
    IF v_discount_type IS NULL OR v_discount_amount = 0 THEN
      v_discount_type := NULL;
      v_discount_value := NULL;
      v_discount_amount := 0;
      v_list_price := NULLIF(v_list_price, v_fee_amount);
    ELSE
      IF v_discount_type NOT IN ('amount', 'percentage') THEN
        RAISE EXCEPTION 'Unsupported imported discount type';
      END IF;
      IF v_list_price IS NULL THEN
        RAISE EXCEPTION 'An imported discount requires a list price';
      END IF;
      IF v_discount_amount < 0 OR v_discount_amount > v_list_price THEN
        RAISE EXCEPTION 'Imported discount cannot exceed the list price';
      END IF;
      IF ROUND(v_list_price - v_discount_amount, 2) <> ROUND(v_fee_amount, 2) THEN
        RAISE EXCEPTION 'Imported list price, discount, and fee do not reconcile';
      END IF;
      IF v_discount_type = 'amount' THEN
        v_discount_value := v_discount_amount;
      ELSIF v_discount_value IS NULL
         OR v_discount_value <= 0
         OR v_discount_value > 100
         OR ROUND(v_list_price * v_discount_value / 100, 2)
            <> ROUND(v_discount_amount, 2) THEN
        RAISE EXCEPTION 'Imported percentage discount does not reconcile';
      END IF;
    END IF;

    v_membership_cancel_after_payment :=
      v_membership_data->>'status' = 'cancelled';
    INSERT INTO public.memberships (
      account_id, contact_id, user_id, plan_id, pricing_option_id,
      start_date, end_date, status, frozen_at, fee_amount, fee_status,
      is_trial, notes, conversion_list_price, conversion_discount_type,
      conversion_discount_value, conversion_discount_amount
    ) VALUES (
      v_account_id, v_contact_id, v_actor, membership_plan.id,
      membership_option.id, (v_membership_data->>'start_date')::DATE,
      (v_membership_data->>'end_date')::DATE,
      CASE WHEN v_membership_cancel_after_payment THEN 'active'
        ELSE COALESCE(NULLIF(v_membership_data->>'status', ''), 'active')::public.membership_status_enum END,
      NULLIF(v_membership_data->>'frozen_at', '')::DATE,
      v_fee_amount, 'due', FALSE,
      NULLIF(BTRIM(v_membership_data->>'notes'), ''),
      v_list_price, v_discount_type, v_discount_value, v_discount_amount
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
      v_service_sold := (v_service_data->>'sold_amount')::NUMERIC;
      IF v_service_sold < 0 THEN
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

      -- An imported service list price is the historical pre-discount price;
      -- it must never be below what was actually charged.
      v_service_list := NULLIF(v_service_data->>'list_amount', '')::NUMERIC;
      IF v_service_list IS NOT NULL AND v_service_list < v_service_sold THEN
        RAISE EXCEPTION 'Service list price is below the price charged';
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
        catalog_item.name, 1, v_service_sold, v_service_sold,
        (v_service_data->>'start_date')::DATE,
        (v_service_data->>'end_date')::DATE,
        COALESCE(v_service_list, v_configured_price, v_service_sold),
        CASE WHEN COALESCE((v_service_data->>'explicit_price')::BOOLEAN, FALSE)
          THEN v_service_sold END,
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
        v_service_sold,
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
