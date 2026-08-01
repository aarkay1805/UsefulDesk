-- Transactional checkout, generic payment allocation, credits, and service
-- lifecycle operations. All money decisions are enforced in Postgres so a
-- browser retry or concurrent collection cannot create an overpayment.

-- ---------------------------------------------------------------------------
-- Catalogue invariants
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_catalog_option()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_item public.catalog_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item
  FROM public.catalog_items
  WHERE id = NEW.item_id AND account_id = NEW.account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalogue item not found';
  END IF;

  IF v_item.kind = 'merchandise' THEN
    IF NEW.duration_count IS NOT NULL OR NEW.duration_unit IS NOT NULL THEN
      RAISE EXCEPTION 'Merchandise cannot have a duration';
    END IF;
    IF NEW.standard_price IS NULL THEN
      RAISE EXCEPTION 'Merchandise requires a unit price';
    END IF;
  ELSE
    IF NEW.duration_count IS NULL OR NEW.duration_unit IS NULL THEN
      RAISE EXCEPTION 'A service option requires a duration';
    END IF;
    IF v_item.requires_trainer AND NEW.standard_price IS NOT NULL THEN
      RAISE EXCEPTION 'Trainer-priced services cannot have a fallback price';
    END IF;
    IF NOT v_item.requires_trainer AND NEW.standard_price IS NULL THEN
      RAISE EXCEPTION 'A fixed-price service requires a price';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_catalog_option ON public.catalog_options;
CREATE TRIGGER trg_validate_catalog_option
  BEFORE INSERT OR UPDATE ON public.catalog_options
  FOR EACH ROW EXECUTE FUNCTION public.validate_catalog_option();

CREATE OR REPLACE FUNCTION public.validate_trainer_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.catalog_options option
    JOIN public.catalog_items item ON item.id = option.item_id
    WHERE option.id = NEW.option_id
      AND option.account_id = NEW.account_id
      AND item.kind = 'service'
      AND item.requires_trainer
  ) THEN
    RAISE EXCEPTION 'Trainer rates are only valid for trainer-priced services';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_trainer_rate ON public.trainer_rates;
CREATE TRIGGER trg_validate_trainer_rate
  BEFORE INSERT OR UPDATE ON public.trainer_rates
  FOR EACH ROW EXECUTE FUNCTION public.validate_trainer_rate();

REVOKE ALL ON FUNCTION public.validate_catalog_option()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_trainer_rate()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Payment purpose and immutable invoice identity
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_payment_purpose_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_purpose_check
  CHECK (payment_purpose IN ('joining', 'renewal', 'sale', 'due', 'other'));

CREATE OR REPLACE FUNCTION public.classify_membership_payment_purpose()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_context TEXT := NULLIF(current_setting('app.payment_purpose', TRUE), '');
  v_source TEXT;
  v_has_earlier_period BOOLEAN := FALSE;
BEGIN
  IF v_context IN ('joining', 'renewal', 'sale', 'due', 'other') THEN
    NEW.payment_purpose := v_context;
    RETURN NEW;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    SELECT source INTO v_source FROM public.invoices WHERE id = NEW.invoice_id;
    NEW.payment_purpose := CASE v_source
      WHEN 'joining' THEN 'joining'
      WHEN 'membership_renewal' THEN 'renewal'
      WHEN 'sale' THEN 'sale'
      WHEN 'service_renewal' THEN 'sale'
      ELSE 'due'
    END;
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.membership_periods current_period
    JOIN public.membership_periods earlier
      ON earlier.membership_id = current_period.membership_id
     AND (earlier.created_at < current_period.created_at
       OR (earlier.created_at = current_period.created_at AND earlier.id < current_period.id))
    WHERE current_period.membership_id = NEW.membership_id
      AND current_period.period_end = NEW.period_end
  ) INTO v_has_earlier_period;

  IF COALESCE(NEW.source, 'manual') = 'auto' THEN
    NEW.payment_purpose := CASE WHEN v_has_earlier_period THEN 'renewal' ELSE 'due' END;
  ELSIF NOT v_has_earlier_period AND NOT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.membership_id = NEW.membership_id AND p.status IN ('paid', 'void')
  ) THEN
    NEW.payment_purpose := 'joining';
  ELSE
    NEW.payment_purpose := 'due';
  END IF;
  RETURN NEW;
END;
$$;

-- Generic invoices are immutable snapshots. Membership fields remain for
-- historical compatibility and are stamped from the invoice/period.
CREATE OR REPLACE FUNCTION public.validate_membership_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
  v_membership public.memberships%ROWTYPE;
  v_balance NUMERIC(12, 2);
  v_system BOOLEAN := COALESCE(current_setting('app.system_payment', TRUE), '') = '1';
