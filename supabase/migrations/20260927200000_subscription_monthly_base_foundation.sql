-- DRAFT ONLY: do not apply to Production until provider, tax, branch, and
-- recovery acceptance is complete. Initial base-tier monthly payments only.
-- The gate is disabled, and all provider-binding/commit RPCs are service-only.

CREATE TABLE IF NOT EXISTS private.subscription_billing_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  test_merchant_account_id TEXT
);
INSERT INTO private.subscription_billing_settings(singleton)
VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS private.organization_subscription_intents (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  billing_account_id UUID NOT NULL REFERENCES public.accounts(id),
  tier TEXT NOT NULL CHECK (tier IN ('starter','growth','ultimate')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','failed','verified')),
  provider_order_id TEXT UNIQUE,
  order_requested_at TIMESTAMPTZ,
  provider_payment_id TEXT UNIQUE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS organization_subscription_intents_organization_time
  ON private.organization_subscription_intents(organization_id,requested_at DESC);

CREATE TABLE IF NOT EXISTS private.organization_subscription_payments (
  provider_payment_id TEXT PRIMARY KEY,
  provider_order_id TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  intent_id UUID NOT NULL UNIQUE REFERENCES private.organization_subscription_intents(request_id),
  provider_merchant_id TEXT NOT NULL,
  provider_mode TEXT NOT NULL CHECK (provider_mode = 'test'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  billing_timezone TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS private.organization_paid_subscription_grants (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('starter','growth','ultimate')),
  source_intent_id UUID NOT NULL UNIQUE REFERENCES private.organization_subscription_intents(request_id),
  first_provider_payment_id TEXT NOT NULL UNIQUE REFERENCES private.organization_subscription_payments(provider_payment_id),
  period_start TIMESTAMPTZ NOT NULL,
  paid_through_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (paid_through_end > period_start)
);

ALTER TABLE private.subscription_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.organization_subscription_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.organization_subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.organization_paid_subscription_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_billing_settings,
  private.organization_subscription_intents,
  private.organization_subscription_payments,
  private.organization_paid_subscription_grants
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.subscription_billing_settings,
  private.organization_subscription_intents,
  private.organization_subscription_payments,
  private.organization_paid_subscription_grants TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_base_monthly_minor(p_tier TEXT)
RETURNS BIGINT LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE p_tier WHEN 'starter' THEN 79900
    WHEN 'growth' THEN 149900 WHEN 'ultimate' THEN 399900 ELSE NULL END;
$$;
CREATE OR REPLACE FUNCTION private.subscription_base_included_branches(p_tier TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE p_tier WHEN 'starter' THEN 1
    WHEN 'growth' THEN 1 WHEN 'ultimate' THEN 5 ELSE NULL END;
$$;

-- Identity-only owner check permits conversion after trial expiry. The RPC
-- records an intent, never creates a checkout/order or grants access.
CREATE OR REPLACE FUNCTION public.subscription_create_monthly_intent(
  p_organization_id UUID,p_request_id UUID,p_tier TEXT,p_billing_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_access private.organization_product_access;
  v_intent private.organization_subscription_intents;
  v_amount BIGINT;
  v_capacity INTEGER;
  v_active INTEGER;
BEGIN
  IF NOT COALESCE((SELECT enabled FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Subscription billing is not enabled' USING ERRCODE='55000';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization and request are required' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id=p_billing_account_id
    AND a.organization_id=p_organization_id AND a.branch_status='active'
    AND a.default_currency='INR' AND public.has_account_membership(a.id)) THEN
    RAISE EXCEPTION 'An active INR billing branch is required' USING ERRCODE='22023';
  END IF;
  v_amount := private.subscription_base_monthly_minor(p_tier);
  v_capacity := private.subscription_base_included_branches(p_tier);
  IF v_amount IS NULL OR v_capacity IS NULL THEN
    RAISE EXCEPTION 'Unknown subscription tier' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_access FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_access.mode<>'trial' OR v_access.suspended_at IS NOT NULL
    OR v_access.trial_ends_at IS NULL OR now()<v_access.trial_ends_at THEN
    RAISE EXCEPTION 'An expired unsuspended trial is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_intent FROM private.organization_subscription_intents
    WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_intent.organization_id<>p_organization_id OR v_intent.tier<>p_tier
      OR v_intent.billing_account_id<>p_billing_account_id THEN
      RAISE EXCEPTION 'Request ID belongs to another plan or organization' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('request_id',v_intent.request_id,'organization_id',v_intent.organization_id,
      'tier',v_intent.tier,'amount_minor',v_intent.amount_minor,'currency',v_intent.currency,
      'state',v_intent.state);
  END IF;
  SELECT count(*) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  IF EXISTS (SELECT 1 FROM public.accounts WHERE organization_id=p_organization_id
    AND branch_status='active' AND default_currency<>'INR') THEN
    RAISE EXCEPTION 'INR branches required for INR billing' USING ERRCODE='22023';
  END IF;
  IF v_active<1 OR v_active>v_capacity THEN
    RAISE EXCEPTION 'Active branches exceed included plan capacity' USING ERRCODE='22023';
  END IF;
  -- A browser restart must resume the already claimed order, never strand it
  -- behind a newly generated request ID. A different tier needs explicit review.
  SELECT * INTO v_intent FROM private.organization_subscription_intents
    WHERE organization_id=p_organization_id AND state='pending'
      AND order_requested_at IS NOT NULL
    ORDER BY requested_at,request_id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_intent.tier<>p_tier THEN
      RAISE EXCEPTION 'Another Test plan order needs completion or review' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('request_id',v_intent.request_id,'organization_id',v_intent.organization_id,
      'tier',v_intent.tier,'amount_minor',v_intent.amount_minor,'currency',v_intent.currency,
      'state',v_intent.state);
  END IF;
  INSERT INTO private.organization_subscription_intents
    (request_id,organization_id,requested_by,billing_account_id,tier,amount_minor)
  VALUES (p_request_id,p_organization_id,auth.uid(),p_billing_account_id,p_tier,v_amount)
  RETURNING * INTO v_intent;
  RETURN jsonb_build_object('request_id',v_intent.request_id,'organization_id',v_intent.organization_id,
    'tier',v_intent.tier,'amount_minor',v_intent.amount_minor,'currency',v_intent.currency,
    'state',v_intent.state);
END;
$$;

-- A single claim prevents a network retry from creating a second provider
-- order after an ambiguous response. An uncertain claim needs reconciliation.
CREATE OR REPLACE FUNCTION public.subscription_claim_test_order(
  p_request_id UUID,p_organization_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_intent private.organization_subscription_intents;
  v_access private.organization_product_access;
  v_active INTEGER;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF NOT COALESCE((SELECT enabled AND test_merchant_account_id=p_provider_merchant_id
    FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Test merchant billing is not enabled' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships WHERE
    organization_id=p_organization_id AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_intent FROM private.organization_subscription_intents
    WHERE request_id=p_request_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_intent.state<>'pending' THEN
    RAISE EXCEPTION 'Pending plan intent required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_access FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_access.mode<>'trial' OR v_access.suspended_at IS NOT NULL
    OR v_access.trial_ends_at IS NULL OR now()<v_access.trial_ends_at THEN
    RAISE EXCEPTION 'Expired trial required for first Test order' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  IF v_active<1 OR v_active>private.subscription_base_included_branches(v_intent.tier) THEN
    RAISE EXCEPTION 'Active branches exceed included plan capacity' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=v_intent.billing_account_id
    AND organization_id=p_organization_id AND branch_status='active'
    AND default_currency='INR') OR EXISTS (SELECT 1 FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active'
      AND default_currency<>'INR') THEN
    RAISE EXCEPTION 'Active INR billing branches are required' USING ERRCODE='22023';
  END IF;
  IF v_intent.provider_order_id IS NOT NULL THEN
    RETURN jsonb_build_object('action','bound','request_id',p_request_id,
      'organization_id',p_organization_id,'provider_order_id',v_intent.provider_order_id,
      'amount_minor',v_intent.amount_minor,'currency',v_intent.currency,'tier',v_intent.tier);
  END IF;
  IF v_intent.order_requested_at IS NOT NULL THEN
    RETURN jsonb_build_object('action','recovery','request_id',p_request_id,
      'organization_id',p_organization_id,'amount_minor',v_intent.amount_minor,
      'currency',v_intent.currency,'tier',v_intent.tier);
  END IF;
  IF EXISTS (SELECT 1 FROM private.organization_subscription_intents
    WHERE organization_id=p_organization_id AND request_id<>p_request_id
      AND state='pending' AND order_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Another Test plan order needs completion or review' USING ERRCODE='55000';
  END IF;
  UPDATE private.organization_subscription_intents SET order_requested_at=now()
    WHERE request_id=p_request_id;
  RETURN jsonb_build_object('action','create','request_id',p_request_id,
    'organization_id',p_organization_id,'amount_minor',v_intent.amount_minor,
    'currency',v_intent.currency,'tier',v_intent.tier);
END;
$$;

-- Creating/restoring an active branch consumes a trial or verified base slot.
-- Paid add-ons are intentionally unavailable until their own ledger exists.
CREATE OR REPLACE FUNCTION private.enforce_subscription_active_branch_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_limit INTEGER; v_active INTEGER; v_access private.organization_product_access;
BEGIN
  IF NEW.branch_status<>'active' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.branch_status='active' AND OLD.organization_id=NEW.organization_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NOT COALESCE((SELECT enabled FROM private.subscription_billing_settings WHERE singleton),FALSE)
    THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.organizations WHERE id=NEW.organization_id FOR UPDATE;
  SELECT * INTO v_access FROM private.organization_product_access
    WHERE organization_id=NEW.organization_id;
  IF v_access.mode='trial' THEN
    v_limit:=5;
  ELSE
    SELECT private.subscription_base_included_branches(tier) INTO v_limit
      FROM private.organization_paid_subscription_grants WHERE organization_id=NEW.organization_id;
  END IF;
  IF v_limit IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_active FROM public.accounts WHERE organization_id=NEW.organization_id
    AND branch_status='active';
  IF v_active>=v_limit THEN
    RAISE EXCEPTION 'Active branch allowance is full' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_subscription_active_branch_limit()
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION private.enforce_subscription_active_branch_limit() OWNER TO postgres;
DROP TRIGGER IF EXISTS enforce_subscription_active_branch_limit ON public.accounts;
CREATE TRIGGER enforce_subscription_active_branch_limit
  BEFORE INSERT OR UPDATE OF branch_status,organization_id ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_active_branch_limit();

-- Restore takes the same organization lock as checkout, create, and the
-- capacity trigger before locking an account row. This prevents lock inversion
-- when an owner restores a branch while another branch operation is running.
CREATE OR REPLACE FUNCTION public.restore_branch(p_account_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_organization_id UUID;
  v_target public.accounts%ROWTYPE;
BEGIN
  SELECT organization_id INTO v_organization_id FROM public.accounts WHERE id=p_account_id;
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can restore it'
      USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_organization_id FOR UPDATE;
  SELECT * INTO v_target FROM public.accounts WHERE id=p_account_id FOR UPDATE;
  IF auth.uid() IS NULL OR v_target.id IS NULL
    OR v_target.organization_id<>v_organization_id
    OR NOT private.is_product_organization_owner(v_organization_id)
    OR NOT private.has_product_account_membership(p_account_id,'owner') THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can restore it'
      USING ERRCODE='42501';
  END IF;
  IF v_target.branch_status<>'archived' THEN
    RAISE EXCEPTION 'Only an archived branch can be restored' USING ERRCODE='22023';
  END IF;
  UPDATE public.accounts SET branch_status='active',readiness_state='attention',
    setup_reviewed_at=NULL,setup_reviewed_by=NULL,archived_at=NULL
    WHERE id=p_account_id;
  INSERT INTO public.organization_audit_log
    (organization_id,account_id,actor_user_id,operation)
  VALUES (v_organization_id,p_account_id,auth.uid(),'branch.restored');
END;
$$;
ALTER FUNCTION public.restore_branch(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.restore_branch(UUID) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.restore_branch(UUID) TO authenticated;

-- Expired owners can archive only the branch IDs they explicitly submit.
-- Ordinary archive_branch is product-access gated and cannot serve conversion.
CREATE OR REPLACE FUNCTION public.subscription_conversion_branches(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.organization_product_access
    WHERE organization_id=p_organization_id AND mode='trial'
      AND suspended_at IS NULL AND trial_ends_at<=now()) THEN
    RAISE EXCEPTION 'Expired trial required for branch review' USING ERRCODE='22023';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_id',a.id,'account_name',a.name,
    'organization_id',a.organization_id,'branch_status',a.branch_status)
    ORDER BY a.name,a.id),'[]'::jsonb)
    FROM public.accounts a WHERE a.organization_id=p_organization_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_archive_branches_for_conversion(
  p_organization_id UUID,p_account_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_access private.organization_product_access;
  v_active INTEGER;
  v_selected INTEGER;
BEGIN
  IF NOT COALESCE((SELECT enabled FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Subscription billing is not enabled' USING ERRCODE='55000';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501';
  END IF;
  IF p_account_ids IS NULL OR cardinality(p_account_ids)<1 OR cardinality(p_account_ids)>4
    OR cardinality(p_account_ids)<>(SELECT count(DISTINCT account_id)
      FROM unnest(p_account_ids) AS ids(account_id))
    OR array_position(p_account_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Choose distinct active branches to archive' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  SELECT * INTO v_access FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_access.mode<>'trial' OR v_access.suspended_at IS NOT NULL
    OR v_access.trial_ends_at IS NULL OR now()<v_access.trial_ends_at THEN
    RAISE EXCEPTION 'Expired trial required for branch choice' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.accounts WHERE organization_id=p_organization_id FOR UPDATE;
  SELECT count(*) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  SELECT count(*) INTO v_selected FROM public.accounts
    WHERE organization_id=p_organization_id AND id=ANY(p_account_ids) AND branch_status='active';
  IF v_selected<>cardinality(p_account_ids) OR v_active-v_selected<1 OR NOT EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.account_memberships am ON am.account_id=a.id
    WHERE a.organization_id=p_organization_id AND a.branch_status='active'
      AND a.id<>ALL(p_account_ids) AND am.user_id=auth.uid()
  ) THEN
    RAISE EXCEPTION 'Keep at least one active branch and choose only this gym''s active branches'
      USING ERRCODE='22023';
  END IF;
  UPDATE public.accounts SET branch_status='archived',readiness_state='attention',
    archived_at=now() WHERE organization_id=p_organization_id AND id=ANY(p_account_ids);
  INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation)
    SELECT p_organization_id,id,auth.uid(),'branch.archived'
      FROM public.accounts WHERE organization_id=p_organization_id AND id=ANY(p_account_ids);
  RETURN jsonb_build_object('archived_count',v_selected,'active_count',v_active-v_selected);
END;
$$;

-- Callable service-only functions live in the exposed public schema; all
-- billing tables remain private and are unavailable to browser roles.
CREATE OR REPLACE FUNCTION public.subscription_bind_test_order(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_merchant_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_intent private.organization_subscription_intents;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF NOT COALESCE((SELECT enabled AND test_merchant_account_id=p_provider_merchant_id
    FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Test merchant billing is not enabled' USING ERRCODE='55000';
  END IF;
  IF NULLIF(btrim(p_provider_order_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider order is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_intent FROM private.organization_subscription_intents
    WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_intent.state<>'pending' THEN
    RAISE EXCEPTION 'Pending intent required' USING ERRCODE='22023';
  END IF;
  IF v_intent.order_requested_at IS NULL THEN
    RAISE EXCEPTION 'Order claim required' USING ERRCODE='22023';
  END IF;
  IF v_intent.provider_order_id IS NOT NULL THEN
    IF v_intent.provider_order_id=p_provider_order_id THEN RETURN; END IF;
    RAISE EXCEPTION 'Intent already bound to another order' USING ERRCODE='23505';
  END IF;
  UPDATE private.organization_subscription_intents
    SET provider_order_id=p_provider_order_id WHERE request_id=p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_test_intent_for_order(
  p_provider_order_id TEXT,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_intent private.organization_subscription_intents;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF NOT COALESCE((SELECT enabled AND test_merchant_account_id=p_provider_merchant_id
    FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Test merchant billing is not enabled' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_intent FROM private.organization_subscription_intents
    WHERE provider_order_id=p_provider_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bound order not found' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('request_id',v_intent.request_id,
    'organization_id',v_intent.organization_id,'provider_order_id',v_intent.provider_order_id,
    'amount_minor',v_intent.amount_minor,'currency',v_intent.currency,
    'tier',v_intent.tier,'state',v_intent.state);
END;
$$;

-- This is an atomic database boundary for an already VERIFIED Test payment.
-- It does not verify signatures/provider state itself; the Test route verifies
-- provider state before calling it.
CREATE OR REPLACE FUNCTION public.subscription_commit_test_initial_payment(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT,p_verified_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_org UUID;
  v_intent private.organization_subscription_intents;
  v_access_before private.organization_product_access;
  v_access_after private.organization_product_access;
  v_grant private.organization_paid_subscription_grants;
  v_payment private.organization_subscription_payments;
  v_billing_timezone TEXT;
  v_capacity INTEGER;
  v_active INTEGER;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF NOT COALESCE((SELECT enabled AND test_merchant_account_id=p_provider_merchant_id
    FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Test merchant billing is not enabled' USING ERRCODE='55000';
  END IF;
  IF NULLIF(btrim(p_provider_order_id),'') IS NULL OR NULLIF(btrim(p_provider_payment_id),'') IS NULL
    OR p_verified_at IS NULL OR NOT isfinite(p_verified_at) THEN
    RAISE EXCEPTION 'Verified payment identity and time are required' USING ERRCODE='22023';
  END IF;
  SELECT organization_id INTO v_org FROM private.organization_subscription_intents
    WHERE request_id=p_request_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Intent not found' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_org FOR UPDATE;
  SELECT * INTO v_intent FROM private.organization_subscription_intents
    WHERE request_id=p_request_id FOR UPDATE;
  IF v_intent.state='verified' THEN
    IF v_intent.provider_payment_id=p_provider_payment_id
      AND v_intent.provider_order_id=p_provider_order_id THEN
      SELECT * INTO v_payment FROM private.organization_subscription_payments
        WHERE intent_id=p_request_id;
      IF NOT FOUND OR v_payment.provider_payment_id<>p_provider_payment_id
        OR v_payment.provider_merchant_id<>p_provider_merchant_id
        OR v_payment.amount_minor IS DISTINCT FROM p_amount_minor
        OR v_payment.currency IS DISTINCT FROM p_currency THEN
        RAISE EXCEPTION 'Verified payment replay does not match' USING ERRCODE='23505';
      END IF;
      SELECT * INTO v_grant FROM private.organization_paid_subscription_grants
        WHERE source_intent_id=p_request_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Verified grant is missing' USING ERRCODE='55000'; END IF;
      RETURN jsonb_build_object('grant',to_jsonb(v_grant),'access',private.product_access_snapshot(v_org));
    END IF;
    RAISE EXCEPTION 'Intent verified with another payment' USING ERRCODE='23505';
  END IF;
  IF v_intent.state<>'pending' OR v_intent.provider_order_id IS NULL
    OR v_intent.provider_order_id<>p_provider_order_id
    OR v_intent.amount_minor IS DISTINCT FROM p_amount_minor
    OR v_intent.currency IS DISTINCT FROM p_currency
    OR v_intent.amount_minor IS DISTINCT FROM private.subscription_base_monthly_minor(v_intent.tier)
    OR p_verified_at<v_intent.requested_at THEN
    RAISE EXCEPTION 'Verified payment does not match the pending plan intent' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM private.organization_subscription_payments
    WHERE provider_payment_id=p_provider_payment_id OR provider_order_id=p_provider_order_id) THEN
    RAISE EXCEPTION 'Provider payment or order already used' USING ERRCODE='23505';
  END IF;
  SELECT * INTO v_access_before FROM private.organization_product_access
    WHERE organization_id=v_org FOR UPDATE;
  IF NOT FOUND OR v_access_before.mode<>'trial' OR v_access_before.suspended_at IS NOT NULL
    OR v_access_before.trial_ends_at IS NULL OR now()<v_access_before.trial_ends_at THEN
    RAISE EXCEPTION 'Expired trial required for first paid term' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants WHERE organization_id=v_org) THEN
    RAISE EXCEPTION 'Organization already has a paid grant' USING ERRCODE='23505';
  END IF;
  v_capacity := private.subscription_base_included_branches(v_intent.tier);
  SELECT count(*) INTO v_active FROM public.accounts
    WHERE organization_id=v_org AND branch_status='active';
  IF EXISTS (SELECT 1 FROM public.accounts WHERE organization_id=v_org
    AND branch_status='active' AND default_currency<>'INR') THEN
    RAISE EXCEPTION 'INR branches required for INR billing' USING ERRCODE='22023';
  END IF;
  IF v_active<1 OR v_active>v_capacity THEN
    RAISE EXCEPTION 'Active branches exceed included plan capacity' USING ERRCODE='22023';
  END IF;
  SELECT timezone INTO v_billing_timezone FROM public.accounts
    WHERE id=v_intent.billing_account_id AND organization_id=v_org
      AND branch_status='active' AND default_currency='INR';
  IF v_billing_timezone IS NULL THEN
    RAISE EXCEPTION 'Billing timezone is missing' USING ERRCODE='22023';
  END IF;
  INSERT INTO private.organization_subscription_payments
    (provider_payment_id,provider_order_id,organization_id,intent_id,
     provider_merchant_id,provider_mode,amount_minor,currency,billing_timezone,verified_at)
  VALUES (p_provider_payment_id,p_provider_order_id,v_org,p_request_id,
    p_provider_merchant_id,'test',p_amount_minor,p_currency,v_billing_timezone,p_verified_at);
  INSERT INTO private.organization_paid_subscription_grants
    (organization_id,tier,source_intent_id,first_provider_payment_id,period_start,paid_through_end)
  VALUES (v_org,v_intent.tier,p_request_id,p_provider_payment_id,
    p_verified_at,p_verified_at+interval '1 month') RETURNING * INTO v_grant;
  UPDATE private.organization_subscription_intents SET state='verified',
    provider_payment_id=p_provider_payment_id,verified_at=p_verified_at WHERE request_id=p_request_id;
  UPDATE private.organization_product_access SET mode='manual',access_starts_at=p_verified_at,
    access_ends_at=v_grant.paid_through_end,version=version+1,updated_at=now()
    WHERE organization_id=v_org RETURNING * INTO v_access_after;
  INSERT INTO private.product_access_audit
    (organization_id,action,reason,before_state,after_state)
  VALUES (v_org,'verified_subscription_payment','Test-mode initial monthly payment',
    to_jsonb(v_access_before),to_jsonb(v_access_after));
  RETURN jsonb_build_object('grant',to_jsonb(v_grant),'access',private.product_access_snapshot(v_org));
END;
$$;

REVOKE ALL ON FUNCTION private.subscription_base_monthly_minor(TEXT),
  private.subscription_base_included_branches(TEXT),
  public.subscription_create_monthly_intent(UUID,UUID,TEXT,UUID),
  public.subscription_conversion_branches(UUID),
  public.subscription_archive_branches_for_conversion(UUID,UUID[]),
  public.subscription_claim_test_order(UUID,UUID,UUID,TEXT),
  public.subscription_bind_test_order(UUID,TEXT,TEXT),
  public.subscription_test_intent_for_order(TEXT,TEXT),
  public.subscription_commit_test_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION private.subscription_base_monthly_minor(TEXT) OWNER TO postgres;
ALTER FUNCTION private.subscription_base_included_branches(TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_create_monthly_intent(UUID,UUID,TEXT,UUID) OWNER TO postgres;
ALTER FUNCTION public.subscription_conversion_branches(UUID) OWNER TO postgres;
ALTER FUNCTION public.subscription_archive_branches_for_conversion(UUID,UUID[]) OWNER TO postgres;
ALTER FUNCTION public.subscription_claim_test_order(UUID,UUID,UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_bind_test_order(UUID,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_test_intent_for_order(TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_commit_test_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_create_monthly_intent(UUID,UUID,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_conversion_branches(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_archive_branches_for_conversion(UUID,UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_claim_test_order(UUID,UUID,UUID,TEXT),
  public.subscription_bind_test_order(UUID,TEXT,TEXT),
  public.subscription_test_intent_for_order(TEXT,TEXT),
  public.subscription_commit_test_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ)
  TO service_role;
