-- ============================================================
-- One-time lead-conversion bonus months
--
-- A bonus-time offer extends only the first membership period. The selected
-- pricing option remains the normal renewal rule, so future periods continue
-- to bill its unchanged duration and price.
-- ============================================================

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS conversion_standard_end_date DATE,
  ADD COLUMN IF NOT EXISTS conversion_bonus_months INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.membership_periods
  ADD COLUMN IF NOT EXISTS standard_period_end DATE,
  ADD COLUMN IF NOT EXISTS bonus_months INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_conversion_bonus_months_valid;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_conversion_bonus_months_valid CHECK (
    conversion_bonus_months BETWEEN 0 AND 120
    AND (
      (conversion_bonus_months = 0 AND conversion_standard_end_date IS NULL)
      OR
      (conversion_bonus_months > 0 AND conversion_standard_end_date IS NOT NULL)
    )
  );

ALTER TABLE public.membership_periods
  DROP CONSTRAINT IF EXISTS membership_periods_bonus_months_valid;

ALTER TABLE public.membership_periods
  ADD CONSTRAINT membership_periods_bonus_months_valid CHECK (
    bonus_months BETWEEN 0 AND 120
    AND (
      (bonus_months = 0 AND standard_period_end IS NULL)
      OR
      (bonus_months > 0 AND standard_period_end IS NOT NULL)
    )
  );

-- Supersedes the conversion-discount birth trigger. Later renewal and
-- plan-change paths omit these offer columns, so every later period stays on
-- the pricing option's regular duration and price.
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
    list_price, discount_type, discount_value, discount_amount,
    standard_period_end, bonus_months
  )
  VALUES (
    NEW.account_id, NEW.id, NEW.contact_id, NEW.plan_id, NEW.pricing_option_id,
    NEW.start_date, NEW.end_date, NEW.fee_amount,
    CASE WHEN NEW.status = 'cancelled' THEN 'void' ELSE 'open' END,
    NEW.conversion_list_price, NEW.conversion_discount_type,
    NEW.conversion_discount_value, NEW.conversion_discount_amount,
    NEW.conversion_standard_end_date, NEW.conversion_bonus_months
  )
  ON CONFLICT (membership_id, period_end) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_initial_membership_period()
  FROM PUBLIC, anon, authenticated;

-- Preserve the established column order and append the bonus-time snapshot so
-- CREATE OR REPLACE remains compatible with existing view consumers.
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
  mp.discount_amount,
  mp.standard_period_end,
  mp.bonus_months
FROM public.membership_periods mp
LEFT JOIN public.payments p
  ON p.membership_id = mp.membership_id
  AND p.period_end IS NOT DISTINCT FROM mp.period_end
GROUP BY mp.id;

GRANT SELECT ON public.membership_period_invoices
  TO authenticated, service_role;
REVOKE ALL ON public.membership_period_invoices FROM anon;
