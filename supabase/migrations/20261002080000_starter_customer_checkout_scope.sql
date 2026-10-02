-- Default closed customer Starter checkout. No customer, offer, review or flag is seeded.
-- The original internal pilot/listener remains pinned. No Production opening authority.
CREATE TABLE IF NOT EXISTS private.subscription_live_customer_reviews (
  review_id UUID PRIMARY KEY,
  offer_approval_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  billing_account_id UUID NOT NULL REFERENCES public.accounts(id),
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  commercial_context TEXT NOT NULL CHECK(commercial_context='customer_sale'),
  reviewed_by UUID NOT NULL REFERENCES auth.users(id),
  release_sha TEXT NOT NULL CHECK(release_sha ~ '^[0-9a-f]{40}$'),
  migration_manifest_sha256 TEXT NOT NULL CHECK(migration_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference))>0),
  buyer_geography_reference TEXT NOT NULL CHECK(length(btrim(buyer_geography_reference))>0),
  issuer_financial_year_reference TEXT NOT NULL CHECK(length(btrim(issuer_financial_year_reference))>0),
  tax_receipt_review_reference TEXT NOT NULL CHECK(length(btrim(tax_receipt_review_reference))>0),
  provider_acceptance_reference TEXT NOT NULL CHECK(length(btrim(provider_acceptance_reference))>0),
  backup_recovery_reference TEXT NOT NULL CHECK(length(btrim(backup_recovery_reference))>0),
  reminder_policy_version TEXT NOT NULL CHECK(length(btrim(reminder_policy_version))>0),
  reviewed_at TIMESTAMPTZ NOT NULL CHECK(isfinite(reviewed_at)),
  revoked_at TIMESTAMPTZ CHECK(revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=reviewed_at)),
  UNIQUE(review_id,organization_id,merchant_id),
  FOREIGN KEY(offer_approval_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_offer_approvals(approval_id,organization_id,merchant_id)
);
CREATE TABLE IF NOT EXISTS private.subscription_live_customer_scopes (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id),
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  review_id UUID NOT NULL,
  quotes_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  orders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  refunds_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK(NOT orders_enabled OR quotes_enabled),
  FOREIGN KEY(review_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_customer_reviews(review_id,organization_id,merchant_id)
);
ALTER TABLE private.subscription_live_customer_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_live_customer_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_customer_reviews,private.subscription_live_customer_scopes
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_live_customer_reviews,private.subscription_live_customer_scopes TO service_role;
ALTER TABLE private.subscription_live_quotes ADD COLUMN IF NOT EXISTS customer_review_id UUID
  REFERENCES private.subscription_live_customer_reviews(review_id);

-- Current authority is used for initiation/first commit, never to erase old obligations.
CREATE OR REPLACE FUNCTION private.subscription_customer_review_active(p_organization_id UUID,p_review_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r
  JOIN private.subscription_live_customer_scopes c ON c.review_id=r.review_id
    AND c.organization_id=r.organization_id AND c.merchant_id=r.merchant_id
  JOIN private.subscription_live_settings s ON s.singleton AND s.merchant_id=r.merchant_id
  JOIN private.subscription_live_offer_approvals a ON a.approval_id=r.offer_approval_id
  JOIN private.subscription_billing_settings b ON b.singleton
  WHERE r.organization_id=p_organization_id AND r.review_id=p_review_id
   AND r.organization_id IS DISTINCT FROM s.pilot_organization_id
   AND r.revoked_at IS NULL AND r.reviewed_at<=clock_timestamp()
   AND a.revoked_at IS NULL AND a.approved_at<=r.reviewed_at
   AND a.organization_id=r.organization_id AND a.merchant_id=r.merchant_id
   AND a.tier='starter' AND a.amount_minor=79900 AND a.currency='INR'
   AND a.quote_validity_seconds=1800 AND a.term_policy='calendar_month_from_capture_event'
   AND EXISTS(SELECT 1 FROM public.organization_memberships m
     WHERE m.organization_id=r.organization_id AND m.user_id=r.reviewed_by AND m.role='owner')
   AND EXISTS(SELECT 1 FROM public.accounts x WHERE x.id=r.billing_account_id
     AND x.organization_id=r.organization_id AND x.branch_status='active' AND x.default_currency='INR')
   AND b.standard_reminder_policy_approved AND b.standard_reminder_policy_version=r.reminder_policy_version
   AND b.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND b.standard_reminder_hour_local=9);
$$;

-- Return the original row for the internal pilot. For an operator-bound customer,
-- project per-customer initiation flags without ever rewriting the global binding.
-- Intake/settlement/recovery survive shutdown or review revocation.
CREATE OR REPLACE FUNCTION private.subscription_live_settings_for_org(p_organization_id UUID)
RETURNS SETOF private.subscription_live_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_live_settings; c private.subscription_live_customer_scopes; active BOOLEAN;
BEGIN
 SELECT * INTO s FROM private.subscription_live_settings WHERE singleton;
 IF NOT FOUND THEN RETURN; END IF;
 IF s.pilot_organization_id=p_organization_id THEN RETURN NEXT s; RETURN; END IF;
 SELECT * INTO c FROM private.subscription_live_customer_scopes
  WHERE organization_id=p_organization_id AND merchant_id=s.merchant_id FOR SHARE;
 IF NOT FOUND THEN RETURN; END IF;
 active:=private.subscription_customer_review_active(p_organization_id,c.review_id);
 s.pilot_organization_id:=p_organization_id;
 s.quotes_enabled:=c.quotes_enabled AND active AND s.webhook_intake_enabled AND s.settlements_enabled;
 s.orders_enabled:=c.orders_enabled AND s.quotes_enabled;
 s.refunds_enabled:=c.refunds_enabled AND active AND s.webhook_intake_enabled AND s.settlements_enabled;
 s.complimentary_conversion_enabled:=FALSE;
 s.renewals_enabled:=FALSE;
 RETURN NEXT s;
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_guard_customer_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Customer review is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
   RAISE EXCEPTION 'Customer review is immutable' USING ERRCODE='55000'; END IF;
 ELSE
  IF NEW.reviewed_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=NEW.organization_id
     AND m.user_id=NEW.reviewed_by AND m.role='owner')
   OR NOT EXISTS(SELECT 1 FROM public.accounts x WHERE x.id=NEW.billing_account_id
     AND x.organization_id=NEW.organization_id AND x.branch_status='active' AND x.default_currency='INR')
   OR NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s WHERE s.singleton
     AND s.merchant_id=NEW.merchant_id AND s.pilot_organization_id IS DISTINCT FROM NEW.organization_id)
   OR NOT EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals a
     WHERE a.approval_id=NEW.offer_approval_id AND a.organization_id=NEW.organization_id
       AND a.merchant_id=NEW.merchant_id AND a.tier='starter' AND a.amount_minor=79900 AND a.currency='INR'
       AND a.quote_validity_seconds=1800 AND a.term_policy='calendar_month_from_capture_event'
       AND a.revoked_at IS NULL AND a.approved_at<=NEW.reviewed_at) THEN
   RAISE EXCEPTION 'Exact owner-reviewed customer Starter offer required' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_customer_review ON private.subscription_live_customer_reviews;
CREATE TRIGGER subscription_guard_customer_review BEFORE INSERT OR UPDATE OR DELETE
 ON private.subscription_live_customer_reviews FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_customer_review();

CREATE OR REPLACE FUNCTION private.subscription_guard_customer_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND
   (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.review_id IS DISTINCT FROM OLD.review_id)
   AND EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id=OLD.organization_id)) THEN
  RAISE EXCEPTION 'Customer binding preserves original obligations' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s WHERE s.singleton
   AND s.merchant_id=NEW.merchant_id AND s.pilot_organization_id IS DISTINCT FROM NEW.organization_id) THEN
  RAISE EXCEPTION 'Customer merchant must match original listener' USING ERRCODE='55000'; END IF;
 IF NEW.quotes_enabled OR NEW.orders_enabled OR NEW.refunds_enabled THEN
  IF NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s WHERE s.singleton
    AND s.webhook_intake_enabled AND s.settlements_enabled)
   OR NOT private.subscription_customer_review_active(NEW.organization_id,NEW.review_id) THEN
   RAISE EXCEPTION 'Customer opening review and intake/settlement required' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_customer_scope ON private.subscription_live_customer_scopes;
CREATE TRIGGER subscription_guard_customer_scope BEFORE INSERT OR UPDATE OR DELETE
 ON private.subscription_live_customer_scopes FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_customer_scope();

