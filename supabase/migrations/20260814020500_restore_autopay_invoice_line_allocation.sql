-- The refund release replaced this allocator with refund-aware balance views
-- but accidentally removed AutoPay's membership-period line isolation. Keep
-- those refund semantics while deriving both allocation eligibility and the
-- proportional denominator from the source-eligible invoice lines.

CREATE OR REPLACE FUNCTION public.allocate_invoice_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice_cents BIGINT;
  v_payment_cents BIGINT := ROUND(NEW.amount * 100)::BIGINT;
  v_auto_line_id UUID;
BEGIN
  IF NEW.status <> 'paid' OR NEW.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.source = 'auto' THEN
    SELECT period.invoice_line_id
    INTO v_auto_line_id
    FROM public.membership_periods period
    JOIN public.invoice_lines line ON line.id = period.invoice_line_id
    WHERE period.membership_id = NEW.membership_id
      AND period.period_end = NEW.period_end
      AND line.invoice_id = NEW.invoice_id
      AND line.state = 'active';

    IF v_auto_line_id IS NULL THEN
      RAISE EXCEPTION
        'Automatic payment has no explicit membership invoice line';
    END IF;
  END IF;

  WITH line_balance AS (
    SELECT
      line.id,
      ROUND(line.collectible_balance * 100)::BIGINT AS balance_cents
    FROM public.invoice_line_balances line
    WHERE line.invoice_id = NEW.invoice_id
      AND line.state = 'active'
      AND line.collectible_balance > 0
      AND (NEW.source <> 'auto' OR line.id = v_auto_line_id)
  )
  SELECT SUM(balance_cents)
  INTO v_invoice_cents
  FROM line_balance;

  IF COALESCE(v_invoice_cents, 0) < v_payment_cents THEN
    RAISE EXCEPTION 'Payment exceeds eligible invoice line balances';
  END IF;

  INSERT INTO public.payment_allocations (
    payment_id,
    invoice_line_id,
    account_id,
    amount
  )
  WITH line_balance AS (
    SELECT
      line.id,
      ROUND(line.collectible_balance * 100)::BIGINT AS balance_cents
    FROM public.invoice_line_balances line
    WHERE line.invoice_id = NEW.invoice_id
      AND line.state = 'active'
      AND line.collectible_balance > 0
      AND (NEW.source <> 'auto' OR line.id = v_auto_line_id)
  ), shares AS (
    SELECT
      id,
      (v_payment_cents * balance_cents / v_invoice_cents)::BIGINT
        AS base_cents,
      MOD(v_payment_cents * balance_cents, v_invoice_cents) AS remainder
    FROM line_balance
  ), ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (ORDER BY remainder DESC, id) AS rank
    FROM shares
  ), totals AS (
    SELECT v_payment_cents - SUM(base_cents) AS extra_cents
    FROM shares
  )
  SELECT
    NEW.id,
    ranked.id,
    NEW.account_id,
    (
      ranked.base_cents
      + CASE WHEN ranked.rank <= totals.extra_cents THEN 1 ELSE 0 END
    )::NUMERIC / 100
  FROM ranked
  CROSS JOIN totals
  WHERE
    ranked.base_cents
      + CASE WHEN ranked.rank <= totals.extra_cents THEN 1 ELSE 0 END > 0;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_payment()
  FROM PUBLIC, anon, authenticated;
