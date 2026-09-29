-- Default-off Test refund race holds. A processed provider refund remains
-- visible for operator reconciliation when another payment has since landed.
ALTER TABLE private.subscription_refund_executions
  ADD COLUMN IF NOT EXISTS review_required_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

CREATE OR REPLACE FUNCTION private.subscription_refund_stops_renewal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_evidence_hold BOOLEAN;
BEGIN
  IF NEW.kind='renewal' THEN
    v_evidence_hold:=FALSE;
    IF TG_OP='UPDATE' THEN
      v_evidence_hold:=OLD.state='pending' AND NEW.state='review_required'
        AND NEW.provider_order_id IS NOT NULL
        AND NEW.provider_order_id IS NOT DISTINCT FROM OLD.provider_order_id
        AND NEW.provider_payment_id IS NOT NULL AND NEW.verified_at IS NOT NULL
        AND NEW.order_requested_at IS NOT DISTINCT FROM OLD.order_requested_at
        AND NEW.amount_minor IS NOT DISTINCT FROM OLD.amount_minor;
    END IF;
    IF (EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants g
        WHERE g.organization_id=NEW.organization_id AND g.renewal_stopped_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM private.subscription_first_refund_requests rr
        WHERE rr.organization_id=NEW.organization_id AND NOT EXISTS(
          SELECT 1 FROM private.subscription_refund_executions e
          WHERE e.organization_id=rr.organization_id AND e.confirmed_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM private.subscription_refund_executions e
        WHERE e.organization_id=NEW.organization_id AND e.confirmed_at IS NULL))
      AND NOT v_evidence_hold THEN
      RAISE EXCEPTION 'Renewal waits for first-refund review' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_refund_stops_renewal ON private.organization_subscription_intents;
CREATE TRIGGER subscription_refund_stops_renewal BEFORE INSERT OR UPDATE
  ON private.organization_subscription_intents FOR EACH ROW EXECUTE FUNCTION private.subscription_refund_stops_renewal();

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
      WHEN e.review_required_at IS NOT NULL THEN 'review_required'
      WHEN e.provider_refund_id IS NOT NULL THEN 'bound' ELSE 'recovery' END;
  ELSE
    IF NOT COALESCE((SELECT refunds_enabled FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
      RAISE EXCEPTION 'Test refund execution is disabled' USING ERRCODE='55000'; END IF;
    IF g.term_generation>1 OR EXISTS(SELECT 1
      FROM private.organization_subscription_payments later
      WHERE later.organization_id=p_organization_id
        AND later.provider_payment_id<>c.provider_payment_id) THEN
      RAISE EXCEPTION 'Later paid charge needs refund review before provider POST'
        USING ERRCODE='55000';
    END IF;
    PERFORM private.subscription_assert_current_term(p_organization_id);
    INSERT INTO private.subscription_refund_executions(organization_id,request_id)
      VALUES(p_organization_id,c.request_id) RETURNING * INTO e;
    v_action:='create';
  END IF;
  RETURN jsonb_build_object('action',v_action,'claim',to_jsonb(c),'execution',to_jsonb(e),
    'provider_order_id',p.provider_order_id);
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
  IF e.confirmed_at IS NOT NULL OR e.review_required_at IS NOT NULL THEN
    RETURN to_jsonb(e); END IF;
  SELECT * INTO g FROM private.organization_paid_subscription_grants WHERE organization_id=c.organization_id FOR UPDATE;
  SELECT * INTO a FROM private.organization_product_access WHERE organization_id=c.organization_id FOR UPDATE;
  IF g.term_generation>1 OR EXISTS(SELECT 1
    FROM private.organization_subscription_payments later
    WHERE later.organization_id=c.organization_id
      AND later.provider_payment_id<>c.provider_payment_id) THEN
    UPDATE private.subscription_refund_executions SET
      review_required_at=now(),review_reason='later_paid_obligation'
      WHERE request_id=p_request_id RETURNING * INTO e;
    RETURN to_jsonb(e);
  END IF;
  v_now:=clock_timestamp();
  -- Preserve a platform correction instead of overwriting unrelated manual access.
  -- Suspensions stay intact while the underlying paid term ends.
  IF g.first_provider_payment_id IS DISTINCT FROM c.provider_payment_id OR a.mode IS DISTINCT FROM 'manual'
    OR a.access_starts_at IS DISTINCT FROM g.period_start OR a.access_starts_at>=v_now
    OR (a.access_ends_at=g.paid_through_end OR (a.access_ends_at=g.paid_through_end+interval '72 hours'
      AND EXISTS(SELECT 1 FROM private.organization_subscription_intents i WHERE i.organization_id=c.organization_id
        AND i.kind='renewal' AND i.source_period_end=g.paid_through_end AND i.first_failed_at IS NOT NULL))) IS NOT TRUE THEN
    UPDATE private.subscription_refund_executions SET
      review_required_at=now(),review_reason='paid_access_changed'
      WHERE request_id=p_request_id RETURNING * INTO e;
    RETURN to_jsonb(e);
  END IF;
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
