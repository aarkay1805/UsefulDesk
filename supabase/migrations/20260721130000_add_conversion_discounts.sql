-- ============================================================
-- Lead conversion discounts
--
-- A conversion offer changes the first invoice only. The membership keeps
-- the offer facts for audit; its initial membership_period copies them so
-- the invoice remains explainable after later renewals roll the membership
-- pointer back to the plan option's regular price.
-- ============================================================

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS conversion_list_price NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS conversion_discount_type TEXT,
  ADD COLUMN IF NOT EXISTS conversion_discount_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS conversion_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.membership_periods
  ADD COLUMN IF NOT EXISTS list_price NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS discount_type TEXT,
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_conversion_discount_valid,
  DROP CONSTRAINT IF EXISTS memberships_conversion_discount_values_valid;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_conversion_discount_valid CHECK (
    conversion_discount_type IS NULL
    OR conversion_discount_type IN ('amount', 'percentage')
  ),
  ADD CONSTRAINT memberships_conversion_discount_values_valid CHECK (
    conversion_discount_amount >= 0
    AND (conversion_list_price IS NULL OR conversion_list_price >= 0)
    AND (conversion_discount_value IS NULL OR conversion_discount_value >= 0)
    AND (
      (conversion_discount_type IS NULL
        AND conversion_discount_value IS NULL
        AND conversion_discount_amount = 0)
      OR
      (conversion_discount_type = 'amount'
        AND conversion_discount_value = conversion_discount_amount
        AND conversion_list_price IS NOT NULL
        AND conversion_discount_amount <= conversion_list_price)
      OR
      (conversion_discount_type = 'percentage'
        AND conversion_discount_value <= 100
        AND conversion_list_price IS NOT NULL
        AND conversion_discount_amount = ROUND(
          conversion_list_price * conversion_discount_value / 100,
          2
        ))
    )
  );

ALTER TABLE public.membership_periods
  DROP CONSTRAINT IF EXISTS membership_periods_discount_valid,
  DROP CONSTRAINT IF EXISTS membership_periods_discount_values_valid;

ALTER TABLE public.membership_periods
  ADD CONSTRAINT membership_periods_discount_valid CHECK (
    discount_type IS NULL OR discount_type IN ('amount', 'percentage')
  ),
  ADD CONSTRAINT membership_periods_discount_values_valid CHECK (
    discount_amount >= 0
    AND (list_price IS NULL OR list_price >= 0)
    AND (discount_value IS NULL OR discount_value >= 0)
    AND (
      (discount_type IS NULL
        AND discount_value IS NULL
        AND discount_amount = 0)
      OR
      (discount_type = 'amount'
        AND discount_value = discount_amount
        AND list_price IS NOT NULL
        AND discount_amount <= list_price)
      OR
      (discount_type = 'percentage'
        AND discount_value <= 100
        AND list_price IS NOT NULL
        AND discount_amount = ROUND(list_price * discount_value / 100, 2))
    )
  );

-- Supersedes migration 062's birth trigger. Later renewal/plan-change paths
-- omit these nullable offer columns, so every later invoice stays regular.
CREATE OR REPLACE FUNCTION public.create_initial_membership_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.membership_periods (
    account_id, membership_id, contact_id, plan_id, pricing_option_id,
    period_start, period_end, fee_amount, state,
    list_price, discount_type, discount_value, discount_amount
  )
  VALUES (
    NEW.account_id, NEW.id, NEW.contact_id, NEW.plan_id, NEW.pricing_option_id,
    NEW.start_date, NEW.end_date, NEW.fee_amount,
    CASE WHEN NEW.status = 'cancelled' THEN 'void' ELSE 'open' END,
    NEW.conversion_list_price, NEW.conversion_discount_type,
    NEW.conversion_discount_value, NEW.conversion_discount_amount
  )
  ON CONFLICT (membership_id, period_end) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_initial_membership_period()
  FROM PUBLIC, anon, authenticated;

-- Keep the existing column order and append offer facts so CREATE OR REPLACE
-- remains compatible with consumers of the 057 view.
CREATE OR REPLACE VIEW public.membership_period_invoices
WITH (security_invoker = true) AS
SELECT
  mp.id,
  mp.account_id,
  mp.membership_id,
  mp.contact_id,
  mp.plan_id,
  mp.period_start,
  mp.period_end,
  mp.fee_amount,
  mp.state,
  mp.created_at,
  COALESCE(
    SUM(p.amount) FILTER (WHERE p.status = 'paid'),
    0
  )::numeric(12, 2) AS amount_paid,
  GREATEST(
    mp.fee_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'paid'), 0),
    0
  )::numeric(12, 2) AS balance,
  mp.list_price,
  mp.discount_type,
  mp.discount_value,
  mp.discount_amount
FROM public.membership_periods mp
LEFT JOIN public.payments p
  ON p.membership_id = mp.membership_id
  AND p.period_end IS NOT DISTINCT FROM mp.period_end
GROUP BY mp.id;

GRANT SELECT ON public.membership_period_invoices TO authenticated, service_role;
REVOKE ALL ON public.membership_period_invoices FROM anon;
