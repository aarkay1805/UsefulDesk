-- Local/Test draft only. These owner reviews cannot create a provider order,
-- accept a payment, change access, or add branch capacity. Commercial choices
-- for quote expiry, add-on billing, and restart remain unapproved.
CREATE TABLE IF NOT EXISTS private.subscription_advanced_reviews (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  billing_account_id UUID NOT NULL REFERENCES public.accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('upgrade','addon_purchase','addon_cancel','restart')),
  source_tier TEXT CHECK (source_tier IN ('starter','growth','ultimate')),
  target_tier TEXT CHECK (target_tier IN ('starter','growth','ultimate')),
  source_period_start TIMESTAMPTZ,
  source_period_end TIMESTAMPTZ,
  source_access_version INTEGER NOT NULL CHECK (source_access_version>0),
  active_account_ids UUID[] NOT NULL,
  archive_account_ids UUID[] NOT NULL DEFAULT '{}',
  requested_slots INTEGER NOT NULL DEFAULT 0 CHECK (requested_slots>=0),
  listed_software_minor BIGINT CHECK (listed_software_minor>=0),
  starter_reminder_reset_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  starter_reminder_policy_version TEXT,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  state TEXT NOT NULL DEFAULT 'awaiting_policy' CHECK (state='awaiting_policy'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_period_start IS NULL OR source_period_end>source_period_start),
  CONSTRAINT subscription_advanced_review_reminder_choice
    CHECK ((starter_reminder_reset_accepted
      AND NULLIF(btrim(starter_reminder_policy_version),'') IS NOT NULL
      AND target_tier='starter')
    OR (NOT starter_reminder_reset_accepted AND starter_reminder_policy_version IS NULL))
);
ALTER TABLE private.subscription_advanced_reviews
  ADD COLUMN IF NOT EXISTS starter_reminder_reset_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS starter_reminder_policy_version TEXT;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.subscription_advanced_reviews'::regclass
      AND conname='subscription_advanced_review_reminder_choice') THEN
    ALTER TABLE private.subscription_advanced_reviews
      ADD CONSTRAINT subscription_advanced_review_reminder_choice
      CHECK ((starter_reminder_reset_accepted
        AND NULLIF(btrim(starter_reminder_policy_version),'') IS NOT NULL
        AND target_tier='starter')
        OR (NOT starter_reminder_reset_accepted AND starter_reminder_policy_version IS NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS subscription_advanced_reviews_org_time
  ON private.subscription_advanced_reviews(organization_id,requested_at DESC);
ALTER TABLE private.subscription_advanced_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_advanced_reviews FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.subscription_advanced_reviews FROM service_role;
GRANT SELECT ON private.subscription_advanced_reviews TO service_role;

-- A listed-software calculation for review, not a customer-payable quote.
-- Numeric arithmetic keeps subsecond periods and rounds positive INR paise
-- half-up. The approved payment boundary must later freeze an owner-reviewed
-- expiry, tax treatment, and the exact payable amount before any order.
CREATE OR REPLACE FUNCTION private.subscription_review_upgrade_minor(
  p_from_tier TEXT,p_to_tier TEXT,p_start TIMESTAMPTZ,p_end TIMESTAMPTZ,p_at TIMESTAMPTZ)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_difference BIGINT; v_minor NUMERIC;
BEGIN
  v_difference:=private.subscription_base_monthly_minor(p_to_tier)-
    private.subscription_base_monthly_minor(p_from_tier);
  IF v_difference IS NULL OR v_difference<=0 OR p_start IS NULL OR p_end IS NULL
    OR p_at IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
    OR NOT isfinite(p_at) OR p_start>=p_end OR p_at<p_start OR p_at>=p_end THEN
    RAISE EXCEPTION 'A higher tier within the current paid term is required'
      USING ERRCODE='22023';
  END IF;
  v_minor:=round(v_difference::NUMERIC *
    (extract(epoch FROM (p_end-p_at))*1000000)::NUMERIC /
    (extract(epoch FROM (p_end-p_start))*1000000)::NUMERIC,0);
  IF v_minor<1 THEN
    RAISE EXCEPTION 'Upgrade must wait for the next billing period' USING ERRCODE='22023';
  END IF;
  RETURN v_minor::BIGINT;
END;
$$;

-- One immutable, owner-scoped review records the exact paid term, access
-- version, and active roster under the organization lock. Reusing a request ID
-- returns only the same review; a different payload or tenant is rejected.
CREATE OR REPLACE FUNCTION public.subscription_create_test_advanced_review(
  p_organization_id UUID,p_request_id UUID,p_billing_account_id UUID,
  p_kind TEXT,p_target_tier TEXT,p_requested_slots INTEGER,p_archive_account_ids UUID[],
  p_starter_reminder_reset_accepted BOOLEAN,p_starter_reminder_policy_version TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.organization_paid_subscription_grants;
  a private.organization_product_access;
  r private.subscription_advanced_reviews;
  v_active UUID[]; v_archive UUID[]; v_amount BIGINT;
BEGIN
  IF NOT COALESCE((SELECT enabled FROM private.subscription_billing_settings WHERE singleton),FALSE) THEN
    RAISE EXCEPTION 'Test billing disabled' USING ERRCODE='55000'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_kind IS NULL
    OR p_kind NOT IN ('upgrade','addon_purchase','addon_cancel','restart')
    OR p_requested_slots IS NULL OR p_requested_slots NOT IN (0,1)
    OR p_starter_reminder_reset_accepted IS NULL
    OR (p_starter_reminder_reset_accepted AND
      (p_target_tier IS DISTINCT FROM 'starter'
        OR NULLIF(btrim(p_starter_reminder_policy_version),'') IS NULL))
    OR (NOT p_starter_reminder_reset_accepted AND
      p_starter_reminder_policy_version IS NOT NULL)
    OR p_archive_account_ids IS NULL OR array_position(p_archive_account_ids,NULL) IS NOT NULL
    OR cardinality(p_archive_account_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_archive_account_ids) id) THEN
    RAISE EXCEPTION 'Invalid review request' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_archive
    FROM unnest(p_archive_account_ids) id;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts x WHERE x.id=p_billing_account_id
    AND x.organization_id=p_organization_id AND x.branch_status='active'
    AND x.default_currency='INR' AND public.has_account_membership(x.id))
    OR EXISTS(SELECT 1 FROM public.accounts x WHERE x.organization_id=p_organization_id
      AND x.branch_status='active' AND x.default_currency<>'INR') THEN
    RAISE EXCEPTION 'An active INR billing branch is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  SELECT * INTO g FROM private.organization_paid_subscription_grants
    WHERE organization_id=p_organization_id FOR UPDATE;
  IF a.organization_id IS NULL THEN RAISE EXCEPTION 'Access record required' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_active
    FROM public.accounts WHERE organization_id=p_organization_id AND branch_status='active';
  IF NOT v_archive<@v_active OR EXISTS(SELECT 1 FROM unnest(v_archive) id
    WHERE NOT public.has_account_membership(id,'owner')) OR p_billing_account_id=ANY(v_archive) THEN
    RAISE EXCEPTION 'Choose only owned active branches to archive' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM private.subscription_advanced_reviews WHERE request_id=p_request_id;
  IF FOUND THEN
    IF r.organization_id<>p_organization_id OR r.billing_account_id<>p_billing_account_id
      OR r.kind<>p_kind OR r.target_tier IS DISTINCT FROM p_target_tier
      OR r.requested_slots<>p_requested_slots OR r.archive_account_ids<>v_archive
      OR r.starter_reminder_reset_accepted<>p_starter_reminder_reset_accepted
      OR r.starter_reminder_policy_version IS DISTINCT FROM
        p_starter_reminder_policy_version THEN
      RAISE EXCEPTION 'Request ID already used' USING ERRCODE='23505'; END IF;
    RETURN to_jsonb(r);
  END IF;
  IF p_kind='restart' THEN
    IF g.organization_id IS NULL OR a.mode<>'manual' OR a.suspended_at IS NOT NULL
      OR NOT ((g.current_term_refunded_at IS NOT NULL
        AND g.renewal_stopped_at IS NOT NULL
        AND a.access_ends_at=g.current_term_refunded_at
        AND now()>=g.current_term_refunded_at) OR
        (now()>=g.paid_through_end AND a.access_ends_at=g.paid_through_end
          AND g.current_term_refunded_at IS NULL AND EXISTS(
          SELECT 1 FROM private.subscription_renewal_changes x
          WHERE x.organization_id=p_organization_id
            AND x.source_period_end=g.paid_through_end AND x.target_tier IS NULL))) THEN
      RAISE EXCEPTION 'Ended paid term required for restart review' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM private.organization_subscription_intents i
      WHERE i.organization_id=p_organization_id AND i.state='pending'
        AND i.order_requested_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM private.subscription_first_refund_requests rr
        WHERE rr.organization_id=p_organization_id
          AND NOT EXISTS(SELECT 1 FROM private.subscription_refund_executions e
            WHERE e.organization_id=rr.organization_id AND e.confirmed_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM private.subscription_refund_executions e
        WHERE e.organization_id=p_organization_id AND e.confirmed_at IS NULL) THEN
      RAISE EXCEPTION 'Prior payment or refund needs review' USING ERRCODE='55000'; END IF;
    IF private.subscription_base_monthly_minor(p_target_tier) IS NULL OR p_requested_slots<>0
      OR cardinality(v_active)-cardinality(v_archive)<1
      OR cardinality(v_active)-cardinality(v_archive)>
        private.subscription_base_included_branches(p_target_tier) THEN
      RAISE EXCEPTION 'Review the retained branches and base plan' USING ERRCODE='22023'; END IF;
    v_amount:=private.subscription_base_monthly_minor(p_target_tier);
  ELSE
    g:=private.subscription_assert_current_term(p_organization_id);
    IF now()<g.period_start OR now()>=g.paid_through_end OR a.access_ends_at<>g.paid_through_end THEN
      RAISE EXCEPTION 'Current paid term required' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM private.organization_subscription_intents i
      WHERE i.organization_id=p_organization_id AND i.state='pending' AND i.order_requested_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM private.subscription_renewal_changes x
        WHERE x.organization_id=p_organization_id AND x.source_period_end=g.paid_through_end) THEN
      RAISE EXCEPTION 'Pending order or scheduled change needs review' USING ERRCODE='55000'; END IF;
    IF p_kind='upgrade' THEN
      IF p_requested_slots<>0 OR cardinality(v_archive)<>0 THEN
        RAISE EXCEPTION 'Base upgrade cannot change branches' USING ERRCODE='22023'; END IF;
      v_amount:=private.subscription_review_upgrade_minor(g.tier,p_target_tier,
        g.period_start,g.paid_through_end,now());
      IF cardinality(v_active)>private.subscription_base_included_branches(p_target_tier) THEN
        RAISE EXCEPTION 'Branch roster needs review' USING ERRCODE='22023'; END IF;
    ELSIF p_kind='addon_purchase' THEN
      IF p_target_tier IS DISTINCT FROM g.tier OR p_requested_slots<>1
        OR cardinality(v_archive)<>0 OR g.tier='starter' THEN
        RAISE EXCEPTION 'Choose one eligible extra branch slot' USING ERRCODE='22023'; END IF;
      -- The listed monthly add-on price is approved. Its remaining-term charge is not.
      v_amount:=49900;
    ELSE
      IF p_target_tier IS DISTINCT FROM g.tier OR p_requested_slots<>1 THEN
        RAISE EXCEPTION 'Choose one purchased slot to cancel' USING ERRCODE='22023'; END IF;
      -- There are no payable add-on purchases yet, so cancellation stays a review.
      v_amount:=NULL;
    END IF;
  END IF;
  INSERT INTO private.subscription_advanced_reviews(request_id,organization_id,requested_by,
    billing_account_id,kind,source_tier,target_tier,source_period_start,source_period_end,
    source_access_version,active_account_ids,archive_account_ids,requested_slots,listed_software_minor,
    starter_reminder_reset_accepted,starter_reminder_policy_version)
  VALUES(p_request_id,p_organization_id,auth.uid(),p_billing_account_id,p_kind,g.tier,
    p_target_tier,g.period_start,g.paid_through_end,a.version,v_active,v_archive,
    p_requested_slots,v_amount,p_starter_reminder_reset_accepted,
    p_starter_reminder_policy_version) RETURNING * INTO r;
  RETURN to_jsonb(r);
END;
$$;

REVOKE ALL ON FUNCTION private.subscription_review_upgrade_minor(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ),
  public.subscription_create_test_advanced_review(UUID,UUID,UUID,TEXT,TEXT,INTEGER,UUID[],BOOLEAN,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_create_test_advanced_review(UUID,UUID,UUID,TEXT,TEXT,INTEGER,UUID[],BOOLEAN,TEXT)
  TO authenticated;
ALTER FUNCTION private.subscription_review_upgrade_minor(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION public.subscription_create_test_advanced_review(UUID,UUID,UUID,TEXT,TEXT,INTEGER,UUID[],BOOLEAN,TEXT) OWNER TO postgres;
