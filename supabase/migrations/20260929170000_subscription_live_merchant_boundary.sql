-- DRAFT, DEFAULT OFF. Do not apply to Production until the Test baseline,
-- payable offer, Live settlement transaction and rollout are accepted.
-- These records cannot grant access, create a provider order or issue a refund.
-- Live SaaS evidence is separate from gym collections and Test subscription RPCs.

CREATE TABLE IF NOT EXISTS private.subscription_live_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK (provider_mode='live'),
  merchant_id TEXT CHECK (merchant_id IS NULL OR merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  pilot_organization_id UUID REFERENCES public.organizations(id),
  webhook_intake_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  orders_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT orders_enabled),
  refunds_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT refunds_enabled),
  CHECK (NOT (webhook_intake_enabled OR orders_enabled OR refunds_enabled)
    OR (merchant_id IS NOT NULL AND pilot_organization_id IS NOT NULL))
);
INSERT INTO private.subscription_live_settings(singleton)
VALUES(TRUE) ON CONFLICT DO NOTHING;

-- A future quote writer must freeze the owner-reviewed amount and expiry before
-- any order claim. There is intentionally no payable quote/order RPC in this draft.
CREATE TABLE IF NOT EXISTS private.subscription_live_quotes (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  billing_account_id UUID NOT NULL REFERENCES public.accounts(id),
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK (provider_mode='live'),
  merchant_id TEXT NOT NULL CHECK (merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  tier TEXT NOT NULL CHECK (tier IN ('starter','growth','ultimate')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor>0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  term_policy TEXT NOT NULL CHECK(term_policy='calendar_month_from_capture_event'),
  offer_reference TEXT NOT NULL CHECK(length(btrim(offer_reference))>0),
  tax_decision_reference TEXT NOT NULL CHECK(length(btrim(tax_decision_reference))>0),
  expires_at TIMESTAMPTZ NOT NULL,
  owner_reviewed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(request_id,organization_id,merchant_id),
  CHECK(expires_at>owner_reviewed_at)
);
CREATE TABLE IF NOT EXISTS private.subscription_live_orders (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK (provider_mode='live'),
  merchant_id TEXT NOT NULL,
  provider_order_id TEXT UNIQUE CHECK(provider_order_id IS NULL OR provider_order_id ~ '^order_[A-Za-z0-9]+$'),
  state TEXT NOT NULL DEFAULT 'claimed' CHECK(state IN ('claimed','bound','review_required')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bound_at TIMESTAMPTZ,
  FOREIGN KEY(request_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_quotes(request_id,organization_id,merchant_id),
  UNIQUE(request_id,organization_id,merchant_id),
  UNIQUE(provider_order_id,organization_id,merchant_id),
  CHECK ((state='claimed' AND provider_order_id IS NULL AND bound_at IS NULL)
    OR (state IN ('bound','review_required') AND provider_order_id IS NOT NULL AND bound_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS private.subscription_live_payments (
  provider_payment_id TEXT PRIMARY KEY CHECK(provider_payment_id ~ '^pay_[A-Za-z0-9]+$'),
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  merchant_id TEXT NOT NULL,
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK(provider_mode='live'),
  provider_order_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  state TEXT NOT NULL DEFAULT 'review_required' CHECK(state='review_required'),
  capture_event_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(request_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_orders(request_id,organization_id,merchant_id),
  FOREIGN KEY(provider_order_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_orders(provider_order_id,organization_id,merchant_id),
  UNIQUE(provider_payment_id,organization_id,merchant_id)
);
CREATE TABLE IF NOT EXISTS private.subscription_live_refunds (
  refund_request_id UUID PRIMARY KEY,
  provider_payment_id TEXT NOT NULL,
  provider_refund_id TEXT UNIQUE CHECK(provider_refund_id IS NULL OR provider_refund_id ~ '^rfnd_[A-Za-z0-9]+$'),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK(provider_mode='live'),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  state TEXT NOT NULL DEFAULT 'review_required' CHECK(state='review_required'),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(provider_payment_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_payments(provider_payment_id,organization_id,merchant_id)
);

-- Webhook delivery identity is saved before any later reconciliation. The
-- payload digest makes event-ID reuse with different contents a hard error.
CREATE TABLE IF NOT EXISTS private.subscription_live_webhook_events (
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 128),
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK(provider_mode='live'),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  request_id UUID NOT NULL REFERENCES private.subscription_live_orders(request_id),
  event_type TEXT NOT NULL CHECK(event_type IN ('payment.captured','payment.failed','refund.created','refund.processed','refund.failed')),
  provider_order_id TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  provider_refund_id TEXT,
  body_sha256 TEXT NOT NULL CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
  provider_event_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'held' CHECK(state='held'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(merchant_id,event_id),
  FOREIGN KEY(provider_order_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_orders(provider_order_id,organization_id,merchant_id),
  CHECK ((event_type LIKE 'refund.%' AND provider_refund_id ~ '^rfnd_[A-Za-z0-9]+$')
    OR (event_type LIKE 'payment.%' AND provider_refund_id IS NULL)),
  CHECK(provider_payment_id ~ '^pay_[A-Za-z0-9]+$')
);
CREATE INDEX IF NOT EXISTS subscription_live_webhook_events_held
  ON private.subscription_live_webhook_events(received_at)
  WHERE state='held';

CREATE OR REPLACE FUNCTION private.subscription_pin_live_merchant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.pilot_organization_id IS DISTINCT FROM OLD.pilot_organization_id)
    AND EXISTS(SELECT 1 FROM private.subscription_live_quotes) THEN
    RAISE EXCEPTION 'Live merchant and pilot are pinned after the first quote'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_pin_live_merchant
  ON private.subscription_live_settings;
CREATE TRIGGER subscription_pin_live_merchant BEFORE UPDATE
  ON private.subscription_live_settings FOR EACH ROW
  EXECUTE FUNCTION private.subscription_pin_live_merchant();
REVOKE ALL ON FUNCTION private.subscription_pin_live_merchant()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_pin_live_merchant() OWNER TO postgres;

ALTER TABLE private.subscription_live_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_live_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_live_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_live_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_live_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_live_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_settings,
  private.subscription_live_quotes,
  private.subscription_live_orders,
  private.subscription_live_payments,
  private.subscription_live_refunds,
  private.subscription_live_webhook_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.subscription_live_settings,
  private.subscription_live_quotes,
  private.subscription_live_orders,
  private.subscription_live_payments,
  private.subscription_live_refunds,
  private.subscription_live_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_record_live_webhook_event(
  p_merchant_id TEXT,p_pilot_organization_id UUID,p_event_id TEXT,
  p_event_type TEXT,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_refund_id TEXT,p_body_sha256 TEXT,p_provider_event_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_order private.subscription_live_orders;
  v_existing private.subscription_live_webhook_events;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton FOR UPDATE;
  IF NOT FOUND OR NOT v_settings.webhook_intake_enabled
    OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live webhook intake is disabled or unbound' USING ERRCODE='55000'; END IF;
  IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_event_type NOT IN ('payment.captured','payment.failed','refund.created','refund.processed','refund.failed')
    OR p_provider_order_id IS NULL OR p_provider_order_id !~ '^order_[A-Za-z0-9]+$'
    OR p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^pay_[A-Za-z0-9]+$'
    OR p_body_sha256 IS NULL OR p_body_sha256 !~ '^[0-9a-f]{64}$'
    OR (p_provider_event_at IS NOT NULL AND
      (NOT isfinite(p_provider_event_at) OR p_provider_event_at>now()+interval '5 minutes'))
    OR (p_event_type LIKE 'refund.%' AND (p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$'))
    OR (p_event_type LIKE 'payment.%' AND p_provider_refund_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid Live webhook identity' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_order FROM private.subscription_live_orders
    WHERE provider_order_id=p_provider_order_id AND merchant_id=p_merchant_id
      AND organization_id=p_pilot_organization_id AND state IN ('bound','review_required');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Live webhook has no bound pilot order' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_existing FROM private.subscription_live_webhook_events
    WHERE merchant_id=p_merchant_id AND event_id=p_event_id;
  IF FOUND THEN
    IF v_existing.body_sha256<>p_body_sha256 OR v_existing.request_id<>v_order.request_id
      OR v_existing.event_type<>p_event_type OR v_existing.provider_payment_id<>p_provider_payment_id
      OR v_existing.provider_refund_id IS DISTINCT FROM p_provider_refund_id
      OR v_existing.provider_event_at IS DISTINCT FROM p_provider_event_at THEN
      RAISE EXCEPTION 'Live webhook event identity changed' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('status','duplicate','request_id',v_existing.request_id);
  END IF;
  INSERT INTO private.subscription_live_webhook_events
    (merchant_id,event_id,organization_id,request_id,event_type,
     provider_order_id,provider_payment_id,provider_refund_id,body_sha256,provider_event_at)
  VALUES(p_merchant_id,p_event_id,v_order.organization_id,v_order.request_id,p_event_type,
    p_provider_order_id,p_provider_payment_id,p_provider_refund_id,p_body_sha256,p_provider_event_at);
  RETURN jsonb_build_object('status','held','request_id',v_order.request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_record_live_webhook_event(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_record_live_webhook_event(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_record_live_webhook_event(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ)
  TO service_role;
