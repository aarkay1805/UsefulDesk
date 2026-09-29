-- DRAFT, DEFAULT OFF. Initial paid-term settlement only. This requires a
-- separately approved offer/tax reference on the quote, a signed Checkout or
-- webhook, and a fresh captured-payment GET before this service-only RPC.
-- No route invokes it yet. New Live orders and refunds remain hard-closed.

ALTER TABLE private.subscription_live_settings
  ADD COLUMN IF NOT EXISTS settlements_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE private.subscription_live_payments
  DROP CONSTRAINT IF EXISTS subscription_live_payments_state_check;
ALTER TABLE private.subscription_live_payments
  ADD CONSTRAINT subscription_live_payments_state_check
  CHECK(state IN ('verified','review_required'));

CREATE TABLE IF NOT EXISTS private.subscription_live_grants (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id),
  request_id UUID NOT NULL UNIQUE REFERENCES private.subscription_live_quotes(request_id),
  provider_payment_id TEXT NOT NULL UNIQUE
    REFERENCES private.subscription_live_payments(provider_payment_id),
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK(provider_mode='live'),
  tier TEXT NOT NULL CHECK(tier IN ('starter','growth','ultimate')),
  period_start TIMESTAMPTZ NOT NULL,
  paid_through_end TIMESTAMPTZ NOT NULL,
  refund_confirmed_at TIMESTAMPTZ,
  renewal_stopped_at TIMESTAMPTZ,
  CHECK(paid_through_end>period_start)
);
ALTER TABLE private.subscription_live_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_grants FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.subscription_live_grants TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_prevent_parallel_merchant_grants()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='subscription_live_grants' THEN
    IF EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants
      WHERE organization_id=NEW.organization_id) THEN
      RAISE EXCEPTION 'Organization already has a Test paid grant' USING ERRCODE='23505'; END IF;
  ELSIF EXISTS(SELECT 1 FROM private.subscription_live_grants
    WHERE organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'Organization already has a Live paid grant' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_prevent_live_grant_on_test
  ON private.organization_paid_subscription_grants;
CREATE TRIGGER subscription_prevent_live_grant_on_test BEFORE INSERT
  ON private.organization_paid_subscription_grants FOR EACH ROW
  EXECUTE FUNCTION private.subscription_prevent_parallel_merchant_grants();
DROP TRIGGER IF EXISTS subscription_prevent_test_grant_on_live
  ON private.subscription_live_grants;
CREATE TRIGGER subscription_prevent_test_grant_on_live BEFORE INSERT
  ON private.subscription_live_grants FOR EACH ROW
  EXECUTE FUNCTION private.subscription_prevent_parallel_merchant_grants();
REVOKE ALL ON FUNCTION private.subscription_prevent_parallel_merchant_grants()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_prevent_parallel_merchant_grants() OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.subscription_freeze_live_quote()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM private.subscription_live_orders
    WHERE request_id=OLD.request_id) THEN
    RAISE EXCEPTION 'Claimed Live quote is immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_freeze_live_quote ON private.subscription_live_quotes;
CREATE TRIGGER subscription_freeze_live_quote BEFORE UPDATE OR DELETE
  ON private.subscription_live_quotes FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_quote();
REVOKE ALL ON FUNCTION private.subscription_freeze_live_quote()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_freeze_live_quote() OWNER TO postgres;