CREATE OR REPLACE FUNCTION private.subscription_stop_revoked_customer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
  UPDATE private.subscription_live_customer_scopes c SET quotes_enabled=FALSE,orders_enabled=FALSE,refunds_enabled=FALSE
  WHERE EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r WHERE r.review_id=c.review_id
    AND ((TG_TABLE_NAME='subscription_live_customer_reviews' AND r.review_id=(to_jsonb(NEW)->>'review_id')::UUID)
     OR (TG_TABLE_NAME='subscription_live_offer_approvals' AND r.offer_approval_id=(to_jsonb(NEW)->>'approval_id')::UUID)));
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_stop_revoked_customer_review ON private.subscription_live_customer_reviews;
CREATE TRIGGER subscription_stop_revoked_customer_review AFTER UPDATE OF revoked_at
 ON private.subscription_live_customer_reviews FOR EACH ROW EXECUTE FUNCTION private.subscription_stop_revoked_customer();
DROP TRIGGER IF EXISTS subscription_stop_revoked_customer_offer ON private.subscription_live_offer_approvals;
CREATE TRIGGER subscription_stop_revoked_customer_offer AFTER UPDATE OF revoked_at
 ON private.subscription_live_offer_approvals FOR EACH ROW EXECUTE FUNCTION private.subscription_stop_revoked_customer();


CREATE OR REPLACE FUNCTION private.subscription_guard_starter_pilot_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (NEW.organization_id IS DISTINCT FROM '8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID AND NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s WHERE s.singleton AND s.merchant_id=NEW.merchant_id AND NEW.organization_id IS DISTINCT FROM s.pilot_organization_id AND EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=NEW.organization_id)))
    OR NEW.merchant_id IS DISTINCT FROM 'acc_TCJwBqanN9LTrK'
    OR NEW.provider_mode IS DISTINCT FROM 'live' OR NEW.tier IS DISTINCT FROM 'starter'
    OR NEW.amount_minor IS DISTINCT FROM 79900::BIGINT OR NEW.currency IS DISTINCT FROM 'INR'
    OR NEW.term_policy IS DISTINCT FROM 'calendar_month_from_capture_event'
    OR NEW.quote_validity_seconds IS DISTINCT FROM 1800
    OR NOT isfinite(NEW.approved_at) OR NEW.approved_at>clock_timestamp() THEN
    RAISE EXCEPTION 'Only the exact first Starter internal pilot offer is permitted'
      USING ERRCODE='22023'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_guard_starter_pilot_quote()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM '8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID THEN
    SELECT c.review_id INTO NEW.customer_review_id FROM private.subscription_live_customer_scopes c
      JOIN private.subscription_live_customer_reviews r ON r.review_id=c.review_id
      JOIN private.subscription_live_offer_approvals a ON a.approval_id=r.offer_approval_id
      WHERE c.organization_id=NEW.organization_id AND c.merchant_id=NEW.merchant_id AND c.quotes_enabled
        AND r.billing_account_id=NEW.billing_account_id AND r.offer_approval_id=NEW.offer_approval_id
        AND a.offer_reference=NEW.offer_reference AND a.tax_decision_reference=NEW.tax_decision_reference
        AND private.subscription_customer_review_active(c.organization_id,c.review_id);
    IF NEW.customer_review_id IS NULL OR NEW.provider_mode<>'live' OR NEW.tier<>'starter'
      OR NEW.amount_minor<>79900 OR NEW.currency<>'INR'
      OR NEW.term_policy<>'calendar_month_from_capture_event'
      OR NEW.expires_at IS DISTINCT FROM NEW.owner_reviewed_at+interval '1800 seconds'
      OR NOT isfinite(NEW.owner_reviewed_at) OR NEW.owner_reviewed_at>clock_timestamp()
      OR NEW.renewal_of_request_id IS NOT NULL OR NEW.source_access_mode IS DISTINCT FROM 'trial'
      OR NEW.source_access_version IS NULL OR NEW.complimentary_conversion_accepted
      OR NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s WHERE s.singleton
        AND s.webhook_intake_enabled AND s.settlements_enabled AND s.merchant_id=NEW.merchant_id) THEN
      RAISE EXCEPTION 'Quote is outside reviewed customer Starter scope' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.customer_review_id IS NOT NULL THEN
    RAISE EXCEPTION 'Internal pilot cannot use customer review' USING ERRCODE='55000'; END IF;
  IF NEW.organization_id IS DISTINCT FROM '8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID
    OR NEW.merchant_id IS DISTINCT FROM 'acc_TCJwBqanN9LTrK'
    OR NEW.provider_mode IS DISTINCT FROM 'live' OR NEW.tier IS DISTINCT FROM 'starter'
    OR NEW.amount_minor IS DISTINCT FROM 79900::BIGINT OR NEW.currency IS DISTINCT FROM 'INR'
    OR NEW.term_policy IS DISTINCT FROM 'calendar_month_from_capture_event'
    OR NEW.expires_at IS DISTINCT FROM NEW.owner_reviewed_at+interval '1800 seconds'
    OR NOT isfinite(NEW.owner_reviewed_at) OR NEW.owner_reviewed_at>clock_timestamp()
    OR NEW.renewal_of_request_id IS NOT NULL OR NEW.source_access_mode IS NULL
    OR NEW.source_access_version IS NULL
    OR NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s
      JOIN private.subscription_live_pilot_opening_reviews r ON r.review_id=s.pilot_opening_review_id
      JOIN private.subscription_live_offer_approvals a ON a.approval_id=r.offer_approval_id
      WHERE s.singleton AND s.quotes_enabled AND r.revoked_at IS NULL AND a.revoked_at IS NULL
        AND NEW.offer_approval_id=a.approval_id AND NEW.organization_id=s.pilot_organization_id
        AND NEW.merchant_id=s.merchant_id AND NEW.offer_reference=a.offer_reference
        AND NEW.tax_decision_reference=a.tax_decision_reference) THEN
    RAISE EXCEPTION 'Quote is outside the approved first Starter internal pilot'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;

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
    NEW.customer_review_id IS DISTINCT FROM OLD.customer_review_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
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
    OR NEW.offer_approval_id IS DISTINCT FROM OLD.offer_approval_id
    OR NEW.renewal_of_request_id IS DISTINCT FROM OLD.renewal_of_request_id
    OR NEW.previous_paid_through_end IS DISTINCT FROM OLD.previous_paid_through_end
    OR NEW.previous_access_version IS DISTINCT FROM OLD.previous_access_version
    OR NEW.source_access_mode IS DISTINCT FROM OLD.source_access_mode
    OR NEW.source_access_version IS DISTINCT FROM OLD.source_access_version
    OR NEW.complimentary_conversion_accepted IS DISTINCT FROM OLD.complimentary_conversion_accepted) THEN
    RAISE EXCEPTION 'Reviewed Live quote economics are immutable'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;

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
  SELECT * INTO s FROM private.subscription_live_settings_for_org(p_organization_id);
  IF NOT FOUND OR NOT s.quotes_enabled OR s.provider_mode<>'live'
    OR s.pilot_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Live quote preview is disabled' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM private.subscription_live_offer_approvals
    WHERE organization_id=p_organization_id AND merchant_id=s.merchant_id
      AND tier=p_tier AND revoked_at IS NULL AND approved_at<=now()
      AND (p_organization_id=(SELECT pilot_organization_id FROM private.subscription_live_settings WHERE singleton)
        OR EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes c
          JOIN private.subscription_live_customer_reviews cr ON cr.review_id=c.review_id
          WHERE c.organization_id=p_organization_id AND cr.offer_approval_id=approval_id
            AND cr.billing_account_id=p_billing_account_id));
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
  IF NOT FOUND OR NOT ((x.mode='trial' AND x.suspended_at IS NULL
    AND x.trial_ends_at IS NOT NULL AND now()>=x.trial_ends_at)
    OR private.subscription_live_complimentary_eligible(
      p_organization_id,p_billing_account_id,auth.uid(),p_tier)) THEN
    RAISE EXCEPTION 'Eligible pilot access required' USING ERRCODE='55000'; END IF;
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
      WHERE organization_id=p_organization_id AND expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Existing paid obligation needs review' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('approval_id',a.approval_id,'tier',a.tier,
    'amount_minor',a.amount_minor,'currency',a.currency,
    'term_policy',a.term_policy,'customer_tax_note',a.customer_tax_note,
    'customer_terms_note',a.customer_terms_note,
    'complimentary_conversion',x.mode='complimentary');
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_create_live_quote(
  p_request_id UUID,p_organization_id UUID,p_billing_account_id UUID,
  p_actor_user_id UUID,p_approval_id UUID,p_seen_amount_minor BIGINT,p_tier TEXT,
  p_provider_merchant_id TEXT,
  p_complimentary_conversion_accepted BOOLEAN DEFAULT FALSE)
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
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  SELECT * INTO s FROM private.subscription_live_settings_for_org(p_organization_id);
  IF NOT FOUND OR NOT s.quotes_enabled OR s.provider_mode<>'live'
    OR s.pilot_organization_id IS DISTINCT FROM p_organization_id
    OR s.merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'Live quote issuance is disabled or unbound' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships
    WHERE organization_id=p_organization_id AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM private.subscription_live_offer_approvals
    WHERE approval_id=p_approval_id FOR UPDATE;
  IF NOT FOUND OR (p_organization_id IS DISTINCT FROM (SELECT pilot_organization_id FROM private.subscription_live_settings WHERE singleton)
      AND NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes c
        JOIN private.subscription_live_customer_reviews cr ON cr.review_id=c.review_id
        WHERE c.organization_id=p_organization_id AND cr.offer_approval_id=p_approval_id
          AND cr.billing_account_id=p_billing_account_id)) OR a.organization_id<>p_organization_id
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
      OR q.merchant_id<>p_provider_merchant_id
      OR q.complimentary_conversion_accepted IS DISTINCT FROM p_complimentary_conversion_accepted
      OR clock_timestamp()>=q.expires_at THEN
      RAISE EXCEPTION 'Live quote replay changed or expired' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('request_id',q.request_id,
      'organization_id',q.organization_id,'tier',q.tier,
      'amount_minor',q.amount_minor,'currency',q.currency,
      'expires_at',q.expires_at,'approval_id',q.offer_approval_id,
      'complimentary_conversion',q.complimentary_conversion_accepted);
  END IF;
  SELECT * INTO x FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR NOT ((x.mode='trial' AND x.suspended_at IS NULL
    AND x.trial_ends_at IS NOT NULL AND now()>=x.trial_ends_at
    AND p_complimentary_conversion_accepted IS FALSE)
    OR (p_complimentary_conversion_accepted IS TRUE
      AND private.subscription_live_complimentary_eligible(
        p_organization_id,p_billing_account_id,p_actor_user_id,p_tier))) THEN
    RAISE EXCEPTION 'Eligible pilot access and acknowledgement required'
      USING ERRCODE='55000'; END IF;
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
      WHERE organization_id=p_organization_id AND expires_at>clock_timestamp()) THEN
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
     offer_approval_id,source_access_mode,source_access_version,
     complimentary_conversion_accepted)
  VALUES(p_request_id,p_organization_id,p_actor_user_id,p_billing_account_id,
    p_provider_merchant_id,a.tier,a.amount_minor,a.currency,a.term_policy,
    a.offer_reference,a.tax_decision_reference,
    v_reviewed_at+make_interval(secs=>a.quote_validity_seconds),
    v_reviewed_at,v_reviewed_at,a.approval_id,x.mode,x.version,
    p_complimentary_conversion_accepted)
  RETURNING * INTO q;
  RETURN jsonb_build_object('request_id',q.request_id,
    'organization_id',q.organization_id,'tier',q.tier,
    'amount_minor',q.amount_minor,'currency',q.currency,
    'expires_at',q.expires_at,'approval_id',q.offer_approval_id,
      'complimentary_conversion',q.complimentary_conversion_accepted);
