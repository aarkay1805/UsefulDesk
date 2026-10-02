-- Default-off customer Starter renewal. No authority seeds, gate activation or provider I/O.
CREATE TABLE IF NOT EXISTS private.subscription_live_renewal_releases (
 release_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 merchant_id TEXT NOT NULL,
 customer_review_id UUID NOT NULL,
 owner_user_id UUID NOT NULL REFERENCES auth.users(id),
 release_sha TEXT NOT NULL CHECK(release_sha ~ '^[0-9a-f]{40}$'),
 migration_manifest_sha256 TEXT NOT NULL CHECK(migration_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference))>0),
 provider_acceptance_reference TEXT NOT NULL CHECK(length(btrim(provider_acceptance_reference))>0),
 backup_recovery_reference TEXT NOT NULL CHECK(length(btrim(backup_recovery_reference))>0),
 reviewed_at TIMESTAMPTZ NOT NULL CHECK(isfinite(reviewed_at)),
 revoked_at TIMESTAMPTZ CHECK(revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=reviewed_at)),
 FOREIGN KEY(customer_review_id,organization_id,merchant_id)
  REFERENCES private.subscription_live_customer_reviews(review_id,organization_id,merchant_id)
);
ALTER TABLE private.subscription_live_renewal_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_renewal_releases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_live_renewal_releases TO service_role;
ALTER TABLE private.subscription_live_customer_scopes
 ADD COLUMN IF NOT EXISTS renewals_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN IF NOT EXISTS renewal_release_id UUID REFERENCES private.subscription_live_renewal_releases(release_id);
ALTER TABLE private.subscription_live_quotes
 ADD COLUMN IF NOT EXISTS renewal_release_id UUID REFERENCES private.subscription_live_renewal_releases(release_id);
-- Preserve first-sale/complimentary snapshots; add only paid customer renewal snapshots.
ALTER TABLE private.subscription_live_quotes DROP CONSTRAINT IF EXISTS subscription_live_source_access_snapshot;
ALTER TABLE private.subscription_live_quotes ADD CONSTRAINT subscription_live_source_access_snapshot CHECK(
 (source_access_mode IS NULL AND source_access_version IS NULL AND NOT complimentary_conversion_accepted)
 OR (source_access_mode IS NOT NULL AND source_access_mode='trial' AND source_access_version IS NOT NULL AND source_access_version>0 AND NOT complimentary_conversion_accepted)
 OR (source_access_mode IS NOT NULL AND source_access_mode='complimentary' AND source_access_version IS NOT NULL AND source_access_version>0 AND complimentary_conversion_accepted
  AND tier='starter' AND renewal_of_request_id IS NULL)
 OR (source_access_mode IS NOT NULL AND source_access_mode='manual' AND source_access_version IS NOT NULL AND source_access_version>0 AND source_access_version=previous_access_version
  AND renewal_of_request_id IS NOT NULL AND customer_review_id IS NOT NULL AND renewal_release_id IS NOT NULL
  AND NOT complimentary_conversion_accepted AND tier='starter'));
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.subscription_live_customer_scopes'::regclass AND conname='subscription_customer_renewals_closed') THEN
  ALTER TABLE private.subscription_live_customer_scopes ADD CONSTRAINT subscription_customer_renewals_closed CHECK(NOT renewals_enabled);
 END IF;
END $$;

-- Release identity survives shutdown for signed settlement; revocation holds captured money.
CREATE OR REPLACE FUNCTION private.subscription_customer_renewal_release_active(p_organization_id UUID,p_release_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.subscription_live_renewal_releases r
 JOIN private.subscription_live_customer_scopes c ON c.organization_id=r.organization_id
  AND c.review_id=r.customer_review_id AND c.merchant_id=r.merchant_id AND c.renewal_release_id=r.release_id
 WHERE r.organization_id=p_organization_id AND r.release_id=p_release_id
  AND r.revoked_at IS NULL AND r.reviewed_at<=clock_timestamp()
  AND private.subscription_customer_review_active(r.organization_id,r.customer_review_id)
  AND EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=r.organization_id AND m.user_id=r.owner_user_id AND m.role='owner'));
$$;
CREATE OR REPLACE FUNCTION private.subscription_guard_renewal_release()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND ((to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at))) THEN
  RAISE EXCEPTION 'Renewal release is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' AND (NEW.reviewed_at>clock_timestamp()
  OR NOT private.subscription_customer_review_active(NEW.organization_id,NEW.customer_review_id)
  OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.owner_user_id AND m.role='owner')) THEN
  RAISE EXCEPTION 'Current owner and customer review required' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
  UPDATE private.subscription_live_customer_scopes SET renewals_enabled=false WHERE renewal_release_id=NEW.release_id;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_renewal_release ON private.subscription_live_renewal_releases;
