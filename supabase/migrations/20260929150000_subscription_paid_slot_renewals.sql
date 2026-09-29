-- Test-only paid-slot renewal. The commercial switch remains default false.
-- A reviewed choice fixes the exact source slots, retained slots and branch
-- archives before a renewal order. One payment renews base and retained slots.
CREATE TABLE IF NOT EXISTS private.subscription_paid_slot_renewal_reviews (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  source_period_start TIMESTAMPTZ NOT NULL,
  source_period_end TIMESTAMPTZ NOT NULL,
  source_generation INTEGER NOT NULL,
  source_tier TEXT NOT NULL,
  target_tier TEXT NOT NULL,
  source_access_version INTEGER NOT NULL,
  source_slot_ids UUID[] NOT NULL,
  cancel_slot_ids UUID[] NOT NULL,
  active_account_ids UUID[] NOT NULL,
  archive_account_ids UUID[] NOT NULL,
  commercial_policy_version TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ,
  UNIQUE(organization_id,source_period_end)
);
ALTER TABLE private.subscription_paid_slot_renewal_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_paid_slot_renewal_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_paid_slot_renewal_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_review_test_paid_slot_renewal(
  p_organization_id UUID,p_request_id UUID,p_cancel_slot_ids UUID[],p_archive_account_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.organization_paid_subscription_grants;
  a private.organization_product_access;
  c private.subscription_renewal_changes;
  r private.subscription_paid_slot_renewal_reviews;
  s private.subscription_billing_settings;
  v_slots UUID[]; v_cancel UUID[]; v_active UUID[]; v_archive UUID[];
  v_tier TEXT; v_retained INTEGER;
BEGIN
  s:=private.subscription_assert_advanced_policy();
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id)
    OR p_request_id IS NULL OR p_cancel_slot_ids IS NULL OR p_archive_account_ids IS NULL
    OR array_position(p_cancel_slot_ids,NULL) IS NOT NULL
    OR array_position(p_archive_account_ids,NULL) IS NOT NULL
    OR cardinality(p_cancel_slot_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_cancel_slot_ids) id)
    OR cardinality(p_archive_account_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_archive_account_ids) id) THEN
    RAISE EXCEPTION 'Owner and distinct slot and branch choices required' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_cancel FROM unnest(p_cancel_slot_ids) id;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_archive FROM unnest(p_archive_account_ids) id;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  g:=private.subscription_assert_current_term(p_organization_id);
  SELECT * INTO a FROM private.organization_product_access WHERE organization_id=p_organization_id;
  IF now()<g.period_start OR now()>=g.paid_through_end+interval '1 month' THEN
    RAISE EXCEPTION 'Renewal window required' USING ERRCODE='55000'; END IF;
  SELECT * INTO r FROM private.subscription_paid_slot_renewal_reviews WHERE request_id=p_request_id;
  IF FOUND THEN
    IF r.organization_id<>p_organization_id OR r.cancel_slot_ids<>v_cancel
      OR r.archive_account_ids<>v_archive THEN
      RAISE EXCEPTION 'Request ID already used' USING ERRCODE='23505'; END IF;
    RETURN to_jsonb(r);
  END IF;
  IF EXISTS(SELECT 1 FROM private.organization_subscription_intents i
    WHERE i.organization_id=p_organization_id AND i.kind='renewal'
      AND i.source_period_end=g.paid_through_end) THEN
    RAISE EXCEPTION 'Renewal already prepared' USING ERRCODE='55000'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_slots
    FROM private.subscription_paid_branch_slots
    WHERE organization_id=p_organization_id AND generation=g.term_generation
      AND cancelled_at IS NULL AND paid_through_end>=g.paid_through_end;
  IF cardinality(v_slots)=0 OR NOT v_cancel<@v_slots THEN
    RAISE EXCEPTION 'Choose current paid slots' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active
    FROM public.accounts WHERE organization_id=p_organization_id AND branch_status='active';
  IF NOT v_archive<@v_active OR EXISTS(SELECT 1 FROM unnest(v_archive) id
    WHERE NOT public.has_account_membership(id,'owner')) THEN
    RAISE EXCEPTION 'Choose only active owned branches' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM private.subscription_renewal_changes
    WHERE organization_id=p_organization_id AND source_period_end=g.paid_through_end;
  IF c.request_id IS NOT NULL AND (c.target_tier IS NULL
    OR c.archive_account_ids<>v_archive OR c.active_account_ids<>v_active) THEN
    RAISE EXCEPTION 'Scheduled renewal choice differs' USING ERRCODE='55000'; END IF;
  v_tier:=COALESCE(c.target_tier,g.tier);
  v_retained:=cardinality(v_slots)-cardinality(v_cancel);
  IF (v_tier='starter' AND v_retained<>0)
    OR (v_tier='growth' AND v_retained>1)
    OR cardinality(v_active)-cardinality(v_archive)<1
    OR cardinality(v_active)-cardinality(v_archive)>
      private.subscription_base_included_branches(v_tier)+v_retained THEN
    RAISE EXCEPTION 'Retained branches exceed paid capacity' USING ERRCODE='22023'; END IF;
  INSERT INTO private.subscription_paid_slot_renewal_reviews(request_id,organization_id,
    requested_by,source_period_start,source_period_end,source_generation,
    source_tier,target_tier,source_access_version,source_slot_ids,cancel_slot_ids,
    active_account_ids,archive_account_ids,commercial_policy_version)
  VALUES(p_request_id,p_organization_id,auth.uid(),g.period_start,g.paid_through_end,
    g.term_generation,g.tier,v_tier,a.version,v_slots,v_cancel,v_active,v_archive,
    s.advanced_policy_version) RETURNING * INTO r;
  RETURN to_jsonb(r);
