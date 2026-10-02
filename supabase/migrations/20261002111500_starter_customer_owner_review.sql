-- Operator readiness is separate from the genuine authenticated owner's review.
-- Seeds no customer, offer, review, scope or activation.
CREATE TABLE IF NOT EXISTS private.subscription_live_customer_preparations (
  LIKE private.subscription_live_customer_reviews INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id),
  source_access_version INTEGER NOT NULL CHECK(source_access_version > 0),
  opening_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  opened_at TIMESTAMPTZ CHECK(opened_at IS NULL OR isfinite(opened_at)),
  FOREIGN KEY(offer_approval_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_offer_approvals(approval_id,organization_id,merchant_id),
  FOREIGN KEY(organization_id) REFERENCES public.organizations(id),
  FOREIGN KEY(billing_account_id) REFERENCES public.accounts(id),
  FOREIGN KEY(reviewed_by) REFERENCES auth.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_live_customer_preparations_active_org
 ON private.subscription_live_customer_preparations(organization_id) WHERE revoked_at IS NULL;
ALTER TABLE private.subscription_live_customer_preparations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_customer_preparations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_live_customer_preparations TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_guard_customer_preparation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Customer preparation is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['opening_enabled','revoked_at','opened_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['opening_enabled','revoked_at','opened_at'])
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (OLD.opened_at IS NOT NULL AND NEW.opened_at IS DISTINCT FROM OLD.opened_at)) THEN
  RAISE EXCEPTION 'Customer preparation is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' AND (NEW.reviewed_at>clock_timestamp() OR NOT EXISTS(
   SELECT 1 FROM private.subscription_live_offer_approvals a
   JOIN private.subscription_live_settings s ON s.singleton AND s.merchant_id=a.merchant_id
   WHERE a.approval_id=NEW.offer_approval_id AND a.organization_id=NEW.organization_id
    AND a.merchant_id=NEW.merchant_id AND a.tier='starter' AND a.amount_minor=79900 AND a.currency='INR'
    AND a.term_policy='calendar_month_from_capture_event' AND a.quote_validity_seconds=1800
    AND a.approved_at<=NEW.reviewed_at AND NEW.organization_id IS DISTINCT FROM s.pilot_organization_id)
   OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=NEW.organization_id
     AND m.user_id=NEW.owner_user_id AND m.role='owner')) THEN
  RAISE EXCEPTION 'Exact operator-prepared customer offer required' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_customer_preparation ON private.subscription_live_customer_preparations;
CREATE TRIGGER subscription_guard_customer_preparation BEFORE INSERT OR UPDATE OR DELETE
 ON private.subscription_live_customer_preparations FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_customer_preparation();

CREATE OR REPLACE FUNCTION private.subscription_close_disabled_preparation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT NEW.opening_enabled OR NEW.revoked_at IS NOT NULL THEN
  UPDATE private.subscription_live_customer_scopes SET quotes_enabled=FALSE,orders_enabled=FALSE,refunds_enabled=FALSE
   WHERE organization_id=NEW.organization_id AND review_id=NEW.review_id;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_close_disabled_preparation ON private.subscription_live_customer_preparations;
CREATE TRIGGER subscription_close_disabled_preparation AFTER UPDATE OF opening_enabled,revoked_at
 ON private.subscription_live_customer_preparations FOR EACH ROW EXECUTE FUNCTION private.subscription_close_disabled_preparation();
ALTER FUNCTION private.subscription_close_disabled_preparation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_close_disabled_preparation() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.subscription_customer_preparation_eligible(p_preparation_id UUID,p_actor UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations p
  JOIN private.subscription_live_offer_approvals a ON a.approval_id=p.offer_approval_id
  JOIN private.subscription_live_settings s ON s.singleton AND s.merchant_id=p.merchant_id
  JOIN private.subscription_billing_settings b ON b.singleton
  JOIN private.organization_product_access x ON x.organization_id=p.organization_id
  JOIN public.accounts c ON c.id=p.billing_account_id AND c.organization_id=p.organization_id
  WHERE p.review_id=p_preparation_id AND p.owner_user_id=p_actor AND p.opening_enabled
   AND p.revoked_at IS NULL AND p.reviewed_at<=clock_timestamp() AND a.revoked_at IS NULL
   AND s.webhook_intake_enabled AND s.settlements_enabled
   AND p.organization_id IS DISTINCT FROM s.pilot_organization_id
   AND c.branch_status='active' AND c.default_currency='INR'
   AND (SELECT count(*) FROM public.accounts WHERE organization_id=p.organization_id AND branch_status='active')=1
   AND EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p.organization_id
     AND m.user_id=p_actor AND m.role='owner')
   AND x.mode='trial' AND x.suspended_at IS NULL AND x.trial_ends_at<=clock_timestamp()
   AND x.version=p.source_access_version
   AND b.standard_reminder_policy_approved AND b.standard_reminder_policy_version=p.reminder_policy_version
   AND b.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND b.standard_reminder_hour_local=9
   AND NOT EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id=p.organization_id)
   AND NOT EXISTS(SELECT 1 FROM private.subscription_live_orders WHERE organization_id=p.organization_id)
   AND NOT EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id=p.organization_id)
   AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id=p.organization_id)
   AND NOT EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants WHERE organization_id=p.organization_id));
