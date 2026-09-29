-- DRAFT, DEFAULT OFF. An empty approval ledger is the only source for a new
-- owner-reviewed Live quote. No price, tax or quote lifetime is supplied by
-- application code. This migration cannot enable quote or payment initiation.
ALTER TABLE private.subscription_live_settings
  ADD COLUMN IF NOT EXISTS quotes_enabled BOOLEAN NOT NULL DEFAULT FALSE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.subscription_live_settings'::regclass
      AND conname='subscription_live_quotes_closed') THEN
    ALTER TABLE private.subscription_live_settings
      ADD CONSTRAINT subscription_live_quotes_closed CHECK(NOT quotes_enabled);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS private.subscription_live_offer_approvals (
  approval_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  provider_mode TEXT NOT NULL DEFAULT 'live' CHECK(provider_mode='live'),
  tier TEXT NOT NULL CHECK(tier IN ('starter','growth','ultimate')),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  term_policy TEXT NOT NULL CHECK(term_policy='calendar_month_from_capture_event'),
  quote_validity_seconds INTEGER NOT NULL CHECK(quote_validity_seconds BETWEEN 60 AND 2592000),
  offer_reference TEXT NOT NULL CHECK(length(btrim(offer_reference))>0),
  tax_decision_reference TEXT NOT NULL CHECK(length(btrim(tax_decision_reference))>0),
  refund_policy_reference TEXT NOT NULL CHECK(length(btrim(refund_policy_reference))>0),
  merchant_approval_reference TEXT NOT NULL CHECK(length(btrim(merchant_approval_reference))>0),
  customer_tax_note TEXT NOT NULL CHECK(length(btrim(customer_tax_note))>0),
  customer_terms_note TEXT NOT NULL CHECK(length(btrim(customer_terms_note))>0),
  approved_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK(revoked_at IS NULL OR revoked_at>=approved_at),
  UNIQUE(approval_id,organization_id,merchant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_live_one_active_offer_per_tier
  ON private.subscription_live_offer_approvals(organization_id,merchant_id,tier)
  WHERE revoked_at IS NULL;
ALTER TABLE private.subscription_live_offer_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_offer_approvals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON private.subscription_live_offer_approvals TO service_role;

ALTER TABLE private.subscription_live_quotes
  ADD COLUMN IF NOT EXISTS offer_approval_id UUID;
-- The approved quote writer and reminder acknowledgment are SECURITY DEFINER
-- functions. The API service role only needs to read this ledger directly.
REVOKE INSERT,UPDATE,DELETE ON private.subscription_live_quotes FROM service_role;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.subscription_live_quotes'::regclass
      AND conname='subscription_live_quote_approval_fkey') THEN
    ALTER TABLE private.subscription_live_quotes
      ADD CONSTRAINT subscription_live_quote_approval_fkey
      FOREIGN KEY(offer_approval_id,organization_id,merchant_id)
      REFERENCES private.subscription_live_offer_approvals(
        approval_id,organization_id,merchant_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.subscription_freeze_live_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Live offer approval cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.approval_id IS DISTINCT FROM OLD.approval_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.provider_mode IS DISTINCT FROM OLD.provider_mode
    OR NEW.tier IS DISTINCT FROM OLD.tier
    OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.term_policy IS DISTINCT FROM OLD.term_policy
    OR NEW.quote_validity_seconds IS DISTINCT FROM OLD.quote_validity_seconds
    OR NEW.offer_reference IS DISTINCT FROM OLD.offer_reference
    OR NEW.tax_decision_reference IS DISTINCT FROM OLD.tax_decision_reference
    OR NEW.refund_policy_reference IS DISTINCT FROM OLD.refund_policy_reference
    OR NEW.merchant_approval_reference IS DISTINCT FROM OLD.merchant_approval_reference
    OR NEW.customer_tax_note IS DISTINCT FROM OLD.customer_tax_note
    OR NEW.customer_terms_note IS DISTINCT FROM OLD.customer_terms_note
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (NEW.revoked_at IS NOT NULL AND NEW.revoked_at<OLD.approved_at) THEN
    RAISE EXCEPTION 'Live offer approval is immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_freeze_live_approval
  ON private.subscription_live_offer_approvals;
CREATE TRIGGER subscription_freeze_live_approval BEFORE UPDATE OR DELETE
  ON private.subscription_live_offer_approvals FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_approval();
REVOKE ALL ON FUNCTION private.subscription_freeze_live_approval()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_freeze_live_approval() OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.subscription_freeze_live_quote_economics()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF (auth.jwt()->>'role')='service_role' AND
      (NEW.offer_approval_id IS NULL OR
       current_setting('app.subscription_live_quote_writer',TRUE) IS DISTINCT FROM 'true') THEN
      RAISE EXCEPTION 'Approved Live quote writer required' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Live quote evidence cannot be deleted' USING ERRCODE='55000'; END IF;
  IF OLD.offer_approval_id IS NOT NULL AND (
    NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id
    OR NEW.provider_mode IS DISTINCT FROM OLD.provider_mode
    OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.tier IS DISTINCT FROM OLD.tier
    OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.term_policy IS DISTINCT FROM OLD.term_policy
    OR NEW.offer_reference IS DISTINCT FROM OLD.offer_reference
    OR NEW.tax_decision_reference IS DISTINCT FROM OLD.tax_decision_reference
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.owner_reviewed_at IS DISTINCT FROM OLD.owner_reviewed_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.offer_approval_id IS DISTINCT FROM OLD.offer_approval_id) THEN
    RAISE EXCEPTION 'Reviewed Live quote economics are immutable'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_freeze_live_quote_economics
  ON private.subscription_live_quotes;
CREATE TRIGGER subscription_freeze_live_quote_economics BEFORE INSERT OR UPDATE OR DELETE
  ON private.subscription_live_quotes FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_quote_economics();
REVOKE ALL ON FUNCTION private.subscription_freeze_live_quote_economics()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_freeze_live_quote_economics() OWNER TO postgres;

-- A preview is amount-only evidence for an authenticated owner. It does not
-- create a quote or provider order, and the issuance switch is hard-closed.
CREATE OR REPLACE FUNCTION public.subscription_live_offer_preview(
  p_organization_id UUID,p_billing_account_id UUID,p_tier TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_live_settings;
  a private.subscription_live_offer_approvals;
  x private.organization_product_access;
  r private.subscription_billing_settings;
  v_active INTEGER; v_capacity INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR NOT s.quotes_enabled OR s.provider_mode<>'live'
    OR s.pilot_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Live quote preview is disabled' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM private.subscription_live_offer_approvals
    WHERE organization_id=p_organization_id AND merchant_id=s.merchant_id
      AND tier=p_tier AND revoked_at IS NULL AND approved_at<=now();
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved Live offer required' USING ERRCODE='55000'; END IF;
  IF p_tier='starter' THEN
    SELECT * INTO r FROM private.subscription_billing_settings WHERE singleton;
    IF NOT COALESCE(r.standard_reminder_policy_approved AND
      NULLIF(btrim(r.standard_reminder_policy_version),'') IS NOT NULL AND
      r.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND
      r.standard_reminder_hour_local=9,FALSE) THEN
      RAISE EXCEPTION 'Starter reminder policy is not approved' USING ERRCODE='55000'; END IF;
  END IF;
  SELECT * INTO x FROM private.organization_product_access
    WHERE organization_id=p_organization_id;
  IF NOT FOUND OR x.mode<>'trial' OR x.suspended_at IS NOT NULL
    OR x.trial_ends_at IS NULL OR now()<x.trial_ends_at THEN
    RAISE EXCEPTION 'Expired trial required' USING ERRCODE='55000'; END IF;
  v_capacity:=private.subscription_base_included_branches(p_tier);
  SELECT count(*) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  IF v_capacity IS NULL OR v_active<1 OR v_active>v_capacity
    OR EXISTS(SELECT 1 FROM public.accounts WHERE organization_id=p_organization_id
      AND branch_status='active' AND default_currency<>'INR')
    OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_billing_account_id
      AND organization_id=p_organization_id AND branch_status='active'
      AND default_currency='INR') THEN
    RAISE EXCEPTION 'Live quote branch roster changed' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_orders
      WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments
      WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_grants
      WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants
      WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_quotes
      WHERE organization_id=p_organization_id AND expires_at>now()) THEN
    RAISE EXCEPTION 'Existing paid obligation needs review' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('approval_id',a.approval_id,'tier',a.tier,
    'amount_minor',a.amount_minor,'currency',a.currency,
    'term_policy',a.term_policy,'customer_tax_note',a.customer_tax_note,
    'customer_terms_note',a.customer_terms_note);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_live_offer_preview(UUID,UUID,TEXT)
  FROM PUBLIC,anon;
ALTER FUNCTION public.subscription_live_offer_preview(UUID,UUID,TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_live_offer_preview(UUID,UUID,TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.subscription_create_live_quote(
  p_request_id UUID,p_organization_id UUID,p_billing_account_id UUID,
  p_actor_user_id UUID,p_approval_id UUID,p_seen_amount_minor BIGINT,p_tier TEXT,
  p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_live_settings;
  a private.subscription_live_offer_approvals;
  q private.subscription_live_quotes;
  x private.organization_product_access;
  r private.subscription_billing_settings;
  v_active INTEGER; v_capacity INTEGER; v_reviewed_at TIMESTAMPTZ;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR NOT s.quotes_enabled OR s.provider_mode<>'live'
    OR s.pilot_organization_id IS DISTINCT FROM p_organization_id
    OR s.merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'Live quote issuance is disabled or unbound' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships
    WHERE organization_id=p_organization_id AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM private.subscription_live_offer_approvals
    WHERE approval_id=p_approval_id FOR UPDATE;
  IF NOT FOUND OR a.organization_id<>p_organization_id
    OR a.merchant_id<>p_provider_merchant_id OR a.tier IS DISTINCT FROM p_tier
    OR a.amount_minor IS DISTINCT FROM p_seen_amount_minor
    OR a.currency<>'INR' OR a.provider_mode<>'live'
    OR a.revoked_at IS NOT NULL OR a.approved_at>now() THEN
    RAISE EXCEPTION 'Reviewed Live amount or approval changed' USING ERRCODE='55000'; END IF;
  SELECT * INTO q FROM private.subscription_live_quotes
    WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF q.organization_id<>p_organization_id OR q.requested_by<>p_actor_user_id
      OR q.billing_account_id<>p_billing_account_id OR q.offer_approval_id<>p_approval_id
      OR q.tier<>p_tier OR q.amount_minor<>p_seen_amount_minor
      OR q.merchant_id<>p_provider_merchant_id OR now()>=q.expires_at THEN
      RAISE EXCEPTION 'Live quote replay changed or expired' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('request_id',q.request_id,
      'organization_id',q.organization_id,'tier',q.tier,
      'amount_minor',q.amount_minor,'currency',q.currency,
      'expires_at',q.expires_at,'approval_id',q.offer_approval_id);
  END IF;
  SELECT * INTO x FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR x.mode<>'trial' OR x.suspended_at IS NOT NULL
    OR x.trial_ends_at IS NULL OR now()<x.trial_ends_at THEN
    RAISE EXCEPTION 'Expired trial required' USING ERRCODE='55000'; END IF;
  v_capacity:=private.subscription_base_included_branches(p_tier);
  SELECT count(*) INTO v_active FROM public.accounts
    WHERE organization_id=p_organization_id AND branch_status='active';
  IF v_capacity IS NULL OR v_active<1 OR v_active>v_capacity
    OR EXISTS(SELECT 1 FROM public.accounts WHERE organization_id=p_organization_id
      AND branch_status='active' AND default_currency<>'INR')
    OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_billing_account_id
      AND organization_id=p_organization_id AND branch_status='active'
      AND default_currency='INR') THEN
    RAISE EXCEPTION 'Live quote branch roster changed' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_orders WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants
      WHERE organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_quotes
      WHERE organization_id=p_organization_id AND expires_at>now()) THEN
    RAISE EXCEPTION 'Existing Live quote or paid obligation needs review' USING ERRCODE='55000'; END IF;
  IF p_tier='starter' THEN
    SELECT * INTO r FROM private.subscription_billing_settings WHERE singleton;
    IF NOT COALESCE(r.standard_reminder_policy_approved AND
      NULLIF(btrim(r.standard_reminder_policy_version),'') IS NOT NULL AND
      r.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND
      r.standard_reminder_hour_local=9,FALSE) THEN
      RAISE EXCEPTION 'Starter reminder policy is not approved' USING ERRCODE='55000'; END IF;
  END IF;
  v_reviewed_at:=clock_timestamp();
  PERFORM set_config('app.subscription_live_quote_writer','true',TRUE);
  INSERT INTO private.subscription_live_quotes
    (request_id,organization_id,requested_by,billing_account_id,
     merchant_id,tier,amount_minor,currency,term_policy,offer_reference,
     tax_decision_reference,expires_at,owner_reviewed_at,created_at,
     offer_approval_id)
  VALUES(p_request_id,p_organization_id,p_actor_user_id,p_billing_account_id,
    p_provider_merchant_id,a.tier,a.amount_minor,a.currency,a.term_policy,
    a.offer_reference,a.tax_decision_reference,
    v_reviewed_at+make_interval(secs=>a.quote_validity_seconds),
    v_reviewed_at,v_reviewed_at,a.approval_id)
  RETURNING * INTO q;
  RETURN jsonb_build_object('request_id',q.request_id,
    'organization_id',q.organization_id,'tier',q.tier,
    'amount_minor',q.amount_minor,'currency',q.currency,
    'expires_at',q.expires_at,'approval_id',q.offer_approval_id);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_create_live_quote(UUID,UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_create_live_quote(UUID,UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_create_live_quote(UUID,UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_live_owner_quote(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes;
  s private.subscription_live_settings;
  a private.subscription_live_offer_approvals;
  r private.subscription_billing_settings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR s.pilot_organization_id IS DISTINCT FROM p_organization_id
    OR s.provider_mode<>'live' THEN RETURN NULL; END IF;
  SELECT * INTO q FROM private.subscription_live_quotes
    WHERE organization_id=p_organization_id AND requested_by=auth.uid()
      AND merchant_id=s.merchant_id AND provider_mode='live'
    ORDER BY created_at DESC,request_id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM private.subscription_live_offer_approvals
    WHERE approval_id=q.offer_approval_id;
  SELECT * INTO r FROM private.subscription_billing_settings WHERE singleton;
  RETURN jsonb_build_object('request_id',q.request_id,'tier',q.tier,
    'amount_minor',q.amount_minor,'currency',q.currency,
    'expires_at',q.expires_at,'owner_reviewed_at',q.owner_reviewed_at,
    'offer_approval_id',q.offer_approval_id,
    'customer_tax_note',a.customer_tax_note,
    'customer_terms_note',a.customer_terms_note,
    'starter_reminder_reset_accepted',q.starter_reminder_reset_accepted,
    'starter_reminder_policy_version',q.starter_reminder_policy_version,
    'approved_starter_reminder_policy',CASE
      WHEN r.standard_reminder_policy_approved
        AND r.standard_reminder_policy_version IS NOT NULL
        AND r.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[]
        AND r.standard_reminder_hour_local=9 THEN jsonb_build_object(
          'version',r.standard_reminder_policy_version,
          'days_before',r.standard_reminder_days_before,
          'hour_local',r.standard_reminder_hour_local)
      ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_live_owner_quote(UUID) FROM PUBLIC,anon;
ALTER FUNCTION public.subscription_live_owner_quote(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_live_owner_quote(UUID) TO authenticated;
