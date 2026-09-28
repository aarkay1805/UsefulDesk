-- PRIVATE TEST DRAFT. Never apply to Production. Orders only: no recurring
-- provider schedule, upgrades, add-ons, or refund money movement is enabled.
ALTER TABLE private.organization_subscription_intents
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','renewal')),
  ADD COLUMN IF NOT EXISTS source_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_tier TEXT,
  ADD COLUMN IF NOT EXISTS expected_access_version INTEGER,
  ADD COLUMN IF NOT EXISTS archive_account_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS active_account_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS first_failed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_one_renewal_per_term
  ON private.organization_subscription_intents(organization_id,source_period_end)
  WHERE kind='renewal';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.organization_subscription_intents'::regclass
    AND conname='subscription_renewal_term_required') THEN
    ALTER TABLE private.organization_subscription_intents ADD CONSTRAINT subscription_renewal_term_required
      CHECK(kind='initial' OR (source_period_start IS NOT NULL AND source_period_end IS NOT NULL
        AND isfinite(source_period_start) AND isfinite(source_period_end) AND source_period_end>source_period_start
        AND source_tier IS NOT NULL AND source_tier IN ('starter','growth','ultimate')
        AND expected_access_version IS NOT NULL AND expected_access_version>0));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS private.subscription_renewal_changes (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  source_period_start TIMESTAMPTZ NOT NULL,
  source_period_end TIMESTAMPTZ NOT NULL,
  source_tier TEXT NOT NULL CHECK (source_tier IN ('starter','growth','ultimate')),
  target_tier TEXT CHECK (target_tier IN ('starter','growth','ultimate')),
  archive_account_ids UUID[] NOT NULL,
  active_account_ids UUID[] NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ,
  UNIQUE(organization_id,source_period_end)
);
CREATE TABLE IF NOT EXISTS private.subscription_renewal_failures (
  provider_payment_id TEXT PRIMARY KEY,
  intent_id UUID NOT NULL REFERENCES private.organization_subscription_intents(request_id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE private.subscription_renewal_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_renewal_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_renewal_changes,private.subscription_renewal_failures FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.subscription_renewal_changes,private.subscription_renewal_failures TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_assert_test_service(p_merchant TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF NOT COALESCE((SELECT enabled AND test_merchant_account_id=p_merchant
    FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Test merchant billing is not enabled' USING ERRCODE='55000';
  END IF;
END;
$$;

-- Call after taking the organization lock. Platform corrections/suspensions
-- never get overwritten by an old billing callback.
CREATE OR REPLACE FUNCTION private.subscription_assert_current_term(p_organization_id UUID)
RETURNS private.organization_paid_subscription_grants
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.organization_paid_subscription_grants; a private.organization_product_access;
BEGIN
  SELECT * INTO g FROM private.organization_paid_subscription_grants WHERE organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Existing paid grant required' USING ERRCODE='22023'; END IF;
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

-- A schedule is immutable in this slice; changing/undoing it requires a later
-- reviewed path. No archives or access changes happen while scheduling.
CREATE OR REPLACE FUNCTION public.subscription_schedule_test_renewal_change(
  p_organization_id UUID,p_request_id UUID,p_target_tier TEXT,p_archive_account_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.organization_paid_subscription_grants; c private.subscription_renewal_changes;
  v_active UUID[]; v_selected UUID[]; v_kept INTEGER;
BEGIN
  IF NOT COALESCE((SELECT enabled FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Subscription billing is not enabled' USING ERRCODE='55000'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_archive_account_ids IS NULL
    OR array_position(p_archive_account_ids,NULL) IS NOT NULL
    OR cardinality(p_archive_account_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_archive_account_ids) id) THEN
    RAISE EXCEPTION 'Distinct archive choices required' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_selected FROM unnest(p_archive_account_ids) id;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  SELECT * INTO c FROM private.subscription_renewal_changes WHERE request_id=p_request_id;
  IF FOUND THEN
    IF c.organization_id IS DISTINCT FROM p_organization_id OR c.target_tier IS DISTINCT FROM p_target_tier
      OR c.archive_account_ids IS DISTINCT FROM v_selected THEN
      RAISE EXCEPTION 'Request already used' USING ERRCODE='23505'; END IF;
    RETURN to_jsonb(c);
  END IF;
  g:=private.subscription_assert_current_term(p_organization_id);
  IF now()<g.period_start OR now()>=g.paid_through_end THEN
    RAISE EXCEPTION 'Schedule before the paid term ends' USING ERRCODE='22023'; END IF;
  IF p_target_tier IS NOT NULL AND (private.subscription_base_monthly_minor(p_target_tier) IS NULL
    OR private.subscription_base_monthly_minor(p_target_tier)>=private.subscription_base_monthly_minor(g.tier)) THEN
    RAISE EXCEPTION 'Choose a lower tier' USING ERRCODE='22023'; END IF;
  IF p_target_tier IS NULL AND cardinality(v_selected)>0 THEN
    RAISE EXCEPTION 'Cancellation cannot archive branches' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM private.organization_subscription_intents WHERE organization_id=p_organization_id
    AND kind='renewal' AND source_period_end=g.paid_through_end) THEN
    RAISE EXCEPTION 'Renewal already prepared' USING ERRCODE='55000'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  IF NOT v_selected<@v_active OR EXISTS(SELECT 1 FROM unnest(v_selected) id
    WHERE NOT public.has_account_membership(id,'owner')) THEN
    RAISE EXCEPTION 'Choose only active branches you own' USING ERRCODE='42501'; END IF;
  v_kept:=cardinality(v_active)-cardinality(v_selected);
  IF p_target_tier IS NOT NULL AND (v_kept<1 OR v_kept>private.subscription_base_included_branches(p_target_tier)) THEN
    RAISE EXCEPTION 'Choose branches within the lower plan allowance' USING ERRCODE='22023'; END IF;
  INSERT INTO private.subscription_renewal_changes(request_id,organization_id,requested_by,
    source_period_start,source_period_end,source_tier,target_tier,archive_account_ids,active_account_ids)
  VALUES(p_request_id,p_organization_id,auth.uid(),g.period_start,g.paid_through_end,g.tier,p_target_tier,v_selected,v_active)
  RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

-- Renewal is owner initiated at/after the boundary; never an automatic debit.
-- One order covers one term anchored to the previous paid-through boundary.
CREATE OR REPLACE FUNCTION public.subscription_create_test_renewal_intent(
  p_organization_id UUID,p_request_id UUID,p_billing_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.organization_paid_subscription_grants; c private.subscription_renewal_changes;
  i private.organization_subscription_intents; v_active UUID[]; v_tier TEXT; v_version INTEGER;
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
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_billing_account_id AND organization_id=p_organization_id
    AND branch_status='active' AND default_currency='INR' AND public.has_account_membership(id)
    AND id<>ALL(COALESCE(c.archive_account_ids,'{}'::UUID[]))) OR EXISTS(SELECT 1 FROM public.accounts
      WHERE organization_id=p_organization_id AND branch_status='active' AND default_currency<>'INR') THEN
    RAISE EXCEPTION 'An active retained INR billing branch is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO i FROM private.organization_subscription_intents WHERE request_id=p_request_id;
  IF FOUND AND (i.organization_id<>p_organization_id OR i.kind<>'renewal' OR i.source_period_end<>g.paid_through_end) THEN
    RAISE EXCEPTION 'Request already used' USING ERRCODE='23505'; END IF;
  SELECT * INTO i FROM private.organization_subscription_intents WHERE organization_id=p_organization_id
    AND kind='renewal' AND source_period_end=g.paid_through_end;
  IF FOUND THEN RETURN to_jsonb(i); END IF;
  SELECT version INTO v_version FROM private.organization_product_access WHERE organization_id=p_organization_id;
  INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,billing_account_id,
    tier,amount_minor,kind,source_period_start,source_period_end,source_tier,expected_access_version,
    archive_account_ids,active_account_ids)
  VALUES(p_request_id,p_organization_id,auth.uid(),p_billing_account_id,v_tier,
    private.subscription_base_monthly_minor(v_tier),'renewal',g.period_start,g.paid_through_end,g.tier,v_version,
    COALESCE(c.archive_account_ids,'{}'::UUID[]),v_active) RETURNING * INTO i;
  RETURN to_jsonb(i);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_claim_test_renewal_order(
  p_request_id UUID,p_organization_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents; g private.organization_paid_subscription_grants;
  v_version INTEGER; v_action TEXT; v_active UUID[];
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
  IF i.provider_order_id IS NOT NULL THEN v_action:='bound';
  ELSIF i.order_requested_at IS NOT NULL THEN v_action:='recovery';
  ELSE
    v_action:='create';
    UPDATE private.organization_subscription_intents SET order_requested_at=now() WHERE request_id=p_request_id;
  END IF;
  RETURN to_jsonb(i)||jsonb_build_object('action',v_action);
END;
$$;

-- Shared lookup keeps the original first-payment path compatible.
CREATE OR REPLACE FUNCTION public.subscription_test_intent_for_order(p_provider_order_id TEXT,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents;
BEGIN
  PERFORM private.subscription_assert_test_service(p_provider_merchant_id);
  SELECT * INTO i FROM private.organization_subscription_intents WHERE provider_order_id=p_provider_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bound order not found' USING ERRCODE='22023'; END IF;
  RETURN to_jsonb(i);
END;
$$;

-- Signed webhook plus fresh failed-payment GET is required by the server.
-- Never move the stored paid-through instant; repeated failures do not add time.
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
  IF i.state='verified' THEN RETURN; END IF;
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

CREATE OR REPLACE FUNCTION public.subscription_commit_test_renewal_payment(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT,p_verified_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents; g private.organization_paid_subscription_grants;
  a private.organization_product_access; p private.organization_subscription_payments;
  v_org UUID; v_active UUID[]; v_zone TEXT; v_next_end TIMESTAMPTZ;
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
  IF v_active<>i.active_account_ids OR NOT i.archive_account_ids<@v_active
    OR cardinality(v_active)-cardinality(i.archive_account_ids)<1
    OR cardinality(v_active)-cardinality(i.archive_account_ids)>private.subscription_base_included_branches(i.tier) THEN
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
  UPDATE private.organization_paid_subscription_grants SET tier=i.tier,period_start=p_verified_at,paid_through_end=v_next_end
    WHERE organization_id=v_org;
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
END;
$$;

REVOKE ALL ON FUNCTION private.subscription_assert_test_service(TEXT),
  private.subscription_assert_current_term(UUID),
  public.subscription_schedule_test_renewal_change(UUID,UUID,TEXT,UUID[]),
  public.subscription_create_test_renewal_intent(UUID,UUID,UUID),
  public.subscription_claim_test_renewal_order(UUID,UUID,UUID,TEXT),
  public.subscription_record_test_renewal_failure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT),
  public.subscription_commit_test_renewal_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_schedule_test_renewal_change(UUID,UUID,TEXT,UUID[]),
  public.subscription_create_test_renewal_intent(UUID,UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_claim_test_renewal_order(UUID,UUID,UUID,TEXT),
  public.subscription_record_test_renewal_failure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT),
  public.subscription_commit_test_renewal_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) TO service_role;

ALTER FUNCTION private.subscription_assert_test_service(TEXT) OWNER TO postgres;
ALTER FUNCTION private.subscription_assert_current_term(UUID) OWNER TO postgres;
ALTER FUNCTION public.subscription_schedule_test_renewal_change(UUID,UUID,TEXT,UUID[]) OWNER TO postgres;
ALTER FUNCTION public.subscription_create_test_renewal_intent(UUID,UUID,UUID) OWNER TO postgres;
ALTER FUNCTION public.subscription_claim_test_renewal_order(UUID,UUID,UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_test_intent_for_order(TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_record_test_renewal_failure(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.subscription_commit_test_renewal_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) OWNER TO postgres;
