-- Restore browser-authorized membership collections after invoices became
-- immutable to authenticated callers. Membership-originated payments already
-- serialize on their membership period; locking the linked invoice as well
-- made RLS hide it because authenticated callers have no invoice UPDATE policy.

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
  v_review BOOLEAN;
  v_system BOOLEAN :=
    COALESCE(current_setting('app.system_payment', TRUE), '') = '1';
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
    FROM public.memberships
    WHERE id = NEW.membership_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membership not found';
    END IF;

    NEW.period_end := COALESCE(NEW.period_end, v_membership.end_date);
    SELECT * INTO v_period
    FROM public.membership_periods
    WHERE membership_id = v_membership.id
      AND period_end = NEW.period_end
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Billing period not found';
    END IF;

    -- The period lock above is the serialization boundary for every
    -- membership-originated payment. A second invoice row lock is redundant
    -- and requires invoice UPDATE RLS, which the immutable browser ledger
    -- deliberately does not expose.
    SELECT invoice.* INTO v_invoice
    FROM public.invoices invoice
    JOIN public.invoice_lines line ON line.invoice_id = invoice.id
    WHERE line.id = v_period.invoice_line_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;
    NEW.invoice_id := v_invoice.id;
  ELSE
    -- Generic invoice collection enters through trusted RPCs that own this
    -- stronger invoice-level serialization boundary.
    SELECT * INTO v_invoice
    FROM public.invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;
    IF v_invoice.membership_period_id IS NOT NULL THEN
      SELECT * INTO v_period
      FROM public.membership_periods
      WHERE id = v_invoice.membership_period_id;
    END IF;
    IF v_invoice.membership_id IS NOT NULL THEN
      SELECT * INTO v_membership
      FROM public.memberships
      WHERE id = v_invoice.membership_id;
    END IF;
  END IF;

  IF NEW.source = 'payment_link' THEN
    IF NOT v_system
      OR NEW.gateway_payment_id IS NULL
      OR NEW.mandate_id IS NOT NULL
      OR NEW.user_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'Invalid trusted Payment Link payment';
    END IF;
    IF v_invoice.currency <> 'INR'
      OR v_invoice.membership_id IS NULL
      OR v_invoice.contact_id IS NULL
    THEN
      RAISE EXCEPTION 'Payment Link invoice is not collectible';
    END IF;
  ELSIF NEW.source = 'auto' THEN
    IF NOT v_system
      OR NEW.gateway_payment_id IS NULL
      OR NEW.mandate_id IS NULL
      OR NEW.user_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'Invalid trusted AutoPay payment';
    END IF;
  ELSIF NEW.source = 'manual' THEN
    IF NEW.gateway_payment_id IS NOT NULL
      OR NEW.mandate_id IS NOT NULL
      OR NEW.gateway_metadata IS NOT NULL
    THEN
      RAISE EXCEPTION 'Manual payments cannot carry gateway provenance';
    END IF;
    IF NOT v_system
      AND NOT public.is_account_member(v_invoice.account_id, 'agent')
    THEN
      RAISE EXCEPTION 'Insufficient access to record this payment';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported payment source';
  END IF;

  IF v_invoice.state <> 'open' THEN
    RAISE EXCEPTION 'Payments cannot be recorded against a void invoice';
  END IF;

  SELECT collectible_balance, requires_refund_review
  INTO v_balance, v_review
  FROM public.invoice_balances
  WHERE id = v_invoice.id;
  IF v_review THEN
    RAISE EXCEPTION 'Invoice is under refund review';
  END IF;
  IF COALESCE(v_balance, 0) <= 0 THEN
    RAISE EXCEPTION 'This invoice is already settled';
  END IF;

  IF NEW.source = 'payment_link' THEN
    IF ROUND(NEW.amount * 100)::BIGINT <> ROUND(v_balance * 100)::BIGINT THEN
      RAISE EXCEPTION 'Payment Link amount must equal the full invoice balance';
    END IF;
  ELSIF NEW.amount > v_balance THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding balance of %', v_balance;
  END IF;

  IF NEW.receipt_bucket IS NOT NULL
    AND NEW.receipt_bucket <> 'payment-receipts'
  THEN
    RAISE EXCEPTION 'Unsupported receipt bucket';
  END IF;

  NEW.account_id := v_invoice.account_id;
  NEW.contact_id := v_invoice.contact_id;
  NEW.membership_id := v_invoice.membership_id;
  NEW.user_id := CASE
    WHEN NEW.source = 'payment_link' THEN NULL
    ELSE COALESCE((SELECT auth.uid()), NEW.user_id)
  END;

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

ALTER FUNCTION public.validate_membership_payment() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_membership_payment()
  FROM PUBLIC, anon, authenticated;