-- Durable claim is saved before the single provider POST. Subsequent callers
-- must GET by exact receipt; an empty/ambiguous recovery never permits POST.
CREATE OR REPLACE FUNCTION public.subscription_claim_live_order(
  p_request_id UUID,p_organization_id UUID,p_actor_user_id UUID,
  p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_quote private.subscription_live_quotes;
  v_order private.subscription_live_orders;
  v_access private.organization_product_access;
  v_reminders private.subscription_billing_settings;
  v_active INTEGER; v_capacity INTEGER;
  v_action TEXT;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Live pilot merchant is unbound' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships
    WHERE organization_id=p_organization_id AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_quote FROM private.subscription_live_quotes
    WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_quote.organization_id<>p_organization_id
    OR v_quote.requested_by<>p_actor_user_id
    OR v_quote.provider_mode<>'live' OR v_quote.merchant_id<>p_provider_merchant_id THEN
    RAISE EXCEPTION 'Reviewed Live quote required' USING ERRCODE='22023'; END IF;
  IF v_quote.offer_approval_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM private.subscription_live_offer_approvals a
    WHERE a.approval_id=v_quote.offer_approval_id
      AND a.organization_id=v_quote.organization_id
      AND a.merchant_id=v_quote.merchant_id AND a.revoked_at IS NULL
      AND a.tier=v_quote.tier AND a.amount_minor=v_quote.amount_minor
      AND a.currency=v_quote.currency AND a.term_policy=v_quote.term_policy
      AND a.offer_reference=v_quote.offer_reference
      AND a.tax_decision_reference=v_quote.tax_decision_reference) THEN
    RAISE EXCEPTION 'Approved Live offer no longer matches quote'
      USING ERRCODE='55000'; END IF;
  -- A bound order is still payable. Apply the current switches and quote
  -- validity to every Checkout response, including retries.
  IF NOT v_settings.orders_enabled OR NOT v_settings.settlements_enabled
    OR NOT v_settings.webhook_intake_enabled OR now()>=v_quote.expires_at
    OR now()<v_quote.owner_reviewed_at THEN
    RAISE EXCEPTION 'Live Checkout is disabled or quote expired' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_access FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  IF v_access.organization_id IS NULL OR v_access.mode<>'trial'
    OR v_access.suspended_at IS NOT NULL OR v_access.trial_ends_at IS NULL
    OR now()<v_access.trial_ends_at THEN
    RAISE EXCEPTION 'Expired trial required before Live Checkout' USING ERRCODE='55000'; END IF;
  v_capacity:=private.subscription_base_included_branches(v_quote.tier);
  SELECT count(*) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  IF v_capacity IS NULL OR v_active<1 OR v_active>v_capacity
    OR EXISTS(SELECT 1 FROM public.accounts WHERE organization_id=p_organization_id
      AND branch_status='active' AND default_currency<>'INR')
    OR NOT EXISTS(SELECT 1 FROM public.accounts
      WHERE id=v_quote.billing_account_id AND organization_id=p_organization_id
        AND branch_status='active' AND default_currency='INR') THEN
    RAISE EXCEPTION 'Live Checkout branch roster changed' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants
      WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_grants
      WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments
      WHERE organization_id=p_organization_id) THEN
    RAISE EXCEPTION 'Existing paid obligation needs review' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_orders
    WHERE organization_id=p_organization_id AND request_id<>p_request_id) THEN
    RAISE EXCEPTION 'Another Live order needs review' USING ERRCODE='55000'; END IF;
  IF v_quote.tier='starter' THEN
    SELECT * INTO v_reminders FROM private.subscription_billing_settings WHERE singleton;
    IF NOT COALESCE(v_reminders.standard_reminder_policy_approved AND
      v_reminders.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND
      v_reminders.standard_reminder_hour_local=9 AND
      v_quote.starter_reminder_reset_accepted AND
      v_quote.starter_reminder_policy_version=v_reminders.standard_reminder_policy_version,FALSE) THEN
      RAISE EXCEPTION 'Starter reminders need owner review before Checkout'
        USING ERRCODE='55000'; END IF;
  END IF;
  SELECT * INTO v_order FROM private.subscription_live_orders
    WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    v_action:=CASE WHEN v_order.provider_order_id IS NULL THEN 'recovery'
      WHEN v_order.state='bound' THEN 'bound' ELSE 'review_required' END;
  ELSE
    INSERT INTO private.subscription_live_orders(request_id,organization_id,merchant_id)
    VALUES(p_request_id,p_organization_id,p_provider_merchant_id)
    RETURNING * INTO v_order;
    v_action:='create';
  END IF;
  RETURN jsonb_build_object('action',v_action,'request_id',p_request_id,
    'organization_id',p_organization_id,'provider_order_id',v_order.provider_order_id,
    'amount_minor',v_quote.amount_minor,'currency',v_quote.currency);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_claim_live_order(UUID,UUID,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_claim_live_order(UUID,UUID,UUID,TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_claim_live_order(UUID,UUID,UUID,TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_bind_live_order(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_merchant_id TEXT,
  p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_order private.subscription_live_orders;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id
    OR p_provider_order_id IS NULL OR p_provider_order_id !~ '^order_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Live order identity is unbound' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_pilot_organization_id FOR UPDATE;
  SELECT * INTO v_order FROM private.subscription_live_orders
    WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_order.organization_id<>p_pilot_organization_id
    OR v_order.merchant_id<>p_provider_merchant_id OR v_order.provider_mode<>'live'
    OR (v_order.provider_order_id IS NOT NULL
      AND v_order.provider_order_id<>p_provider_order_id)
    OR v_order.state='review_required' THEN
    RAISE EXCEPTION 'Live order binding changed identity' USING ERRCODE='23505'; END IF;
  UPDATE private.subscription_live_orders
    SET provider_order_id=p_provider_order_id,state='bound',
      bound_at=COALESCE(bound_at,now())
    WHERE request_id=p_request_id RETURNING * INTO v_order;
  RETURN jsonb_build_object('request_id',v_order.request_id,
    'organization_id',v_order.organization_id,
    'provider_order_id',v_order.provider_order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_bind_live_order(UUID,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_bind_live_order(UUID,TEXT,TEXT,UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_bind_live_order(UUID,TEXT,TEXT,UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_live_order_for_capture(
  p_provider_order_id TEXT,p_provider_merchant_id TEXT,p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_quote private.subscription_live_quotes;
  v_order private.subscription_live_orders;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR NOT v_settings.settlements_enabled OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live settlement is disabled or unbound' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_order FROM private.subscription_live_orders
    WHERE provider_order_id=p_provider_order_id AND merchant_id=p_provider_merchant_id
      AND organization_id=p_pilot_organization_id AND state IN ('bound','review_required');
  IF NOT FOUND THEN RAISE EXCEPTION 'Bound Live order missing' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_quote FROM private.subscription_live_quotes
    WHERE request_id=v_order.request_id AND organization_id=v_order.organization_id
      AND merchant_id=v_order.merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live quote missing' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('request_id',v_quote.request_id,
    'organization_id',v_quote.organization_id,'provider_order_id',v_order.provider_order_id,
    'provider_merchant_id',v_order.merchant_id,'amount_minor',v_quote.amount_minor,
    'currency',v_quote.currency);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_live_order_for_capture(TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_live_order_for_capture(TEXT,TEXT,UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_live_order_for_capture(TEXT,TEXT,UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_live_payment_replay_status(
  p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_merchant_id TEXT,p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_payment private.subscription_live_payments;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE provider_payment_id=p_provider_payment_id AND provider_order_id=p_provider_order_id
      AND merchant_id=p_provider_merchant_id AND organization_id=p_pilot_organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('status',v_payment.state,
    'request_id',v_payment.request_id,'organization_id',v_payment.organization_id,
    'provider_payment_id',v_payment.provider_payment_id);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_live_payment_replay_status(TEXT,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_live_payment_replay_status(TEXT,TEXT,TEXT,UUID)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_live_payment_replay_status(TEXT,TEXT,TEXT,UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_commit_live_initial_payment(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT,
  p_capture_event_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_quote private.subscription_live_quotes;
  v_order private.subscription_live_orders;
  v_payment private.subscription_live_payments;
  v_grant private.subscription_live_grants;
  v_access_before private.organization_product_access;
  v_access_after private.organization_product_access;
  v_reminders private.subscription_billing_settings;
  v_active INTEGER; v_capacity INTEGER;
  v_hold_reason TEXT;
  v_offer_active BOOLEAN;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live' OR NOT v_settings.settlements_enabled
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'Live settlement is disabled or merchant-unbound' USING ERRCODE='55000'; END IF;
  IF p_provider_order_id IS NULL OR p_provider_order_id !~ '^order_[A-Za-z0-9]+$'
    OR p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^pay_[A-Za-z0-9]+$'
    OR p_amount_minor IS NULL OR p_amount_minor<=0 OR p_currency<>'INR'
    OR p_capture_event_at IS NULL OR NOT isfinite(p_capture_event_at)
    OR p_capture_event_at>now()+interval '5 minutes' THEN
    RAISE EXCEPTION 'Invalid verified Live payment facts' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_quote FROM private.subscription_live_quotes WHERE request_id=p_request_id;
  IF NOT FOUND OR v_quote.provider_mode<>'live' OR v_quote.merchant_id<>p_provider_merchant_id
    OR v_quote.organization_id<>v_settings.pilot_organization_id
    OR v_quote.amount_minor<>p_amount_minor OR v_quote.currency<>p_currency
    OR v_quote.term_policy<>'calendar_month_from_capture_event'
    OR v_quote.offer_reference IS NULL OR v_quote.tax_decision_reference IS NULL THEN
    RAISE EXCEPTION 'Payment is outside the reviewed Live quote' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_quote.organization_id FOR UPDATE;
  PERFORM 1 FROM private.subscription_live_offer_approvals
    WHERE approval_id=v_quote.offer_approval_id FOR SHARE;
  SELECT EXISTS(
    SELECT 1 FROM private.subscription_live_offer_approvals a
    WHERE a.approval_id=v_quote.offer_approval_id
      AND a.organization_id=v_quote.organization_id
      AND a.merchant_id=v_quote.merchant_id AND a.revoked_at IS NULL
      AND a.tier=v_quote.tier AND a.amount_minor=v_quote.amount_minor
      AND a.currency=v_quote.currency AND a.term_policy=v_quote.term_policy
      AND a.offer_reference=v_quote.offer_reference
      AND a.tax_decision_reference=v_quote.tax_decision_reference)
    INTO v_offer_active;
  SELECT * INTO v_quote FROM private.subscription_live_quotes
    WHERE request_id=p_request_id FOR UPDATE;
  SELECT * INTO v_order FROM private.subscription_live_orders
    WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_order.provider_mode<>'live'
    OR v_order.merchant_id<>p_provider_merchant_id
    OR v_order.organization_id<>v_quote.organization_id
    OR v_order.provider_order_id<>p_provider_order_id
    OR v_order.state NOT IN ('bound','review_required') THEN
    RAISE EXCEPTION 'Live order is not bound to quote and merchant' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.subscription_live_webhook_events e
    WHERE e.request_id=p_request_id AND e.organization_id=v_quote.organization_id
      AND e.merchant_id=p_provider_merchant_id AND e.event_type='payment.captured'
      AND e.provider_order_id=p_provider_order_id
      AND e.provider_payment_id=p_provider_payment_id
      AND e.provider_event_at=p_capture_event_at) THEN
    RAISE EXCEPTION 'Signed Live capture event time required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_payment.provider_payment_id<>p_provider_payment_id
      OR v_payment.provider_order_id<>p_provider_order_id
      OR v_payment.merchant_id<>p_provider_merchant_id
      OR v_payment.organization_id<>v_quote.organization_id
      OR v_payment.amount_minor<>p_amount_minor OR v_payment.currency<>p_currency THEN
      RAISE EXCEPTION 'Live payment replay changed identity' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('status',v_payment.state,
      'organization_id',v_quote.organization_id,'request_id',p_request_id,
      'provider_payment_id',p_provider_payment_id);
  END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_payments
    WHERE provider_payment_id=p_provider_payment_id OR provider_order_id=p_provider_order_id) THEN
    RAISE EXCEPTION 'Live provider identity already used' USING ERRCODE='23505'; END IF;

  SELECT * INTO v_access_before FROM private.organization_product_access
    WHERE organization_id=v_quote.organization_id FOR UPDATE;
  IF NOT v_offer_active THEN
    v_hold_reason:='offer_approval_changed';
  ELSIF v_order.claimed_at>=v_quote.expires_at
    OR p_capture_event_at<v_quote.owner_reviewed_at
    OR p_capture_event_at>v_quote.expires_at THEN
    v_hold_reason:='quote_expired_or_changed';
  ELSIF v_access_before.organization_id IS NULL OR v_access_before.mode<>'trial'
    OR v_access_before.suspended_at IS NOT NULL
    OR v_access_before.trial_ends_at IS NULL
    OR now()<v_access_before.trial_ends_at THEN
    v_hold_reason:='access_changed';
  ELSIF EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants
    WHERE organization_id=v_quote.organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_grants
      WHERE organization_id=v_quote.organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments
      WHERE organization_id=v_quote.organization_id) THEN
    v_hold_reason:='existing_paid_obligation';
  END IF;
  v_capacity:=private.subscription_base_included_branches(v_quote.tier);
  SELECT count(*) INTO v_active FROM public.accounts
    WHERE organization_id=v_quote.organization_id AND branch_status='active';
  IF v_hold_reason IS NULL AND (v_capacity IS NULL OR v_active<1 OR v_active>v_capacity
    OR EXISTS(SELECT 1 FROM public.accounts WHERE organization_id=v_quote.organization_id
      AND branch_status='active' AND default_currency<>'INR')
    OR NOT EXISTS(SELECT 1 FROM public.accounts
      WHERE id=v_quote.billing_account_id AND organization_id=v_quote.organization_id
        AND branch_status='active' AND default_currency='INR')) THEN
    v_hold_reason:='branch_roster_changed';
  END IF;
  IF v_hold_reason IS NULL AND v_quote.tier='starter' THEN
    SELECT * INTO v_reminders FROM private.subscription_billing_settings WHERE singleton;
    IF NOT COALESCE(v_reminders.standard_reminder_policy_approved AND
      v_reminders.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND
      v_reminders.standard_reminder_hour_local=9 AND
      v_quote.starter_reminder_reset_accepted AND
      v_quote.starter_reminder_policy_version=v_reminders.standard_reminder_policy_version,FALSE) THEN
      v_hold_reason:='starter_reminder_policy_changed';
    END IF;
  END IF;
  INSERT INTO private.subscription_live_payments
    (provider_payment_id,request_id,organization_id,merchant_id,
     provider_order_id,amount_minor,currency,state,capture_event_at)
  VALUES(p_provider_payment_id,p_request_id,v_quote.organization_id,p_provider_merchant_id,
    p_provider_order_id,p_amount_minor,p_currency,
    CASE WHEN v_hold_reason IS NULL THEN 'verified' ELSE 'review_required' END,
    p_capture_event_at);
  IF v_hold_reason IS NOT NULL THEN
    UPDATE private.subscription_live_orders SET state='review_required'
      WHERE request_id=p_request_id;
    RETURN jsonb_build_object('status','review_required','reason',v_hold_reason,
      'organization_id',v_quote.organization_id,'request_id',p_request_id,
      'provider_payment_id',p_provider_payment_id);
  END IF;
  IF v_quote.tier='starter' THEN
    PERFORM private.subscription_apply_live_starter_reminder_policy(
      v_quote.organization_id,p_request_id);
  END IF;
  INSERT INTO private.subscription_live_grants
    (organization_id,request_id,provider_payment_id,merchant_id,tier,
     period_start,paid_through_end)
  VALUES(v_quote.organization_id,p_request_id,p_provider_payment_id,p_provider_merchant_id,
    v_quote.tier,p_capture_event_at,p_capture_event_at+interval '1 month') RETURNING * INTO v_grant;
  UPDATE private.organization_product_access SET mode='manual',
    access_starts_at=p_capture_event_at,access_ends_at=v_grant.paid_through_end,
    version=version+1,updated_at=now()
    WHERE organization_id=v_quote.organization_id RETURNING * INTO v_access_after;
  INSERT INTO private.product_access_audit
    (organization_id,action,reason,before_state,after_state)
  VALUES(v_quote.organization_id,'verified_subscription_payment',
    'Usefulmade Live initial monthly payment',
    to_jsonb(v_access_before),to_jsonb(v_access_after));
  RETURN jsonb_build_object('status','verified','organization_id',v_quote.organization_id,
    'request_id',p_request_id,'provider_payment_id',p_provider_payment_id,
    'paid_through_end',v_grant.paid_through_end);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_commit_live_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_commit_live_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_commit_live_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ)
  TO service_role;
