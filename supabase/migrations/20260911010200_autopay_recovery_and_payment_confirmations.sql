-- Step 5: no-backfill AutoPay recovery and factual transaction confirmations.
-- The payment trigger deliberately sees every authoritative insert, so browser
-- dialogs, checkout, link settlement, and captured provider charges cannot
-- diverge into separately maintained notification paths.

ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS payment_confirmations_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_confirmations_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_confirmations_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS autopay_recovery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS autopay_recovery_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autopay_recovery_generation UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.lifecycle_reminder_jobs
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS autopay_failure_event_id UUID;

ALTER TABLE public.lifecycle_reminder_jobs
  DROP CONSTRAINT IF EXISTS lifecycle_reminder_jobs_kind_check;
ALTER TABLE public.lifecycle_reminder_jobs
  ADD CONSTRAINT lifecycle_reminder_jobs_kind_check CHECK (kind IN (
    'invoice_due', 'invoice_overdue', 'installment_overdue',
    'membership_post_expiry', 'service_post_expiry', 'promise_to_pay',
    'payment_link_follow_up', 'payment_confirmation', 'autopay_recovery'
  ));
CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_reminder_jobs_payment_confirmation_key
  ON public.lifecycle_reminder_jobs(account_id, payment_id, activation_generation)
  WHERE kind = 'payment_confirmation' AND payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.razorpay_autopay_failure_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  mandate_id UUID NOT NULL REFERENCES public.payment_mandates(id) ON DELETE CASCADE,
  canonical_webhook_event_id TEXT NOT NULL REFERENCES public.webhook_events(id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('retry_pending', 'terminal')),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, canonical_webhook_event_id)
);
ALTER TABLE public.razorpay_autopay_failure_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS razorpay_autopay_failure_events_select ON public.razorpay_autopay_failure_events;
CREATE POLICY razorpay_autopay_failure_events_select ON public.razorpay_autopay_failure_events
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
REVOKE ALL ON public.razorpay_autopay_failure_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.razorpay_autopay_failure_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.razorpay_autopay_failure_events TO service_role;

-- Re-enabling starts an independent generation and sets the exact no-backfill
-- boundary. The preceding Step 4 trigger owns the older lifecycle columns;
-- this narrow trigger protects just Step 5's fields without changing them.
CREATE OR REPLACE FUNCTION public.set_step5_reminder_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.payment_confirmations_enabled = OLD.payment_confirmations_enabled
       AND (NEW.payment_confirmations_activated_at IS DISTINCT FROM OLD.payment_confirmations_activated_at
         OR NEW.payment_confirmations_generation IS DISTINCT FROM OLD.payment_confirmations_generation) THEN
      RAISE EXCEPTION 'Payment confirmation activation fields are system managed';
    END IF;
    IF NEW.autopay_recovery_enabled = OLD.autopay_recovery_enabled
       AND (NEW.autopay_recovery_activated_at IS DISTINCT FROM OLD.autopay_recovery_activated_at
         OR NEW.autopay_recovery_generation IS DISTINCT FROM OLD.autopay_recovery_generation) THEN
      RAISE EXCEPTION 'AutoPay recovery activation fields are system managed';
    END IF;
  END IF;
  IF NEW.payment_confirmations_enabled AND NOT COALESCE(OLD.payment_confirmations_enabled, FALSE) THEN
    NEW.payment_confirmations_activated_at := clock_timestamp();
    NEW.payment_confirmations_generation := gen_random_uuid();
  END IF;
  IF NEW.autopay_recovery_enabled AND NOT COALESCE(OLD.autopay_recovery_enabled, FALSE) THEN
    NEW.autopay_recovery_activated_at := clock_timestamp();
    NEW.autopay_recovery_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_step5_reminder_activation ON public.renewal_reminder_settings;
CREATE TRIGGER trg_step5_reminder_activation
  BEFORE INSERT OR UPDATE OF payment_confirmations_enabled, autopay_recovery_enabled,
    payment_confirmations_activated_at, payment_confirmations_generation,
    autopay_recovery_activated_at, autopay_recovery_generation
  ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_step5_reminder_activation();

-- This after-insert trigger is transaction-bound: a rolled-back payment
-- cannot leave an event/job behind. It uses only the inserted payment and an
-- exact membership-period record; it never searches for a "latest invoice".
CREATE OR REPLACE FUNCTION public.enqueue_payment_confirmation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings public.renewal_reminder_settings%ROWTYPE; v_period_end DATE; v_is_renewal BOOLEAN := FALSE;
BEGIN
  IF NEW.status <> 'paid' OR NEW.contact_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_settings FROM public.renewal_reminder_settings WHERE account_id = NEW.account_id;
  IF NOT FOUND OR NOT v_settings.payment_confirmations_enabled
     OR v_settings.payment_confirmations_activated_at IS NULL
     OR NEW.created_at < v_settings.payment_confirmations_activated_at THEN RETURN NEW; END IF;
  IF NEW.membership_id IS NOT NULL AND NEW.period_end IS NOT NULL AND NEW.payment_purpose = 'renewal' THEN
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
DROP TRIGGER IF EXISTS trg_enqueue_payment_confirmation ON public.payments;
CREATE TRIGGER trg_enqueue_payment_confirmation
  AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.enqueue_payment_confirmation();

