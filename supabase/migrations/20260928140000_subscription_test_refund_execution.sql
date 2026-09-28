-- PRIVATE TEST DRAFT. Default-off full first-payment refunds, Orders adapter only.
ALTER TABLE private.subscription_billing_settings ADD COLUMN IF NOT EXISTS refunds_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE private.organization_paid_subscription_grants
  ADD COLUMN IF NOT EXISTS refund_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_stopped_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS private.subscription_refund_executions (
  organization_id UUID PRIMARY KEY REFERENCES private.subscription_first_refund_claims(organization_id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE REFERENCES private.subscription_first_refund_claims(request_id) ON DELETE CASCADE,
  provider_requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_refund_id TEXT UNIQUE,
  provider_status TEXT CHECK(provider_status IN ('pending','failed','processed')),
  confirmed_at TIMESTAMPTZ
);
ALTER TABLE private.subscription_refund_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_refund_executions FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.subscription_refund_executions TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_claim_test_refund(
  p_organization_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.subscription_first_refund_claims; e private.subscription_refund_executions;
  p private.organization_subscription_payments; g private.organization_paid_subscription_grants; v_action TEXT;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=p_organization_id
    AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM private.subscription_first_refund_claims WHERE organization_id=p_organization_id;
  SELECT * INTO g FROM private.organization_paid_subscription_grants WHERE organization_id=p_organization_id;
  IF c.request_id IS NULL OR c.provider_merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR c.provider_payment_id IS DISTINCT FROM g.first_provider_payment_id THEN
    RAISE EXCEPTION 'Eligible first-payment claim required' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM private.organization_subscription_payments WHERE provider_payment_id=c.provider_payment_id;
  IF p.provider_mode<>'test' OR p.amount_minor IS DISTINCT FROM c.amount_minor THEN
    RAISE EXCEPTION 'First payment does not match' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM private.subscription_refund_executions WHERE organization_id=p_organization_id;
  IF FOUND THEN
    v_action:=CASE WHEN e.confirmed_at IS NOT NULL THEN 'confirmed'
      WHEN e.provider_refund_id IS NOT NULL THEN 'bound' ELSE 'recovery' END;
  ELSE
    IF NOT COALESCE((SELECT refunds_enabled FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
      RAISE EXCEPTION 'Test refund execution is disabled' USING ERRCODE='55000'; END IF;
    PERFORM private.subscription_assert_current_term(p_organization_id);
    INSERT INTO private.subscription_refund_executions(organization_id,request_id)
      VALUES(p_organization_id,c.request_id) RETURNING * INTO e;
    v_action:='create';
  END IF;
  RETURN jsonb_build_object('action',v_action,'claim',to_jsonb(c),'execution',to_jsonb(e),
    'provider_order_id',p.provider_order_id);
END;
$$;

-- Persist the exact refund identity before applying access. Pending/failed
-- observations never end access. Processed is monotonic under delayed events.
CREATE OR REPLACE FUNCTION public.subscription_observe_test_refund(
  p_request_id UUID,p_provider_merchant_id TEXT,p_provider_payment_id TEXT,
  p_provider_refund_id TEXT,p_amount_minor BIGINT,p_currency TEXT,p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.subscription_first_refund_claims; e private.subscription_refund_executions;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  SELECT * INTO c FROM private.subscription_first_refund_claims WHERE request_id=p_request_id;
  IF c.request_id IS NULL THEN RAISE EXCEPTION 'Refund claim missing' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=c.organization_id FOR UPDATE;
  SELECT * INTO e FROM private.subscription_refund_executions WHERE request_id=p_request_id FOR UPDATE;
  IF e.request_id IS NULL OR c.provider_merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR c.provider_payment_id IS DISTINCT FROM p_provider_payment_id OR c.amount_minor IS DISTINCT FROM p_amount_minor
    OR c.currency IS DISTINCT FROM p_currency OR p_status IS NULL OR p_status NOT IN ('pending','failed','processed')
    OR p_provider_refund_id IS NULL OR p_provider_refund_id!~'^rfnd_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Refund does not match full first payment' USING ERRCODE='22023'; END IF;
  IF e.provider_refund_id IS NOT NULL AND e.provider_refund_id<>p_provider_refund_id THEN
    RAISE EXCEPTION 'Refund already bound to another identity' USING ERRCODE='23505'; END IF;
  UPDATE private.subscription_refund_executions SET provider_refund_id=p_provider_refund_id,
    provider_status=CASE WHEN provider_status='processed' THEN 'processed' ELSE p_status END
    WHERE request_id=p_request_id RETURNING * INTO e;
  RETURN to_jsonb(e);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_commit_test_full_refund(
  p_request_id UUID,p_provider_merchant_id TEXT,p_provider_payment_id TEXT,p_provider_refund_id TEXT,
  p_amount_minor BIGINT,p_currency TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.subscription_first_refund_claims; e private.subscription_refund_executions;
  g private.organization_paid_subscription_grants; a private.organization_product_access; v_now TIMESTAMPTZ;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  SELECT * INTO c FROM private.subscription_first_refund_claims WHERE request_id=p_request_id;
  IF c.request_id IS NULL THEN RAISE EXCEPTION 'Refund claim missing' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=c.organization_id FOR UPDATE;
  SELECT * INTO e FROM private.subscription_refund_executions WHERE request_id=p_request_id FOR UPDATE;
  IF e.request_id IS NULL OR e.provider_status IS DISTINCT FROM 'processed'
    OR e.provider_refund_id IS DISTINCT FROM p_provider_refund_id
    OR c.provider_merchant_id IS DISTINCT FROM p_provider_merchant_id OR c.provider_payment_id IS DISTINCT FROM p_provider_payment_id
    OR c.amount_minor IS DISTINCT FROM p_amount_minor OR c.currency IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION 'Verified processed full refund required' USING ERRCODE='22023'; END IF;
  IF e.confirmed_at IS NOT NULL THEN RETURN to_jsonb(e); END IF;
  SELECT * INTO g FROM private.organization_paid_subscription_grants WHERE organization_id=c.organization_id FOR UPDATE;
  SELECT * INTO a FROM private.organization_product_access WHERE organization_id=c.organization_id FOR UPDATE;
  v_now:=clock_timestamp();
  -- Preserve a platform correction instead of overwriting unrelated manual access.
  -- Suspensions stay intact while the underlying paid term ends.
  IF g.first_provider_payment_id IS DISTINCT FROM c.provider_payment_id OR a.mode IS DISTINCT FROM 'manual'
    OR a.access_starts_at IS DISTINCT FROM g.period_start OR a.access_starts_at>=v_now
    OR (a.access_ends_at=g.paid_through_end OR (a.access_ends_at=g.paid_through_end+interval '72 hours'
      AND EXISTS(SELECT 1 FROM private.organization_subscription_intents i WHERE i.organization_id=c.organization_id
        AND i.kind='renewal' AND i.source_period_end=g.paid_through_end AND i.first_failed_at IS NOT NULL))) IS NOT TRUE THEN
    RAISE EXCEPTION 'Paid access changed; confirmed refund needs review' USING ERRCODE='55000'; END IF;
  UPDATE private.organization_paid_subscription_grants SET refund_confirmed_at=v_now,renewal_stopped_at=v_now
    WHERE organization_id=c.organization_id;
  UPDATE private.organization_product_access SET access_ends_at=LEAST(access_ends_at,v_now),version=version+1,updated_at=v_now
    WHERE organization_id=c.organization_id;
  UPDATE private.subscription_refund_executions SET confirmed_at=v_now WHERE request_id=p_request_id RETURNING * INTO e;
  INSERT INTO private.product_access_audit(organization_id,action,reason,before_state,after_state)
    SELECT c.organization_id,'subscription_full_refund','Confirmed full first Test payment refund; renewal stopped',to_jsonb(a),to_jsonb(x)
    FROM private.organization_product_access x WHERE x.organization_id=c.organization_id;
  RETURN to_jsonb(e);
END;
$$;

-- Applied to every renewal prepare/claim/failure/commit; first-payment replay
-- already returns its old evidence without re-granting access.
CREATE OR REPLACE FUNCTION private.subscription_refund_stops_renewal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.kind='renewal' AND EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants
    WHERE organization_id=NEW.organization_id AND renewal_stopped_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Renewal stopped after refund' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_refund_stops_renewal ON private.organization_subscription_intents;
CREATE TRIGGER subscription_refund_stops_renewal BEFORE INSERT OR UPDATE
  ON private.organization_subscription_intents FOR EACH ROW EXECUTE FUNCTION private.subscription_refund_stops_renewal();

CREATE OR REPLACE FUNCTION public.subscription_test_billing_snapshot(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT COALESCE((SELECT enabled FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Test billing disabled' USING ERRCODE='55000'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('organization_id',p_organization_id,
    'grant',(SELECT to_jsonb(g) FROM private.organization_paid_subscription_grants g WHERE organization_id=p_organization_id),
    'access',private.product_access_snapshot(p_organization_id),
    'change',(SELECT to_jsonb(c) FROM private.subscription_renewal_changes c
      JOIN private.organization_paid_subscription_grants g USING(organization_id)
      WHERE c.organization_id=p_organization_id AND c.source_period_end=g.paid_through_end),
    'claim',(SELECT to_jsonb(c) FROM private.subscription_first_refund_claims c WHERE organization_id=p_organization_id),
    'refund',(SELECT to_jsonb(e) FROM private.subscription_refund_executions e WHERE organization_id=p_organization_id),
    'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.verified_at DESC),'[]'::JSONB)
      FROM (SELECT amount_minor,currency,verified_at,provider_payment_id FROM private.organization_subscription_payments
        WHERE organization_id=p_organization_id ORDER BY verified_at DESC LIMIT 12) p),
    'refunds_enabled',(SELECT refunds_enabled FROM private.subscription_billing_settings WHERE singleton));
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_test_refund_for_payment(p_provider_payment_id TEXT,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  RETURN (SELECT jsonb_build_object('claim',to_jsonb(c),'execution',to_jsonb(e),'provider_order_id',p.provider_order_id)
    FROM private.subscription_first_refund_claims c JOIN private.subscription_refund_executions e USING(organization_id,request_id)
    JOIN private.organization_subscription_payments p ON p.provider_payment_id=c.provider_payment_id
    WHERE c.provider_payment_id=p_provider_payment_id AND c.provider_merchant_id=p_provider_merchant_id);
END;
$$;
REVOKE ALL ON FUNCTION private.subscription_refund_stops_renewal(),
  public.subscription_claim_test_refund(UUID,UUID,TEXT),
  public.subscription_observe_test_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),
  public.subscription_commit_test_full_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT),
  public.subscription_test_refund_for_payment(TEXT,TEXT),public.subscription_test_billing_snapshot(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_claim_test_refund(UUID,UUID,TEXT),
  public.subscription_observe_test_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),
  public.subscription_commit_test_full_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT),
  public.subscription_test_refund_for_payment(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_test_billing_snapshot(UUID) TO authenticated;
ALTER FUNCTION private.subscription_refund_stops_renewal() OWNER TO postgres;
ALTER FUNCTION public.subscription_claim_test_refund(UUID,UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_observe_test_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_commit_test_full_refund(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_test_refund_for_payment(TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_test_billing_snapshot(UUID) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.subscription_assert_current_term(p_organization_id UUID)
RETURNS private.organization_paid_subscription_grants
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.organization_paid_subscription_grants; a private.organization_product_access;
BEGIN
  SELECT * INTO g FROM private.organization_paid_subscription_grants WHERE organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Existing paid grant required' USING ERRCODE='22023'; END IF;
  IF g.renewal_stopped_at IS NOT NULL THEN RAISE EXCEPTION 'Renewal stopped after refund' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM private.organization_product_access WHERE organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR a.mode<>'manual' OR a.suspended_at IS NOT NULL
    OR a.access_starts_at IS DISTINCT FROM g.period_start
    OR (a.access_ends_at=g.paid_through_end OR (
      a.access_ends_at=g.paid_through_end+interval '72 hours' AND EXISTS (
        SELECT 1 FROM private.organization_subscription_intents i WHERE i.organization_id=p_organization_id
          AND i.kind='renewal' AND i.source_period_end=g.paid_through_end
          AND i.first_failed_at IS NOT NULL AND i.expected_access_version=a.version))) IS NOT TRUE THEN
    RAISE EXCEPTION 'Paid access changed; review required' USING ERRCODE='55000';
  END IF;
  RETURN g;
END;
$$;