END;
$$;

-- Called under the organization lock by all three renewal stages. A missing
-- review is a hard stop whenever the source term has purchased capacity.
CREATE OR REPLACE FUNCTION private.subscription_checked_paid_slot_renewal(
  p_organization_id UUID,p_source_end TIMESTAMPTZ,p_target_tier TEXT,
  p_version INTEGER,p_active UUID[],p_archive UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.organization_paid_subscription_grants;
  r private.subscription_paid_slot_renewal_reviews;
  v_slots UUID[]; v_retained INTEGER;
  s private.subscription_billing_settings;
BEGIN
  SELECT * INTO g FROM private.organization_paid_subscription_grants
    WHERE organization_id=p_organization_id;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_slots
    FROM private.subscription_paid_branch_slots
    WHERE organization_id=p_organization_id AND generation=g.term_generation
      AND cancelled_at IS NULL AND paid_through_end>=p_source_end;
  IF cardinality(v_slots)=0 THEN RETURN 0; END IF;
  s:=private.subscription_assert_advanced_policy();
  SELECT * INTO r FROM private.subscription_paid_slot_renewal_reviews
    WHERE organization_id=p_organization_id AND source_period_end=p_source_end;
  IF r.request_id IS NULL OR r.source_period_start<>g.period_start
    OR r.source_generation<>g.term_generation OR r.source_tier<>g.tier
    OR r.target_tier<>p_target_tier OR NOT (
      r.source_access_version=p_version OR
      (r.source_access_version=p_version-1 AND EXISTS(
        SELECT 1 FROM private.organization_subscription_intents i
        WHERE i.organization_id=p_organization_id AND i.kind='renewal'
          AND i.source_period_end=p_source_end AND i.first_failed_at IS NOT NULL
          AND i.expected_access_version=p_version)))
    OR r.source_slot_ids<>v_slots OR NOT r.cancel_slot_ids<@v_slots
    OR r.active_account_ids<>p_active OR r.archive_account_ids<>p_archive
    OR r.commercial_policy_version<>s.advanced_policy_version
    OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id=p_organization_id AND m.user_id=r.requested_by
        AND m.role='owner') THEN
    RAISE EXCEPTION 'Paid slot renewal choice changed; review required' USING ERRCODE='55000';
  END IF;
  v_retained:=cardinality(v_slots)-cardinality(r.cancel_slot_ids);
  IF (p_target_tier='starter' AND v_retained<>0)
    OR (p_target_tier='growth' AND v_retained>1)
    OR cardinality(p_active)-cardinality(p_archive)<1
    OR cardinality(p_active)-cardinality(p_archive)>
      private.subscription_base_included_branches(p_target_tier)+v_retained THEN
    RAISE EXCEPTION 'Retained branches exceed paid capacity' USING ERRCODE='55000';
  END IF;
  RETURN v_retained;
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_review_test_paid_slot_renewal(UUID,UUID,UUID[],UUID[]),
  private.subscription_checked_paid_slot_renewal(UUID,TIMESTAMPTZ,TEXT,INTEGER,UUID[],UUID[])
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_review_test_paid_slot_renewal(UUID,UUID,UUID[],UUID[])
  TO authenticated;
