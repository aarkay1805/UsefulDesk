-- A fully settled exact invoice is as authoritative as a captured mandate
-- payment for superseding old recovery work. Partial settlement remains open.
CREATE OR REPLACE FUNCTION public.supersede_autopay_recovery_on_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'paid' AND (
    NEW.mandate_id IS NOT NULL
    OR (NEW.invoice_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.invoice_balances balance
      WHERE balance.id = NEW.invoice_id AND balance.collectible_balance <= 0
    ))
  ) THEN
    UPDATE public.razorpay_autopay_failure_events
    SET superseded_at = clock_timestamp()
    WHERE account_id=NEW.account_id AND superseded_at IS NULL
      AND observed_at <= NEW.created_at
      AND (mandate_id = NEW.mandate_id OR (invoice_id = NEW.invoice_id AND NEW.invoice_id IS NOT NULL));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.supersede_autopay_recovery_on_payment() FROM PUBLIC, anon, authenticated;