CREATE TRIGGER subscription_guard_renewal_release BEFORE INSERT OR UPDATE OR DELETE ON private.subscription_live_renewal_releases
 FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_renewal_release();

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
 s.renewals_enabled:=c.renewals_enabled AND active AND s.quotes_enabled AND s.orders_enabled
  AND private.subscription_customer_renewal_release_active(p_organization_id,c.renewal_release_id);
 RETURN NEXT s;
END;
$$;

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
 IF NEW.renewals_enabled AND (NOT NEW.quotes_enabled OR NOT NEW.orders_enabled
  OR NOT EXISTS(SELECT 1 FROM private.subscription_live_renewal_releases r
   WHERE r.release_id=NEW.renewal_release_id AND r.organization_id=NEW.organization_id AND r.merchant_id=NEW.merchant_id
    AND r.customer_review_id=NEW.review_id AND r.revoked_at IS NULL AND r.reviewed_at<=clock_timestamp()
    AND EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=r.organization_id AND m.user_id=r.owner_user_id AND m.role='owner'))) THEN
  RAISE EXCEPTION 'Separate renewal release and checkout scope required' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND NEW.renewal_release_id IS DISTINCT FROM OLD.renewal_release_id
  AND EXISTS(SELECT 1 FROM private.subscription_live_quotes q WHERE q.organization_id=OLD.organization_id AND q.renewal_release_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Renewal release preserves existing obligations' USING ERRCODE='55000'; END IF;
 IF NEW.quotes_enabled OR NEW.orders_enabled OR NEW.refunds_enabled OR NEW.renewals_enabled THEN
  IF NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s WHERE s.singleton
    AND s.webhook_intake_enabled AND s.settlements_enabled)
   OR NOT private.subscription_customer_review_active(NEW.organization_id,NEW.review_id) THEN
   RAISE EXCEPTION 'Customer opening review and intake/settlement required' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_stop_revoked_customer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
  UPDATE private.subscription_live_customer_scopes c SET quotes_enabled=FALSE,orders_enabled=FALSE,refunds_enabled=FALSE,renewals_enabled=FALSE
  WHERE EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r WHERE r.review_id=c.review_id
    AND ((TG_TABLE_NAME='subscription_live_customer_reviews' AND r.review_id=(to_jsonb(NEW)->>'review_id')::UUID)
     OR (TG_TABLE_NAME='subscription_live_offer_approvals' AND r.offer_approval_id=(to_jsonb(NEW)->>'approval_id')::UUID)));
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_require_live_renewal(
 p_organization_id UUID,p_billing_account_id UUID,p_actor_user_id UUID,p_previous_request_id UUID)
RETURNS private.subscription_live_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.subscription_live_grants; x private.organization_product_access;
 s private.subscription_live_settings;
