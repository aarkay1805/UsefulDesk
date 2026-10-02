-- Observability only. No flags, payment, refund, access or provider writes.
-- The route opts in only after installation using its separate runtime flag.
CREATE TABLE IF NOT EXISTS private.subscription_live_delivery_receipts (
  delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL CHECK (merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  listener_organization_id UUID NOT NULL REFERENCES public.organizations(id),
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK (provider_mode='live'),
  event_id TEXT NOT NULL CHECK (event_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  event_id_source TEXT NOT NULL CHECK (event_id_source IN ('provider','body_digest')),
  event_type TEXT NOT NULL CHECK (event_type IN
    ('payment.captured','payment.failed','refund.created','refund.processed','refund.failed')),
  provider_order_id TEXT CHECK (provider_order_id IS NULL OR provider_order_id ~ '^order_[A-Za-z0-9]+$'),
  provider_payment_id TEXT NOT NULL CHECK (provider_payment_id ~ '^pay_[A-Za-z0-9]+$'),
  provider_refund_id TEXT,
  body_sha256 TEXT NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  provider_event_at TIMESTAMPTZ,
  classification TEXT NOT NULL CHECK (classification IN
    ('saas','unrelated_order','unrelated_no_order')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((event_id_source='provider') OR event_id=body_sha256),
  CHECK ((classification='unrelated_no_order' AND provider_order_id IS NULL)
    OR (classification IN ('saas','unrelated_order') AND provider_order_id IS NOT NULL)),
  CHECK ((event_type LIKE 'refund.%' AND provider_refund_id IS NOT NULL
    AND provider_refund_id ~ '^rfnd_[A-Za-z0-9]+$')
    OR (event_type LIKE 'payment.%' AND provider_refund_id IS NULL))
);
CREATE INDEX IF NOT EXISTS subscription_live_delivery_receipts_event
  ON private.subscription_live_delivery_receipts(merchant_id,event_id,event_id_source,recorded_at);
ALTER TABLE private.subscription_live_delivery_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_delivery_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_live_delivery_receipts TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_freeze_live_delivery_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'Live delivery receipts are append-only' USING ERRCODE='55000';
END;
$$;
DROP TRIGGER IF EXISTS subscription_freeze_live_delivery_receipt
  ON private.subscription_live_delivery_receipts;
CREATE TRIGGER subscription_freeze_live_delivery_receipt BEFORE UPDATE OR DELETE
  ON private.subscription_live_delivery_receipts FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_delivery_receipt();
REVOKE ALL ON FUNCTION private.subscription_freeze_live_delivery_receipt()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_freeze_live_delivery_receipt() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.subscription_record_live_delivery_receipt(
  p_merchant_id TEXT,p_pilot_organization_id UUID,p_event_id TEXT,p_event_id_source TEXT,
  p_event_type TEXT,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_refund_id TEXT,p_body_sha256 TEXT,p_provider_event_at TIMESTAMPTZ,
  p_classification TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_event private.subscription_live_webhook_events;
  v_delivery_id UUID;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  -- Serialize conflicting event identities and recheck the current listener.
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton FOR UPDATE;
  IF NOT FOUND OR NOT v_settings.webhook_intake_enabled OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live webhook intake is disabled or unbound' USING ERRCODE='55000'; END IF;
  IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_event_id_source IS NULL OR p_event_id_source NOT IN ('provider','body_digest')
    OR p_event_type IS NULL OR p_event_type NOT IN
      ('payment.captured','payment.failed','refund.created','refund.processed','refund.failed')
    OR p_classification IS NULL OR p_classification NOT IN ('saas','unrelated_order','unrelated_no_order')
    OR p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^pay_[A-Za-z0-9]+$'
    OR p_body_sha256 IS NULL OR p_body_sha256 !~ '^[0-9a-f]{64}$'
    OR (p_event_id_source='body_digest' AND p_event_id<>p_body_sha256)
    OR (p_classification='unrelated_no_order' AND p_provider_order_id IS NOT NULL)
    OR (p_classification<>'unrelated_no_order' AND
      (p_provider_order_id IS NULL OR p_provider_order_id !~ '^order_[A-Za-z0-9]+$'))
    OR (p_event_type LIKE 'refund.%' AND
      (p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$'))
    OR (p_event_type LIKE 'payment.%' AND p_provider_refund_id IS NOT NULL)
    OR (p_provider_event_at IS NOT NULL AND
      (NOT isfinite(p_provider_event_at) OR p_provider_event_at<='2020-01-01'::timestamptz
        OR p_provider_event_at>clock_timestamp()+interval '5 minutes')) THEN
    RAISE EXCEPTION 'Invalid Live delivery identity' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_event FROM private.subscription_live_webhook_events
    WHERE merchant_id=p_merchant_id AND event_id=p_event_id;
  IF p_classification='saas' THEN
    IF v_event.event_id IS NULL OR v_event.organization_id<>p_pilot_organization_id
      OR v_event.event_type<>p_event_type OR v_event.provider_order_id<>p_provider_order_id
      OR v_event.provider_payment_id<>p_provider_payment_id
      OR v_event.provider_refund_id IS DISTINCT FROM p_provider_refund_id
      OR v_event.body_sha256<>p_body_sha256
      OR v_event.provider_event_at IS DISTINCT FROM p_provider_event_at THEN
      RAISE EXCEPTION 'SaaS delivery requires matching durable intake' USING ERRCODE='22023'; END IF;
  ELSIF v_event.event_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM private.subscription_live_orders
      WHERE merchant_id=p_merchant_id AND provider_order_id=p_provider_order_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_webhook_events
      WHERE merchant_id=p_merchant_id AND provider_payment_id=p_provider_payment_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments
      WHERE merchant_id=p_merchant_id AND provider_payment_id=p_provider_payment_id) THEN
    RAISE EXCEPTION 'Known SaaS work cannot be recorded as unrelated' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_delivery_receipts d
    WHERE d.merchant_id=p_merchant_id AND d.event_id=p_event_id AND d.event_id_source=p_event_id_source
      AND (d.listener_organization_id<>p_pilot_organization_id OR d.body_sha256<>p_body_sha256
        OR d.event_type<>p_event_type OR d.classification<>p_classification
        OR d.provider_order_id IS DISTINCT FROM p_provider_order_id
        OR d.provider_payment_id<>p_provider_payment_id
        OR d.provider_refund_id IS DISTINCT FROM p_provider_refund_id
        OR d.provider_event_at IS DISTINCT FROM p_provider_event_at)) THEN
    RAISE EXCEPTION 'Live delivery event identity changed' USING ERRCODE='23505'; END IF;

  INSERT INTO private.subscription_live_delivery_receipts
    (merchant_id,listener_organization_id,event_id,event_id_source,event_type,
     provider_order_id,provider_payment_id,provider_refund_id,body_sha256,
     provider_event_at,classification)
  VALUES(p_merchant_id,p_pilot_organization_id,p_event_id,p_event_id_source,p_event_type,
    p_provider_order_id,p_provider_payment_id,p_provider_refund_id,p_body_sha256,
    p_provider_event_at,p_classification) RETURNING delivery_id INTO v_delivery_id;
  RETURN jsonb_build_object('status','recorded','delivery_id',v_delivery_id);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_record_live_delivery_receipt(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.subscription_record_live_delivery_receipt(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_record_live_delivery_receipt(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT)
  TO service_role;