END;
$$;

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
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_organization_id);
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Live pilot merchant is unbound' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships
    WHERE organization_id=p_organization_id AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_quote FROM private.subscription_live_quotes
    WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_quote.organization_id<>p_organization_id
    OR v_quote.requested_by<>p_actor_user_id
    OR v_quote.provider_mode<>'live' OR v_quote.merchant_id<>p_provider_merchant_id THEN
    RAISE EXCEPTION 'Reviewed Live quote required' USING ERRCODE='22023'; END IF;
  IF v_quote.customer_review_id IS NOT NULL AND NOT private.subscription_customer_review_active(
    v_quote.organization_id,v_quote.customer_review_id) THEN
    RAISE EXCEPTION 'Customer opening review changed' USING ERRCODE='55000'; END IF;
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
    OR NOT v_settings.webhook_intake_enabled OR clock_timestamp()>=v_quote.expires_at
    OR clock_timestamp()<v_quote.owner_reviewed_at THEN
    RAISE EXCEPTION 'Live Checkout is disabled or quote expired' USING ERRCODE='55000'; END IF;
  IF v_quote.renewal_of_request_id IS NOT NULL THEN
    PERFORM private.subscription_require_live_renewal(p_organization_id,v_quote.billing_account_id,
      p_actor_user_id,v_quote.renewal_of_request_id);
    IF NOT EXISTS(SELECT 1 FROM private.organization_product_access WHERE organization_id=p_organization_id
      AND version=v_quote.previous_access_version AND access_ends_at=v_quote.previous_paid_through_end)
      OR EXISTS(SELECT 1 FROM private.subscription_live_orders o
        LEFT JOIN private.subscription_live_payments p USING(request_id)
        WHERE o.organization_id=p_organization_id AND o.request_id<>p_request_id
          AND (p.request_id IS NULL OR p.state<>'verified')) THEN
      RAISE EXCEPTION 'Renewal changed or another order needs review' USING ERRCODE='55000'; END IF;
  ELSE
  SELECT * INTO v_access FROM private.organization_product_access
    WHERE organization_id=p_organization_id FOR UPDATE;
  IF v_access.organization_id IS NULL OR NOT (
    (v_quote.source_access_mode='complimentary'
      AND v_quote.complimentary_conversion_accepted
      AND v_access.version=v_quote.source_access_version
      AND private.subscription_live_complimentary_eligible(
        p_organization_id,v_quote.billing_account_id,p_actor_user_id,
        v_quote.tier,p_request_id))
    OR (v_access.mode='trial' AND v_access.suspended_at IS NULL
      AND v_access.trial_ends_at IS NOT NULL AND now()>=v_access.trial_ends_at
      AND (v_quote.source_access_mode IS NULL OR
        (v_quote.source_access_mode='trial'
         AND v_access.version=v_quote.source_access_version)))) THEN
    RAISE EXCEPTION 'Live Checkout access changed' USING ERRCODE='55000'; END IF;
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
  END IF;
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

