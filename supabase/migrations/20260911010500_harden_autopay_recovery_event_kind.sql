-- Prevent a privileged caller from relabelling a canonical pending retry as a
-- terminal manual-fallback request (or the reverse).
CREATE OR REPLACE FUNCTION public.enqueue_razorpay_autopay_recovery(
  p_canonical_webhook_event_id TEXT, p_mandate_id UUID, p_event_kind TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mandate public.payment_mandates%ROWTYPE; v_settings public.renewal_reminder_settings%ROWTYPE;
  v_event public.webhook_events%ROWTYPE; v_invoice UUID; v_contact UUID; v_id UUID;
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
  SELECT line.invoice_id, period.contact_id INTO v_invoice, v_contact FROM public.membership_periods period JOIN public.memberships member ON member.id=period.membership_id JOIN public.invoice_lines line ON line.id=period.invoice_line_id WHERE period.membership_id=v_mandate.membership_id AND period.period_end=member.end_date AND period.state='open' ORDER BY period.created_at DESC, period.id DESC LIMIT 1;
  v_contact := COALESCE(v_contact, (SELECT contact_id FROM public.memberships WHERE id=v_mandate.membership_id));
  INSERT INTO public.razorpay_autopay_failure_events(account_id,mandate_id,canonical_webhook_event_id,event_kind,invoice_id,contact_id,observed_at) VALUES(v_mandate.account_id,v_mandate.id,v_event.id,p_event_kind,v_invoice,v_contact,v_event.created_at) ON CONFLICT(account_id,canonical_webhook_event_id) DO UPDATE SET canonical_webhook_event_id=EXCLUDED.canonical_webhook_event_id RETURNING id INTO v_id;
  INSERT INTO public.lifecycle_reminder_jobs(account_id,contact_id,invoice_id,autopay_failure_event_id,kind,subject_cycle_id,milestone_key,business_key,effective_due_on,coordination_on,activation_generation) VALUES(v_mandate.account_id,v_contact,v_invoice,v_id,'autopay_recovery',v_mandate.id::TEXT || ':' || v_event.id,p_event_kind,'autopay_recovery:' || v_mandate.id::TEXT || ':' || v_event.id || ':' || v_settings.autopay_recovery_generation::TEXT,(v_event.created_at AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=v_mandate.account_id),'UTC'))::DATE,(v_event.created_at AT TIME ZONE COALESCE((SELECT timezone FROM public.accounts WHERE id=v_mandate.account_id),'UTC'))::DATE,v_settings.autopay_recovery_generation) ON CONFLICT(account_id,business_key) DO NOTHING;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_razorpay_autopay_recovery(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_razorpay_autopay_recovery(TEXT, UUID, TEXT) TO service_role;