BEGIN
  IF NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'New ledger rows must be paid payments';
  END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF NEW.invoice_id IS NULL THEN
    IF NEW.membership_id IS NULL THEN
      RAISE EXCEPTION 'An invoice or membership is required';
    END IF;
    SELECT * INTO v_membership
    FROM public.memberships WHERE id = NEW.membership_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
    NEW.period_end := COALESCE(NEW.period_end, v_membership.end_date);
    SELECT * INTO v_period
    FROM public.membership_periods
    WHERE membership_id = v_membership.id AND period_end = NEW.period_end
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing period not found'; END IF;
    SELECT i.* INTO v_invoice
    FROM public.invoices i
    JOIN public.invoice_lines il ON il.invoice_id = i.id
    WHERE il.id = v_period.invoice_line_id
    FOR UPDATE OF i;
    NEW.invoice_id := v_invoice.id;
  ELSE
    SELECT * INTO v_invoice
    FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF v_invoice.membership_period_id IS NOT NULL THEN
      SELECT * INTO v_period FROM public.membership_periods
      WHERE id = v_invoice.membership_period_id;
    END IF;
    IF v_invoice.membership_id IS NOT NULL THEN
      SELECT * INTO v_membership FROM public.memberships
      WHERE id = v_invoice.membership_id;
    END IF;
  END IF;

  IF NOT v_system AND NOT public.is_account_member(v_invoice.account_id, 'agent') THEN
    RAISE EXCEPTION 'Insufficient access to record this payment';
  END IF;
  IF v_invoice.state <> 'open' THEN
    RAISE EXCEPTION 'Payments cannot be recorded against a void invoice';
  END IF;

  SELECT GREATEST(
    COALESCE(SUM(CASE WHEN il.state = 'active' THEN il.line_amount ELSE 0 END), 0)
      - COALESCE((SELECT SUM(pa.amount) FROM public.payment_allocations pa
                  JOIN public.payments p ON p.id = pa.payment_id
                  WHERE pa.invoice_line_id IN (SELECT id FROM public.invoice_lines WHERE invoice_id = v_invoice.id)
                    AND p.status = 'paid'), 0)
      - COALESCE((SELECT SUM(ica.amount) FROM public.invoice_credit_allocations ica
                  WHERE ica.invoice_line_id IN (SELECT id FROM public.invoice_lines WHERE invoice_id = v_invoice.id)), 0),
    0
  )::NUMERIC(12, 2) INTO v_balance
  FROM public.invoice_lines il WHERE il.invoice_id = v_invoice.id;

  IF v_balance <= 0 THEN RAISE EXCEPTION 'This invoice is already settled'; END IF;
  IF NEW.amount > v_balance THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding balance of %', v_balance;
  END IF;
  IF NEW.receipt_bucket IS NOT NULL AND NEW.receipt_bucket <> 'payment-receipts' THEN
    RAISE EXCEPTION 'Unsupported receipt bucket';
  END IF;

  NEW.account_id := v_invoice.account_id;
  NEW.contact_id := v_invoice.contact_id;
  NEW.membership_id := v_invoice.membership_id;
  NEW.user_id := COALESCE((SELECT auth.uid()), NEW.user_id);
  IF v_period.id IS NOT NULL THEN
    IF v_period.state = 'void' THEN
      RAISE EXCEPTION 'Payments cannot be recorded against a void billing period';
    END IF;
    NEW.period_start := v_period.period_start;
    NEW.period_end := v_period.period_end;
    NEW.plan_id := v_period.plan_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Protect the generic identity alongside established financial snapshots.
CREATE OR REPLACE FUNCTION public.protect_payment_invoice_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'Payment invoice is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_payment_invoice_id ON public.payments;
CREATE TRIGGER trg_protect_payment_invoice_id
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_payment_invoice_id();

-- ---------------------------------------------------------------------------
-- Deterministic largest-remainder allocations (paise exact)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_invoice_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice_cents BIGINT;
  v_payment_cents BIGINT := ROUND(NEW.amount * 100)::BIGINT;
BEGIN
  IF NEW.status <> 'paid' OR NEW.invoice_id IS NULL THEN RETURN NEW; END IF;

  WITH line_balance AS (
    SELECT
      il.id,
      GREATEST(
        ROUND(il.line_amount * 100)::BIGINT
          - COALESCE((SELECT SUM(ROUND(pa.amount * 100)::BIGINT)
                      FROM public.payment_allocations pa
                      JOIN public.payments p ON p.id = pa.payment_id
                      WHERE pa.invoice_line_id = il.id AND p.status = 'paid'), 0)
          - COALESCE((SELECT SUM(ROUND(ica.amount * 100)::BIGINT)
                      FROM public.invoice_credit_allocations ica
                      WHERE ica.invoice_line_id = il.id), 0),
        0
      ) AS balance_cents
    FROM public.invoice_lines il
    WHERE il.invoice_id = NEW.invoice_id AND il.state = 'active'
  )
  SELECT SUM(balance_cents) INTO v_invoice_cents FROM line_balance;

  IF COALESCE(v_invoice_cents, 0) < v_payment_cents THEN
    RAISE EXCEPTION 'Payment exceeds invoice line balances';
  END IF;

  INSERT INTO public.payment_allocations (payment_id, invoice_line_id, account_id, amount)
  WITH line_balance AS (
    SELECT
      il.id,
      GREATEST(
        ROUND(il.line_amount * 100)::BIGINT
          - COALESCE((SELECT SUM(ROUND(pa.amount * 100)::BIGINT)
                      FROM public.payment_allocations pa
                      JOIN public.payments p ON p.id = pa.payment_id
                      WHERE pa.invoice_line_id = il.id AND p.status = 'paid'), 0)
          - COALESCE((SELECT SUM(ROUND(ica.amount * 100)::BIGINT)
                      FROM public.invoice_credit_allocations ica
                      WHERE ica.invoice_line_id = il.id), 0),
        0
      ) AS balance_cents
    FROM public.invoice_lines il
    WHERE il.invoice_id = NEW.invoice_id AND il.state = 'active'
  ), shares AS (
    SELECT
      id,
      (v_payment_cents * balance_cents / v_invoice_cents)::BIGINT AS base_cents,
      MOD(v_payment_cents * balance_cents, v_invoice_cents) AS remainder
    FROM line_balance WHERE balance_cents > 0
  ), ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY remainder DESC, id) AS rank
    FROM shares
  ), totals AS (
    SELECT v_payment_cents - SUM(base_cents) AS extra_cents FROM shares
  )
  SELECT NEW.id, ranked.id, NEW.account_id,
    (ranked.base_cents + CASE WHEN ranked.rank <= totals.extra_cents THEN 1 ELSE 0 END)::NUMERIC / 100
  FROM ranked CROSS JOIN totals
  WHERE ranked.base_cents + CASE WHEN ranked.rank <= totals.extra_cents THEN 1 ELSE 0 END > 0;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allocate_invoice_payment ON public.payments;
CREATE TRIGGER trg_allocate_invoice_payment
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.allocate_invoice_payment();

