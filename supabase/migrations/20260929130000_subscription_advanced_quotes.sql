-- Owner-reviewed Test quotes and service-only claimed orders. The private
-- commercial switch defaults off and requires explicit versioned decisions.
CREATE OR REPLACE FUNCTION public.subscription_create_test_advanced_quote(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_billing_settings;
  r private.subscription_advanced_reviews;
  g private.organization_paid_subscription_grants;
  a private.organization_product_access;
  i private.organization_subscription_intents;
  v_org UUID; v_active UUID[]; v_amount BIGINT; v_slots INTEGER; v_expiry TIMESTAMPTZ;
BEGIN
  s:=private.subscription_assert_advanced_policy();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
  SELECT organization_id INTO v_org
    FROM private.subscription_advanced_reviews WHERE request_id=p_request_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Review required' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_org FOR UPDATE;
  SELECT * INTO r FROM private.subscription_advanced_reviews WHERE request_id=p_request_id;
  IF r.requested_by IS DISTINCT FROM auth.uid()
    OR NOT public.is_organization_owner(r.organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  IF r.kind NOT IN ('upgrade','addon_purchase','restart') THEN
    RAISE EXCEPTION 'Payable review required' USING ERRCODE='22023'; END IF;
  IF r.target_tier='starter' AND s.capabilities_enabled
    AND NOT COALESCE(s.standard_reminder_policy_approved
      AND r.starter_reminder_reset_accepted
      AND r.starter_reminder_policy_version=s.standard_reminder_policy_version,FALSE) THEN
    RAISE EXCEPTION 'Starter reminder review changed' USING ERRCODE='55000'; END IF;
  SELECT * INTO i FROM private.organization_subscription_intents
    WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF i.organization_id IS DISTINCT FROM r.organization_id
      OR i.advanced_review_id IS DISTINCT FROM r.request_id
      OR i.kind IS DISTINCT FROM r.kind
      OR i.commercial_policy_version IS DISTINCT FROM s.advanced_policy_version THEN
      RAISE EXCEPTION 'Review ID already used' USING ERRCODE='23505'; END IF;
    IF i.state<>'pending' OR i.quote_expires_at<=now() THEN
      RAISE EXCEPTION 'Quote needs a new owner review' USING ERRCODE='55000'; END IF;
    IF r.target_tier='starter' AND s.capabilities_enabled
      AND NOT i.starter_reminder_reset_accepted THEN
      PERFORM public.subscription_acknowledge_starter_reminders(r.request_id);
      SELECT * INTO i FROM private.organization_subscription_intents
        WHERE request_id=r.request_id;
    END IF;
    RETURN to_jsonb(i);
  END IF;
  IF EXISTS(SELECT 1 FROM private.organization_subscription_intents x
      WHERE x.organization_id=r.organization_id AND x.kind IN ('upgrade','addon_purchase','restart')
        AND x.state='pending' AND x.order_requested_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM private.subscription_advanced_payment_exceptions e
      WHERE e.organization_id=r.organization_id AND e.resolved_at IS NULL) THEN
    RAISE EXCEPTION 'Prior Test order needs review' USING ERRCODE='55000'; END IF;
  SELECT * INTO g FROM private.organization_paid_subscription_grants
    WHERE organization_id=r.organization_id FOR UPDATE;
  SELECT * INTO a FROM private.organization_product_access
    WHERE organization_id=r.organization_id FOR UPDATE;
  IF g.organization_id IS NULL OR a.organization_id IS NULL
    OR a.mode<>'manual' OR a.suspended_at IS NOT NULL
    OR r.source_tier IS DISTINCT FROM g.tier
    OR r.source_period_start IS DISTINCT FROM g.period_start
    OR r.source_period_end IS DISTINCT FROM g.paid_through_end
    OR r.source_access_version IS DISTINCT FROM a.version THEN
    RAISE EXCEPTION 'Paid term changed; review again' USING ERRCODE='55000'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active
    FROM public.accounts WHERE organization_id=r.organization_id AND branch_status='active';
  IF v_active IS DISTINCT FROM r.active_account_ids
    OR NOT r.archive_account_ids<@v_active
    OR NOT EXISTS(SELECT 1 FROM public.accounts b
      WHERE b.id=r.billing_account_id AND b.organization_id=r.organization_id
        AND b.branch_status='active' AND b.default_currency='INR'
        AND b.id<>ALL(r.archive_account_ids) AND public.has_account_membership(b.id))
    OR EXISTS(SELECT 1 FROM public.accounts b WHERE b.organization_id=r.organization_id
      AND b.branch_status='active' AND b.default_currency<>'INR')
    OR EXISTS(SELECT 1 FROM unnest(r.archive_account_ids) id
      WHERE NOT public.has_account_membership(id,'owner')) THEN
    RAISE EXCEPTION 'Branch roster changed; review again' USING ERRCODE='55000'; END IF;
  v_slots:=private.subscription_active_paid_slots(r.organization_id);
  IF r.kind='restart' THEN
    IF NOT ((g.current_term_refunded_at IS NOT NULL
        AND g.renewal_stopped_at IS NOT NULL
        AND a.access_ends_at=g.current_term_refunded_at) OR
      (g.current_term_refunded_at IS NULL AND now()>=g.paid_through_end
        AND a.access_ends_at=g.paid_through_end
        AND EXISTS(SELECT 1 FROM private.subscription_renewal_changes c
          WHERE c.organization_id=r.organization_id
            AND c.source_period_end=g.paid_through_end AND c.target_tier IS NULL)))
      OR EXISTS(SELECT 1 FROM private.subscription_first_refund_requests rr
        WHERE rr.organization_id=r.organization_id
          AND NOT EXISTS(SELECT 1 FROM private.subscription_refund_executions e
            WHERE e.organization_id=rr.organization_id AND e.confirmed_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM private.organization_subscription_intents x
        WHERE x.organization_id=r.organization_id AND x.state='pending'
          AND x.order_requested_at IS NOT NULL)
      OR cardinality(v_active)-cardinality(r.archive_account_ids)<1
      OR cardinality(v_active)-cardinality(r.archive_account_ids)>
        private.subscription_base_included_branches(r.target_tier) THEN
      RAISE EXCEPTION 'Restart needs owner review' USING ERRCODE='55000'; END IF;
    v_amount:=private.subscription_base_monthly_minor(r.target_tier);
    v_expiry:=now()+make_interval(secs=>s.advanced_quote_lifetime_seconds);
  ELSE
    IF g.renewal_stopped_at IS NOT NULL OR now()<g.period_start
      OR now()>=g.paid_through_end OR a.access_starts_at<>g.period_start
      OR a.access_ends_at<>g.paid_through_end
      OR EXISTS(SELECT 1 FROM private.subscription_renewal_changes c
        WHERE c.organization_id=r.organization_id AND c.source_period_end=g.paid_through_end)
      OR EXISTS(SELECT 1 FROM private.subscription_first_refund_requests rr
        WHERE rr.organization_id=r.organization_id
          AND NOT EXISTS(SELECT 1 FROM private.subscription_refund_executions e
            WHERE e.organization_id=rr.organization_id AND e.confirmed_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'Current paid term required' USING ERRCODE='55000'; END IF;
    IF r.kind='upgrade' THEN
      IF v_slots>0 OR cardinality(r.archive_account_ids)>0
        OR cardinality(v_active)>private.subscription_base_included_branches(r.target_tier) THEN
        RAISE EXCEPTION 'Paid slots or branches need review' USING ERRCODE='55000'; END IF;
      v_amount:=private.subscription_review_upgrade_minor(g.tier,r.target_tier,
        g.period_start,g.paid_through_end,now());
    ELSE
      IF r.kind<>'addon_purchase' OR r.requested_slots<>1
        OR r.target_tier<>g.tier OR g.tier='starter'
        OR (g.tier='growth' AND v_slots>=1) THEN
        RAISE EXCEPTION 'Extra slot needs review' USING ERRCODE='55000'; END IF;
      v_amount:=round(49900::NUMERIC *
        (extract(epoch FROM (g.paid_through_end-now()))*1000000)::NUMERIC /
        (extract(epoch FROM (g.paid_through_end-g.period_start))*1000000)::NUMERIC,0)::BIGINT;
      IF v_amount<1 THEN
        RAISE EXCEPTION 'Extra slot must wait for renewal' USING ERRCODE='55000'; END IF;
    END IF;
    v_expiry:=LEAST(now()+make_interval(secs=>s.advanced_quote_lifetime_seconds),
      g.paid_through_end);
  END IF;
  IF v_amount IS NULL OR v_amount<1 OR v_expiry<=now() THEN
    RAISE EXCEPTION 'No payable Test quote available' USING ERRCODE='55000'; END IF;
  INSERT INTO private.organization_subscription_intents(request_id,organization_id,
    requested_by,billing_account_id,tier,amount_minor,kind,source_period_start,
    source_period_end,source_tier,expected_access_version,archive_account_ids,
    active_account_ids,advanced_review_id,quote_expires_at,commercial_policy_version,
    source_term_generation,quoted_slot_count)
  VALUES(r.request_id,r.organization_id,r.requested_by,r.billing_account_id,
    r.target_tier,v_amount,r.kind,g.period_start,g.paid_through_end,g.tier,
    a.version,r.archive_account_ids,v_active,r.request_id,v_expiry,
    s.advanced_policy_version,g.term_generation,v_slots) RETURNING * INTO i;
  IF r.target_tier='starter' AND s.capabilities_enabled THEN
    PERFORM public.subscription_acknowledge_starter_reminders(r.request_id);
    SELECT * INTO i FROM private.organization_subscription_intents
      WHERE request_id=r.request_id;
  END IF;
  RETURN to_jsonb(i);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_claim_test_advanced_order(
  p_request_id UUID,p_organization_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_billing_settings;
  i private.organization_subscription_intents;
  g private.organization_paid_subscription_grants;
  a private.organization_product_access;
  v_active UUID[]; v_action TEXT;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  s:=private.subscription_assert_advanced_policy();
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships
    WHERE organization_id=p_organization_id AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM private.organization_subscription_intents
    WHERE request_id=p_request_id AND organization_id=p_organization_id FOR UPDATE;
  IF i.request_id IS NULL OR i.kind NOT IN ('upgrade','addon_purchase','restart')
    OR i.state<>'pending' OR i.requested_by<>p_actor_user_id
    OR i.commercial_policy_version IS DISTINCT FROM s.advanced_policy_version
    OR i.quote_expires_at IS NULL OR now()>=i.quote_expires_at THEN
    RAISE EXCEPTION 'Current owner-reviewed quote required' USING ERRCODE='55000'; END IF;
  IF i.tier='starter' THEN
    PERFORM private.subscription_assert_starter_reminder_review(
      p_organization_id,p_request_id);
  END IF;
  SELECT * INTO g FROM private.organization_paid_subscription_grants
    WHERE organization_id=p_organization_id FOR UPDATE;
  SELECT * INTO a FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active
    FROM public.accounts WHERE organization_id=p_organization_id AND branch_status='active';
  IF g.organization_id IS NULL OR a.organization_id IS NULL
    OR a.mode<>'manual' OR a.suspended_at IS NOT NULL
    OR i.source_term_generation<>g.term_generation
    OR i.source_period_start<>g.period_start OR i.source_period_end<>g.paid_through_end
    OR i.source_tier<>g.tier OR i.expected_access_version<>a.version
    OR i.active_account_ids<>v_active
    OR private.subscription_active_paid_slots(p_organization_id)<>i.quoted_slot_count
    OR EXISTS(SELECT 1 FROM private.subscription_advanced_payment_exceptions e
      WHERE e.organization_id=p_organization_id AND e.resolved_at IS NULL) THEN
    RAISE EXCEPTION 'Quote changed; review again' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_first_refund_requests rr
      WHERE rr.organization_id=p_organization_id AND NOT EXISTS(
        SELECT 1 FROM private.subscription_refund_executions e
        WHERE e.organization_id=rr.organization_id AND e.confirmed_at IS NOT NULL))
    OR EXISTS(SELECT 1 FROM private.subscription_refund_executions e
      WHERE e.organization_id=p_organization_id AND e.confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'Refund needs review before another order' USING ERRCODE='55000'; END IF;
  IF i.kind='restart' THEN
    IF NOT ((g.current_term_refunded_at IS NOT NULL AND g.renewal_stopped_at IS NOT NULL
        AND a.access_ends_at=g.current_term_refunded_at) OR
      (g.current_term_refunded_at IS NULL AND now()>=g.paid_through_end
        AND a.access_ends_at=g.paid_through_end
        AND EXISTS(SELECT 1 FROM private.subscription_renewal_changes c
          WHERE c.organization_id=p_organization_id
            AND c.source_period_end=g.paid_through_end AND c.target_tier IS NULL)))
      OR EXISTS(SELECT 1 FROM private.subscription_first_refund_requests rr
        WHERE rr.organization_id=p_organization_id AND NOT EXISTS(
          SELECT 1 FROM private.subscription_refund_executions e
          WHERE e.organization_id=rr.organization_id AND e.confirmed_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'Restart needs review' USING ERRCODE='55000'; END IF;
  ELSE
    IF now()>=g.paid_through_end OR a.access_starts_at<>g.period_start
      OR a.access_ends_at<>g.paid_through_end OR g.renewal_stopped_at IS NOT NULL
      OR (i.kind='addon_purchase' AND g.tier='growth' AND i.quoted_slot_count>=1)
      OR (i.kind='upgrade' AND i.quoted_slot_count>0) THEN
      RAISE EXCEPTION 'Current paid term required' USING ERRCODE='55000'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts b WHERE b.id=i.billing_account_id
    AND b.organization_id=p_organization_id AND b.branch_status='active'
    AND b.default_currency='INR' AND b.id<>ALL(i.archive_account_ids))
    OR EXISTS(SELECT 1 FROM public.accounts b WHERE b.organization_id=p_organization_id
      AND b.branch_status='active' AND b.default_currency<>'INR')
    OR EXISTS(SELECT 1 FROM unnest(i.archive_account_ids) id
      WHERE NOT EXISTS(SELECT 1 FROM public.account_memberships am
        WHERE am.account_id=id AND am.user_id=p_actor_user_id AND am.role='owner')) THEN
    RAISE EXCEPTION 'Branch review changed' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.organization_subscription_intents x
    WHERE x.organization_id=p_organization_id AND x.request_id<>p_request_id
      AND x.state='pending' AND x.order_requested_at IS NOT NULL
      AND x.kind IN ('upgrade','addon_purchase','restart')) THEN
    RAISE EXCEPTION 'Another Test order needs review' USING ERRCODE='55000'; END IF;
  IF i.provider_order_id IS NOT NULL THEN v_action:='bound';
  ELSIF i.order_requested_at IS NOT NULL THEN v_action:='recovery';
  ELSE
    v_action:='create';
    UPDATE private.organization_subscription_intents SET order_requested_at=now()
      WHERE request_id=p_request_id;
  END IF;
  RETURN to_jsonb(i)||jsonb_build_object('action',v_action);
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_create_test_advanced_quote(UUID),
  public.subscription_claim_test_advanced_order(UUID,UUID,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_create_test_advanced_quote(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_claim_test_advanced_order(UUID,UUID,UUID,TEXT)
  TO service_role;
ALTER FUNCTION public.subscription_create_test_advanced_quote(UUID) OWNER TO postgres;
ALTER FUNCTION public.subscription_claim_test_advanced_order(UUID,UUID,UUID,TEXT) OWNER TO postgres;
