-- DRAFT, DEFAULT OFF. No route initiates a Live refund. The database switch
-- in the preceding migration is hard-closed until a separately reviewed
-- rollout migration, refund policy and provider acceptance exist.

CREATE TABLE IF NOT EXISTS private.subscription_live_refund_reviews (
  refund_request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  provider_payment_id TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK(provider_mode='live'),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  approved_policy_reference TEXT NOT NULL CHECK(length(btrim(approved_policy_reference))>0),
  owner_reviewed_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(provider_payment_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_payments(provider_payment_id,organization_id,merchant_id)
);
ALTER TABLE private.subscription_live_refund_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_refund_reviews FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.subscription_live_refund_reviews TO service_role;

ALTER TABLE private.subscription_live_refunds
  DROP CONSTRAINT IF EXISTS subscription_live_refunds_state_check;
ALTER TABLE private.subscription_live_refunds
  ADD CONSTRAINT subscription_live_refunds_state_check
  CHECK(state IN ('claimed','pending','failed','processed','review_required'));
ALTER TABLE private.subscription_live_refunds
  ADD COLUMN IF NOT EXISTS provider_requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.subscription_live_refunds'::regclass
      AND conname='subscription_live_refunds_review_fkey') THEN
    ALTER TABLE private.subscription_live_refunds
      ADD CONSTRAINT subscription_live_refunds_review_fkey
      FOREIGN KEY(refund_request_id)
      REFERENCES private.subscription_live_refund_reviews(refund_request_id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_live_one_refund_per_payment
  ON private.subscription_live_refunds(provider_payment_id);

CREATE OR REPLACE FUNCTION public.subscription_claim_live_refund(
  p_refund_request_id UUID,p_organization_id UUID,p_actor_user_id UUID,
  p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_review private.subscription_live_refund_reviews;
  v_refund private.subscription_live_refunds;
  v_payment private.subscription_live_payments;
  v_grant private.subscription_live_grants;
  v_action TEXT;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Live refund merchant is unbound' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships
    WHERE organization_id=p_organization_id AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_review FROM private.subscription_live_refund_reviews
    WHERE refund_request_id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_review.organization_id<>p_organization_id
    OR v_review.requested_by<>p_actor_user_id
    OR v_review.merchant_id<>p_provider_merchant_id
    OR v_review.owner_reviewed_at>now() THEN
    RAISE EXCEPTION 'Reviewed full Live refund required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE provider_payment_id=v_review.provider_payment_id;
  SELECT * INTO v_grant FROM private.subscription_live_grants
    WHERE organization_id=p_organization_id;
  IF v_payment.provider_payment_id IS NULL OR v_grant.organization_id IS NULL
    OR v_payment.state<>'verified' OR v_payment.organization_id<>p_organization_id
    OR v_payment.merchant_id<>p_provider_merchant_id
    OR v_payment.amount_minor<>v_review.amount_minor
    OR v_payment.currency<>v_review.currency
    OR v_grant.provider_payment_id IS DISTINCT FROM v_payment.provider_payment_id
    OR v_grant.merchant_id<>p_provider_merchant_id THEN
    RAISE EXCEPTION 'Full original Live payment does not match' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id FOR UPDATE;
  IF FOUND THEN
    v_action:=CASE WHEN v_refund.confirmed_at IS NOT NULL THEN 'confirmed'
      WHEN v_refund.state='review_required' THEN 'review_required'
      WHEN v_refund.provider_refund_id IS NULL THEN 'recovery' ELSE 'bound' END;
  ELSE
    IF NOT v_settings.refunds_enabled THEN
      RAISE EXCEPTION 'New Live refunds are disabled' USING ERRCODE='55000'; END IF;
    IF v_grant.refund_confirmed_at IS NOT NULL OR v_grant.renewal_stopped_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM private.subscription_live_payments
        WHERE organization_id=p_organization_id
          AND provider_payment_id<>v_payment.provider_payment_id)
      OR EXISTS(SELECT 1 FROM private.organization_subscription_payments
        WHERE organization_id=p_organization_id) THEN
      RAISE EXCEPTION 'Later paid obligation needs refund review' USING ERRCODE='55000'; END IF;
    INSERT INTO private.subscription_live_refunds
      (refund_request_id,provider_payment_id,organization_id,merchant_id,
       amount_minor,currency,state)
    VALUES(p_refund_request_id,v_payment.provider_payment_id,p_organization_id,
      p_provider_merchant_id,v_payment.amount_minor,'INR','claimed')
    RETURNING * INTO v_refund;
    v_action:='create';
  END IF;
  RETURN jsonb_build_object('action',v_action,'refund_request_id',p_refund_request_id,
    'request_id',v_payment.request_id,
    'organization_id',p_organization_id,'provider_payment_id',v_payment.provider_payment_id,
    'provider_order_id',v_payment.provider_order_id,
    'provider_refund_id',v_refund.provider_refund_id,
    'amount_minor',v_payment.amount_minor,'currency','INR');
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_claim_live_refund(UUID,UUID,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_claim_live_refund(UUID,UUID,UUID,TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_claim_live_refund(UUID,UUID,UUID,TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_live_refund_for_payment(
  p_provider_payment_id TEXT,p_provider_refund_id TEXT,
  p_provider_merchant_id TEXT,p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund private.subscription_live_refunds;
  v_payment private.subscription_live_payments;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE provider_payment_id=p_provider_payment_id
      AND provider_refund_id=p_provider_refund_id
      AND merchant_id=p_provider_merchant_id
      AND organization_id=p_pilot_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bound Live refund missing' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE provider_payment_id=p_provider_payment_id
      AND organization_id=p_pilot_organization_id
      AND merchant_id=p_provider_merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original Live payment missing' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('refund_request_id',v_refund.refund_request_id,
    'request_id',v_payment.request_id,'organization_id',v_payment.organization_id,
    'provider_payment_id',v_payment.provider_payment_id,
    'provider_order_id',v_payment.provider_order_id,
    'provider_refund_id',v_refund.provider_refund_id,
    'amount_minor',v_refund.amount_minor,'currency',v_refund.currency,
    'state',v_refund.state,'confirmed_at',v_refund.confirmed_at,
    'review_reason',v_refund.review_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_live_refund_for_payment(TEXT,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_live_refund_for_payment(TEXT,TEXT,TEXT,UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_live_refund_for_payment(TEXT,TEXT,TEXT,UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_observe_live_refund(
  p_refund_request_id UUID,p_provider_payment_id TEXT,p_provider_refund_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT,p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund private.subscription_live_refunds;
  v_settings private.subscription_live_settings;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'Live refund merchant is unbound' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live refund claim missing' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_refund.organization_id FOR UPDATE;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id FOR UPDATE;
  IF v_refund.organization_id<>v_settings.pilot_organization_id
    OR v_refund.merchant_id<>p_provider_merchant_id
    OR v_refund.provider_payment_id<>p_provider_payment_id
    OR v_refund.amount_minor<>p_amount_minor OR v_refund.currency<>p_currency
    OR p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$'
    OR p_status NOT IN ('pending','failed','processed')
    OR (v_refund.provider_refund_id IS NOT NULL
      AND v_refund.provider_refund_id<>p_provider_refund_id) THEN
    RAISE EXCEPTION 'Live refund observation changed identity' USING ERRCODE='23505'; END IF;
  UPDATE private.subscription_live_refunds
      SET provider_refund_id=p_provider_refund_id,
      state=CASE WHEN state IN ('processed','review_required') THEN state ELSE p_status END
    WHERE refund_request_id=p_refund_request_id RETURNING * INTO v_refund;
  RETURN to_jsonb(v_refund);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_observe_live_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_observe_live_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_observe_live_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_commit_live_full_refund(
  p_refund_request_id UUID,p_provider_payment_id TEXT,p_provider_refund_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund private.subscription_live_refunds;
  v_payment private.subscription_live_payments;
  v_grant private.subscription_live_grants;
  v_access_before private.organization_product_access;
  v_access_after private.organization_product_access;
  v_settings private.subscription_live_settings;
  v_now TIMESTAMPTZ;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'Live refund merchant is unbound' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live refund claim missing' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_refund.organization_id FOR UPDATE;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id FOR UPDATE;
  IF v_refund.merchant_id<>p_provider_merchant_id
    OR v_refund.organization_id<>v_settings.pilot_organization_id
    OR v_refund.provider_payment_id<>p_provider_payment_id
    OR v_refund.provider_refund_id<>p_provider_refund_id
    OR v_refund.amount_minor<>p_amount_minor OR v_refund.currency<>p_currency THEN
    RAISE EXCEPTION 'Verified processed Live refund required' USING ERRCODE='22023'; END IF;
  IF v_refund.confirmed_at IS NOT NULL OR v_refund.review_reason IS NOT NULL THEN
    RETURN to_jsonb(v_refund); END IF;
  IF v_refund.state<>'processed' THEN
    RAISE EXCEPTION 'Verified processed Live refund required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE provider_payment_id=p_provider_payment_id;
  SELECT * INTO v_grant FROM private.subscription_live_grants
    WHERE organization_id=v_refund.organization_id FOR UPDATE;
  SELECT * INTO v_access_before FROM private.organization_product_access
    WHERE organization_id=v_refund.organization_id FOR UPDATE;
  IF v_payment.provider_payment_id IS NULL OR v_grant.organization_id IS NULL
    OR v_payment.state<>'verified' OR v_payment.merchant_id<>p_provider_merchant_id
    OR v_payment.amount_minor<>p_amount_minor OR v_payment.currency<>p_currency
    OR v_grant.provider_payment_id IS DISTINCT FROM p_provider_payment_id
    OR v_grant.merchant_id<>p_provider_merchant_id
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments
      WHERE organization_id=v_refund.organization_id
        AND provider_payment_id<>p_provider_payment_id)
    OR EXISTS(SELECT 1 FROM private.organization_subscription_payments
      WHERE organization_id=v_refund.organization_id)
    OR v_access_before.mode IS DISTINCT FROM 'manual'
    OR v_access_before.access_starts_at IS DISTINCT FROM v_grant.period_start
    OR v_access_before.access_ends_at IS DISTINCT FROM v_grant.paid_through_end THEN
    UPDATE private.subscription_live_refunds
      SET state='review_required',review_reason='later_payment_or_access_change'
      WHERE refund_request_id=p_refund_request_id RETURNING * INTO v_refund;
    RETURN to_jsonb(v_refund);
  END IF;
  v_now:=clock_timestamp();
  UPDATE private.subscription_live_grants
    SET refund_confirmed_at=v_now,renewal_stopped_at=v_now
    WHERE organization_id=v_refund.organization_id;
  UPDATE private.organization_product_access
    SET access_ends_at=LEAST(access_ends_at,v_now),version=version+1,
      updated_at=v_now WHERE organization_id=v_refund.organization_id
    RETURNING * INTO v_access_after;
  UPDATE private.subscription_live_refunds SET confirmed_at=v_now
    WHERE refund_request_id=p_refund_request_id RETURNING * INTO v_refund;
  INSERT INTO private.product_access_audit
    (organization_id,action,reason,before_state,after_state)
  VALUES(v_refund.organization_id,'subscription_full_refund',
    'Confirmed full Usefulmade Live first-payment refund',
    to_jsonb(v_access_before),to_jsonb(v_access_after));
  RETURN to_jsonb(v_refund);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_commit_live_full_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_commit_live_full_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_commit_live_full_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT)
  TO service_role;