-- Membership fee status follows only its current membership line, never
-- service or merchandise balances on the same invoice.
CREATE OR REPLACE FUNCTION public.derive_membership_fee_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_balance NUMERIC(12, 2);
BEGIN
  SELECT GREATEST(
    il.line_amount
      - COALESCE((SELECT SUM(pa.amount) FROM public.payment_allocations pa
                  JOIN public.payments p ON p.id = pa.payment_id
                  WHERE pa.invoice_line_id = il.id AND p.status = 'paid'), 0)
      - COALESCE((SELECT SUM(ica.amount) FROM public.invoice_credit_allocations ica
                  WHERE ica.invoice_line_id = il.id), 0),
    0
  ) INTO v_balance
  FROM public.membership_periods mp
  JOIN public.invoice_lines il ON il.id = mp.invoice_line_id
  WHERE mp.membership_id = NEW.id AND mp.period_end = NEW.end_date;

  IF v_balance IS NULL THEN v_balance := NEW.fee_amount; END IF;
  NEW.fee_status := CASE
    WHEN NEW.is_trial OR NEW.status = 'cancelled' OR v_balance < 0.5 THEN 'paid'
    ELSE 'due'
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.classify_membership_payment_purpose()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_membership_payment()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_payment_invoice_id()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_invoice_payment()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.derive_membership_fee_status()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Member credit balances
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.member_credit_balances
WITH (security_invoker = true) AS
SELECT
  entry.id,
  entry.account_id,
  entry.membership_id,
  entry.contact_id,
  entry.amount,
  entry.source,
  entry.source_service_id,
  entry.note,
  entry.created_by,
  entry.created_at,
  GREATEST(entry.amount - COALESCE(SUM(allocation.amount), 0), 0)::NUMERIC(12, 2) AS balance
FROM public.member_credit_entries entry
LEFT JOIN public.invoice_credit_allocations allocation
  ON allocation.credit_entry_id = entry.id
GROUP BY entry.id;

GRANT SELECT ON public.member_credit_balances TO authenticated, service_role;
REVOKE ALL ON public.member_credit_balances FROM anon;

