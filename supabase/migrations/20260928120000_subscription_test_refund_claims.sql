-- PRIVATE TEST DRAFT. Reserves an eligible request; never issues a provider
-- refund, ends access, or stops a provider recurring schedule.
ALTER TABLE private.organization_subscription_payments
  ADD COLUMN IF NOT EXISTS provider_created_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS private.subscription_first_refund_requests (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS private.subscription_first_refund_claims (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  provider_payment_id TEXT NOT NULL UNIQUE REFERENCES private.organization_subscription_payments(provider_payment_id),
  provider_merchant_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL CHECK(currency='INR'),
  billing_timezone TEXT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'requested' CHECK(state='requested')
);
ALTER TABLE private.subscription_first_refund_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_first_refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_first_refund_claims,private.subscription_first_refund_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.subscription_first_refund_claims,private.subscription_first_refund_requests TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_receive_test_refund_request(
  p_organization_id UUID,p_request_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT,p_received_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.subscription_first_refund_requests;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=p_organization_id
    AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants g
    JOIN private.organization_subscription_payments p ON p.provider_payment_id=g.first_provider_payment_id
    WHERE g.organization_id=p_organization_id AND p.provider_mode='test' AND p.provider_merchant_id=p_provider_merchant_id) THEN
    RAISE EXCEPTION 'Verified first Test payment required' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM private.subscription_first_refund_requests WHERE organization_id=p_organization_id;
  IF FOUND THEN RETURN to_jsonb(r); END IF;
  IF p_request_id IS NULL OR p_received_at IS NULL OR NOT isfinite(p_received_at)
    OR p_received_at>now()+interval '1 minute' OR p_received_at<now()-interval '5 minutes' THEN
    RAISE EXCEPTION 'Server receipt time required' USING ERRCODE='22023'; END IF;
  INSERT INTO private.subscription_first_refund_requests(organization_id,request_id,requested_by,requested_at)
    VALUES(p_organization_id,p_request_id,p_actor_user_id,p_received_at) RETURNING * INTO r;
  RETURN to_jsonb(r);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_test_first_payment(
  p_organization_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p private.organization_subscription_payments; c private.subscription_first_refund_claims;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=p_organization_id
    AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT x.* INTO p FROM private.organization_subscription_payments x
    JOIN private.organization_paid_subscription_grants g ON g.first_provider_payment_id=x.provider_payment_id
    WHERE g.organization_id=p_organization_id AND x.organization_id=p_organization_id
      AND x.provider_mode='test' AND x.provider_merchant_id=p_provider_merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified first Test payment required' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM private.subscription_first_refund_claims WHERE organization_id=p_organization_id;
  RETURN jsonb_build_object('payment',to_jsonb(p),'claim',CASE WHEN c.request_id IS NULL THEN NULL ELSE to_jsonb(c) END);
END;
$$;

-- Server records the request receipt instant before provider I/O. Browser
-- supplied times/amounts/timezones never enter this service-only transaction.
CREATE OR REPLACE FUNCTION public.subscription_reserve_test_first_refund(
  p_organization_id UUID,p_request_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT,
  p_provider_payment_id TEXT,p_paid_at TIMESTAMPTZ,p_requested_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p private.organization_subscription_payments; c private.subscription_first_refund_claims;
  v_intent_time TIMESTAMPTZ; r private.subscription_first_refund_requests;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=p_organization_id
    AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT x.* INTO p FROM private.organization_subscription_payments x
    JOIN private.organization_paid_subscription_grants g ON g.first_provider_payment_id=x.provider_payment_id
    WHERE g.organization_id=p_organization_id AND x.organization_id=p_organization_id
      AND x.provider_mode='test' AND x.provider_merchant_id=p_provider_merchant_id FOR UPDATE OF x;
  IF NOT FOUND OR p.provider_payment_id IS DISTINCT FROM p_provider_payment_id THEN
    RAISE EXCEPTION 'Verified first Test payment required' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM private.subscription_first_refund_claims WHERE organization_id=p_organization_id;
  IF FOUND THEN RETURN to_jsonb(c); END IF;
  SELECT * INTO r FROM private.subscription_first_refund_requests WHERE organization_id=p_organization_id;
  IF NOT FOUND OR r.request_id IS DISTINCT FROM p_request_id OR r.requested_at IS DISTINCT FROM p_requested_at THEN
    RAISE EXCEPTION 'Original refund receipt required' USING ERRCODE='22023'; END IF;
  SELECT requested_at INTO v_intent_time FROM private.organization_subscription_intents WHERE request_id=p.intent_id;
  IF p_request_id IS NULL OR p_paid_at IS NULL OR NOT isfinite(p_paid_at)
    OR p_requested_at IS NULL OR NOT isfinite(p_requested_at)
    OR p_paid_at<v_intent_time-interval '1 second' OR p_paid_at>p.verified_at
    OR p_requested_at<p_paid_at OR (p.provider_created_at IS NOT NULL AND p.provider_created_at<>p_paid_at)
    OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p.billing_timezone) THEN
    RAISE EXCEPTION 'Verified payment and server receipt times required' USING ERRCODE='22023'; END IF;
  IF (p_requested_at AT TIME ZONE p.billing_timezone)::DATE>(p_paid_at AT TIME ZONE p.billing_timezone)::DATE+7 THEN
    RAISE EXCEPTION 'First-payment refund request is outside day seven' USING ERRCODE='22023'; END IF;
  UPDATE private.organization_subscription_payments SET provider_created_at=p_paid_at
    WHERE provider_payment_id=p.provider_payment_id AND provider_created_at IS NULL;
  INSERT INTO private.subscription_first_refund_claims(organization_id,request_id,requested_by,provider_payment_id,
    provider_merchant_id,amount_minor,currency,billing_timezone,paid_at,requested_at)
  VALUES(p_organization_id,p_request_id,r.requested_by,p.provider_payment_id,p.provider_merchant_id,p.amount_minor,
    p.currency,p.billing_timezone,p_paid_at,p_requested_at) RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_test_first_payment(UUID,UUID,TEXT),
  public.subscription_receive_test_refund_request(UUID,UUID,UUID,TEXT,TIMESTAMPTZ),
  public.subscription_reserve_test_first_refund(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_test_first_payment(UUID,UUID,TEXT),
  public.subscription_receive_test_refund_request(UUID,UUID,UUID,TEXT,TIMESTAMPTZ),
  public.subscription_reserve_test_first_refund(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
ALTER FUNCTION public.subscription_test_first_payment(UUID,UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_receive_test_refund_request(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION public.subscription_reserve_test_first_refund(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) OWNER TO postgres;
