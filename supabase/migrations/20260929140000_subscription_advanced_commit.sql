-- Signed Checkout or signed webhook plus a fresh captured-payment GET happens
-- in the Test server adapter before this service-only atomic transaction.
CREATE OR REPLACE FUNCTION public.subscription_commit_test_advanced_payment(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT,
  p_verified_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents;
  g private.organization_paid_subscription_grants;
  a private.organization_product_access;
  p private.organization_subscription_payments;
  e private.subscription_advanced_payment_exceptions;
  s private.subscription_billing_settings;
  v_org UUID; v_active UUID[]; v_slots INTEGER; v_zone TEXT;
  v_reason TEXT; v_next_end TIMESTAMPTZ;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  SELECT organization_id INTO v_org FROM private.organization_subscription_intents
    WHERE request_id=p_request_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Bound advanced intent required' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_org FOR UPDATE;
  SELECT * INTO i FROM private.organization_subscription_intents
    WHERE request_id=p_request_id FOR UPDATE;
  IF i.kind NOT IN ('upgrade','addon_purchase','restart')
    OR i.provider_order_id IS DISTINCT FROM p_provider_order_id
    OR i.amount_minor IS DISTINCT FROM p_amount_minor
    OR i.currency IS DISTINCT FROM p_currency
    OR p_provider_order_id IS NULL OR p_provider_order_id!~'^order_[A-Za-z0-9]+$'
    OR p_provider_payment_id IS NULL OR p_provider_payment_id!~'^pay_[A-Za-z0-9]+$'
    OR p_currency<>'INR' OR p_verified_at IS NULL OR NOT isfinite(p_verified_at)
    OR p_verified_at<i.requested_at OR p_verified_at>now()+interval '1 minute' THEN
    RAISE EXCEPTION 'Verified advanced payment does not match intent' USING ERRCODE='22023'; END IF;
  IF i.state='verified' THEN
    SELECT * INTO p FROM private.organization_subscription_payments
      WHERE intent_id=p_request_id;
    IF p.provider_payment_id IS DISTINCT FROM p_provider_payment_id
      OR p.provider_order_id IS DISTINCT FROM p_provider_order_id
      OR p.provider_merchant_id IS DISTINCT FROM p_provider_merchant_id
      OR p.amount_minor IS DISTINCT FROM p_amount_minor OR p.currency IS DISTINCT FROM p_currency THEN
      RAISE EXCEPTION 'Verified advanced replay differs' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('status','verified','organization_id',v_org,
      'request_id',p_request_id,'kind',i.kind,'provider_payment_id',p_provider_payment_id);
  END IF;
  IF i.state='review_required' THEN
    SELECT * INTO e FROM private.subscription_advanced_payment_exceptions
      WHERE intent_id=p_request_id;
    IF e.provider_payment_id IS DISTINCT FROM p_provider_payment_id
      OR e.provider_order_id IS DISTINCT FROM p_provider_order_id
      OR e.provider_merchant_id IS DISTINCT FROM p_provider_merchant_id
      OR e.amount_minor IS DISTINCT FROM p_amount_minor THEN
      RAISE EXCEPTION 'Review-held payment replay differs' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('status','review_required','organization_id',v_org,
      'request_id',p_request_id,'kind',i.kind,'provider_payment_id',p_provider_payment_id);
  END IF;
  IF i.state<>'pending' OR EXISTS(SELECT 1 FROM private.organization_subscription_payments
      WHERE provider_payment_id=p_provider_payment_id OR provider_order_id=p_provider_order_id)
    OR EXISTS(SELECT 1 FROM private.subscription_advanced_payment_exceptions
      WHERE provider_payment_id=p_provider_payment_id OR provider_order_id=p_provider_order_id) THEN
    RAISE EXCEPTION 'Payment identity already used or intent closed' USING ERRCODE='23505'; END IF;
  SELECT * INTO s FROM private.subscription_billing_settings WHERE singleton;
  IF NOT COALESCE(s.advanced_payments_enabled AND s.advanced_commercial_approved
    AND s.advanced_policy_version=i.commercial_policy_version,FALSE) THEN
    v_reason:='commercial_policy_changed';
  ELSIF i.quote_expires_at IS NULL OR p_verified_at>=i.quote_expires_at
    OR now()>=i.quote_expires_at THEN
    v_reason:='quote_expired';
  END IF;
  SELECT * INTO g FROM private.organization_paid_subscription_grants
    WHERE organization_id=v_org FOR UPDATE;
  SELECT * INTO a FROM private.organization_product_access
    WHERE organization_id=v_org FOR UPDATE;
  PERFORM 1 FROM public.accounts WHERE organization_id=v_org ORDER BY id FOR UPDATE;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active
    FROM public.accounts WHERE organization_id=v_org AND branch_status='active';
  v_slots:=private.subscription_active_paid_slots(v_org);
  IF v_reason IS NULL AND (g.organization_id IS NULL OR a.organization_id IS NULL
    OR a.mode<>'manual' OR a.suspended_at IS NOT NULL
    OR i.source_term_generation IS DISTINCT FROM g.term_generation
    OR i.source_period_start IS DISTINCT FROM g.period_start
    OR i.source_period_end IS DISTINCT FROM g.paid_through_end
    OR i.source_tier IS DISTINCT FROM g.tier
    OR i.expected_access_version IS DISTINCT FROM a.version
    OR i.active_account_ids IS DISTINCT FROM v_active
    OR i.quoted_slot_count IS DISTINCT FROM v_slots) THEN
    v_reason:='source_term_or_roster_changed';
  END IF;
  IF v_reason IS NULL AND (NOT EXISTS(SELECT 1 FROM public.organization_memberships
      WHERE organization_id=v_org AND user_id=i.requested_by AND role='owner')
    OR NOT i.archive_account_ids<@v_active
    OR EXISTS(SELECT 1 FROM unnest(i.archive_account_ids) id
      WHERE NOT EXISTS(SELECT 1 FROM public.account_memberships am
        WHERE am.account_id=id AND am.user_id=i.requested_by AND am.role='owner'))
    OR NOT EXISTS(SELECT 1 FROM public.accounts b WHERE b.id=i.billing_account_id
      AND b.organization_id=v_org AND b.branch_status='active'
      AND b.default_currency='INR' AND b.id<>ALL(i.archive_account_ids))
    OR EXISTS(SELECT 1 FROM public.accounts b WHERE b.organization_id=v_org
      AND b.branch_status='active' AND b.default_currency<>'INR')) THEN
    v_reason:='owner_or_billing_branch_changed';
  END IF;
  IF v_reason IS NULL AND EXISTS(SELECT 1 FROM private.subscription_first_refund_requests rr
    WHERE rr.organization_id=v_org AND NOT EXISTS(
      SELECT 1 FROM private.subscription_refund_executions x
      WHERE x.organization_id=rr.organization_id AND x.confirmed_at IS NOT NULL)) THEN
    v_reason:='refund_request_unresolved';
  END IF;
  IF v_reason IS NULL AND i.tier='starter' AND s.capabilities_enabled
    AND NOT COALESCE(s.standard_reminder_policy_approved
      AND i.starter_reminder_reset_accepted
      AND i.starter_reminder_policy_version=s.standard_reminder_policy_version,FALSE) THEN
    v_reason:='starter_reminder_policy_changed';
  END IF;
  IF v_reason IS NULL AND i.kind='restart' THEN
    IF NOT ((g.current_term_refunded_at IS NOT NULL
        AND g.renewal_stopped_at IS NOT NULL
        AND a.access_ends_at=g.current_term_refunded_at) OR
      (g.current_term_refunded_at IS NULL AND now()>=g.paid_through_end
        AND a.access_ends_at=g.paid_through_end
        AND EXISTS(SELECT 1 FROM private.subscription_renewal_changes c
          WHERE c.organization_id=v_org AND c.source_period_end=g.paid_through_end
            AND c.target_tier IS NULL)))
      OR cardinality(v_active)-cardinality(i.archive_account_ids)<1
      OR cardinality(v_active)-cardinality(i.archive_account_ids)>
        private.subscription_base_included_branches(i.tier) THEN
      v_reason:='restart_or_branch_choice_changed';
    END IF;
  ELSIF v_reason IS NULL THEN
    IF now()>=g.paid_through_end OR a.access_starts_at<>g.period_start
      OR a.access_ends_at<>g.paid_through_end OR g.renewal_stopped_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM private.subscription_renewal_changes c
        WHERE c.organization_id=v_org AND c.source_period_end=g.paid_through_end) THEN
      v_reason:='paid_term_ended_or_changed';
    ELSIF i.kind='upgrade' AND (v_slots>0
      OR cardinality(v_active)>private.subscription_base_included_branches(i.tier)
      OR private.subscription_base_monthly_minor(i.tier)<=
        private.subscription_base_monthly_minor(g.tier)) THEN
      v_reason:='upgrade_capacity_changed';
    ELSIF i.kind='addon_purchase' AND (g.tier='starter'
      OR i.tier<>g.tier OR (g.tier='growth' AND v_slots>=1)) THEN
      v_reason:='paid_slot_capacity_changed';
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    INSERT INTO private.subscription_advanced_payment_exceptions(
      provider_payment_id,intent_id,organization_id,provider_order_id,
      provider_merchant_id,amount_minor,reason)
    VALUES(p_provider_payment_id,p_request_id,v_org,p_provider_order_id,
      p_provider_merchant_id,p_amount_minor,v_reason);
    UPDATE private.organization_subscription_intents
      SET state='review_required',provider_payment_id=p_provider_payment_id,
        verified_at=p_verified_at WHERE request_id=p_request_id;
    RETURN jsonb_build_object('status','review_required','organization_id',v_org,
      'request_id',p_request_id,'kind',i.kind,'provider_payment_id',p_provider_payment_id);
  END IF;
  SELECT timezone INTO v_zone FROM public.accounts
    WHERE id=i.billing_account_id AND organization_id=v_org
      AND branch_status='active' AND default_currency='INR';
  IF v_zone IS NULL THEN RAISE EXCEPTION 'Billing timezone missing' USING ERRCODE='22023'; END IF;
  INSERT INTO private.organization_subscription_payments(provider_payment_id,
    provider_order_id,organization_id,intent_id,provider_merchant_id,provider_mode,
    amount_minor,currency,billing_timezone,verified_at)
  VALUES(p_provider_payment_id,p_provider_order_id,v_org,p_request_id,
    p_provider_merchant_id,'test',p_amount_minor,p_currency,v_zone,p_verified_at);
  IF i.kind='upgrade' THEN
    UPDATE private.organization_paid_subscription_grants SET tier=i.tier
      WHERE organization_id=v_org;
    UPDATE private.organization_product_access SET version=version+1,updated_at=now()
      WHERE organization_id=v_org;
  ELSIF i.kind='addon_purchase' THEN
    INSERT INTO private.subscription_paid_branch_slots(organization_id,generation,
      source_intent_id,source_payment_id,active_from,paid_through_end)
    VALUES(v_org,g.term_generation,p_request_id,p_provider_payment_id,
      p_verified_at,g.paid_through_end);
    UPDATE private.organization_product_access SET version=version+1,updated_at=now()
      WHERE organization_id=v_org;
  ELSE
    v_next_end:=p_verified_at+interval '1 month';
    UPDATE public.accounts SET branch_status='archived',readiness_state='attention',
      archived_at=now() WHERE organization_id=v_org AND id=ANY(i.archive_account_ids);
    INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation)
      SELECT v_org,id,i.requested_by,'branch.archived' FROM unnest(i.archive_account_ids) id;
    UPDATE private.organization_paid_subscription_grants SET
      tier=i.tier,term_generation=g.term_generation+1,
      current_generation_source_intent_id=p_request_id,
      current_generation_source_payment_id=p_provider_payment_id,
      current_term_refunded_at=NULL,renewal_stopped_at=NULL,
      period_start=p_verified_at,paid_through_end=v_next_end
      WHERE organization_id=v_org;
    UPDATE private.organization_product_access SET mode='manual',
      access_starts_at=p_verified_at,access_ends_at=v_next_end,
      version=version+1,updated_at=now() WHERE organization_id=v_org;
  END IF;
  UPDATE private.organization_subscription_intents
    SET state='verified',provider_payment_id=p_provider_payment_id,
      verified_at=p_verified_at WHERE request_id=p_request_id;
  INSERT INTO private.product_access_audit(organization_id,actor_user_id,action,reason,
    before_state,after_state)
  SELECT v_org,i.requested_by,'verified_subscription_'||i.kind,
    'Captured Usefulmade Test payment committed',
    to_jsonb(a),to_jsonb(x) FROM private.organization_product_access x
    WHERE x.organization_id=v_org;
  RETURN jsonb_build_object('status','verified','organization_id',v_org,
    'request_id',p_request_id,'kind',i.kind,'provider_payment_id',p_provider_payment_id);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_commit_test_advanced_payment(
  UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_commit_test_advanced_payment(
  UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) TO service_role;
ALTER FUNCTION public.subscription_commit_test_advanced_payment(
  UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) OWNER TO postgres;

-- Active-branch transitions consume only included plus verified paid slots.
CREATE OR REPLACE FUNCTION private.enforce_subscription_active_branch_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_limit INTEGER; v_active INTEGER; v_access private.organization_product_access;
BEGIN
  IF NEW.branch_status<>'active' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.branch_status='active'
    AND OLD.organization_id=NEW.organization_id THEN RETURN NEW; END IF;
  IF NOT COALESCE((SELECT enabled FROM private.subscription_billing_settings WHERE singleton),FALSE)
    THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.organizations WHERE id=NEW.organization_id FOR UPDATE;
  SELECT * INTO v_access FROM private.organization_product_access
    WHERE organization_id=NEW.organization_id;
  IF v_access.mode='trial' THEN
    v_limit:=5;
  ELSE
    SELECT private.subscription_base_included_branches(g.tier)+
      private.subscription_active_paid_slots(NEW.organization_id)
      INTO v_limit FROM private.organization_paid_subscription_grants g
      WHERE g.organization_id=NEW.organization_id;
  END IF;
  IF v_limit IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_active FROM public.accounts WHERE organization_id=NEW.organization_id
    AND branch_status='active';
  IF v_active>=v_limit THEN
    RAISE EXCEPTION 'Active branch allowance is full' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_subscription_active_branch_limit() OWNER TO postgres;

-- Until the matching add-on renewal charge/cancellation transaction is
-- installed, refuse a renewal that would silently discard paid slot capacity.
CREATE OR REPLACE FUNCTION private.subscription_hold_slot_renewal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.term_generation=OLD.term_generation
    AND NEW.paid_through_end IS DISTINCT FROM OLD.paid_through_end
    AND EXISTS(SELECT 1 FROM private.subscription_paid_branch_slots s
      WHERE s.organization_id=OLD.organization_id
        AND s.generation=OLD.term_generation AND s.cancelled_at IS NULL
        AND s.paid_through_end>=OLD.paid_through_end) THEN
    RAISE EXCEPTION 'Paid slot renewal needs owner review' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_hold_slot_renewal
  ON private.organization_paid_subscription_grants;
CREATE TRIGGER subscription_hold_slot_renewal
  BEFORE UPDATE OF paid_through_end ON private.organization_paid_subscription_grants
  FOR EACH ROW EXECUTE FUNCTION private.subscription_hold_slot_renewal();
REVOKE ALL ON FUNCTION private.subscription_hold_slot_renewal()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_hold_slot_renewal() OWNER TO postgres;