BEGIN
 SELECT * INTO s FROM private.subscription_live_settings_for_org(p_organization_id);
 IF NOT FOUND OR NOT s.renewals_enabled OR s.provider_mode<>'live'
  OR s.pilot_organization_id IS DISTINCT FROM p_organization_id THEN
  RAISE EXCEPTION 'Live renewal is disabled' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=p_organization_id
  AND user_id=p_actor_user_id AND role='owner') THEN
  RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
 SELECT * INTO g FROM private.subscription_live_grants WHERE organization_id=p_organization_id;
 SELECT * INTO x FROM private.organization_product_access WHERE organization_id=p_organization_id;
 IF g.organization_id IS NULL OR g.request_id IS DISTINCT FROM p_previous_request_id
  OR g.merchant_id IS DISTINCT FROM s.merchant_id OR g.tier<>'starter'
  OR g.refund_confirmed_at IS NOT NULL OR g.renewal_stopped_at IS NOT NULL
  OR clock_timestamp()<g.paid_through_end OR x.organization_id IS NULL OR x.mode<>'manual'
  OR x.suspended_at IS NOT NULL OR x.access_starts_at IS DISTINCT FROM g.period_start
  OR x.access_ends_at IS DISTINCT FROM g.paid_through_end
  OR EXISTS(SELECT 1 FROM private.subscription_live_refunds WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_refund_reviews WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_webhook_events WHERE organization_id=p_organization_id
   AND event_type LIKE 'refund.%')
  OR EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id=p_organization_id
   AND state='review_required')
  OR EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants WHERE organization_id=p_organization_id)
  OR (SELECT count(*) FROM public.accounts WHERE organization_id=p_organization_id AND branch_status='active')<>1
  OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_billing_account_id AND organization_id=p_organization_id
   AND branch_status='active' AND default_currency='INR') THEN
  RAISE EXCEPTION 'Expired Starter term or renewal review required' USING ERRCODE='55000'; END IF;
 RETURN g;
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_live_renewal_preview(
  p_organization_id UUID,p_billing_account_id UUID,p_tier TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_live_settings;
  a private.subscription_live_offer_approvals;
  x private.organization_product_access;
  r private.subscription_billing_settings;
  g private.subscription_live_grants;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_live_settings_for_org(p_organization_id);
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
  SELECT * INTO g FROM private.subscription_live_grants WHERE organization_id=p_organization_id;
  g:=private.subscription_require_live_renewal(p_organization_id,p_billing_account_id,auth.uid(),g.request_id);
  IF p_tier<>'starter' OR a.quote_validity_seconds<>1800 THEN
    RAISE EXCEPTION 'Approved Starter renewal offer required' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_orders o
    LEFT JOIN private.subscription_live_payments p USING(request_id)
    WHERE o.organization_id=p_organization_id AND (p.request_id IS NULL OR p.state<>'verified'))
    OR EXISTS(SELECT 1 FROM private.subscription_live_quotes q
      WHERE q.organization_id=p_organization_id AND q.expires_at>clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM private.subscription_live_payments p WHERE p.request_id=q.request_id)) THEN
    RAISE EXCEPTION 'Existing renewal needs review' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('renewal_of_request_id',g.request_id,'approval_id',a.approval_id,'tier',a.tier,
    'amount_minor',a.amount_minor,'currency',a.currency,
    'term_policy',a.term_policy,'customer_tax_note',a.customer_tax_note,
    'customer_terms_note',a.customer_terms_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_create_live_renewal_quote(
  p_request_id UUID,p_organization_id UUID,p_billing_account_id UUID,
  p_actor_user_id UUID,p_approval_id UUID,p_seen_amount_minor BIGINT,p_tier TEXT,
  p_provider_merchant_id TEXT,p_previous_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_live_settings;
  a private.subscription_live_offer_approvals;
  q private.subscription_live_quotes;
  x private.organization_product_access;
  g private.subscription_live_grants;
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
  IF NOT FOUND OR a.organization_id<>p_organization_id
    OR a.merchant_id<>p_provider_merchant_id OR a.tier IS DISTINCT FROM p_tier
    OR a.amount_minor IS DISTINCT FROM p_seen_amount_minor
    OR a.currency<>'INR' OR a.provider_mode<>'live'
    OR a.revoked_at IS NOT NULL OR a.approved_at>now()
    OR a.tier<>'starter' OR a.quote_validity_seconds<>1800 THEN
    RAISE EXCEPTION 'Reviewed Live amount or approval changed' USING ERRCODE='55000'; END IF;
  SELECT * INTO q FROM private.subscription_live_quotes
    WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF q.organization_id<>p_organization_id OR q.requested_by<>p_actor_user_id
      OR q.billing_account_id<>p_billing_account_id OR q.offer_approval_id<>p_approval_id
      OR q.tier<>p_tier OR q.amount_minor<>p_seen_amount_minor
      OR q.merchant_id<>p_provider_merchant_id OR clock_timestamp()>=q.expires_at
      OR q.renewal_of_request_id IS DISTINCT FROM p_previous_request_id THEN
      RAISE EXCEPTION 'Live quote replay changed or expired' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('request_id',q.request_id,
      'organization_id',q.organization_id,'tier',q.tier,'renewal_of_request_id',q.renewal_of_request_id,
      'amount_minor',q.amount_minor,'currency',q.currency,
      'expires_at',q.expires_at,'approval_id',q.offer_approval_id);
  END IF;
  g:=private.subscription_require_live_renewal(p_organization_id,p_billing_account_id,p_actor_user_id,p_previous_request_id);
  SELECT * INTO x FROM private.organization_product_access WHERE organization_id=p_organization_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM private.subscription_live_orders o
    LEFT JOIN private.subscription_live_payments p USING(request_id)
    WHERE o.organization_id=p_organization_id AND (p.request_id IS NULL OR p.state<>'verified'))
    OR EXISTS(SELECT 1 FROM private.subscription_live_quotes q2
      WHERE q2.organization_id=p_organization_id AND q2.expires_at>clock_timestamp()
       AND NOT EXISTS(SELECT 1 FROM private.subscription_live_payments p WHERE p.request_id=q2.request_id)) THEN
    RAISE EXCEPTION 'Existing renewal needs review' USING ERRCODE='55000'; END IF;
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
     offer_approval_id,renewal_of_request_id,previous_paid_through_end,previous_access_version,source_access_mode,source_access_version)
  VALUES(p_request_id,p_organization_id,p_actor_user_id,p_billing_account_id,
    p_provider_merchant_id,a.tier,a.amount_minor,a.currency,a.term_policy,
    a.offer_reference,a.tax_decision_reference,
    v_reviewed_at+make_interval(secs=>a.quote_validity_seconds),
    v_reviewed_at,v_reviewed_at,a.approval_id,g.request_id,g.paid_through_end,x.version,x.mode,x.version)
  RETURNING * INTO q;
  RETURN jsonb_build_object('request_id',q.request_id,
    'organization_id',q.organization_id,'tier',q.tier,'renewal_of_request_id',q.renewal_of_request_id,
    'amount_minor',q.amount_minor,'currency',q.currency,
    'expires_at',q.expires_at,'approval_id',q.offer_approval_id);
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
      OR (NEW.renewal_of_request_id IS NULL AND NEW.source_access_mode IS DISTINCT FROM 'trial')
      OR (NEW.renewal_of_request_id IS NOT NULL AND NEW.source_access_mode IS DISTINCT FROM 'manual')
      OR NEW.source_access_version IS NULL OR NEW.complimentary_conversion_accepted
      OR NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s WHERE s.singleton
        AND s.webhook_intake_enabled AND s.settlements_enabled AND s.merchant_id=NEW.merchant_id) THEN
      RAISE EXCEPTION 'Quote is outside reviewed customer Starter scope' USING ERRCODE='55000'; END IF;
    IF NEW.renewal_of_request_id IS NOT NULL THEN
      SELECT c.renewal_release_id INTO NEW.renewal_release_id FROM private.subscription_live_customer_scopes c
       WHERE c.organization_id=NEW.organization_id AND c.renewals_enabled
        AND private.subscription_customer_renewal_release_active(c.organization_id,c.renewal_release_id);
      IF NEW.renewal_release_id IS NULL THEN
        RAISE EXCEPTION 'Separate renewal release required' USING ERRCODE='55000'; END IF;
      PERFORM private.subscription_require_live_renewal(NEW.organization_id,NEW.billing_account_id,NEW.requested_by,NEW.renewal_of_request_id);
    ELSIF NEW.renewal_release_id IS NOT NULL THEN
      RAISE EXCEPTION 'First payment cannot use renewal release' USING ERRCODE='55000'; END IF;
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
    OR NEW.renewal_release_id IS DISTINCT FROM OLD.renewal_release_id
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
    'amount_minor',v_quote.amount_minor,'currency',v_quote.currency,'renewal_of_request_id',v_quote.renewal_of_request_id);
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
    'order_state',(SELECT state FROM private.subscription_live_orders WHERE request_id=q.request_id),
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
  'expired',clock_timestamp()>=g.paid_through_end,
  'renewal_available',COALESCE((SELECT s.renewals_enabled AND s.quotes_enabled AND s.orders_enabled
    FROM private.subscription_live_settings_for_org(p_organization_id) s),FALSE));
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
  IF v_quote.renewal_of_request_id IS NOT NULL AND v_quote.customer_review_id IS NOT NULL
    AND NOT private.subscription_customer_renewal_release_active(v_quote.organization_id,v_quote.renewal_release_id) THEN
    v_hold_reason:='renewal_release_changed';
  ELSIF v_quote.customer_review_id IS NOT NULL AND (
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

REVOKE ALL ON FUNCTION private.subscription_customer_renewal_release_active(UUID,UUID),private.subscription_guard_renewal_release()
 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_customer_renewal_release_active(UUID,UUID) OWNER TO postgres;
ALTER FUNCTION private.subscription_guard_renewal_release() OWNER TO postgres;

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
   'renewal_of_request_id',q.renewal_of_request_id,
   'merchant_id',q.merchant_id,'amount_minor',q.amount_minor,'currency',q.currency,
   'scope',CASE WHEN q.customer_review_id IS NULL THEN 'internal_acceptance' ELSE 'customer_sale' END);
END;
$$;
