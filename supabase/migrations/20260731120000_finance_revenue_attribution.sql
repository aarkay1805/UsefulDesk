-- Durable payment-purpose attribution for Finance Overview, plus a
-- branch-scoped Meta lead-cohort performance read model.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_purpose TEXT;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_payment_purpose_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_purpose_check
  CHECK (payment_purpose IN ('joining', 'renewal', 'due', 'other'));

-- A replay may encounter the immutable-purpose trigger created at the end of
-- an earlier successful run. Remove it while the deterministic backfill is
-- reconciled, then restore it below before any caller can write again.
DROP TRIGGER IF EXISTS trg_protect_membership_payment_purpose
  ON public.payments;

-- Start conservatively. Exact operation/installment links win first; timing
-- heuristics only classify rows that still have no durable provenance.
UPDATE public.payments
SET payment_purpose = 'other'
WHERE payment_purpose IS NULL;

UPDATE public.payments AS payment
SET payment_purpose = CASE operation.operation
  WHEN 'convert' THEN 'joining'
  WHEN 'renew' THEN 'renewal'
  ELSE 'other'
END
FROM public.membership_operations AS operation
WHERE operation.idempotency_key = payment.idempotency_key;

UPDATE public.payments AS payment
SET payment_purpose = 'joining'
FROM public.membership_installment_plans AS installment
WHERE installment.first_payment_id = payment.id;

WITH ranked_periods AS (
  SELECT
    period.id,
    period.membership_id,
    period.period_end,
    period.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY period.membership_id
      ORDER BY period.created_at, period.id
    ) AS cycle_number
  FROM public.membership_periods AS period
), candidates AS (
  SELECT
    payment.id,
    CASE
      WHEN period.cycle_number = 1
        AND payment.created_at >= membership.created_at
        AND payment.created_at <= membership.created_at + INTERVAL '15 minutes'
        THEN 'joining'
      WHEN period.cycle_number > 1
        AND payment.created_at >= period.created_at
        AND payment.created_at <= period.created_at + INTERVAL '15 minutes'
        THEN 'renewal'
      WHEN payment.created_at > period.created_at + INTERVAL '15 minutes'
        THEN 'due'
      ELSE 'other'
    END AS payment_purpose
  FROM public.payments AS payment
  JOIN public.memberships AS membership
    ON membership.id = payment.membership_id
   AND membership.account_id = payment.account_id
  JOIN ranked_periods AS period
    ON period.membership_id = payment.membership_id
   AND period.period_end = payment.period_end
  WHERE payment.payment_purpose = 'other'
    AND NOT EXISTS (
      SELECT 1
      FROM public.membership_operations AS operation
      WHERE operation.idempotency_key = payment.idempotency_key
    )
)
UPDATE public.payments AS payment
SET payment_purpose = candidate.payment_purpose
FROM candidates AS candidate
WHERE candidate.id = payment.id;

ALTER TABLE public.payments
  ALTER COLUMN payment_purpose SET DEFAULT 'other',
  ALTER COLUMN payment_purpose SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_account_purpose_paid
  ON public.payments(account_id, payment_purpose, paid_at DESC)
  WHERE status = 'paid';

-- Purpose is derived inside the database. Callers cannot forge it by passing
-- a value on a direct INSERT.
CREATE OR REPLACE FUNCTION public.classify_membership_payment_purpose()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_context TEXT;
  v_operation TEXT;
  v_membership_created_at TIMESTAMPTZ;
  v_period_created_at TIMESTAMPTZ;
  v_has_earlier_period BOOLEAN := FALSE;
