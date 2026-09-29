-- Default-off Live webhook replay queue. Intake remains independent of new
-- order/refund switches so in-flight money is never discarded on rollback.
ALTER TABLE private.subscription_live_webhook_events
  DROP CONSTRAINT IF EXISTS subscription_live_webhook_events_state_check;
ALTER TABLE private.subscription_live_webhook_events
  ADD CONSTRAINT subscription_live_webhook_events_state_check
  CHECK(state IN ('held','reconciled'));
ALTER TABLE private.subscription_live_webhook_events
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.subscription_list_live_held_events(
  p_provider_merchant_id TEXT,p_pilot_organization_id UUID,p_limit INTEGER,
  p_capture_enabled BOOLEAN,p_refund_enabled BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR NOT v_settings.webhook_intake_enabled
    OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id
    OR p_limit IS NULL OR p_limit<1 OR p_limit>20
    OR NOT COALESCE(p_capture_enabled OR p_refund_enabled,FALSE) THEN
    RAISE EXCEPTION 'Live reconciliation is disabled or unbound' USING ERRCODE='55000'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.received_at,e.event_id)
    FROM (SELECT event_id,organization_id,request_id,event_type,
      provider_order_id,provider_payment_id,provider_refund_id,body_sha256,
      provider_event_at,received_at
      FROM private.subscription_live_webhook_events
      WHERE merchant_id=p_provider_merchant_id
        AND organization_id=p_pilot_organization_id AND state='held'
        AND ((p_capture_enabled AND v_settings.settlements_enabled
          AND event_type='payment.captured' AND provider_event_at IS NOT NULL)
          OR (p_refund_enabled AND event_type LIKE 'refund.%'))
      ORDER BY received_at,event_id LIMIT p_limit) e),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_list_live_held_events(TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_list_live_held_events(TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_list_live_held_events(TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_mark_live_event_reconciled(
  p_provider_merchant_id TEXT,p_pilot_organization_id UUID,
  p_event_id TEXT,p_body_sha256 TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event private.subscription_live_webhook_events;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_event FROM private.subscription_live_webhook_events
    WHERE merchant_id=p_provider_merchant_id AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.organization_id<>p_pilot_organization_id
    OR v_event.body_sha256<>p_body_sha256 THEN
    RAISE EXCEPTION 'Live event identity changed' USING ERRCODE='22023'; END IF;
  IF v_event.state='reconciled' THEN
    RETURN jsonb_build_object('state','reconciled','event_id',p_event_id); END IF;
  IF v_event.event_type='payment.captured' THEN
    IF NOT EXISTS(SELECT 1 FROM private.subscription_live_payments p
      WHERE p.request_id=v_event.request_id
        AND p.organization_id=v_event.organization_id
        AND p.merchant_id=v_event.merchant_id
        AND p.provider_order_id=v_event.provider_order_id
        AND p.provider_payment_id=v_event.provider_payment_id
        AND p.state IN ('verified','review_required')) THEN
      RAISE EXCEPTION 'Captured Live payment is not durable' USING ERRCODE='55000'; END IF;
  ELSIF v_event.event_type LIKE 'refund.%' THEN
    IF NOT EXISTS(SELECT 1 FROM private.subscription_live_refunds r
      WHERE r.organization_id=v_event.organization_id
        AND r.merchant_id=v_event.merchant_id
        AND r.provider_payment_id=v_event.provider_payment_id
        AND r.provider_refund_id=v_event.provider_refund_id
        AND r.state IN ('pending','failed','processed','review_required')) THEN
      RAISE EXCEPTION 'Observed Live refund is not durable' USING ERRCODE='55000'; END IF;
  ELSIF v_event.event_type='payment.failed' THEN
    -- No Live initial-term grace or access change follows a failed payment.
    -- Its signed delivery remains in the audit row and is complete here.
    NULL;
  ELSE
    RAISE EXCEPTION 'Live event is not reconciled by this worker' USING ERRCODE='22023';
  END IF;
  UPDATE private.subscription_live_webhook_events
    SET state='reconciled',reconciled_at=now()
    WHERE merchant_id=p_provider_merchant_id AND event_id=p_event_id;
  RETURN jsonb_build_object('state','reconciled','event_id',p_event_id);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_mark_live_event_reconciled(TEXT,UUID,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_mark_live_event_reconciled(TEXT,UUID,TEXT,TEXT)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_mark_live_event_reconciled(TEXT,UUID,TEXT,TEXT)
  TO service_role;
