-- This is an AFTER INSERT trigger: existing ledger rows never re-enter it
-- when settings are enabled. `created_at` can be transaction-start time, so
-- comparing it with an in-transaction activation time would incorrectly drop
-- a newly inserted authoritative renewal.
CREATE OR REPLACE FUNCTION public.enqueue_payment_confirmation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings public.renewal_reminder_settings%ROWTYPE; v_period_end DATE; v_is_renewal BOOLEAN := FALSE;
BEGIN
  IF NEW.status <> 'paid' OR NEW.contact_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_settings FROM public.renewal_reminder_settings WHERE account_id = NEW.account_id;
  IF NOT FOUND OR NOT v_settings.payment_confirmations_enabled
     OR v_settings.payment_confirmations_activated_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.membership_id IS NOT NULL AND NEW.period_end IS NOT NULL
     AND NEW.idempotency_key IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.membership_operations operation
       WHERE operation.idempotency_key = NEW.idempotency_key
         AND operation.account_id = NEW.account_id
         AND operation.membership_id = NEW.membership_id
         AND operation.operation = 'renew'
     ) THEN
    SELECT period_end INTO v_period_end FROM public.membership_periods
      WHERE membership_id = NEW.membership_id AND period_end = NEW.period_end AND state = 'open'
      ORDER BY created_at DESC, id DESC LIMIT 1;
    v_is_renewal := v_period_end IS NOT NULL;
  END IF;
  INSERT INTO public.lifecycle_reminder_jobs(
    account_id, contact_id, invoice_id, payment_id, kind, subject_cycle_id,
    milestone_key, business_key, effective_due_on, coordination_on, activation_generation, reason
  ) VALUES (
    NEW.account_id, NEW.contact_id, NEW.invoice_id, NEW.id, 'payment_confirmation',
    NEW.id::TEXT, 'payment-confirmed',
    'payment_confirmation:' || NEW.id::TEXT || ':' || v_settings.payment_confirmations_generation::TEXT,
    (NEW.paid_at AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=NEW.account_id), 'UTC'))::DATE,
    (NEW.paid_at AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=NEW.account_id), 'UTC'))::DATE,
    v_settings.payment_confirmations_generation,
    jsonb_build_object('payment_id', NEW.id, 'renewed', v_is_renewal, 'period_end', v_period_end)
  ) ON CONFLICT (account_id, business_key) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_payment_confirmation() FROM PUBLIC, anon, authenticated;