-- The service-only entry point accepts only an already claimed canonical
-- Razorpay webhook whose signed payload binds the same subscription. Pending
-- means provider retry; halted is the first terminal/manual-fallback state.
CREATE OR REPLACE FUNCTION public.enqueue_razorpay_autopay_recovery(
  p_canonical_webhook_event_id TEXT, p_mandate_id UUID, p_event_kind TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mandate public.payment_mandates%ROWTYPE; v_settings public.renewal_reminder_settings%ROWTYPE;
  v_event public.webhook_events%ROWTYPE; v_invoice UUID; v_contact UUID; v_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' OR p_event_kind NOT IN ('retry_pending','terminal') THEN
    RAISE EXCEPTION 'service role and valid recovery event required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_event FROM public.webhook_events WHERE id=p_canonical_webhook_event_id
    AND gateway='razorpay' AND processing_status='processing' FOR SHARE;
  SELECT * INTO v_mandate FROM public.payment_mandates WHERE id=p_mandate_id FOR SHARE;
  IF NOT FOUND OR v_event.id IS NULL OR v_event.account_id IS DISTINCT FROM v_mandate.account_id
     OR v_event.type NOT IN ('subscription.pending','subscription.halted')
     OR (p_event_kind = 'retry_pending' AND v_event.type <> 'subscription.pending')
     OR (p_event_kind = 'terminal' AND v_event.type <> 'subscription.halted')
     OR v_event.payload #>> '{payload,subscription,entity,id}' IS DISTINCT FROM v_mandate.gateway_subscription_id THEN
    RAISE EXCEPTION 'verified Razorpay event and mandate binding required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_settings FROM public.renewal_reminder_settings WHERE account_id=v_mandate.account_id;
  IF NOT FOUND OR NOT v_settings.autopay_recovery_enabled
     OR v_settings.autopay_recovery_activated_at IS NULL OR v_event.created_at < v_settings.autopay_recovery_activated_at THEN RETURN NULL; END IF;
  SELECT line.invoice_id, period.contact_id INTO v_invoice, v_contact
  FROM public.membership_periods period
  JOIN public.memberships member ON member.id=period.membership_id
  JOIN public.invoice_lines line ON line.id=period.invoice_line_id
  WHERE period.membership_id=v_mandate.membership_id AND period.period_end=member.end_date AND period.state='open'
  ORDER BY period.created_at DESC, period.id DESC LIMIT 1;
  v_contact := COALESCE(v_contact, (SELECT contact_id FROM public.memberships WHERE id=v_mandate.membership_id));
  INSERT INTO public.razorpay_autopay_failure_events(account_id,mandate_id,canonical_webhook_event_id,event_kind,invoice_id,contact_id,observed_at)
  VALUES(v_mandate.account_id,v_mandate.id,v_event.id,p_event_kind,v_invoice,v_contact,v_event.created_at)
  ON CONFLICT(account_id,canonical_webhook_event_id) DO UPDATE SET canonical_webhook_event_id=EXCLUDED.canonical_webhook_event_id
  RETURNING id INTO v_id;
  INSERT INTO public.lifecycle_reminder_jobs(account_id,contact_id,invoice_id,autopay_failure_event_id,kind,subject_cycle_id,milestone_key,business_key,effective_due_on,coordination_on,activation_generation)
  VALUES(v_mandate.account_id,v_contact,v_invoice,v_id,'autopay_recovery',v_mandate.id::TEXT || ':' || v_event.id,
    p_event_kind,'autopay_recovery:' || v_mandate.id::TEXT || ':' || v_event.id || ':' || v_settings.autopay_recovery_generation::TEXT,
    (v_event.created_at AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=v_mandate.account_id),'UTC'))::DATE,
    (v_event.created_at AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=v_mandate.account_id),'UTC'))::DATE,
    v_settings.autopay_recovery_generation)
  ON CONFLICT(account_id,business_key) DO NOTHING;
  RETURN v_id;
END;
$$;

-- A later committed payment is authoritative evidence that an earlier
-- provider-failure recovery is stale. This is an event-state update only; it
-- never changes the payment ledger or creates a replacement transaction.
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
DROP TRIGGER IF EXISTS trg_supersede_autopay_recovery_on_payment ON public.payments;
CREATE TRIGGER trg_supersede_autopay_recovery_on_payment
  AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.supersede_autopay_recovery_on_payment();

REVOKE ALL ON FUNCTION public.set_step5_reminder_activation(), public.enqueue_payment_confirmation(),
  public.enqueue_razorpay_autopay_recovery(TEXT, UUID, TEXT), public.supersede_autopay_recovery_on_payment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_razorpay_autopay_recovery(TEXT, UUID, TEXT) TO service_role;

COMMENT ON TABLE public.razorpay_autopay_failure_events IS
  'Verified canonical Razorpay retry/terminal events only. No historical backfill; later committed payment facts supersede pending recovery work.';
