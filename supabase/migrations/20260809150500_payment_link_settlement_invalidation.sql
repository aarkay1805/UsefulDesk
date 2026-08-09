-- Payment Link settlement writes its own immutable payment and allocations.
-- Those provider-originated ledger facts must not request cancellation of the
-- link that is being marked paid. Other invoice mutations, including AutoPay
-- and manual payments, still invalidate an active Payment Link.
CREATE OR REPLACE FUNCTION public.invalidate_invoice_payment_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice_id UUID;
  v_payment_source TEXT;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    v_payment_source := COALESCE(NEW.source, OLD.source);
    IF v_payment_source = 'payment_link' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  ELSIF TG_TABLE_NAME IN ('payment_allocations', 'invoice_credit_allocations') THEN
    SELECT invoice_id INTO v_invoice_id FROM public.invoice_lines
    WHERE id = COALESCE(NEW.invoice_line_id, OLD.invoice_line_id);
    IF TG_TABLE_NAME = 'payment_allocations' THEN
      SELECT source INTO v_payment_source FROM public.payments
      WHERE id = COALESCE(NEW.payment_id, OLD.payment_id);
      IF v_payment_source = 'payment_link' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'invoice_lines' THEN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  ELSIF TG_TABLE_NAME = 'invoices' THEN
    v_invoice_id := COALESCE(NEW.id, OLD.id);
  END IF;
  IF v_invoice_id IS NOT NULL THEN
    PERFORM public.request_invoice_link_cancellation(v_invoice_id, TG_TABLE_NAME || '_changed');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.invalidate_invoice_payment_link()
  FROM PUBLIC, anon, authenticated;

UPDATE public.razorpay_payment_links
SET cancel_reason = NULL, updated_at = now()
WHERE status = 'paid' AND cancel_reason IN (
  'payments_changed', 'payment_allocations_changed'
);