CREATE OR REPLACE FUNCTION public.subscription_live_owner_quote(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes;
  s private.subscription_live_settings;
  a private.subscription_live_offer_approvals;
  r private.subscription_billing_settings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_live_settings_for_org(p_organization_id);
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
    'renewal_of_request_id',q.renewal_of_request_id,
    'payment_state',(SELECT state FROM private.subscription_live_payments WHERE request_id=q.request_id),
    'amount_minor',q.amount_minor,'currency',q.currency,
    'expires_at',q.expires_at,'owner_reviewed_at',q.owner_reviewed_at,
    'offer_approval_id',q.offer_approval_id,
    'complimentary_conversion',q.complimentary_conversion_accepted,
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

CREATE OR REPLACE FUNCTION public.subscription_acknowledge_live_starter_reminders(
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes;
  s private.subscription_live_settings;
  r private.subscription_billing_settings;
BEGIN
  SELECT * INTO q FROM private.subscription_live_quotes
    WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR q.tier<>'starter' OR auth.uid() IS NULL
    OR q.requested_by IS DISTINCT FROM auth.uid()
    OR NOT public.is_organization_owner(q.organization_id) THEN
    RAISE EXCEPTION 'Starter owner quote required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_live_settings_for_org(q.organization_id);
  SELECT * INTO r FROM private.subscription_billing_settings WHERE singleton;
  IF s.pilot_organization_id IS DISTINCT FROM q.organization_id
    OR s.merchant_id IS DISTINCT FROM q.merchant_id
    OR NOT COALESCE(r.standard_reminder_policy_approved AND
      r.standard_reminder_policy_version IS NOT NULL AND
      r.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND
      r.standard_reminder_hour_local=9,FALSE) THEN
    RAISE EXCEPTION 'Starter reminder policy is not approved' USING ERRCODE='55000'; END IF;
  IF q.starter_reminder_reset_accepted THEN
    IF q.starter_reminder_policy_version IS DISTINCT FROM r.standard_reminder_policy_version THEN
      RAISE EXCEPTION 'Reminder policy changed; review again' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('request_id',q.request_id,
      'policy_version',q.starter_reminder_policy_version);
  END IF;
  IF clock_timestamp()>=q.expires_at OR EXISTS(SELECT 1 FROM private.subscription_live_orders
    WHERE request_id=p_request_id) THEN
    RAISE EXCEPTION 'Review reminders before creating an order' USING ERRCODE='55000'; END IF;
  UPDATE private.subscription_live_quotes SET starter_reminder_reset_accepted=TRUE,
    starter_reminder_policy_version=r.standard_reminder_policy_version
    WHERE request_id=p_request_id;
  RETURN jsonb_build_object('request_id',p_request_id,
    'policy_version',r.standard_reminder_policy_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_bind_live_order(
  p_request_id UUID,p_provider_order_id TEXT,p_provider_merchant_id TEXT,
  p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_order private.subscription_live_orders;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_pilot_organization_id);
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

CREATE OR REPLACE FUNCTION public.subscription_live_order_for_capture(
  p_provider_order_id TEXT,p_provider_merchant_id TEXT,p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_quote private.subscription_live_quotes;
  v_order private.subscription_live_orders;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_pilot_organization_id);
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

CREATE OR REPLACE FUNCTION public.subscription_record_live_webhook_event(
  p_merchant_id TEXT,p_pilot_organization_id UUID,p_event_id TEXT,
  p_event_type TEXT,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_refund_id TEXT,p_body_sha256 TEXT,p_provider_event_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_order private.subscription_live_orders;
  v_existing private.subscription_live_webhook_events;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM private.subscription_live_settings WHERE singleton FOR UPDATE;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_pilot_organization_id);
  IF NOT FOUND OR NOT v_settings.webhook_intake_enabled
    OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live webhook intake is disabled or unbound' USING ERRCODE='55000'; END IF;
  IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_event_type NOT IN ('payment.captured','payment.failed','refund.created','refund.processed','refund.failed')
    OR p_provider_order_id IS NULL OR p_provider_order_id !~ '^order_[A-Za-z0-9]+$'
    OR p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^pay_[A-Za-z0-9]+$'
    OR p_body_sha256 IS NULL OR p_body_sha256 !~ '^[0-9a-f]{64}$'
    OR (p_provider_event_at IS NOT NULL AND
      (NOT isfinite(p_provider_event_at) OR p_provider_event_at>now()+interval '5 minutes'))
    OR (p_event_type LIKE 'refund.%' AND (p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$'))
    OR (p_event_type LIKE 'payment.%' AND p_provider_refund_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid Live webhook identity' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_order FROM private.subscription_live_orders
    WHERE provider_order_id=p_provider_order_id AND merchant_id=p_merchant_id
      AND organization_id=p_pilot_organization_id AND state IN ('bound','review_required');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Live webhook has no bound pilot order' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_existing FROM private.subscription_live_webhook_events
    WHERE merchant_id=p_merchant_id AND event_id=p_event_id;
  IF FOUND THEN
    IF v_existing.body_sha256<>p_body_sha256 OR v_existing.request_id<>v_order.request_id
      OR v_existing.event_type<>p_event_type OR v_existing.provider_payment_id<>p_provider_payment_id
      OR v_existing.provider_refund_id IS DISTINCT FROM p_provider_refund_id
      OR v_existing.provider_event_at IS DISTINCT FROM p_provider_event_at THEN
      RAISE EXCEPTION 'Live webhook event identity changed' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('status','duplicate','request_id',v_existing.request_id);
  END IF;
  INSERT INTO private.subscription_live_webhook_events
    (merchant_id,event_id,organization_id,request_id,event_type,
     provider_order_id,provider_payment_id,provider_refund_id,body_sha256,provider_event_at)
  VALUES(p_merchant_id,p_event_id,v_order.organization_id,v_order.request_id,p_event_type,
    p_provider_order_id,p_provider_payment_id,p_provider_refund_id,p_body_sha256,p_provider_event_at);
  RETURN jsonb_build_object('status','held','request_id',v_order.request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_list_live_held_events(
  p_provider_merchant_id TEXT,p_pilot_organization_id UUID,p_limit INTEGER,
  p_capture_enabled BOOLEAN,p_refund_enabled BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_pilot_organization_id);
  IF NOT FOUND OR NOT v_settings.webhook_intake_enabled
    OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id
    OR p_limit IS NULL OR p_limit<1 OR p_limit>20
    OR NOT COALESCE(p_capture_enabled OR p_refund_enabled,FALSE) THEN
    RAISE EXCEPTION 'Live reconciliation is disabled or unbound' USING ERRCODE='55000'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.received_at,e.event_id)
    FROM (SELECT event_id,organization_id,request_id,event_type,
      provider_order_id,provider_payment_id,provider_refund_id,body_sha256,
      provider_event_at,received_at
      FROM private.subscription_live_webhook_events
      WHERE merchant_id=p_provider_merchant_id
        AND organization_id=p_pilot_organization_id AND state='held'
        AND ((p_capture_enabled AND v_settings.settlements_enabled
          AND event_type='payment.captured' AND provider_event_at IS NOT NULL)
          OR (p_refund_enabled AND event_type LIKE 'refund.%'))
      ORDER BY received_at,event_id LIMIT p_limit) e),'[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_claim_live_recovery_items(
  p_provider_merchant_id TEXT,p_pilot_organization_id UUID,p_limit INTEGER DEFAULT 5,
  p_lease_token UUID DEFAULT gen_random_uuid())
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings; v_item RECORD;
  v_result JSONB:='[]'::JSONB; v_claimed INTEGER;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_pilot_organization_id);
  IF NOT FOUND OR v_settings.provider_mode<>'live' OR NOT v_settings.webhook_intake_enabled
    OR NOT v_settings.settlements_enabled
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live recovery is disabled or unbound' USING ERRCODE='55000'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>5 OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'Invalid bounded recovery claim' USING ERRCODE='22023'; END IF;
  -- Bound/confirmed facts may have landed before a worker crashed. Only reap
  -- expired/unleased metadata, within the same scope/batch; never provider facts.
  WITH terminal AS (
    SELECT w.item_type,w.item_id,
      CASE WHEN w.item_type='order' THEN 'order_bound_signed_event_required'
        WHEN EXISTS(SELECT 1 FROM private.subscription_live_refunds r
          WHERE r.refund_request_id=w.item_id AND r.confirmed_at IS NOT NULL)
          THEN 'refund_confirmed' ELSE 'refund_review_required' END AS reason
    FROM private.subscription_live_recovery_queue w
    WHERE w.merchant_id=p_provider_merchant_id AND w.organization_id=p_pilot_organization_id
      AND w.completed_at IS NULL AND (w.lease_expires_at IS NULL OR w.lease_expires_at<=clock_timestamp())
      AND ((w.item_type='order' AND EXISTS(SELECT 1 FROM private.subscription_live_orders o
        WHERE o.request_id=w.item_id AND o.organization_id=w.organization_id
          AND o.merchant_id=w.merchant_id AND o.provider_order_id IS NOT NULL))
        OR (w.item_type='refund' AND EXISTS(SELECT 1 FROM private.subscription_live_refunds r
          WHERE r.refund_request_id=w.item_id AND r.organization_id=w.organization_id
            AND r.merchant_id=w.merchant_id AND (r.confirmed_at IS NOT NULL OR r.state='review_required'))))
    ORDER BY w.next_attempt_at,w.item_type,w.item_id LIMIT p_limit FOR UPDATE OF w SKIP LOCKED
  ), closed AS (
    UPDATE private.subscription_live_recovery_queue w SET completed_at=clock_timestamp(),
      lease_token=NULL,lease_expires_at=NULL,
      last_outcome=CASE WHEN t.reason='refund_review_required' THEN 'review_required' ELSE 'recovered' END,
      last_reason=t.reason FROM terminal t WHERE w.item_type=t.item_type AND w.item_id=t.item_id
    RETURNING w.item_type,w.item_id,w.last_reason
  )
  UPDATE private.subscription_live_recovery_exceptions e SET latest_reason=c.last_reason,
    last_observed_at=clock_timestamp(),status=CASE WHEN c.last_reason='refund_review_required'
      THEN 'waiting_owner' ELSE 'resolved' END,
    resolved_at=CASE WHEN c.last_reason='refund_review_required' THEN NULL ELSE clock_timestamp() END
    FROM closed c WHERE e.item_type=c.item_type AND e.item_id=c.item_id;
  FOR v_item IN
    SELECT c.* FROM (
      SELECT 'order'::TEXT AS item_type,o.request_id AS item_id,o.request_id,
        o.organization_id,o.merchant_id,o.provider_order_id,
        NULL::TEXT AS provider_payment_id,NULL::TEXT AS provider_refund_id,
        q.amount_minor,q.currency,o.claimed_at
      FROM private.subscription_live_orders o JOIN private.subscription_live_quotes q
        ON q.request_id=o.request_id AND q.organization_id=o.organization_id AND q.merchant_id=o.merchant_id
      WHERE o.provider_mode='live' AND o.organization_id=p_pilot_organization_id
        AND o.merchant_id=p_provider_merchant_id AND o.state='claimed' AND o.provider_order_id IS NULL
      UNION ALL
      SELECT 'refund',r.refund_request_id,p.request_id,r.organization_id,r.merchant_id,
        p.provider_order_id,r.provider_payment_id,r.provider_refund_id,r.amount_minor,r.currency,r.claimed_at
      FROM private.subscription_live_refunds r JOIN private.subscription_live_payments p
        ON p.provider_payment_id=r.provider_payment_id AND p.organization_id=r.organization_id AND p.merchant_id=r.merchant_id
      WHERE r.provider_mode='live' AND r.organization_id=p_pilot_organization_id
        AND r.merchant_id=p_provider_merchant_id AND r.confirmed_at IS NULL
        AND r.state IN ('claimed','pending','failed','processed')
    ) c LEFT JOIN private.subscription_live_recovery_queue w
      ON w.item_type=c.item_type AND w.item_id=c.item_id
    WHERE (w.item_id IS NULL OR (w.completed_at IS NULL AND w.next_attempt_at<=clock_timestamp()
      AND (w.lease_expires_at IS NULL OR w.lease_expires_at<=clock_timestamp())))
    ORDER BY COALESCE(w.next_attempt_at,c.claimed_at),c.item_type,c.item_id LIMIT p_limit
  LOOP
    INSERT INTO private.subscription_live_recovery_queue(item_type,item_id,organization_id,merchant_id)
    VALUES(v_item.item_type,v_item.item_id,v_item.organization_id,v_item.merchant_id) ON CONFLICT DO NOTHING;
    UPDATE private.subscription_live_recovery_queue SET lease_token=p_lease_token,
      lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1
    WHERE item_type=v_item.item_type AND item_id=v_item.item_id AND completed_at IS NULL
      AND next_attempt_at<=clock_timestamp()
      AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp());
    GET DIAGNOSTICS v_claimed=ROW_COUNT;
    IF v_claimed=1 THEN
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'item_type',v_item.item_type,'item_id',v_item.item_id,'lease_token',p_lease_token,
        'request_id',v_item.request_id,'organization_id',v_item.organization_id,
        'provider_merchant_id',v_item.merchant_id,'provider_order_id',v_item.provider_order_id,
        'provider_payment_id',v_item.provider_payment_id,'provider_refund_id',v_item.provider_refund_id,
        'amount_minor',v_item.amount_minor,'currency',v_item.currency));
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_finish_live_recovery_item(
  p_item_type TEXT,p_item_id UUID,p_lease_token UUID,p_provider_merchant_id TEXT,
  p_pilot_organization_id UUID,p_outcome TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings; v_queue private.subscription_live_recovery_queue;
  v_terminal BOOLEAN:=FALSE; v_held BOOLEAN:=FALSE;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_pilot_organization_id);
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live recovery identity unbound' USING ERRCODE='55000'; END IF;
  IF p_item_type IS NULL OR p_item_type NOT IN ('order','refund') OR p_outcome IS NULL
    OR p_outcome NOT IN ('recovered','pending','failed','review_required','retry')
    OR p_reason IS NULL OR p_reason !~ '^[a-z][a-z0-9_]{0,95}$' THEN
    RAISE EXCEPTION 'Invalid recovery result' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_queue FROM private.subscription_live_recovery_queue
    WHERE item_type=p_item_type AND item_id=p_item_id FOR UPDATE;
  IF NOT FOUND OR v_queue.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_queue.organization_id IS DISTINCT FROM p_pilot_organization_id
    OR v_queue.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL
    OR v_queue.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Recovery lease lost or expired' USING ERRCODE='55000'; END IF;
  -- A genuine webhook may have committed while the GET worker was running.
  -- Canonical durable completion wins over its stale pending/retry observation.
  IF p_item_type='order' THEN
    SELECT EXISTS(SELECT 1 FROM private.subscription_live_orders
      WHERE request_id=p_item_id AND organization_id=p_pilot_organization_id
        AND merchant_id=p_provider_merchant_id AND provider_order_id IS NOT NULL) INTO v_terminal;
  ELSE
    SELECT EXISTS(SELECT 1 FROM private.subscription_live_refunds
      WHERE refund_request_id=p_item_id AND organization_id=p_pilot_organization_id
        AND merchant_id=p_provider_merchant_id AND confirmed_at IS NOT NULL),
      EXISTS(SELECT 1 FROM private.subscription_live_refunds
      WHERE refund_request_id=p_item_id AND organization_id=p_pilot_organization_id
        AND merchant_id=p_provider_merchant_id AND state='review_required')
      INTO v_terminal,v_held;
  END IF;
  IF p_outcome='recovered' AND NOT v_terminal THEN
    RAISE EXCEPTION 'Canonical recovery completion missing' USING ERRCODE='55000'; END IF;
  IF v_terminal THEN
    p_outcome:='recovered';
    p_reason:=CASE WHEN p_item_type='order' THEN 'order_bound_signed_event_required' ELSE 'refund_confirmed' END;
    UPDATE private.subscription_live_recovery_exceptions SET status='resolved',resolved_at=clock_timestamp(),
      latest_reason=p_reason,last_observed_at=clock_timestamp()
      WHERE item_type=p_item_type AND item_id=p_item_id;
  ELSE
    IF v_held THEN p_outcome:='review_required'; p_reason:='refund_review_required'; END IF;
    PERFORM private.subscription_record_live_recovery_exception(p_item_type,p_item_id,
      p_pilot_organization_id,p_provider_merchant_id,p_reason);
  END IF;
  UPDATE private.subscription_live_recovery_queue SET lease_token=NULL,lease_expires_at=NULL,
    last_outcome=p_outcome,last_reason=p_reason,
    next_attempt_at=clock_timestamp()+interval '5 minutes',
    completed_at=CASE WHEN v_terminal OR v_held THEN clock_timestamp() ELSE NULL END
    WHERE item_type=p_item_type AND item_id=p_item_id RETURNING * INTO v_queue;
  RETURN jsonb_build_object('item_type',p_item_type,'item_id',p_item_id,
    'outcome',p_outcome,'reason',p_reason,'completed',v_queue.completed_at IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_observe_live_refund(
  p_refund_request_id UUID,p_provider_payment_id TEXT,p_provider_refund_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT,p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund private.subscription_live_refunds;
  v_settings private.subscription_live_settings;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org((SELECT organization_id FROM private.subscription_live_refunds WHERE refund_request_id=p_refund_request_id));
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'Live refund merchant is unbound' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live refund claim missing' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_refund.organization_id FOR UPDATE;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id FOR UPDATE;
  IF v_refund.organization_id<>v_settings.pilot_organization_id
    OR v_refund.merchant_id<>p_provider_merchant_id
    OR v_refund.provider_payment_id<>p_provider_payment_id
    OR v_refund.amount_minor<>p_amount_minor OR v_refund.currency<>p_currency
    OR p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$'
    OR p_status NOT IN ('pending','failed','processed')
    OR (v_refund.provider_refund_id IS NOT NULL
      AND v_refund.provider_refund_id<>p_provider_refund_id) THEN
    RAISE EXCEPTION 'Live refund observation changed identity' USING ERRCODE='23505'; END IF;
  UPDATE private.subscription_live_refunds
      SET provider_refund_id=p_provider_refund_id,
      state=CASE WHEN state IN ('processed','review_required') THEN state ELSE p_status END
    WHERE refund_request_id=p_refund_request_id RETURNING * INTO v_refund;
  RETURN to_jsonb(v_refund);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_commit_live_full_refund(
  p_refund_request_id UUID,p_provider_payment_id TEXT,p_provider_refund_id TEXT,
  p_provider_merchant_id TEXT,p_amount_minor BIGINT,p_currency TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund private.subscription_live_refunds;
  v_payment private.subscription_live_payments;
  v_grant private.subscription_live_grants;
  v_access_before private.organization_product_access;
  v_access_after private.organization_product_access;
  v_settings private.subscription_live_settings;
  v_now TIMESTAMPTZ;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org((SELECT organization_id FROM private.subscription_live_refunds WHERE refund_request_id=p_refund_request_id));
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'Live refund merchant is unbound' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live refund claim missing' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=v_refund.organization_id FOR UPDATE;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id FOR UPDATE;
  IF v_refund.merchant_id<>p_provider_merchant_id
    OR v_refund.organization_id<>v_settings.pilot_organization_id
    OR v_refund.provider_payment_id<>p_provider_payment_id
    OR v_refund.provider_refund_id<>p_provider_refund_id
    OR v_refund.amount_minor<>p_amount_minor OR v_refund.currency<>p_currency THEN
    RAISE EXCEPTION 'Verified processed Live refund required' USING ERRCODE='22023'; END IF;
  IF v_refund.confirmed_at IS NOT NULL OR v_refund.review_reason IS NOT NULL THEN
    RETURN to_jsonb(v_refund); END IF;
  IF v_refund.state<>'processed' THEN
    RAISE EXCEPTION 'Verified processed Live refund required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE provider_payment_id=p_provider_payment_id;
  SELECT * INTO v_grant FROM private.subscription_live_grants
    WHERE organization_id=v_refund.organization_id FOR UPDATE;
  SELECT * INTO v_access_before FROM private.organization_product_access
    WHERE organization_id=v_refund.organization_id FOR UPDATE;
  IF v_payment.provider_payment_id IS NULL OR v_grant.organization_id IS NULL
    OR v_payment.state<>'verified' OR v_payment.merchant_id<>p_provider_merchant_id
    OR v_payment.amount_minor<>p_amount_minor OR v_payment.currency<>p_currency
    OR v_grant.provider_payment_id IS DISTINCT FROM p_provider_payment_id
    OR v_grant.merchant_id<>p_provider_merchant_id
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments
      WHERE organization_id=v_refund.organization_id
        AND provider_payment_id<>p_provider_payment_id)
    OR EXISTS(SELECT 1 FROM private.organization_subscription_payments
      WHERE organization_id=v_refund.organization_id)
    OR v_access_before.mode IS DISTINCT FROM 'manual'
    OR v_access_before.access_starts_at IS DISTINCT FROM v_grant.period_start
    OR v_access_before.access_ends_at IS DISTINCT FROM v_grant.paid_through_end THEN
    UPDATE private.subscription_live_refunds
      SET state='review_required',review_reason='later_payment_or_access_change'
      WHERE refund_request_id=p_refund_request_id RETURNING * INTO v_refund;
    RETURN to_jsonb(v_refund);
  END IF;
  v_now:=clock_timestamp();
  UPDATE private.subscription_live_grants
    SET refund_confirmed_at=v_now,renewal_stopped_at=v_now
    WHERE organization_id=v_refund.organization_id;
  UPDATE private.organization_product_access
    SET access_ends_at=LEAST(access_ends_at,v_now),version=version+1,
      updated_at=v_now WHERE organization_id=v_refund.organization_id
    RETURNING * INTO v_access_after;
  UPDATE private.subscription_live_refunds SET confirmed_at=v_now
    WHERE refund_request_id=p_refund_request_id RETURNING * INTO v_refund;
  INSERT INTO private.product_access_audit
    (organization_id,action,reason,before_state,after_state)
  VALUES(v_refund.organization_id,'subscription_full_refund',
    'Confirmed full Usefulmade Live first-payment refund',
    to_jsonb(v_access_before),to_jsonb(v_access_after));
  RETURN to_jsonb(v_refund);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_claim_live_refund(
  p_refund_request_id UUID,p_organization_id UUID,p_actor_user_id UUID,
  p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_review private.subscription_live_refund_reviews;
  v_refund private.subscription_live_refunds;
  v_payment private.subscription_live_payments;
  v_grant private.subscription_live_grants;
  v_action TEXT;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_organization_id);
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Live refund merchant is unbound' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships
    WHERE organization_id=p_organization_id AND user_id=p_actor_user_id AND role='owner') THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_review FROM private.subscription_live_refund_reviews
    WHERE refund_request_id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_review.organization_id<>p_organization_id
    OR v_review.requested_by<>p_actor_user_id
    OR v_review.merchant_id<>p_provider_merchant_id
    OR v_review.owner_reviewed_at>clock_timestamp() THEN
    RAISE EXCEPTION 'Reviewed full Live refund required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE provider_payment_id=v_review.provider_payment_id;
  SELECT * INTO v_grant FROM private.subscription_live_grants
    WHERE organization_id=p_organization_id;
  IF v_payment.provider_payment_id IS NULL OR v_grant.organization_id IS NULL
    OR v_payment.state<>'verified' OR v_payment.organization_id<>p_organization_id
    OR v_payment.merchant_id<>p_provider_merchant_id
    OR v_payment.amount_minor<>v_review.amount_minor
    OR v_payment.currency<>v_review.currency
    OR v_grant.provider_payment_id IS DISTINCT FROM v_payment.provider_payment_id
    OR v_grant.merchant_id<>p_provider_merchant_id THEN
    RAISE EXCEPTION 'Full original Live payment does not match' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_refund FROM private.subscription_live_refunds
    WHERE refund_request_id=p_refund_request_id FOR UPDATE;
  IF FOUND THEN
    v_action:=CASE WHEN v_refund.confirmed_at IS NOT NULL THEN 'confirmed'
      WHEN v_refund.state='review_required' THEN 'review_required'
      WHEN v_refund.provider_refund_id IS NULL THEN 'recovery' ELSE 'bound' END;
  ELSE
    IF NOT v_settings.refunds_enabled THEN
      RAISE EXCEPTION 'New Live refunds are disabled' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM private.subscription_live_orders WHERE organization_id=p_organization_id
      AND request_id<>v_payment.request_id)
      OR v_grant.refund_confirmed_at IS NOT NULL OR v_grant.renewal_stopped_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM private.subscription_live_payments
        WHERE organization_id=p_organization_id
          AND provider_payment_id<>v_payment.provider_payment_id)
      OR EXISTS(SELECT 1 FROM private.organization_subscription_payments
        WHERE organization_id=p_organization_id) THEN
      RAISE EXCEPTION 'Later paid obligation needs refund review' USING ERRCODE='55000'; END IF;
    INSERT INTO private.subscription_live_refunds
      (refund_request_id,provider_payment_id,organization_id,merchant_id,
       amount_minor,currency,state)
    VALUES(p_refund_request_id,v_payment.provider_payment_id,p_organization_id,
      p_provider_merchant_id,v_payment.amount_minor,'INR','claimed')
    RETURNING * INTO v_refund;
    v_action:='create';
  END IF;
  RETURN jsonb_build_object('action',v_action,'refund_request_id',p_refund_request_id,
    'request_id',v_payment.request_id,
    'organization_id',p_organization_id,'provider_payment_id',v_payment.provider_payment_id,
    'provider_order_id',v_payment.provider_order_id,
    'provider_refund_id',v_refund.provider_refund_id,
    'amount_minor',v_payment.amount_minor,'currency','INR');