$$;

CREATE OR REPLACE FUNCTION public.subscription_customer_review_preview(p_organization_id UUID,p_billing_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p private.subscription_live_customer_preparations; a private.subscription_live_offer_approvals; c private.subscription_live_customer_scopes;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
  RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM private.subscription_live_customer_preparations
  WHERE organization_id=p_organization_id AND billing_account_id=p_billing_account_id AND owner_user_id=auth.uid()
   AND revoked_at IS NULL ORDER BY reviewed_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO a FROM private.subscription_live_offer_approvals WHERE approval_id=p.offer_approval_id AND revoked_at IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO c FROM private.subscription_live_customer_scopes WHERE organization_id=p_organization_id AND review_id=p.review_id;
 IF c.review_id IS NULL AND NOT private.subscription_customer_preparation_eligible(p.review_id,auth.uid()) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('preparation_id',p.review_id,'organization_id',p.organization_id,'billing_account_id',p.billing_account_id,
  'amount_minor',a.amount_minor,'currency',a.currency,'customer_tax_note',a.customer_tax_note,'customer_terms_note',a.customer_terms_note,
  'branch_name',(SELECT name FROM public.accounts WHERE id=p.billing_account_id),
  'owner_reviewed',c.review_id IS NOT NULL,
  'checkout_open',COALESCE(c.quotes_enabled AND c.orders_enabled AND private.subscription_customer_review_active(c.organization_id,c.review_id),FALSE),
  'opening_available',p.opening_enabled AND p.opened_at IS NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_approve_customer_review(p_preparation_id UUID,p_seen_amount_minor BIGINT,p_terms_accepted BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p private.subscription_live_customer_preparations; r private.subscription_live_customer_reviews; v_now TIMESTAMPTZ;
BEGIN
 IF auth.uid() IS NULL OR p_terms_accepted IS DISTINCT FROM TRUE OR p_seen_amount_minor IS DISTINCT FROM 79900::BIGINT THEN
  RAISE EXCEPTION 'Owner offer acknowledgement required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM private.subscription_live_customer_preparations WHERE review_id=p_preparation_id FOR UPDATE;
 IF NOT FOUND OR p.owner_user_id IS DISTINCT FROM auth.uid() OR NOT public.is_organization_owner(p.organization_id) THEN
  RAISE EXCEPTION 'Prepared organization owner required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p.organization_id FOR UPDATE;
 IF NOT private.subscription_customer_preparation_eligible(p.review_id,auth.uid()) THEN
  RAISE EXCEPTION 'Customer preparation changed; contact support' USING ERRCODE='55000'; END IF;
 SELECT * INTO r FROM private.subscription_live_customer_reviews WHERE review_id=p.review_id;
 IF NOT FOUND THEN
  v_now:=clock_timestamp();
  INSERT INTO private.subscription_live_customer_reviews
   (review_id,offer_approval_id,organization_id,billing_account_id,merchant_id,commercial_context,reviewed_by,
    release_sha,migration_manifest_sha256,authorization_reference,buyer_geography_reference,issuer_financial_year_reference,
    tax_receipt_review_reference,provider_acceptance_reference,backup_recovery_reference,reminder_policy_version,reviewed_at)
  VALUES(p.review_id,p.offer_approval_id,p.organization_id,p.billing_account_id,p.merchant_id,'customer_sale',auth.uid(),
   p.release_sha,p.migration_manifest_sha256,p.authorization_reference,p.buyer_geography_reference,p.issuer_financial_year_reference,
   p.tax_receipt_review_reference,p.provider_acceptance_reference,p.backup_recovery_reference,p.reminder_policy_version,v_now);
  INSERT INTO private.subscription_live_customer_scopes(organization_id,merchant_id,review_id)
   VALUES(p.organization_id,p.merchant_id,p.review_id);
  INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation,details)
   VALUES(p.organization_id,p.billing_account_id,auth.uid(),'subscription.customer_review_approved',
     jsonb_build_object('review_id',p.review_id,'offer_approval_id',p.offer_approval_id,'amount_minor',79900,'terms_accepted',TRUE,'scope_initially_closed',TRUE));
 ELSIF r.reviewed_by IS DISTINCT FROM auth.uid() OR r.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Customer review changed' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('review_id',p.review_id,'organization_id',p.organization_id,'billing_account_id',p.billing_account_id);
END;
$$;

-- Called by the server only after the preceding authenticated owner transaction commits.
-- One-way consumption prevents owner retries from reopening operator containment.
CREATE OR REPLACE FUNCTION public.subscription_open_reviewed_customer_scope(p_review_id UUID,p_organization_id UUID,p_actor_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p private.subscription_live_customer_preparations; c private.subscription_live_customer_scopes; v_now TIMESTAMPTZ;
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM private.subscription_live_customer_preparations WHERE review_id=p_review_id FOR UPDATE;
 IF NOT FOUND OR p.organization_id IS DISTINCT FROM p_organization_id OR p.owner_user_id IS DISTINCT FROM p_actor_user_id
  OR NOT private.subscription_customer_preparation_eligible(p.review_id,p_actor_user_id)
  OR NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r WHERE r.review_id=p.review_id
    AND r.reviewed_by=p_actor_user_id AND r.reviewed_at>=p.reviewed_at AND r.revoked_at IS NULL)
  OR NOT private.subscription_customer_review_active(p.organization_id,p.review_id) THEN
  RAISE EXCEPTION 'Reviewed customer opening required' USING ERRCODE='55000'; END IF;
 SELECT * INTO c FROM private.subscription_live_customer_scopes WHERE organization_id=p.organization_id AND review_id=p.review_id FOR UPDATE;
 IF p.opened_at IS NOT NULL THEN
  IF NOT c.quotes_enabled OR NOT c.orders_enabled THEN RAISE EXCEPTION 'Customer checkout closed by operator' USING ERRCODE='55000'; END IF;
 ELSE
  IF c.review_id IS NULL OR c.quotes_enabled OR c.orders_enabled OR c.refunds_enabled THEN
   RAISE EXCEPTION 'Initially closed customer scope required' USING ERRCODE='55000'; END IF;
  v_now:=clock_timestamp();
  UPDATE private.subscription_live_customer_scopes SET quotes_enabled=TRUE,orders_enabled=TRUE WHERE organization_id=p.organization_id;
  UPDATE private.subscription_live_customer_preparations SET opened_at=v_now WHERE review_id=p.review_id;
  INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation,details)
   VALUES(p.organization_id,p.billing_account_id,NULL,'subscription.customer_checkout_opened',
    jsonb_build_object('review_id',p.review_id,'operator_preparation_reviewed_by',p.reviewed_by,'authenticated_owner',p_actor_user_id,
      'quotes_enabled',TRUE,'orders_enabled',TRUE,'refunds_enabled',FALSE));
 END IF;
 RETURN jsonb_build_object('review_id',p.review_id,'organization_id',p.organization_id,'checkout_open',TRUE);
END;
$$;

ALTER FUNCTION private.subscription_guard_customer_preparation() OWNER TO postgres;
ALTER FUNCTION private.subscription_customer_preparation_eligible(UUID,UUID) OWNER TO postgres;
ALTER FUNCTION public.subscription_customer_review_preview(UUID,UUID) OWNER TO postgres;
ALTER FUNCTION public.subscription_approve_customer_review(UUID,BIGINT,BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.subscription_open_reviewed_customer_scope(UUID,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_guard_customer_preparation(),private.subscription_customer_preparation_eligible(UUID,UUID),
 public.subscription_customer_review_preview(UUID,UUID),public.subscription_approve_customer_review(UUID,BIGINT,BOOLEAN),
 public.subscription_open_reviewed_customer_scope(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.subscription_customer_review_preview(UUID,UUID),public.subscription_approve_customer_review(UUID,BIGINT,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_open_reviewed_customer_scope(UUID,UUID,UUID) TO service_role;