CREATE OR REPLACE FUNCTION public.allocate_credit_to_invoice(
  p_credit_entry_id UUID,
  p_invoice_id UUID,
  p_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_id UUID;
  v_amount_cents BIGINT := ROUND(p_amount * 100)::BIGINT;
  v_balance_cents BIGINT;
BEGIN
  SELECT account_id INTO v_account_id FROM public.invoices WHERE id = p_invoice_id;
  IF v_account_id IS NULL OR v_amount_cents <= 0 THEN RETURN 0; END IF;

  WITH line_balance AS (
    SELECT il.id,
      GREATEST(
        ROUND(il.line_amount * 100)::BIGINT
          - COALESCE((SELECT SUM(ROUND(pa.amount * 100)::BIGINT)
                      FROM public.payment_allocations pa
                      JOIN public.payments p ON p.id = pa.payment_id
                      WHERE pa.invoice_line_id = il.id AND p.status = 'paid'), 0)
          - COALESCE((SELECT SUM(ROUND(ica.amount * 100)::BIGINT)
                      FROM public.invoice_credit_allocations ica
                      WHERE ica.invoice_line_id = il.id), 0),
        0
      ) AS balance_cents
    FROM public.invoice_lines il
    WHERE il.invoice_id = p_invoice_id AND il.state = 'active'
  )
  SELECT SUM(balance_cents) INTO v_balance_cents FROM line_balance;

  v_amount_cents := LEAST(v_amount_cents, COALESCE(v_balance_cents, 0));
  IF v_amount_cents <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.invoice_credit_allocations (
    account_id, credit_entry_id, invoice_line_id, amount
  )
  WITH line_balance AS (
    SELECT il.id,
      GREATEST(
        ROUND(il.line_amount * 100)::BIGINT
          - COALESCE((SELECT SUM(ROUND(pa.amount * 100)::BIGINT)
                      FROM public.payment_allocations pa
                      JOIN public.payments p ON p.id = pa.payment_id
                      WHERE pa.invoice_line_id = il.id AND p.status = 'paid'), 0)
          - COALESCE((SELECT SUM(ROUND(ica.amount * 100)::BIGINT)
                      FROM public.invoice_credit_allocations ica
                      WHERE ica.invoice_line_id = il.id), 0),
        0
      ) AS balance_cents
    FROM public.invoice_lines il
    WHERE il.invoice_id = p_invoice_id AND il.state = 'active'
  ), shares AS (
    SELECT id,
      (v_amount_cents * balance_cents / v_balance_cents)::BIGINT AS base_cents,
      MOD(v_amount_cents * balance_cents, v_balance_cents) AS remainder
    FROM line_balance WHERE balance_cents > 0
  ), ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY remainder DESC, id) AS rank FROM shares
  ), totals AS (
    SELECT v_amount_cents - SUM(base_cents) AS extra_cents FROM shares
  )
  SELECT v_account_id, p_credit_entry_id, ranked.id,
    (ranked.base_cents + CASE WHEN ranked.rank <= totals.extra_cents THEN 1 ELSE 0 END)::NUMERIC / 100
  FROM ranked CROSS JOIN totals
  WHERE ranked.base_cents + CASE WHEN ranked.rank <= totals.extra_cents THEN 1 ELSE 0 END > 0;

  RETURN v_amount_cents::NUMERIC / 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_oldest_member_credit(p_invoice_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_credit RECORD;
  v_invoice_balance NUMERIC(12, 2);
  v_applied NUMERIC(12, 2) := 0;
  v_step NUMERIC(12, 2);
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.membership_id IS NULL THEN RETURN 0; END IF;

  FOR v_credit IN
    SELECT * FROM public.member_credit_balances
    WHERE account_id = v_invoice.account_id
      AND membership_id = v_invoice.membership_id
      AND balance > 0
    ORDER BY created_at, id
  LOOP
    SELECT balance INTO v_invoice_balance
    FROM public.invoice_balances WHERE id = p_invoice_id;
    EXIT WHEN COALESCE(v_invoice_balance, 0) <= 0;
    v_step := public.allocate_credit_to_invoice(
      v_credit.id, p_invoice_id, LEAST(v_credit.balance, v_invoice_balance)
    );
    v_applied := v_applied + v_step;
  END LOOP;
  RETURN v_applied;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_credit_to_invoice(UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_oldest_member_credit(UUID)
  FROM PUBLIC, anon, authenticated;

-- Append validated catalogue selections to a newly issued invoice. Existing
-- invoices are never reopened by the public API.
CREATE OR REPLACE FUNCTION public.append_catalog_selections(
  p_invoice_id UUID,
  p_membership_id UUID,
  p_contact_id UUID,
  p_selections JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_selection JSONB;
  v_item public.catalog_items%ROWTYPE;
  v_option public.catalog_options%ROWTYPE;
  v_trainer public.trainers%ROWTYPE;
  v_rate public.trainer_rates%ROWTYPE;
  v_quantity INTEGER;
  v_configured NUMERIC(12, 2);
  v_unit_amount NUMERIC(12, 2);
  v_start DATE;
  v_end DATE;
  v_line_id UUID;
  v_service_id UUID;
  v_override_reason TEXT;
  v_sort INTEGER := 10;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.state <> 'open' THEN RAISE EXCEPTION 'Open invoice not found'; END IF;
  IF COALESCE(jsonb_typeof(p_selections), 'array') <> 'array' THEN
    RAISE EXCEPTION 'Selections must be an array';
  END IF;

  FOR v_selection IN SELECT value FROM jsonb_array_elements(COALESCE(p_selections, '[]'::JSONB))
  LOOP
    SELECT * INTO v_item FROM public.catalog_items
    WHERE id = (v_selection->>'item_id')::UUID
      AND account_id = v_invoice.account_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue item is unavailable'; END IF;

    SELECT * INTO v_option FROM public.catalog_options
    WHERE id = (v_selection->>'option_id')::UUID
      AND item_id = v_item.id AND account_id = v_invoice.account_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue option is unavailable'; END IF;

    v_quantity := COALESCE((v_selection->>'quantity')::INTEGER, 1);
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
    IF v_item.kind = 'service' AND v_quantity <> 1 THEN
      RAISE EXCEPTION 'A service must be sold one term at a time';
    END IF;

    IF v_item.requires_trainer THEN
      IF NULLIF(v_selection->>'trainer_id', '') IS NULL THEN
        RAISE EXCEPTION 'Select a trainer for %', v_item.name;
      END IF;
      SELECT * INTO v_trainer FROM public.trainers
      WHERE id = (v_selection->>'trainer_id')::UUID
        AND account_id = v_invoice.account_id AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Trainer is unavailable'; END IF;
      SELECT * INTO v_rate FROM public.trainer_rates
      WHERE trainer_id = v_trainer.id AND option_id = v_option.id
        AND account_id = v_invoice.account_id AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'No current rate is configured for this trainer and duration';
      END IF;
      v_configured := v_rate.price;
    ELSE
      IF NULLIF(v_selection->>'trainer_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'This item does not use trainer pricing';
      END IF;
      v_configured := v_option.standard_price;
    END IF;

    v_unit_amount := COALESCE((v_selection->>'unit_amount')::NUMERIC, v_configured);
    v_override_reason := NULLIF(BTRIM(v_selection->>'override_reason'), '');
    IF v_unit_amount < 0 THEN RAISE EXCEPTION 'Sale price cannot be negative'; END IF;
    IF v_unit_amount IS DISTINCT FROM v_configured THEN
      IF NOT public.is_account_member(v_invoice.account_id, 'admin') THEN
        RAISE EXCEPTION 'Only an admin can override a sale price';
      END IF;
      IF v_override_reason IS NULL THEN RAISE EXCEPTION 'A price override reason is required'; END IF;
    ELSE
      v_override_reason := NULL;
    END IF;

    IF v_item.kind = 'service' THEN
      v_start := COALESCE((v_selection->>'start_date')::DATE, CURRENT_DATE);
      v_end := CASE v_option.duration_unit
        WHEN 'day' THEN v_start + v_option.duration_count
        WHEN 'week' THEN v_start + (v_option.duration_count * 7)
        WHEN 'month' THEN (v_start + make_interval(months => v_option.duration_count))::DATE
        WHEN 'year' THEN (v_start + make_interval(years => v_option.duration_count))::DATE
      END;
    ELSE
      v_start := NULL; v_end := NULL;
    END IF;

    INSERT INTO public.invoice_lines (
      account_id, invoice_id, kind, catalog_item_id, catalog_option_id,
      trainer_id, description, quantity, unit_amount, line_amount,
      service_start, service_end, list_amount, override_amount,
      override_reason, overridden_by, sort_order
    ) VALUES (
      v_invoice.account_id, v_invoice.id, v_item.kind, v_item.id, v_option.id,
      CASE WHEN v_item.requires_trainer THEN v_trainer.id ELSE NULL END,
      v_item.name, v_quantity, v_unit_amount, v_unit_amount * v_quantity,
      v_start, v_end, v_configured * v_quantity,
      CASE WHEN v_unit_amount IS DISTINCT FROM v_configured THEN v_unit_amount ELSE NULL END,
      v_override_reason,
      CASE WHEN v_override_reason IS NOT NULL THEN (SELECT auth.uid()) ELSE NULL END,
      v_sort
    ) RETURNING id INTO v_line_id;

    IF v_item.kind = 'service' THEN
      INSERT INTO public.member_services (
        account_id, membership_id, contact_id, invoice_line_id,
        catalog_item_id, catalog_option_id, renewed_from_service_id,
        item_name_snapshot, option_duration_count, option_duration_unit,
        start_date, end_date, sold_amount
      ) VALUES (
        v_invoice.account_id, p_membership_id, p_contact_id, v_line_id,
        v_item.id, v_option.id,
        NULLIF(v_selection->>'renewed_from_service_id', '')::UUID,
        v_item.name, v_option.duration_count, v_option.duration_unit,
        v_start, v_end, v_unit_amount
      ) RETURNING id INTO v_service_id;

      IF v_item.requires_trainer THEN
        INSERT INTO public.service_trainer_assignments (
          account_id, member_service_id, trainer_id, trainer_name_snapshot,
          trainer_title_snapshot, full_package_rate, starts_on
        ) VALUES (
          v_invoice.account_id, v_service_id, v_trainer.id,
          v_trainer.display_name, v_trainer.title, v_configured, v_start
        );
      END IF;
    END IF;
    v_sort := v_sort + 10;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.append_catalog_selections(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;

-- The single browser-facing transaction for join/convert/renew/sale/service
-- renewal. Payload validation is intentionally explicit and dependency-free.
CREATE OR REPLACE FUNCTION public.perform_member_checkout(p_payload JSONB)
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
  v_membership_data JSONB := COALESCE(p_payload->'membership', '{}'::JSONB);
  v_collection JSONB := COALESCE(p_payload->'collection', '{}'::JSONB);
  v_invoice_id UUID;
  v_period_id UUID;
  v_existing public.invoice_balances%ROWTYPE;
  v_result public.invoice_balances%ROWTYPE;
  v_collect NUMERIC(12, 2) := COALESCE((v_collection->>'amount')::NUMERIC, 0);
  v_payment_id UUID;
  v_purpose TEXT;
  v_name TEXT;
  v_member_number INTEGER;
  v_currency TEXT;
BEGIN
  IF v_mode NOT IN ('join', 'convert', 'membership_renewal', 'sale', 'service_renewal') THEN
    RAISE EXCEPTION 'Unsupported checkout mode';
  END IF;
  IF NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Agent access is required';
  END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'An idempotency key is required'; END IF;

  SELECT balance.* INTO v_existing
  FROM public.invoice_balances balance
  JOIN public.invoices invoice ON invoice.id = balance.id
  WHERE invoice.account_id = v_account_id AND invoice.idempotency_key = v_key;
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
  ) THEN RAISE EXCEPTION 'Member contact not found'; END IF;

  IF v_mode = 'join' THEN
    IF v_membership_id IS NOT NULL THEN RAISE EXCEPTION 'Join creates a new membership'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.membership_plans
      WHERE id = (v_membership_data->>'plan_id')::UUID AND account_id = v_account_id
    ) THEN RAISE EXCEPTION 'Membership plan not found'; END IF;
    INSERT INTO public.memberships (
      account_id, contact_id, user_id, plan_id, pricing_option_id,
      start_date, end_date, status, fee_amount, fee_status, is_trial, notes
    ) VALUES (
      v_account_id, v_contact_id, (SELECT auth.uid()),
      (v_membership_data->>'plan_id')::UUID,
      NULLIF(v_membership_data->>'pricing_option_id', '')::UUID,
      (v_membership_data->>'period_start')::DATE,
      (v_membership_data->>'period_end')::DATE,
      'active', (v_membership_data->>'fee_amount')::NUMERIC,
      'due', FALSE, NULLIF(BTRIM(v_membership_data->>'notes'), '')
    ) RETURNING id, member_number INTO v_membership_id, v_member_number;
    SELECT id, invoice_line_id INTO v_period_id, v_payment_id
    FROM public.membership_periods WHERE membership_id = v_membership_id
    ORDER BY created_at, id LIMIT 1;
    SELECT invoice_id INTO v_invoice_id FROM public.invoice_lines WHERE id = v_payment_id;
  ELSIF v_mode IN ('convert', 'membership_renewal') THEN
    IF v_membership_id IS NULL THEN RAISE EXCEPTION 'Membership is required'; END IF;
    PERFORM public.renew_membership_transaction(
      v_membership_id,
      (v_membership_data->>'plan_id')::UUID,
      (v_membership_data->>'period_start')::DATE,
      (v_membership_data->>'period_end')::DATE,
      (v_membership_data->>'fee_amount')::NUMERIC,
      0, 'cash', v_mode = 'convert', v_key,
      NULLIF(v_membership_data->>'pricing_option_id', '')::UUID
    );
    SELECT id, invoice_line_id INTO v_period_id, v_payment_id
    FROM public.membership_periods
    WHERE membership_id = v_membership_id
      AND period_end = (v_membership_data->>'period_end')::DATE
    ORDER BY created_at DESC LIMIT 1;
    SELECT invoice_id INTO v_invoice_id FROM public.invoice_lines WHERE id = v_payment_id;
    SELECT member_number INTO v_member_number FROM public.memberships WHERE id = v_membership_id;
  ELSE
    SELECT m.member_number, c.name, a.default_currency
    INTO v_member_number, v_name, v_currency
    FROM public.memberships m
    JOIN public.contacts c ON c.id = m.contact_id
    JOIN public.accounts a ON a.id = m.account_id
    WHERE m.id = v_membership_id AND m.account_id = v_account_id
      AND m.contact_id = v_contact_id FOR UPDATE OF m;
    IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
    INSERT INTO public.invoices (
      account_id, contact_id, membership_id, source, issued_at,
      customer_name_snapshot, member_number_snapshot, currency,
      created_by, idempotency_key
    ) VALUES (
      v_account_id, v_contact_id, v_membership_id,
      CASE WHEN v_mode = 'service_renewal' THEN 'service_renewal' ELSE 'sale' END,
      COALESCE((p_payload->>'issued_at')::TIMESTAMPTZ, NOW()),
      v_name, v_member_number, v_currency, (SELECT auth.uid()), v_key
    ) RETURNING id INTO v_invoice_id;
  END IF;

  IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'Checkout invoice was not created'; END IF;
  UPDATE public.invoices SET idempotency_key = v_key WHERE id = v_invoice_id;

  PERFORM public.append_catalog_selections(
    v_invoice_id, v_membership_id, v_contact_id,
    COALESCE(p_payload->'selections', '[]'::JSONB)
  );

  IF v_mode IN ('sale', 'service_renewal') AND NOT EXISTS (
    SELECT 1 FROM public.invoice_lines WHERE invoice_id = v_invoice_id
  ) THEN RAISE EXCEPTION 'Select at least one product or service'; END IF;

  -- Credits are applied only in this manual checkout path. Gateway-created
  -- AutoPay renewal invoices never call it and retain their fixed mandate fee.
  PERFORM public.apply_oldest_member_credit(v_invoice_id);

  SELECT balance INTO v_result FROM public.invoice_balances balance WHERE id = v_invoice_id;
  IF v_collect < 0 OR v_collect > v_result.balance THEN
    RAISE EXCEPTION 'Collected amount must be between zero and the invoice balance';
  END IF;
  IF v_mode = 'convert' AND v_collect <= 0 THEN
    RAISE EXCEPTION 'Lead conversion requires a positive initial collection';
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
      v_invoice_id, v_collect, COALESCE(NULLIF(v_collection->>'method', ''), 'cash'),
      'paid', COALESCE((v_collection->>'paid_at')::TIMESTAMPTZ, NOW()),
      NULLIF(v_membership_data->>'period_start', '')::DATE,
      NULLIF(v_membership_data->>'period_end', '')::DATE,
      CASE WHEN NULLIF(v_collection->>'receipt_path', '') IS NULL THEN NULL ELSE 'payment-receipts' END,
      NULLIF(v_collection->>'receipt_path', ''),
      NULLIF(BTRIM(v_collection->>'note'), ''), v_key
    ) RETURNING id INTO v_payment_id;
    PERFORM set_config('app.payment_purpose', '', TRUE);
  END IF;

  SELECT balance.* INTO v_result FROM public.invoice_balances balance WHERE id = v_invoice_id;
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

REVOKE ALL ON FUNCTION public.perform_member_checkout(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_member_checkout(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id UUID,
  p_amount NUMERIC,
  p_method TEXT,
  p_paid_at TIMESTAMPTZ,
  p_note TEXT,
  p_receipt_path TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_payment_id UUID;
  v_result public.invoice_balances%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_invoice.account_id, 'agent') THEN
    RAISE EXCEPTION 'Invoice not found or access denied';
  END IF;
  SELECT id INTO v_payment_id FROM public.payments
  WHERE account_id = v_invoice.account_id AND idempotency_key = p_idempotency_key;
  IF v_payment_id IS NULL THEN
    PERFORM set_config('app.payment_purpose', 'due', TRUE);
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, user_id, invoice_id,
      amount, method, status, paid_at, receipt_bucket, screenshot_path,
      note, idempotency_key
    ) VALUES (
      v_invoice.account_id, v_invoice.membership_id, v_invoice.contact_id,
      (SELECT auth.uid()), v_invoice.id, p_amount, p_method, 'paid', p_paid_at,
      CASE WHEN p_receipt_path IS NULL THEN NULL ELSE 'payment-receipts' END,
      p_receipt_path, NULLIF(BTRIM(p_note), ''), p_idempotency_key
    ) RETURNING id INTO v_payment_id;
    PERFORM set_config('app.payment_purpose', '', TRUE);
  END IF;
  SELECT balance.* INTO v_result FROM public.invoice_balances balance WHERE id = v_invoice.id;
  RETURN jsonb_build_object(
    'payment_id', v_payment_id, 'invoice_id', v_invoice.id,
    'total', v_result.total, 'cash_paid', v_result.amount_paid,
    'credit_applied', v_result.credit_applied, 'balance', v_result.balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_invoice_payment(
  UUID, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(
  UUID, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Service history, renewal readiness, cancellation, and reassignment
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS member_service_id UUID;
ALTER TABLE public.invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_member_service_id_fkey;
ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_member_service_id_fkey
  FOREIGN KEY (member_service_id) REFERENCES public.member_services(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_lines_member_service
  ON public.invoice_lines(member_service_id) WHERE member_service_id IS NOT NULL;

-- Back-reference newly created service lines without introducing a creation
-- cycle in the schema.
CREATE OR REPLACE FUNCTION public.link_member_service_invoice_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.invoice_lines SET member_service_id = NEW.id WHERE id = NEW.invoice_line_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_link_member_service_invoice_line ON public.member_services;
CREATE TRIGGER trg_link_member_service_invoice_line
  AFTER INSERT ON public.member_services
  FOR EACH ROW EXECUTE FUNCTION public.link_member_service_invoice_line();
REVOKE ALL ON FUNCTION public.link_member_service_invoice_line()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.member_service_details
WITH (security_invoker = true) AS
SELECT
  service.*,
  line.invoice_id,
  COALESCE(line.amount_paid, 0)::NUMERIC(12, 2) AS amount_paid,
  COALESCE(line.credit_applied, 0)::NUMERIC(12, 2) AS credit_applied,
  COALESCE(line.balance, service.sold_amount)::NUMERIC(12, 2) AS balance,
  CASE
    WHEN service.status = 'cancelled' THEN 'cancelled'
    WHEN service.start_date > (NOW() AT TIME ZONE account.timezone)::DATE THEN 'upcoming'
    WHEN service.end_date < (NOW() AT TIME ZONE account.timezone)::DATE THEN 'expired'
    ELSE 'active'
  END AS derived_status,
  assignment.trainer_id,
  assignment.trainer_name_snapshot AS trainer_name,
  assignment.trainer_title_snapshot AS trainer_title,
  assignment.full_package_rate AS assigned_full_rate,
  CASE
    WHEN item.requires_trainer THEN current_rate.price
    ELSE option.standard_price
  END::NUMERIC(12, 2) AS current_renewal_price,
  item.requires_trainer,
  item.is_active AS item_is_active,
  option.is_active AS option_is_active
FROM public.member_services service
JOIN public.accounts account ON account.id = service.account_id
JOIN public.invoice_line_balances line ON line.id = service.invoice_line_id
LEFT JOIN public.catalog_items item ON item.id = service.catalog_item_id
LEFT JOIN public.catalog_options option ON option.id = service.catalog_option_id
LEFT JOIN public.service_trainer_assignments assignment
  ON assignment.member_service_id = service.id AND assignment.ends_on IS NULL
LEFT JOIN public.trainer_rates current_rate
  ON current_rate.trainer_id = assignment.trainer_id
 AND current_rate.option_id = service.catalog_option_id
 AND current_rate.is_active;

GRANT SELECT ON public.member_service_details TO authenticated, service_role;
REVOKE ALL ON public.member_service_details FROM anon;

CREATE OR REPLACE FUNCTION public.cancel_member_service(
  p_member_service_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_service public.member_services%ROWTYPE;
BEGIN
  SELECT * INTO v_service FROM public.member_services
  WHERE id = p_member_service_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_service.account_id, 'agent') THEN
    RAISE EXCEPTION 'Service not found or access denied';
  END IF;
  IF v_service.status = 'cancelled' THEN RETURN v_service.id; END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE public.member_services SET status = 'cancelled', cancelled_at = NOW(),
    cancelled_by = (SELECT auth.uid()), cancel_reason = BTRIM(p_reason)
  WHERE id = v_service.id;
  RETURN v_service.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_invoice_line(
  p_invoice_line_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_line public.invoice_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM public.invoice_lines WHERE id = p_invoice_line_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_line.account_id, 'admin') THEN
    RAISE EXCEPTION 'Invoice line not found or admin access required';
  END IF;
  IF v_line.state = 'void' THEN RETURN v_line.id; END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_allocations allocation
    JOIN public.payments payment ON payment.id = allocation.payment_id
    WHERE allocation.invoice_line_id = v_line.id AND payment.status = 'paid'
  ) THEN RAISE EXCEPTION 'Void the related paid payment before voiding this line'; END IF;

  UPDATE public.invoice_lines SET state = 'void', voided_at = NOW(),
    voided_by = (SELECT auth.uid()), void_reason = BTRIM(p_reason)
  WHERE id = v_line.id;
  IF v_line.membership_period_id IS NOT NULL THEN
    UPDATE public.membership_periods SET state = 'void'
    WHERE id = v_line.membership_period_id;
  END IF;
  IF v_line.member_service_id IS NOT NULL THEN
    UPDATE public.member_services SET status = 'cancelled', cancelled_at = NOW(),
      cancelled_by = (SELECT auth.uid()), cancel_reason = BTRIM(p_reason)
    WHERE id = v_line.member_service_id;
  END IF;
  RETURN v_line.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_invoice_payment(
  p_payment_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT public.void_membership_payment(p_payment_id, p_reason) $$;

REVOKE ALL ON FUNCTION public.cancel_member_service(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_member_service(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.void_invoice_line(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_invoice_line(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.void_invoice_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_invoice_payment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reassign_member_service_trainer(
  p_member_service_id UUID,
  p_new_trainer_id UUID,
  p_switch_date DATE,
  p_reason TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_service public.member_services%ROWTYPE;
  v_old public.service_trainer_assignments%ROWTYPE;
  v_new public.trainers%ROWTYPE;
  v_rate public.trainer_rates%ROWTYPE;
  v_total_days INTEGER;
  v_remaining_days INTEGER;
  v_adjustment NUMERIC(12, 2);
  v_invoice_id UUID;
  v_credit_id UUID;
  v_credit_remaining NUMERIC(12, 2);
  v_line RECORD;
  v_line_balance NUMERIC(12, 2);
  v_apply NUMERIC(12, 2);
  v_currency TEXT;
  v_name TEXT;
  v_member_number INTEGER;
BEGIN
  SELECT * INTO v_service FROM public.member_services
  WHERE id = p_member_service_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_service.account_id, 'agent') THEN
    RAISE EXCEPTION 'Service not found or access denied';
  END IF;
  IF v_service.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled service cannot be reassigned'; END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF p_switch_date < v_service.start_date OR p_switch_date > v_service.end_date THEN
    RAISE EXCEPTION 'Switch date must fall within the service term';
  END IF;

  SELECT * INTO v_old FROM public.service_trainer_assignments
  WHERE member_service_id = v_service.id AND ends_on IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This service has no current trainer assignment'; END IF;
  IF v_old.trainer_id = p_new_trainer_id THEN RAISE EXCEPTION 'Select a different trainer'; END IF;

  SELECT * INTO v_new FROM public.trainers
  WHERE id = p_new_trainer_id AND account_id = v_service.account_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trainer is unavailable'; END IF;
  SELECT * INTO v_rate FROM public.trainer_rates
  WHERE trainer_id = v_new.id AND option_id = v_service.catalog_option_id
    AND account_id = v_service.account_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'No current rate is configured for this trainer and duration'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices
    WHERE account_id = v_service.account_id AND idempotency_key = p_idempotency_key
  ) THEN
    SELECT id INTO v_invoice_id FROM public.invoices
    WHERE account_id = v_service.account_id AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('member_service_id', v_service.id, 'adjustment_invoice_id', v_invoice_id);
  END IF;

  v_total_days := v_service.end_date - v_service.start_date;
  v_remaining_days := GREATEST(v_service.end_date - p_switch_date, 0);
  v_adjustment := ROUND(
    (v_rate.price - v_old.full_package_rate) * v_remaining_days / v_total_days,
    2
  );

  UPDATE public.service_trainer_assignments SET ends_on = p_switch_date,
    reason = BTRIM(p_reason) WHERE id = v_old.id;
  INSERT INTO public.service_trainer_assignments (
    account_id, member_service_id, trainer_id, trainer_name_snapshot,
    trainer_title_snapshot, full_package_rate, starts_on, reason
  ) VALUES (
    v_service.account_id, v_service.id, v_new.id, v_new.display_name,
    v_new.title, v_rate.price, p_switch_date, BTRIM(p_reason)
  );

  SELECT c.name, m.member_number, a.default_currency
  INTO v_name, v_member_number, v_currency
  FROM public.memberships m
  JOIN public.contacts c ON c.id = m.contact_id
  JOIN public.accounts a ON a.id = m.account_id
  WHERE m.id = v_service.membership_id;

  IF v_adjustment > 0 THEN
    INSERT INTO public.invoices (
      account_id, contact_id, membership_id, source, customer_name_snapshot,
      member_number_snapshot, currency, created_by, idempotency_key
    ) VALUES (
      v_service.account_id, v_service.contact_id, v_service.membership_id,
      'service_adjustment', v_name, v_member_number, v_currency,
      (SELECT auth.uid()), p_idempotency_key
    ) RETURNING id INTO v_invoice_id;
    INSERT INTO public.invoice_lines (
      account_id, invoice_id, kind, member_service_id, catalog_item_id,
      catalog_option_id, trainer_id, description, quantity, unit_amount,
      line_amount, list_amount, service_start, service_end
    ) VALUES (
      v_service.account_id, v_invoice_id, 'service_adjustment', v_service.id,
      v_service.catalog_item_id, v_service.catalog_option_id, v_new.id,
      'Trainer reassignment · ' || v_new.display_name, 1, v_adjustment,
      v_adjustment, v_adjustment, p_switch_date, v_service.end_date
    );
  ELSIF v_adjustment < 0 THEN
    INSERT INTO public.member_credit_entries (
      account_id, membership_id, contact_id, amount, source,
      source_service_id, note, created_by
    ) VALUES (
      v_service.account_id, v_service.membership_id, v_service.contact_id,
      ABS(v_adjustment), 'trainer_reassignment', v_service.id,
      'Trainer reassignment to ' || v_new.display_name || ' · ' || BTRIM(p_reason),
      (SELECT auth.uid())
    ) RETURNING id INTO v_credit_id;
    v_credit_remaining := ABS(v_adjustment);

    FOR v_line IN
      SELECT il.id
      FROM public.invoice_lines il
      JOIN public.invoices invoice ON invoice.id = il.invoice_id
      WHERE il.state = 'active'
        AND (il.id = v_service.invoice_line_id OR il.member_service_id = v_service.id)
      ORDER BY invoice.issued_at, il.id
    LOOP
      SELECT balance INTO v_line_balance FROM public.invoice_line_balances WHERE id = v_line.id;
      v_apply := LEAST(COALESCE(v_line_balance, 0), v_credit_remaining);
      IF v_apply > 0 THEN
        INSERT INTO public.invoice_credit_allocations (
          account_id, credit_entry_id, invoice_line_id, amount
        ) VALUES (v_service.account_id, v_credit_id, v_line.id, v_apply);
        v_credit_remaining := v_credit_remaining - v_apply;
      END IF;
      EXIT WHEN v_credit_remaining <= 0;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'member_service_id', v_service.id,
    'old_trainer_id', v_old.trainer_id,
    'new_trainer_id', v_new.id,
    'adjustment', v_adjustment,
    'adjustment_invoice_id', v_invoice_id,
    'credit_entry_id', v_credit_id,
    'credit_remaining', COALESCE(v_credit_remaining, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_member_service_trainer(
  UUID, UUID, DATE, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_member_service_trainer(
  UUID, UUID, DATE, TEXT, UUID
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Claim-first service renewal reminder delivery history
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_renewal_reminders_sent
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.service_renewal_reminders_sent
  DROP CONSTRAINT IF EXISTS service_renewal_reminders_sent_status_check;
ALTER TABLE public.service_renewal_reminders_sent
  ADD CONSTRAINT service_renewal_reminders_sent_status_check
  CHECK (status IN ('claimed', 'sent', 'failed'));
ALTER TABLE public.service_renewal_reminders_sent
  ALTER COLUMN sent_at DROP NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.service_renewal_reminders_sent;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.service_renewal_reminders_sent
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE VIEW public.service_renewal_queue
WITH (security_invoker = true) AS
SELECT detail.*,
  contact.name AS member_name,
  contact.phone,
  account.timezone,
  settings.service_enabled,
  settings.service_days_before,
  ((detail.end_date - (NOW() AT TIME ZONE account.timezone)::DATE))::INTEGER AS days_until_expiry
FROM public.member_service_details detail
JOIN public.contacts contact ON contact.id = detail.contact_id
JOIN public.accounts account ON account.id = detail.account_id
LEFT JOIN public.renewal_reminder_settings settings ON settings.account_id = detail.account_id
WHERE detail.status = 'active';

GRANT SELECT ON public.service_renewal_queue TO authenticated, service_role;
REVOKE ALL ON public.service_renewal_queue FROM anon;

CREATE OR REPLACE FUNCTION public.claim_service_renewal_reminders(p_limit INTEGER DEFAULT 100)
RETURNS SETOF public.service_renewal_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_candidate public.service_renewal_queue%ROWTYPE;
BEGIN
  FOR v_candidate IN
    SELECT queue.*
    FROM public.service_renewal_queue queue
    WHERE queue.service_enabled
      AND queue.days_until_expiry = ANY(queue.service_days_before)
      AND queue.current_renewal_price IS NOT NULL
      AND queue.item_is_active AND queue.option_is_active
    ORDER BY queue.end_date, queue.id
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
  LOOP
    INSERT INTO public.service_renewal_reminders_sent (
      account_id, member_service_id, end_date, days_before,
      status, claimed_at, sent_at, attempts
    ) VALUES (
      v_candidate.account_id, v_candidate.id, v_candidate.end_date,
      v_candidate.days_until_expiry, 'claimed', NOW(), NULL, 1
    )
    ON CONFLICT (member_service_id, end_date, days_before) DO UPDATE SET
      status = 'claimed', claimed_at = NOW(), sent_at = NULL,
      attempts = public.service_renewal_reminders_sent.attempts + 1,
      last_error = NULL, updated_at = NOW()
    WHERE public.service_renewal_reminders_sent.status = 'failed'
       OR (
         public.service_renewal_reminders_sent.status = 'claimed'
         AND public.service_renewal_reminders_sent.claimed_at < NOW() - INTERVAL '15 minutes'
       );
    IF FOUND THEN RETURN NEXT v_candidate; END IF;
  END LOOP;
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_service_renewal_reminder(
  p_member_service_id UUID,
  p_end_date DATE,
  p_days_before INTEGER,
  p_succeeded BOOLEAN,
  p_wa_message_id TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.service_renewal_reminders_sent SET
    status = CASE WHEN p_succeeded THEN 'sent' ELSE 'failed' END,
    sent_at = CASE WHEN p_succeeded THEN NOW() ELSE NULL END,
    wa_message_id = CASE WHEN p_succeeded THEN p_wa_message_id ELSE NULL END,
    last_error = CASE WHEN p_succeeded THEN NULL ELSE LEFT(COALESCE(p_error, 'Unknown error'), 1000) END,
    updated_at = NOW()
  WHERE member_service_id = p_member_service_id
    AND end_date = p_end_date AND days_before = p_days_before
    AND status = 'claimed';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_service_renewal_reminders(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_service_renewal_reminder(
  UUID, DATE, INTEGER, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_service_renewal_reminders(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_service_renewal_reminder(
  UUID, DATE, INTEGER, BOOLEAN, TEXT, TEXT
) TO service_role;

-- Reconcile the cache once using membership-line-only allocations.
UPDATE public.memberships SET fee_status = fee_status;
