-- A renewal confirmation needs the exact durable renewal operation, not merely
-- a similarly dated period. AutoPay terminal recovery likewise requires the
-- cycle end carried by the verified provider event; without it, staff review
-- is safer than attributing old debt to a new failed collection.
CREATE OR REPLACE FUNCTION public.enqueue_payment_confirmation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings public.renewal_reminder_settings%ROWTYPE; v_period_end DATE; v_is_renewal BOOLEAN := FALSE;
BEGIN
  IF NEW.status <> 'paid' OR NEW.contact_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_settings FROM public.renewal_reminder_settings WHERE account_id = NEW.account_id;
  IF NOT FOUND OR NOT v_settings.payment_confirmations_enabled
     OR v_settings.payment_confirmations_activated_at IS NULL
     OR NEW.created_at < v_settings.payment_confirmations_activated_at THEN RETURN NEW; END IF;
  IF NEW.membership_id IS NOT NULL AND NEW.period_end IS NOT NULL
     AND NEW.payment_purpose = 'renewal' AND NEW.idempotency_key IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.enqueue_razorpay_autopay_recovery(
  p_canonical_webhook_event_id TEXT, p_mandate_id UUID, p_event_kind TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mandate public.payment_mandates%ROWTYPE; v_settings public.renewal_reminder_settings%ROWTYPE;
  v_event public.webhook_events%ROWTYPE; v_invoice UUID; v_contact UUID; v_id UUID; v_cycle_end DATE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' OR p_event_kind NOT IN ('retry_pending','terminal') THEN RAISE EXCEPTION 'service role and valid recovery event required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_event FROM public.webhook_events WHERE id=p_canonical_webhook_event_id AND gateway='razorpay' AND processing_status='processing' FOR SHARE;
  SELECT * INTO v_mandate FROM public.payment_mandates WHERE id=p_mandate_id FOR SHARE;
  IF NOT FOUND OR v_event.id IS NULL OR v_event.account_id IS DISTINCT FROM v_mandate.account_id
     OR v_event.type NOT IN ('subscription.pending','subscription.halted')
     OR (p_event_kind = 'retry_pending' AND v_event.type <> 'subscription.pending')
     OR (p_event_kind = 'terminal' AND v_event.type <> 'subscription.halted')
     OR v_event.payload #>> '{payload,subscription,entity,id}' IS DISTINCT FROM v_mandate.gateway_subscription_id THEN
    RAISE EXCEPTION 'verified Razorpay event and mandate binding required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_settings FROM public.renewal_reminder_settings WHERE account_id=v_mandate.account_id;
  IF NOT FOUND OR NOT v_settings.autopay_recovery_enabled OR v_settings.autopay_recovery_activated_at IS NULL OR v_event.created_at < v_settings.autopay_recovery_activated_at THEN RETURN NULL; END IF;
  IF COALESCE(v_event.payload #>> '{payload,subscription,entity,current_end}', '') ~ '^[0-9]+$' THEN
    v_cycle_end := (to_timestamp((v_event.payload #>> '{payload,subscription,entity,current_end}')::DOUBLE PRECISION) AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=v_mandate.account_id),'UTC'))::DATE;
  END IF;
  IF v_cycle_end IS NOT NULL THEN
    SELECT line.invoice_id, period.contact_id INTO v_invoice, v_contact
    FROM public.membership_periods period
    JOIN public.invoice_lines line ON line.id=period.invoice_line_id
    WHERE period.membership_id=v_mandate.membership_id AND period.period_end=v_cycle_end AND period.state='open'
    ORDER BY period.created_at DESC, period.id DESC LIMIT 1;
  END IF;
  v_contact := COALESCE(v_contact, (SELECT contact_id FROM public.memberships WHERE id=v_mandate.membership_id));
  INSERT INTO public.razorpay_autopay_failure_events(account_id,mandate_id,canonical_webhook_event_id,event_kind,invoice_id,contact_id,observed_at) VALUES(v_mandate.account_id,v_mandate.id,v_event.id,p_event_kind,v_invoice,v_contact,v_event.created_at) ON CONFLICT(account_id,canonical_webhook_event_id) DO UPDATE SET canonical_webhook_event_id=EXCLUDED.canonical_webhook_event_id RETURNING id INTO v_id;
  INSERT INTO public.lifecycle_reminder_jobs(account_id,contact_id,invoice_id,autopay_failure_event_id,kind,subject_cycle_id,milestone_key,business_key,effective_due_on,coordination_on,activation_generation) VALUES(v_mandate.account_id,v_contact,v_invoice,v_id,'autopay_recovery',v_mandate.id::TEXT || ':' || v_event.id,p_event_kind,'autopay_recovery:' || v_mandate.id::TEXT || ':' || v_event.id || ':' || v_settings.autopay_recovery_generation::TEXT,(v_event.created_at AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=v_mandate.account_id),'UTC'))::DATE,(v_event.created_at AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=v_mandate.account_id),'UTC'))::DATE,v_settings.autopay_recovery_generation) ON CONFLICT(account_id,business_key) DO NOTHING;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_payment_confirmation(), public.enqueue_razorpay_autopay_recovery(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_razorpay_autopay_recovery(TEXT, UUID, TEXT) TO service_role;