BEGIN
  v_context := NULLIF(
    current_setting('app.payment_purpose', TRUE),
    ''
  );

  IF v_context IN ('joining', 'renewal', 'due', 'other') THEN
    NEW.payment_purpose := v_context;
    RETURN NEW;
  END IF;

  SELECT operation.operation
  INTO v_operation
  FROM public.membership_operations AS operation
  WHERE operation.idempotency_key = NEW.idempotency_key
    AND operation.account_id = NEW.account_id
    AND operation.membership_id = NEW.membership_id;

  IF v_operation = 'convert' THEN
    NEW.payment_purpose := 'joining';
    RETURN NEW;
  ELSIF v_operation = 'renew' THEN
    NEW.payment_purpose := 'renewal';
    RETURN NEW;
  ELSIF v_operation = 'plan_change' THEN
    NEW.payment_purpose := 'other';
    RETURN NEW;
  END IF;

  SELECT
    membership.created_at,
    period.created_at,
    EXISTS (
      SELECT 1
      FROM public.membership_periods AS earlier
      WHERE earlier.membership_id = period.membership_id
        AND (
          earlier.created_at < period.created_at
          OR (earlier.created_at = period.created_at AND earlier.id < period.id)
        )
    )
  INTO
    v_membership_created_at,
    v_period_created_at,
    v_has_earlier_period
  FROM public.memberships AS membership
  JOIN public.membership_periods AS period
    ON period.membership_id = membership.id
   AND period.period_end = NEW.period_end
  WHERE membership.id = NEW.membership_id
    AND membership.account_id = NEW.account_id;

  IF v_period_created_at IS NULL THEN
    NEW.payment_purpose := 'other';
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.source, 'manual') = 'auto' THEN
    NEW.payment_purpose := CASE
      WHEN v_has_earlier_period
        AND v_period_created_at >= TRANSACTION_TIMESTAMP() - INTERVAL '1 second'
        THEN 'renewal'
      ELSE 'due'
    END;
    RETURN NEW;
  END IF;

  IF NOT v_has_earlier_period
    AND v_membership_created_at >= TRANSACTION_TIMESTAMP() - INTERVAL '15 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.payments AS existing
      WHERE existing.membership_id = NEW.membership_id
        AND existing.status IN ('paid', 'void')
    )
  THEN
    NEW.payment_purpose := 'joining';
  ELSE
    NEW.payment_purpose := 'due';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_classify_membership_payment_purpose
  ON public.payments;
CREATE TRIGGER trg_classify_membership_payment_purpose
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.classify_membership_payment_purpose();

CREATE OR REPLACE FUNCTION public.protect_membership_payment_purpose()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.payment_purpose IS DISTINCT FROM OLD.payment_purpose THEN
    RAISE EXCEPTION 'Payment purpose is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_membership_payment_purpose
  ON public.payments;
CREATE TRIGGER trg_protect_membership_payment_purpose
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_membership_payment_purpose();

REVOKE ALL ON FUNCTION public.classify_membership_payment_purpose()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_membership_payment_purpose()
  FROM PUBLIC, anon, authenticated;