ALTER FUNCTION public.subscription_review_test_paid_slot_renewal(UUID,UUID,UUID[],UUID[]) OWNER TO postgres;
ALTER FUNCTION private.subscription_checked_paid_slot_renewal(UUID,TIMESTAMPTZ,TEXT,INTEGER,UUID[],UUID[]) OWNER TO postgres;

-- Replace the legacy base-only renewal path with a single base-plus-slots order.
CREATE OR REPLACE FUNCTION public.subscription_create_test_renewal_intent(
  p_organization_id UUID,p_request_id UUID,p_billing_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.organization_paid_subscription_grants; c private.subscription_renewal_changes;
  i private.organization_subscription_intents; r private.subscription_paid_slot_renewal_reviews;
  v_active UUID[]; v_archive UUID[]; v_tier TEXT; v_version INTEGER; v_slots INTEGER;
BEGIN
  IF NOT COALESCE((SELECT enabled FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Subscription billing is not enabled' USING ERRCODE='55000'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  g:=private.subscription_assert_current_term(p_organization_id);
  IF now()<g.paid_through_end OR now()>=g.paid_through_end+interval '1 month' THEN
    RAISE EXCEPTION 'Renewal is outside this term; review required' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM private.subscription_renewal_changes WHERE organization_id=p_organization_id
    AND source_period_end=g.paid_through_end;
  IF FOUND AND c.target_tier IS NULL THEN RAISE EXCEPTION 'Renewal is cancelled' USING ERRCODE='55000'; END IF;
  v_tier:=COALESCE(c.target_tier,g.tier);
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  IF c.request_id IS NOT NULL AND (c.active_account_ids<>v_active OR c.source_tier<>g.tier
    OR c.source_period_start<>g.period_start) THEN
    RAISE EXCEPTION 'Scheduled branch roster changed; review required' USING ERRCODE='55000'; END IF;
  SELECT version INTO v_version FROM private.organization_product_access WHERE organization_id=p_organization_id;
  SELECT * INTO r FROM private.subscription_paid_slot_renewal_reviews
    WHERE organization_id=p_organization_id AND source_period_end=g.paid_through_end;
  v_archive:=COALESCE(r.archive_account_ids,c.archive_account_ids,'{}'::UUID[]);
  v_slots:=private.subscription_checked_paid_slot_renewal(p_organization_id,
    g.paid_through_end,v_tier,v_version,v_active,v_archive);
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_billing_account_id AND organization_id=p_organization_id
    AND branch_status='active' AND default_currency='INR' AND public.has_account_membership(id)
    AND id<>ALL(v_archive)) OR EXISTS(SELECT 1 FROM public.accounts
      WHERE organization_id=p_organization_id AND branch_status='active' AND default_currency<>'INR') THEN
    RAISE EXCEPTION 'An active retained INR billing branch is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO i FROM private.organization_subscription_intents WHERE request_id=p_request_id;
  IF FOUND AND (i.organization_id<>p_organization_id OR i.kind<>'renewal' OR i.source_period_end<>g.paid_through_end) THEN
    RAISE EXCEPTION 'Request already used' USING ERRCODE='23505'; END IF;
  SELECT * INTO i FROM private.organization_subscription_intents WHERE organization_id=p_organization_id
    AND kind='renewal' AND source_period_end=g.paid_through_end;
  IF FOUND THEN RETURN to_jsonb(i); END IF;
  INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,billing_account_id,
    tier,amount_minor,kind,source_period_start,source_period_end,source_tier,expected_access_version,
    archive_account_ids,active_account_ids)
  VALUES(p_request_id,p_organization_id,auth.uid(),p_billing_account_id,v_tier,
    private.subscription_base_monthly_minor(v_tier)+v_slots*49900,'renewal',
    g.period_start,g.paid_through_end,g.tier,v_version,v_archive,v_active) RETURNING * INTO i;
  RETURN to_jsonb(i);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_claim_test_renewal_order(
  p_request_id UUID,p_organization_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents; g private.organization_paid_subscription_grants;
  v_version INTEGER; v_action TEXT; v_active UUID[]; v_slots INTEGER;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=p_organization_id
    AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  g:=private.subscription_assert_current_term(p_organization_id);
  SELECT * INTO i FROM private.organization_subscription_intents
    WHERE request_id=p_request_id AND organization_id=p_organization_id FOR UPDATE;
  SELECT version INTO v_version FROM private.organization_product_access WHERE organization_id=p_organization_id;
  IF i.request_id IS NULL OR i.kind<>'renewal' OR i.state<>'pending'
    OR i.source_period_start<>g.period_start OR i.source_period_end<>g.paid_through_end
    OR i.source_tier<>g.tier OR i.expected_access_version<>v_version
    OR now()<g.paid_through_end OR now()>=g.paid_through_end+interval '1 month' THEN
    RAISE EXCEPTION 'Current pending renewal required' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  IF v_active<>i.active_account_ids OR NOT EXISTS(SELECT 1 FROM public.accounts
    WHERE id=i.billing_account_id AND organization_id=p_organization_id AND branch_status='active'
      AND default_currency='INR' AND id<>ALL(i.archive_account_ids)) OR EXISTS(SELECT 1 FROM public.accounts
        WHERE organization_id=p_organization_id AND branch_status='active' AND default_currency<>'INR') THEN
    RAISE EXCEPTION 'Renewal branches changed; review required' USING ERRCODE='55000'; END IF;
  v_slots:=private.subscription_checked_paid_slot_renewal(p_organization_id,
    g.paid_through_end,i.tier,v_version,v_active,i.archive_account_ids);
  IF i.amount_minor<>private.subscription_base_monthly_minor(i.tier)+v_slots*49900 THEN
    RAISE EXCEPTION 'Renewal price changed; review required' USING ERRCODE='55000'; END IF;
  IF i.provider_order_id IS NOT NULL THEN v_action:='bound';
  ELSIF i.order_requested_at IS NOT NULL THEN v_action:='recovery';
  ELSE
    v_action:='create';
    UPDATE private.organization_subscription_intents SET order_requested_at=now() WHERE request_id=p_request_id;
  END IF;
  RETURN to_jsonb(i)||jsonb_build_object('action',v_action);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_commit_test_renewal_payment(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT,p_verified_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents; g private.organization_paid_subscription_grants;
  a private.organization_product_access; p private.organization_subscription_payments;
  v_org UUID; v_active UUID[]; v_zone TEXT; v_next_end TIMESTAMPTZ;
  v_slots INTEGER; r private.subscription_paid_slot_renewal_reviews;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  SELECT organization_id INTO v_org FROM private.organization_subscription_intents WHERE request_id=p_request_id;
  PERFORM 1 FROM public.organizations WHERE id=v_org FOR UPDATE;
  SELECT * INTO i FROM private.organization_subscription_intents WHERE request_id=p_request_id FOR UPDATE;
  IF i.request_id IS NULL OR i.kind<>'renewal' OR i.provider_order_id IS DISTINCT FROM p_provider_order_id
    OR p_provider_order_id IS NULL OR i.amount_minor IS DISTINCT FROM p_amount_minor
    OR i.currency IS DISTINCT FROM p_currency OR p_provider_payment_id IS NULL
    OR p_provider_payment_id!~'^pay_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Payment does not match renewal' USING ERRCODE='22023'; END IF;
  IF i.state='verified' THEN
    SELECT * INTO p FROM private.organization_subscription_payments WHERE intent_id=p_request_id;
    IF p.provider_payment_id IS DISTINCT FROM p_provider_payment_id OR p.provider_merchant_id IS DISTINCT FROM p_provider_merchant_id
      OR p.amount_minor IS DISTINCT FROM p_amount_minor OR p.currency IS DISTINCT FROM p_currency THEN
      RAISE EXCEPTION 'Renewal replay differs' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('payment',to_jsonb(p),'access',private.product_access_snapshot(v_org));
  END IF;
  IF i.state='review_required' THEN
    IF NOT EXISTS(SELECT 1 FROM private.subscription_advanced_payment_exceptions e
      WHERE e.intent_id=p_request_id AND e.provider_order_id=p_provider_order_id
        AND e.provider_payment_id=p_provider_payment_id
        AND e.provider_merchant_id=p_provider_merchant_id
        AND e.amount_minor=p_amount_minor) THEN
      RAISE EXCEPTION 'Review-held renewal replay differs' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('status','review_required','organization_id',v_org,
      'request_id',p_request_id,'kind','renewal',
      'provider_payment_id',p_provider_payment_id);
  END IF;
  BEGIN
  g:=private.subscription_assert_current_term(v_org);
  SELECT * INTO a FROM private.organization_product_access WHERE organization_id=v_org;
  v_next_end:=g.paid_through_end+interval '1 month';
  IF i.state<>'pending' OR i.source_period_start<>g.period_start OR i.source_period_end<>g.paid_through_end
    OR i.source_tier<>g.tier OR i.expected_access_version<>a.version
    OR p_verified_at IS NULL OR NOT isfinite(p_verified_at) OR p_verified_at<i.requested_at
    OR p_verified_at<g.paid_through_end OR p_verified_at>=v_next_end
    OR p_verified_at>now()+interval '1 minute' OR now()>=v_next_end THEN
    RAISE EXCEPTION 'Current renewal term required' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=v_org
    AND user_id=i.requested_by AND role='owner') OR EXISTS(SELECT 1 FROM unnest(i.archive_account_ids) id
      WHERE NOT EXISTS(SELECT 1 FROM public.account_memberships am WHERE am.account_id=id
        AND am.user_id=i.requested_by AND am.role='owner')) THEN
    RAISE EXCEPTION 'Archive authorization changed' USING ERRCODE='42501'; END IF;
  -- Lock accounts after organization, and require the entire reviewed roster.
  PERFORM 1 FROM public.accounts WHERE organization_id=v_org ORDER BY id FOR UPDATE;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active FROM public.accounts
    WHERE organization_id=v_org AND branch_status='active';
  v_slots:=private.subscription_checked_paid_slot_renewal(v_org,
    g.paid_through_end,i.tier,a.version,v_active,i.archive_account_ids);
  IF i.amount_minor<>private.subscription_base_monthly_minor(i.tier)+v_slots*49900 THEN
    RAISE EXCEPTION 'Renewal price changed; review required' USING ERRCODE='55000'; END IF;
  IF v_active<>i.active_account_ids OR NOT i.archive_account_ids<@v_active
    OR cardinality(v_active)-cardinality(i.archive_account_ids)<1
    OR cardinality(v_active)-cardinality(i.archive_account_ids)>private.subscription_base_included_branches(i.tier)+v_slots THEN
    RAISE EXCEPTION 'Branch roster changed or exceeds capacity' USING ERRCODE='22023'; END IF;
  SELECT timezone INTO v_zone FROM public.accounts WHERE id=i.billing_account_id
    AND organization_id=v_org AND branch_status='active' AND default_currency='INR'
    AND id<>ALL(i.archive_account_ids);
  IF v_zone IS NULL OR EXISTS(SELECT 1 FROM public.accounts WHERE organization_id=v_org
    AND branch_status='active' AND default_currency<>'INR') THEN
    RAISE EXCEPTION 'INR billing branch required' USING ERRCODE='22023'; END IF;
  INSERT INTO private.organization_subscription_payments(provider_payment_id,provider_order_id,organization_id,intent_id,
    provider_merchant_id,provider_mode,amount_minor,currency,billing_timezone,verified_at)
    VALUES(p_provider_payment_id,p_provider_order_id,v_org,p_request_id,p_provider_merchant_id,'test',
      p_amount_minor,p_currency,v_zone,p_verified_at) RETURNING * INTO p;
  UPDATE public.accounts SET branch_status='archived',readiness_state='attention',archived_at=now()
    WHERE organization_id=v_org AND id=ANY(i.archive_account_ids);
  INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation)
    SELECT v_org,id,i.requested_by,'branch.archived' FROM unnest(i.archive_account_ids) id;
  PERFORM set_config('app.subscription_slot_renewal_intent',p_request_id::TEXT,TRUE);
  UPDATE private.organization_paid_subscription_grants SET tier=i.tier,period_start=p_verified_at,paid_through_end=v_next_end
    WHERE organization_id=v_org;
  SELECT * INTO r FROM private.subscription_paid_slot_renewal_reviews
    WHERE organization_id=v_org AND source_period_end=i.source_period_end;
  IF v_slots>0 OR r.request_id IS NOT NULL THEN
    UPDATE private.subscription_paid_branch_slots SET cancelled_at=p_verified_at
      WHERE organization_id=v_org AND generation=g.term_generation
        AND id=ANY(r.cancel_slot_ids);
    UPDATE private.subscription_paid_branch_slots SET paid_through_end=v_next_end
      WHERE organization_id=v_org AND generation=g.term_generation
        AND id=ANY(r.source_slot_ids) AND id<>ALL(r.cancel_slot_ids);
    UPDATE private.subscription_paid_slot_renewal_reviews SET committed_at=p_verified_at
      WHERE request_id=r.request_id;
  END IF;
  UPDATE private.organization_subscription_intents SET state='verified',provider_payment_id=p_provider_payment_id,
    verified_at=p_verified_at WHERE request_id=p_request_id;
  UPDATE private.subscription_renewal_changes SET committed_at=p_verified_at
    WHERE organization_id=v_org AND source_period_end=i.source_period_end;
  UPDATE private.organization_product_access SET access_starts_at=p_verified_at,access_ends_at=v_next_end,
    version=version+1,updated_at=now() WHERE organization_id=v_org;
  INSERT INTO private.product_access_audit(organization_id,action,reason,before_state,after_state)
    SELECT v_org,'verified_subscription_renewal','Verified Test monthly renewal',to_jsonb(a),to_jsonb(x)
    FROM private.organization_product_access x WHERE x.organization_id=v_org;
  RETURN jsonb_build_object('payment',to_jsonb(p),'access',private.product_access_snapshot(v_org));
  EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE '22023' OR SQLSTATE '42501' THEN
    INSERT INTO private.subscription_advanced_payment_exceptions(
      provider_payment_id,intent_id,organization_id,provider_order_id,
      provider_merchant_id,amount_minor,reason)
    VALUES(p_provider_payment_id,p_request_id,v_org,p_provider_order_id,
      p_provider_merchant_id,p_amount_minor,'renewal_review_required_'||SQLSTATE);
    UPDATE private.organization_subscription_intents SET
      state='review_required',provider_payment_id=p_provider_payment_id,
      verified_at=p_verified_at WHERE request_id=p_request_id;
    RETURN jsonb_build_object('status','review_required','organization_id',v_org,
      'request_id',p_request_id,'kind','renewal',
      'provider_payment_id',p_provider_payment_id);
  END;
END;
$$;

-- A failed callback cannot add grace after a captured payment is review-held.
CREATE OR REPLACE FUNCTION public.subscription_record_test_renewal_failure(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_payment_id TEXT,p_provider_merchant_id TEXT,
  p_amount_minor BIGINT,p_currency TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents; g private.organization_paid_subscription_grants;
  a private.organization_product_access; v_org UUID;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  SELECT organization_id INTO v_org FROM private.organization_subscription_intents WHERE request_id=p_request_id;
  PERFORM 1 FROM public.organizations WHERE id=v_org FOR UPDATE;
  SELECT * INTO i FROM private.organization_subscription_intents WHERE request_id=p_request_id FOR UPDATE;
  IF i.request_id IS NULL OR i.kind<>'renewal' OR i.provider_order_id IS DISTINCT FROM p_provider_order_id
    OR i.amount_minor IS DISTINCT FROM p_amount_minor OR i.currency IS DISTINCT FROM p_currency
    OR p_provider_payment_id IS NULL OR p_provider_payment_id!~'^pay_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Failure does not match renewal' USING ERRCODE='22023'; END IF;
  IF i.state IN ('verified','review_required') THEN RETURN; END IF;
  g:=private.subscription_assert_current_term(v_org);
  SELECT * INTO a FROM private.organization_product_access WHERE organization_id=v_org;
  IF i.source_period_end<>g.paid_through_end OR i.source_period_start<>g.period_start
    OR i.source_tier<>g.tier OR i.expected_access_version<>a.version THEN
    RAISE EXCEPTION 'Renewal term changed' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_renewal_failures WHERE provider_payment_id=p_provider_payment_id
    AND intent_id<>p_request_id) OR EXISTS(SELECT 1 FROM private.organization_subscription_payments
    WHERE provider_payment_id=p_provider_payment_id) THEN
    RAISE EXCEPTION 'Payment already used' USING ERRCODE='23505'; END IF;
  INSERT INTO private.subscription_renewal_failures(provider_payment_id,intent_id)
    VALUES(p_provider_payment_id,p_request_id) ON CONFLICT DO NOTHING;
  IF i.first_failed_at IS NOT NULL THEN RETURN; END IF;
  -- An already elapsed grace never reopens access.
  UPDATE private.organization_subscription_intents SET first_failed_at=now(),
    expected_access_version=CASE WHEN now()<g.paid_through_end+interval '72 hours' THEN a.version+1 ELSE a.version END
    WHERE request_id=p_request_id;
  IF now()<g.paid_through_end+interval '72 hours' THEN
    UPDATE private.organization_product_access SET access_ends_at=g.paid_through_end+interval '72 hours',
      version=version+1,updated_at=now() WHERE organization_id=v_org;
    INSERT INTO private.product_access_audit(organization_id,action,reason,before_state,after_state)
      SELECT v_org,'subscription_renewal_grace','Verified Test renewal failure; fixed 72-hour grace',to_jsonb(a),to_jsonb(x)
      FROM private.organization_product_access x WHERE x.organization_id=v_org;
  END IF;
END;
$$;


-- A paid-slot term can move only inside the reviewed verified-renewal RPC.
CREATE OR REPLACE FUNCTION private.subscription_hold_slot_renewal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_request TEXT;
BEGIN
  IF NEW.term_generation=OLD.term_generation
    AND NEW.paid_through_end IS DISTINCT FROM OLD.paid_through_end
    AND EXISTS(SELECT 1 FROM private.subscription_paid_branch_slots s
      WHERE s.organization_id=OLD.organization_id
        AND s.generation=OLD.term_generation AND s.cancelled_at IS NULL
        AND s.paid_through_end>=OLD.paid_through_end) THEN
    v_request:=current_setting('app.subscription_slot_renewal_intent',TRUE);
    IF v_request IS NULL OR NOT EXISTS(
      SELECT 1 FROM private.organization_subscription_intents i
      WHERE i.request_id::TEXT=v_request AND i.organization_id=OLD.organization_id
        AND i.kind='renewal' AND i.state='pending'
        AND i.source_period_end=OLD.paid_through_end
        AND i.provider_payment_id IS NULL) THEN
      RAISE EXCEPTION 'Paid slot renewal needs verified owner choice'
        USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_create_test_renewal_intent(UUID,UUID,UUID),
  public.subscription_claim_test_renewal_order(UUID,UUID,UUID,TEXT),
  public.subscription_commit_test_renewal_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ),
  public.subscription_record_test_renewal_failure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_create_test_renewal_intent(UUID,UUID,UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_claim_test_renewal_order(UUID,UUID,UUID,TEXT),
  public.subscription_commit_test_renewal_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ),
  public.subscription_record_test_renewal_failure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT)
  TO service_role;
