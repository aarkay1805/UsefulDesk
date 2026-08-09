-- A creating row with an expired lease has not necessarily reached Razorpay.
-- Claim it without changing provider state; the worker first searches by the
-- immutable receipt, then either reuses stored bytes or safely stores the
-- never-sent canonical body before the first provider call.
CREATE OR REPLACE FUNCTION public.claim_gateway_refund_recovery_batch(
  p_provider_mode TEXT,p_recovery_owner UUID,p_limit INTEGER DEFAULT 100,p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.payment_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_provider_mode NOT IN ('test','live') OR p_recovery_owner IS NULL OR p_limit<1 OR p_limit>100
     OR p_lease_seconds<30 OR p_lease_seconds>300 THEN RAISE EXCEPTION 'Invalid refund recovery claim'; END IF;
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  RETURN QUERY
  WITH candidates AS (
    SELECT refund.id FROM public.payment_refunds refund
    JOIN public.account_payment_credentials credential ON credential.account_id=refund.account_id
      AND credential.gateway='razorpay' AND credential.authentication_mode='oauth'
      AND credential.provider_mode=p_provider_mode AND credential.connection_status='ready'
    WHERE refund.status IN ('creating','pending','orphaned') AND refund.next_reconcile_at<=now()
      AND (refund.outbound_lease_until IS NULL OR refund.outbound_lease_until<now())
    ORDER BY refund.next_reconcile_at,refund.created_at LIMIT p_limit FOR UPDATE OF refund SKIP LOCKED
  )
  UPDATE public.payment_refunds refund SET outbound_owner=p_recovery_owner,
    outbound_lease_until=now()+make_interval(secs=>p_lease_seconds),
    reconcile_attempt_count=refund.reconcile_attempt_count+1,updated_at=now()
  FROM candidates WHERE refund.id=candidates.id RETURNING refund.*;
END; $$;

CREATE OR REPLACE FUNCTION public.store_gateway_refund_request(
  p_account_id UUID,p_refund_id UUID,p_outbound_owner UUID,p_provider_idempotency_key TEXT,
  p_canonical_body TEXT,p_body_sha256 TEXT
)
RETURNS public.payment_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE;
BEGIN
  IF p_body_sha256 !~ '^[0-9a-f]{64}$' OR encode(extensions.digest(p_canonical_body,'sha256'),'hex')<>p_body_sha256
     OR p_provider_idempotency_key !~ '^[A-Za-z0-9_-]{10,}$' THEN RAISE EXCEPTION 'Invalid canonical refund request'; END IF;
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  UPDATE public.payment_refunds SET provider_idempotency_key=p_provider_idempotency_key,
    canonical_request_body=p_canonical_body,canonical_request_sha256=p_body_sha256,updated_at=now()
  WHERE id=p_refund_id AND account_id=p_account_id AND status IN ('creating','orphaned')
    AND outbound_owner=p_outbound_owner AND outbound_lease_until>now()
    AND (canonical_request_body IS NULL OR (canonical_request_body=p_canonical_body AND canonical_request_sha256=p_body_sha256))
  RETURNING * INTO v_refund;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request lease is unavailable'; END IF;
  RETURN v_refund;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_gateway_refund_request(
  p_account_id UUID,p_refund_id UUID,p_outbound_owner UUID,p_error TEXT
)
RETURNS public.payment_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE;
BEGIN
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  UPDATE public.payment_refunds SET status='failed',provider_status='failed',provider_error=left(p_error,500),
    failed_at=COALESCE(failed_at,now()),outbound_owner=NULL,outbound_lease_until=NULL,updated_at=now()
  WHERE id=p_refund_id AND account_id=p_account_id AND status IN ('creating','pending','orphaned')
    AND outbound_owner=p_outbound_owner AND outbound_lease_until>now()
  RETURNING * INTO v_refund;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request lease is unavailable'; END IF;
  RETURN v_refund;
END; $$;

CREATE OR REPLACE FUNCTION public.record_gateway_refund_exception(
  p_account_id UUID,p_payment_id UUID,p_gateway_refund_id TEXT,p_reason_code TEXT,
  p_reason_message TEXT,p_provider_facts JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_payment public.payments%ROWTYPE; v_exception_id UUID;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id=p_payment_id AND account_id=p_account_id;
  IF NOT FOUND OR v_payment.invoice_id IS NULL OR v_payment.gateway_payment_id IS NULL
     OR NULLIF(btrim(p_gateway_refund_id),'') IS NULL OR NULLIF(btrim(p_reason_code),'') IS NULL
     OR NULLIF(btrim(p_reason_message),'') IS NULL THEN RAISE EXCEPTION 'Invalid refund exception'; END IF;
  INSERT INTO public.gateway_refund_exceptions(account_id,payment_id,invoice_id,gateway_payment_id,gateway_refund_id,
    reason_code,reason_message,provider_facts)
  VALUES(p_account_id,v_payment.id,v_payment.invoice_id,v_payment.gateway_payment_id,p_gateway_refund_id,
    btrim(p_reason_code),left(btrim(p_reason_message),500),COALESCE(p_provider_facts,'{}'::JSONB))
  ON CONFLICT(account_id,gateway_refund_id) DO UPDATE SET last_seen_at=now(),
    attempt_count=public.gateway_refund_exceptions.attempt_count+1,
    reason_code=EXCLUDED.reason_code,reason_message=EXCLUDED.reason_message,provider_facts=EXCLUDED.provider_facts
  RETURNING id INTO v_exception_id;
  RETURN v_exception_id;
END; $$;

REVOKE ALL ON FUNCTION public.fail_gateway_refund_request(UUID,UUID,UUID,TEXT),
 public.record_gateway_refund_exception(UUID,UUID,TEXT,TEXT,TEXT,JSONB)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_gateway_refund_request(UUID,UUID,UUID,TEXT),
 public.record_gateway_refund_exception(UUID,UUID,TEXT,TEXT,TEXT,JSONB)
 TO service_role;