-- The established manual-payment API is the only browser-facing path for
-- later collections. Stamp it as due unless a narrower trusted wrapper (the
-- joining API below) has already supplied a purpose for this transaction.
CREATE OR REPLACE FUNCTION public.record_membership_payment(
  p_membership_id UUID,
  p_period_end DATE,
  p_amount NUMERIC,
  p_method TEXT,
  p_paid_at TIMESTAMPTZ,
  p_note TEXT,
  p_receipt_path TEXT,
  p_idempotency_key UUID
)
RETURNS TABLE(payment_id UUID, amount_paid NUMERIC, balance NUMERIC)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_payment_id UUID;
  v_previous_purpose TEXT;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND
    OR NOT public.is_account_member(v_membership.account_id, 'agent')
  THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;

  SELECT id INTO v_payment_id
  FROM public.payments
  WHERE account_id = v_membership.account_id
    AND idempotency_key = p_idempotency_key;

  IF v_payment_id IS NULL THEN
    v_previous_purpose := current_setting('app.payment_purpose', TRUE);
    IF NULLIF(v_previous_purpose, '') IS NULL THEN
      PERFORM set_config('app.payment_purpose', 'due', TRUE);
    END IF;

    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id,
      amount, method, status, paid_at, period_end,
      screenshot_url, screenshot_path, receipt_bucket, note,
      idempotency_key
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      v_membership.plan_id, (SELECT auth.uid()),
      p_amount, p_method, 'paid', p_paid_at,
      COALESCE(p_period_end, v_membership.end_date),
      NULL, p_receipt_path,
      CASE WHEN p_receipt_path IS NULL THEN NULL ELSE 'payment-receipts' END,
      NULLIF(BTRIM(p_note), ''), p_idempotency_key
    )
    RETURNING id INTO v_payment_id;

    IF NULLIF(v_previous_purpose, '') IS NULL THEN
      PERFORM set_config('app.payment_purpose', '', TRUE);
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_payment_id,
    invoice.amount_paid,
    invoice.balance
  FROM public.membership_period_invoices AS invoice
  WHERE invoice.membership_id = v_membership.id
    AND invoice.period_end = COALESCE(p_period_end, v_membership.end_date);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_membership_payment(
  UUID, DATE, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_membership_payment(
  UUID, DATE, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) TO authenticated;

-- A narrow API for the initial Add/Convert-member collection. It preserves
-- record_membership_payment's validation/idempotency contract while proving
-- that the target is the first open cycle and the membership was just made.
CREATE OR REPLACE FUNCTION public.record_joining_payment(
  p_membership_id UUID,
  p_period_end DATE,
  p_amount NUMERIC,
  p_method TEXT,
  p_paid_at TIMESTAMPTZ,
  p_note TEXT,
  p_receipt_path TEXT,
  p_idempotency_key UUID
)
RETURNS TABLE(payment_id UUID, amount_paid NUMERIC, balance NUMERIC)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_first_period public.membership_periods%ROWTYPE;
  v_existing public.payments%ROWTYPE;
  v_previous_purpose TEXT;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND
    OR NOT public.is_account_member(v_membership.account_id, 'agent')
  THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;

  SELECT * INTO v_existing
  FROM public.payments
  WHERE account_id = v_membership.account_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.membership_id IS DISTINCT FROM v_membership.id
      OR v_existing.payment_purpose <> 'joining'
    THEN
      RAISE EXCEPTION 'Idempotency key already belongs to another payment';
    END IF;

    RETURN QUERY
    SELECT *
    FROM public.record_membership_payment(
      p_membership_id,
      p_period_end,
      p_amount,
      p_method,
      p_paid_at,
      p_note,
      p_receipt_path,
      p_idempotency_key
    );
    RETURN;
  END IF;

  SELECT * INTO v_first_period
  FROM public.membership_periods
  WHERE membership_id = v_membership.id
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF v_first_period.id IS NULL
    OR v_first_period.state <> 'open'
    OR v_first_period.period_end IS DISTINCT FROM
      COALESCE(p_period_end, v_membership.end_date)
  THEN
    RAISE EXCEPTION 'Joining payments must target the first open invoice';
  END IF;

  IF v_membership.created_at < STATEMENT_TIMESTAMP() - INTERVAL '15 minutes' THEN
    RAISE EXCEPTION 'The joining-payment window has closed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments AS existing
    WHERE existing.membership_id = v_membership.id
      AND existing.status IN ('paid', 'void')
  ) THEN
    RAISE EXCEPTION 'A joining payment is already recorded';
  END IF;

  v_previous_purpose := current_setting('app.payment_purpose', TRUE);
  PERFORM set_config('app.payment_purpose', 'joining', TRUE);

  RETURN QUERY
  SELECT *
  FROM public.record_membership_payment(
    p_membership_id,
    p_period_end,
    p_amount,
    p_method,
    p_paid_at,
    p_note,
    p_receipt_path,
    p_idempotency_key
  );

  PERFORM set_config(
    'app.payment_purpose',
    COALESCE(v_previous_purpose, ''),
    TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_joining_payment(
  UUID, DATE, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_joining_payment(
  UUID, DATE, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) TO authenticated;

-- The 60% first installment is still an initial joining collection. The
-- remaining 40% continues through record_membership_payment and is due.
CREATE OR REPLACE FUNCTION public.record_membership_installment_payment(
  p_membership_id UUID,
  p_period_end DATE,
  p_method TEXT,
  p_paid_at TIMESTAMPTZ,
  p_idempotency_key UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_fee NUMERIC(12, 2);
  v_first_amount NUMERIC(12, 2);
  v_second_amount NUMERIC(12, 2);
  v_payment_id UUID;
  v_plan_id UUID;
  v_timezone TEXT;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND
    OR NOT public.is_account_member(v_membership.account_id, 'agent')
  THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;

  SELECT period.fee_amount INTO v_fee
  FROM public.membership_periods AS period
  WHERE period.membership_id = v_membership.id
    AND period.period_end = p_period_end
    AND period.state = 'open'
  FOR UPDATE;

  IF v_fee IS NULL OR v_fee <= 0 THEN
    RAISE EXCEPTION 'Open membership invoice not found';
  END IF;

  v_first_amount := ROUND(v_fee * 0.60, 2);
  v_second_amount := ROUND(v_fee - v_first_amount, 2);

  IF v_first_amount <= 0 OR v_second_amount <= 0 THEN
    RAISE EXCEPTION 'Invoice is too small to split into installments';
  END IF;

  SELECT result.payment_id INTO v_payment_id
  FROM public.record_joining_payment(
    v_membership.id,
    p_period_end,
    v_first_amount,
    p_method,
    p_paid_at,
    '',
    NULL,
    p_idempotency_key
  ) AS result;

  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'The first installment payment could not be recorded';
  END IF;

  SELECT account.timezone INTO v_timezone
  FROM public.accounts AS account
  WHERE account.id = v_membership.account_id;

  INSERT INTO public.membership_installment_plans (
    account_id,
    membership_id,
    contact_id,
    period_end,
    first_payment_id,
    first_amount,
    second_amount,
    second_due_on,
    split_percent_now,
    created_by
  )
  VALUES (
    v_membership.account_id,
    v_membership.id,
    v_membership.contact_id,
    p_period_end,
    v_payment_id,
    v_first_amount,
    v_second_amount,
    (p_paid_at AT TIME ZONE COALESCE(v_timezone, 'Asia/Kolkata'))::DATE + 28,
    60,
    (SELECT auth.uid())
  )
  ON CONFLICT (membership_id, period_end) DO NOTHING
  RETURNING id INTO v_plan_id;

  IF v_plan_id IS NULL THEN
    SELECT id INTO v_plan_id
    FROM public.membership_installment_plans
    WHERE membership_id = v_membership.id
      AND period_end = p_period_end;
  END IF;

  RETURN v_plan_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_membership_installment_payment(
  UUID, DATE, TEXT, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_membership_installment_payment(
  UUID, DATE, TEXT, TIMESTAMPTZ, UUID
) TO authenticated;

-- The selected month is an acquisition cohort. Conversions and joining
-- revenue intentionally continue accumulating after that month.
CREATE OR REPLACE FUNCTION public.finance_overview_ad_performance(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH params AS (
    SELECT
      LEAST(p_start_date, p_end_date) AS report_start,
      GREATEST(p_start_date, p_end_date) AS report_end,
      COALESCE(NULLIF(BTRIM(p_time_zone), ''), 'UTC') AS tz
  ), ranges AS (
    SELECT
      report_start,
      report_end,
      report_start::TIMESTAMP AT TIME ZONE tz AS start_at,
      (report_end + 1)::TIMESTAMP AT TIME ZONE tz AS end_at
    FROM params
  ), cohort AS MATERIALIZED (
    SELECT contact.account_id, contact.id
    FROM public.contacts AS contact
    CROSS JOIN ranges AS range
    WHERE public.is_account_member(contact.account_id)
      AND contact.created_at >= range.start_at
      AND contact.created_at < range.end_at
      AND (
        LOWER(BTRIM(COALESCE(contact.source, ''))) IN ('instagram', 'facebook')
        OR contact.received_via = 'meta'
      )
  ), cohort_stats AS (
    SELECT
      COUNT(*)::BIGINT AS leads,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.account_id = cohort.account_id
            AND membership.contact_id = cohort.id
            AND membership.is_trial = FALSE
        )
      )::BIGINT AS converted_members
    FROM cohort
  ), cohort_revenue AS (
    SELECT COALESCE(SUM(payment.amount), 0)::NUMERIC AS joining_revenue
    FROM cohort
    JOIN public.payments AS payment
      ON payment.account_id = cohort.account_id
     AND payment.contact_id = cohort.id
     AND payment.status = 'paid'
     AND payment.payment_purpose = 'joining'
  ), marketing_spend AS (
    SELECT COALESCE(SUM(expense.amount), 0)::NUMERIC AS ad_spend
    FROM public.expenses AS expense
    JOIN public.expense_categories AS category
      ON category.id = expense.category_id
     AND category.account_id = expense.account_id
    CROSS JOIN ranges AS range
    WHERE public.is_account_member(expense.account_id)
      AND expense.status = 'posted'
      AND expense.occurred_on >= range.report_start
      AND expense.occurred_on <= range.report_end
      AND LOWER(BTRIM(category.name)) = 'marketing'
  )
  SELECT JSONB_BUILD_OBJECT(
    'adSpend', spend.ad_spend,
    'leads', stats.leads,
    'convertedMembers', stats.converted_members,
    'joiningRevenue', revenue.joining_revenue,
    'conversionRate', CASE
      WHEN stats.leads = 0 THEN NULL
      ELSE ROUND(stats.converted_members::NUMERIC * 100 / stats.leads, 1)
    END,
    'returnOnAdSpend', CASE
      WHEN spend.ad_spend = 0 THEN NULL
      ELSE ROUND(revenue.joining_revenue / spend.ad_spend, 2)
    END
  )
  FROM cohort_stats AS stats
  CROSS JOIN cohort_revenue AS revenue
  CROSS JOIN marketing_spend AS spend;
$$;

REVOKE ALL ON FUNCTION public.finance_overview_ad_performance(
  DATE, DATE, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_overview_ad_performance(
  DATE, DATE, TEXT
) TO authenticated;