ALTER FUNCTION public.subscription_create_test_renewal_intent(UUID,UUID,UUID) OWNER TO postgres;
ALTER FUNCTION public.subscription_claim_test_renewal_order(UUID,UUID,UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_commit_test_renewal_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION private.subscription_hold_slot_renewal() OWNER TO postgres;
ALTER FUNCTION public.subscription_record_test_renewal_failure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT) OWNER TO postgres;

-- Owner billing view: current-term status, exact active slots and branch IDs.
-- Policy values appear only after the private advanced switch is enabled.
CREATE OR REPLACE FUNCTION public.subscription_test_billing_snapshot(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_billing_settings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_billing_settings WHERE singleton;
  IF NOT COALESCE(s.enabled,FALSE) THEN
    RAISE EXCEPTION 'Test billing disabled' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('organization_id',p_organization_id,
    'grant',(SELECT to_jsonb(g) FROM private.organization_paid_subscription_grants g
      WHERE organization_id=p_organization_id),
    'access',private.product_access_snapshot(p_organization_id),
    'change',(SELECT to_jsonb(c) FROM private.subscription_renewal_changes c
      JOIN private.organization_paid_subscription_grants g USING(organization_id)
      WHERE c.organization_id=p_organization_id AND c.source_period_end=g.paid_through_end),
    'claim',(SELECT to_jsonb(c) FROM private.subscription_first_refund_claims c
      WHERE organization_id=p_organization_id),
    'refund',(SELECT to_jsonb(e) FROM private.subscription_refund_executions e
      WHERE organization_id=p_organization_id),
    'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.verified_at DESC),'[]'::JSONB)
      FROM (SELECT amount_minor,currency,verified_at,provider_payment_id
        FROM private.organization_subscription_payments
        WHERE organization_id=p_organization_id ORDER BY verified_at DESC LIMIT 12) p),
    'refunds_enabled',s.refunds_enabled,
    'advanced_available',COALESCE(s.advanced_payments_enabled AND
      s.advanced_commercial_approved,FALSE),
    'starter_reminder_policy',CASE WHEN s.advanced_payments_enabled AND
      s.standard_reminder_policy_approved THEN jsonb_build_object(
        'version',s.standard_reminder_policy_version,
        'days_before',s.standard_reminder_days_before,
        'hour_local',s.standard_reminder_hour_local)
      ELSE NULL END,
    'active_branches',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',b.id,'name',b.name,'owned',public.has_account_membership(b.id,'owner'))
      ORDER BY b.name,b.id),'[]'::JSONB) FROM public.accounts b
      WHERE b.organization_id=p_organization_id AND b.branch_status='active'),
    'paid_slots',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',x.id,'paid_through_end',x.paid_through_end) ORDER BY x.id),'[]'::JSONB)
      FROM private.subscription_paid_branch_slots x
      JOIN private.organization_paid_subscription_grants g
        ON g.organization_id=x.organization_id AND g.term_generation=x.generation
      WHERE x.organization_id=p_organization_id AND x.cancelled_at IS NULL
        AND x.paid_through_end>=g.paid_through_end),
    'slot_renewal_review',(SELECT to_jsonb(r)
      FROM private.subscription_paid_slot_renewal_reviews r
      JOIN private.organization_paid_subscription_grants g USING(organization_id)
      WHERE r.organization_id=p_organization_id AND r.source_period_end=g.paid_through_end));
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_test_billing_snapshot(UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_test_billing_snapshot(UUID) TO authenticated;
ALTER FUNCTION public.subscription_test_billing_snapshot(UUID) OWNER TO postgres;