END;
$$;

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
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org((SELECT organization_id FROM private.subscription_live_quotes WHERE request_id=p_request_id));
  IF NOT FOUND OR v_settings.provider_mode<>'live' OR NOT v_settings.settlements_enabled
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'Live settlement is disabled or merchant-unbound' USING ERRCODE='55000'; END IF;
  IF p_provider_order_id IS NULL OR p_provider_order_id !~ '^order_[A-Za-z0-9]+$'
    OR p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^pay_[A-Za-z0-9]+$'
    OR p_amount_minor IS NULL OR p_amount_minor<=0 OR p_currency IS DISTINCT FROM 'INR'
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
    RETURN jsonb_build_object('status',v_payment.state,'reason',v_payment.hold_reason,
      'organization_id',v_quote.organization_id,'request_id',p_request_id,
      'provider_payment_id',p_provider_payment_id);
  END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_payments
    WHERE provider_payment_id=p_provider_payment_id OR provider_order_id=p_provider_order_id) THEN
    RAISE EXCEPTION 'Live provider identity already used' USING ERRCODE='23505'; END IF;

  SELECT * INTO v_access_before FROM private.organization_product_access
    WHERE organization_id=v_quote.organization_id FOR UPDATE;
  IF v_quote.customer_review_id IS NOT NULL AND (
    NOT private.subscription_customer_review_active(v_quote.organization_id,v_quote.customer_review_id)
    OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id=v_quote.organization_id AND m.user_id=v_quote.requested_by AND m.role='owner')) THEN
    v_hold_reason:='customer_opening_review_changed';
  ELSIF NOT v_offer_active THEN
    v_hold_reason:='offer_approval_changed';
  ELSIF v_order.claimed_at>=v_quote.expires_at
    OR p_capture_event_at<v_quote.owner_reviewed_at
    OR p_capture_event_at>v_quote.expires_at THEN
    v_hold_reason:='quote_expired_or_changed';
  ELSIF v_quote.renewal_of_request_id IS NOT NULL THEN
    SELECT * INTO v_grant FROM private.subscription_live_grants
      WHERE organization_id=v_quote.organization_id FOR UPDATE;
    IF v_grant.organization_id IS NULL OR v_grant.request_id IS DISTINCT FROM v_quote.renewal_of_request_id
      OR v_grant.paid_through_end IS DISTINCT FROM v_quote.previous_paid_through_end
      OR v_grant.merchant_id<>p_provider_merchant_id OR v_grant.tier<>'starter'
      OR v_quote.tier<>'starter' OR p_capture_event_at<v_grant.paid_through_end
      OR v_grant.refund_confirmed_at IS NOT NULL OR v_grant.renewal_stopped_at IS NOT NULL
      OR v_access_before.mode IS DISTINCT FROM 'manual' OR v_access_before.suspended_at IS NOT NULL
      OR v_access_before.version IS DISTINCT FROM v_quote.previous_access_version
      OR v_access_before.access_ends_at IS DISTINCT FROM v_quote.previous_paid_through_end
      OR NOT EXISTS(SELECT 1 FROM public.organization_memberships
        WHERE organization_id=v_quote.organization_id AND user_id=v_quote.requested_by AND role='owner')
      OR EXISTS(SELECT 1 FROM private.subscription_live_refunds WHERE organization_id=v_quote.organization_id)
      OR EXISTS(SELECT 1 FROM private.subscription_live_refund_reviews WHERE organization_id=v_quote.organization_id)
      OR EXISTS(SELECT 1 FROM private.subscription_live_webhook_events WHERE organization_id=v_quote.organization_id
        AND event_type LIKE 'refund.%')
      OR EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id=v_quote.organization_id
        AND state='review_required') THEN
      v_hold_reason:='renewal_changed_or_stopped';
    END IF;
  ELSE
    IF v_access_before.organization_id IS NULL OR NOT (
      (v_quote.source_access_mode='complimentary'
        AND v_quote.complimentary_conversion_accepted
        AND v_access_before.version=v_quote.source_access_version
        AND private.subscription_live_complimentary_eligible(
          v_quote.organization_id,v_quote.billing_account_id,v_quote.requested_by,
          v_quote.tier,p_request_id))
      OR (v_access_before.mode='trial' AND v_access_before.suspended_at IS NULL
        AND v_access_before.trial_ends_at IS NOT NULL
        AND now()>=v_access_before.trial_ends_at
        AND (v_quote.source_access_mode IS NULL OR
          (v_quote.source_access_mode='trial'
            AND v_access_before.version=v_quote.source_access_version)))) THEN
    v_hold_reason:='access_changed';
  ELSIF EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants
    WHERE organization_id=v_quote.organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_grants
      WHERE organization_id=v_quote.organization_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments
      WHERE organization_id=v_quote.organization_id) THEN
    v_hold_reason:='existing_paid_obligation';
  END IF;
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
     provider_order_id,amount_minor,currency,state,capture_event_at,hold_reason)
  VALUES(p_provider_payment_id,p_request_id,v_quote.organization_id,p_provider_merchant_id,
    p_provider_order_id,p_amount_minor,p_currency,
    CASE WHEN v_hold_reason IS NULL THEN 'verified' ELSE 'review_required' END,
    p_capture_event_at,v_hold_reason);
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
  IF v_quote.renewal_of_request_id IS NULL THEN
  INSERT INTO private.subscription_live_grants
    (organization_id,request_id,provider_payment_id,merchant_id,tier,
     period_start,paid_through_end)
  VALUES(v_quote.organization_id,p_request_id,p_provider_payment_id,p_provider_merchant_id,
    v_quote.tier,p_capture_event_at,p_capture_event_at+interval '1 month') RETURNING * INTO v_grant;
  ELSE
    UPDATE private.subscription_live_grants SET request_id=p_request_id,
      provider_payment_id=p_provider_payment_id,period_start=p_capture_event_at,
      paid_through_end=p_capture_event_at+interval '1 month'
      WHERE organization_id=v_quote.organization_id RETURNING * INTO v_grant;
  END IF;
  UPDATE private.organization_product_access SET mode='manual',
    access_starts_at=p_capture_event_at,access_ends_at=v_grant.paid_through_end,
    version=version+1,updated_at=now()
    WHERE organization_id=v_quote.organization_id RETURNING * INTO v_access_after;
  INSERT INTO private.product_access_audit
    (organization_id,action,reason,before_state,after_state)
  VALUES(v_quote.organization_id,
    CASE WHEN v_quote.renewal_of_request_id IS NULL THEN 'verified_subscription_payment' ELSE 'verified_subscription_renewal' END,
    'Usefulmade Live capture-event monthly payment',
    to_jsonb(v_access_before),to_jsonb(v_access_after));
  RETURN jsonb_build_object('status','verified','organization_id',v_quote.organization_id,
    'request_id',p_request_id,'provider_payment_id',p_provider_payment_id,
    'paid_through_end',v_grant.paid_through_end);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_live_owner_term(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.subscription_live_grants;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
  RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
 SELECT g1.* INTO g FROM private.subscription_live_grants g1
  JOIN private.subscription_live_settings_for_org(p_organization_id) s ON s.pilot_organization_id=g1.organization_id
   AND s.merchant_id=g1.merchant_id WHERE g1.organization_id=p_organization_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('request_id',g.request_id,'tier',g.tier,'paid_through_end',g.paid_through_end,
  'renewal_stopped',g.renewal_stopped_at IS NOT NULL,'refunded',g.refund_confirmed_at IS NOT NULL,
  'expired',now()>=g.paid_through_end);
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_guard_starter_pilot_refund_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM private.subscription_live_payments p
    JOIN private.subscription_live_quotes q ON q.request_id=p.request_id
    JOIN private.subscription_live_offer_approvals a ON a.approval_id=q.offer_approval_id
    WHERE p.provider_payment_id=NEW.provider_payment_id AND p.organization_id=NEW.organization_id
      AND q.renewal_of_request_id IS NULL
      AND EXISTS(SELECT 1 FROM public.organization_memberships m
        WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.requested_by AND m.role='owner')
      AND q.tier='starter' AND q.amount_minor=79900 AND q.currency='INR'
      AND (q.organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID OR (q.customer_review_id IS NOT NULL AND private.subscription_customer_review_active(q.organization_id,q.customer_review_id)))
      AND q.merchant_id='acc_TCJwBqanN9LTrK'
      AND NEW.approved_policy_reference=a.refund_policy_reference) THEN
    RAISE EXCEPTION 'Refund review must match the first Starter offer policy'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_record_live_delivery_receipt(
  p_merchant_id TEXT,p_pilot_organization_id UUID,p_event_id TEXT,p_event_id_source TEXT,
  p_event_type TEXT,p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_refund_id TEXT,p_body_sha256 TEXT,p_provider_event_at TIMESTAMPTZ,
  p_classification TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_event private.subscription_live_webhook_events;
  v_delivery_id UUID;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  -- Serialize conflicting event identities and recheck the current listener.
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton FOR UPDATE;
  IF NOT FOUND OR NOT v_settings.webhook_intake_enabled OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live webhook intake is disabled or unbound' USING ERRCODE='55000'; END IF;
  IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_event_id_source IS NULL OR p_event_id_source NOT IN ('provider','body_digest')
    OR p_event_type IS NULL OR p_event_type NOT IN
      ('payment.captured','payment.failed','refund.created','refund.processed','refund.failed')
    OR p_classification IS NULL OR p_classification NOT IN ('saas','unrelated_order','unrelated_no_order')
    OR p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^pay_[A-Za-z0-9]+$'
    OR p_body_sha256 IS NULL OR p_body_sha256 !~ '^[0-9a-f]{64}$'
    OR (p_event_id_source='body_digest' AND p_event_id<>p_body_sha256)
    OR (p_classification='unrelated_no_order' AND p_provider_order_id IS NOT NULL)
    OR (p_classification<>'unrelated_no_order' AND
      (p_provider_order_id IS NULL OR p_provider_order_id !~ '^order_[A-Za-z0-9]+$'))
    OR (p_event_type LIKE 'refund.%' AND
      (p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$'))
    OR (p_event_type LIKE 'payment.%' AND p_provider_refund_id IS NOT NULL)
    OR (p_provider_event_at IS NOT NULL AND
      (NOT isfinite(p_provider_event_at) OR p_provider_event_at<='2020-01-01'::timestamptz
        OR p_provider_event_at>clock_timestamp()+interval '5 minutes')) THEN
    RAISE EXCEPTION 'Invalid Live delivery identity' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_event FROM private.subscription_live_webhook_events
    WHERE merchant_id=p_merchant_id AND event_id=p_event_id;
  IF p_classification='saas' THEN
    IF v_event.event_id IS NULL OR NOT EXISTS(SELECT 1 FROM private.subscription_live_settings_for_org(v_event.organization_id))
      OR v_event.event_type<>p_event_type OR v_event.provider_order_id<>p_provider_order_id
      OR v_event.provider_payment_id<>p_provider_payment_id
      OR v_event.provider_refund_id IS DISTINCT FROM p_provider_refund_id
      OR v_event.body_sha256<>p_body_sha256
      OR v_event.provider_event_at IS DISTINCT FROM p_provider_event_at THEN
      RAISE EXCEPTION 'SaaS delivery requires matching durable intake' USING ERRCODE='22023'; END IF;
  ELSIF v_event.event_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM private.subscription_live_orders
      WHERE merchant_id=p_merchant_id AND provider_order_id=p_provider_order_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_webhook_events
      WHERE merchant_id=p_merchant_id AND provider_payment_id=p_provider_payment_id)
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments
      WHERE merchant_id=p_merchant_id AND provider_payment_id=p_provider_payment_id) THEN
    RAISE EXCEPTION 'Known SaaS work cannot be recorded as unrelated' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_delivery_receipts d
    WHERE d.merchant_id=p_merchant_id AND d.event_id=p_event_id AND d.event_id_source=p_event_id_source
      AND (d.listener_organization_id<>p_pilot_organization_id OR d.body_sha256<>p_body_sha256
        OR d.event_type<>p_event_type OR d.classification<>p_classification
        OR d.provider_order_id IS DISTINCT FROM p_provider_order_id
        OR d.provider_payment_id<>p_provider_payment_id
        OR d.provider_refund_id IS DISTINCT FROM p_provider_refund_id
        OR d.provider_event_at IS DISTINCT FROM p_provider_event_at)) THEN
    RAISE EXCEPTION 'Live delivery event identity changed' USING ERRCODE='23505'; END IF;

  INSERT INTO private.subscription_live_delivery_receipts
    (merchant_id,listener_organization_id,event_id,event_id_source,event_type,
     provider_order_id,provider_payment_id,provider_refund_id,body_sha256,
     provider_event_at,classification)
  VALUES(p_merchant_id,p_pilot_organization_id,p_event_id,p_event_id_source,p_event_type,
    p_provider_order_id,p_provider_payment_id,p_provider_refund_id,p_body_sha256,
    p_provider_event_at,p_classification) RETURNING delivery_id INTO v_delivery_id;
  RETURN jsonb_build_object('status','recorded','delivery_id',v_delivery_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.subscription_resolve_live_scope(
 p_provider_merchant_id TEXT,p_request_id UUID DEFAULT NULL,p_provider_order_id TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes; s private.subscription_live_settings;
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF (p_request_id IS NULL)=(p_provider_order_id IS NULL) THEN
  RAISE EXCEPTION 'One durable quote/order identity required' USING ERRCODE='22023'; END IF;
 SELECT q1.* INTO q FROM private.subscription_live_quotes q1
  WHERE q1.merchant_id=p_provider_merchant_id AND ((p_request_id IS NOT NULL AND q1.request_id=p_request_id)
   OR (p_provider_order_id IS NOT NULL AND EXISTS(SELECT 1 FROM private.subscription_live_orders o
     WHERE o.request_id=q1.request_id AND o.organization_id=q1.organization_id AND o.merchant_id=q1.merchant_id
       AND o.provider_order_id=p_provider_order_id AND o.state IN ('bound','review_required'))));
 IF NOT FOUND THEN RAISE EXCEPTION 'Durable Live identity required' USING ERRCODE='55000'; END IF;
 SELECT * INTO s FROM private.subscription_live_settings_for_org(q.organization_id);
 IF NOT FOUND OR s.merchant_id IS DISTINCT FROM p_provider_merchant_id OR NOT s.webhook_intake_enabled
   OR (q.customer_review_id IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM private.subscription_live_customer_reviews r WHERE r.review_id=q.customer_review_id
       AND r.organization_id=q.organization_id AND r.merchant_id=q.merchant_id
       AND r.offer_approval_id=q.offer_approval_id AND r.billing_account_id=q.billing_account_id)) THEN
  RAISE EXCEPTION 'Live identity is not operator-bound' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('request_id',q.request_id,'organization_id',q.organization_id,
   'merchant_id',q.merchant_id,'amount_minor',q.amount_minor,'currency',q.currency,
   'scope',CASE WHEN q.customer_review_id IS NULL THEN 'internal_acceptance' ELSE 'customer_sale' END);
END;
$$;

-- Bounded server-owned scope inventory for late event/order/refund recovery.
-- The original scope is always first and is retained after customer shutdown.
CREATE OR REPLACE FUNCTION public.subscription_list_live_recovery_scopes(p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_live_settings;
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM private.subscription_live_settings WHERE singleton;
 IF NOT FOUND OR s.merchant_id IS DISTINCT FROM p_provider_merchant_id OR NOT s.webhook_intake_enabled THEN
  RAISE EXCEPTION 'Original Live listener required' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_array(s.pilot_organization_id)||COALESCE((SELECT jsonb_agg(c.organization_id ORDER BY c.organization_id)
   FROM private.subscription_live_customer_scopes c WHERE c.merchant_id=s.merchant_id AND EXISTS(
     SELECT 1 FROM private.subscription_live_orders o WHERE o.organization_id=c.organization_id AND o.merchant_id=c.merchant_id)),'[]'::jsonb);
END;
$$;


REVOKE ALL ON FUNCTION private.subscription_customer_review_active(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_customer_review_active(UUID,UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.subscription_guard_customer_review() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_guard_customer_review() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.subscription_guard_customer_scope() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_guard_customer_scope() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.subscription_live_settings_for_org(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_live_settings_for_org(UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.subscription_stop_revoked_customer() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_stop_revoked_customer() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.subscription_list_live_recovery_scopes(TEXT) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.subscription_list_live_recovery_scopes(TEXT) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.subscription_list_live_recovery_scopes(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.subscription_resolve_live_scope(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.subscription_resolve_live_scope(TEXT,UUID,TEXT) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.subscription_resolve_live_scope(TEXT,UUID,TEXT) TO service_role;

-- Customer exception review retains owner/status/next action without resolving money.
CREATE OR REPLACE FUNCTION public.subscription_review_live_recovery_exception(
  p_item_type TEXT,p_item_id UUID,p_provider_merchant_id TEXT,p_pilot_organization_id UUID,
  p_operator_id UUID,p_authorization_reference TEXT,p_evidence_reference TEXT,
  p_status TEXT,p_owner_reference TEXT,p_next_action TEXT,p_next_action_due_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_before private.subscription_live_recovery_exceptions;
  v_after private.subscription_live_recovery_exceptions; v_review_id UUID;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings_for_org(p_pilot_organization_id);
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id
    OR NOT private.subscription_live_recovery_operator_allowed(p_pilot_organization_id,p_operator_id) THEN
    RAISE EXCEPTION 'Exact Live organization owner review required' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('investigating','waiting_provider','waiting_owner','recovery_approved')
    OR p_next_action_due_at IS NULL OR NOT isfinite(p_next_action_due_at)
    OR p_owner_reference IS NULL OR length(btrim(p_owner_reference)) NOT BETWEEN 1 AND 200
    OR p_next_action IS NULL OR length(btrim(p_next_action)) NOT BETWEEN 1 AND 1000
    OR p_authorization_reference IS NULL OR length(btrim(p_authorization_reference)) NOT BETWEEN 1 AND 500
    OR p_evidence_reference IS NULL OR length(btrim(p_evidence_reference)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Bounded metadata review and next action required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_before FROM private.subscription_live_recovery_exceptions
    WHERE item_type=p_item_type AND item_id=p_item_id FOR UPDATE;
  IF NOT FOUND OR v_before.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_before.organization_id IS DISTINCT FROM p_pilot_organization_id OR v_before.status='resolved' THEN
    RAISE EXCEPTION 'Unresolved exact Live exception required' USING ERRCODE='55000'; END IF;
  UPDATE private.subscription_live_recovery_exceptions SET status=p_status,
    owner_reference=btrim(p_owner_reference),next_action=btrim(p_next_action),
    next_action_due_at=p_next_action_due_at
    WHERE item_type=p_item_type AND item_id=p_item_id RETURNING * INTO v_after;
  INSERT INTO private.subscription_live_recovery_reviews
    (item_type,item_id,operator_id,authorization_reference,evidence_reference,before_state,after_state)
  VALUES(p_item_type,p_item_id,p_operator_id,btrim(p_authorization_reference),btrim(p_evidence_reference),
    to_jsonb(v_before),to_jsonb(v_after)) RETURNING review_id INTO v_review_id;
  RETURN jsonb_build_object('item_type',p_item_type,'item_id',p_item_id,'status',v_after.status,
    'review_id',v_review_id,'financial_hold_unchanged',TRUE);
END;
$$;
