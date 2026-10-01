-- REVIEW CANDIDATE ONLY. Default closed; no offer/review rows or switch updates.
-- Owner-authorized clean staging preparation may install this closed candidate.
-- Production installation/opening requires its exact separate approved rollout.
-- This allows only the first Starter term for UsefulMade / Home office as
-- INTERNAL acceptance. It does not authorize a customer sale or self-invoice.
-- Renewal initiation remains hard-closed. Global capabilities remain untouched.
-- Evidence references require human inspection; their presence does not prove
-- tax clearance. Provider acceptance is preflight/Test/mixed-routing readiness
-- for controlled acceptance, never a circular demand for a prior Live capture.
-- The tax/receipt review must classify internal acceptance without a self-invoice.

CREATE TABLE IF NOT EXISTS private.subscription_live_pilot_opening_reviews (
  review_id UUID PRIMARY KEY,
  offer_approval_id UUID NOT NULL,
  organization_id UUID NOT NULL CHECK(organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID),
  merchant_id TEXT NOT NULL CHECK(merchant_id='acc_TCJwBqanN9LTrK'),
  commercial_context TEXT NOT NULL CHECK(commercial_context='internal_acceptance'),
  reviewed_by UUID NOT NULL REFERENCES auth.users(id),
  release_sha TEXT NOT NULL CHECK(release_sha ~ '^[0-9a-f]{40}$'),
  migration_manifest_sha256 TEXT NOT NULL CHECK(migration_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference))>0),
  provider_acceptance_reference TEXT NOT NULL CHECK(length(btrim(provider_acceptance_reference))>0),
  tax_receipt_review_reference TEXT NOT NULL CHECK(length(btrim(tax_receipt_review_reference))>0),
  backup_recovery_reference TEXT NOT NULL CHECK(length(btrim(backup_recovery_reference))>0),
  reviewed_at TIMESTAMPTZ NOT NULL CHECK(isfinite(reviewed_at)),
  revoked_at TIMESTAMPTZ CHECK(revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=reviewed_at)),
  FOREIGN KEY(offer_approval_id,organization_id,merchant_id)
    REFERENCES private.subscription_live_offer_approvals(approval_id,organization_id,merchant_id)
);
ALTER TABLE private.subscription_live_pilot_opening_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_pilot_opening_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_live_pilot_opening_reviews TO service_role;

ALTER TABLE private.subscription_live_settings
  ADD COLUMN IF NOT EXISTS pilot_opening_review_id UUID
    REFERENCES private.subscription_live_pilot_opening_reviews(review_id);
-- Only an explicitly reviewed operator migration may select evidence/open flags.
-- Existing service-only money/evidence RPCs keep their existing execute grants.
-- TRUNCATE bypasses row triggers and RLS; remove the earlier blanket grants.
REVOKE ALL ON private.subscription_live_settings,private.subscription_live_quotes,
  private.subscription_live_orders,private.subscription_live_payments,
  private.subscription_live_grants,private.subscription_live_terms,
  private.subscription_live_refunds,private.subscription_live_refund_reviews,
  private.subscription_live_webhook_events,private.subscription_live_offer_approvals
  FROM service_role;
GRANT SELECT ON private.subscription_live_settings,private.subscription_live_quotes,
  private.subscription_live_orders,private.subscription_live_payments,
  private.subscription_live_grants,private.subscription_live_terms,
  private.subscription_live_refunds,private.subscription_live_refund_reviews,
  private.subscription_live_webhook_events,private.subscription_live_offer_approvals
  TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_guard_starter_pilot_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM '8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID
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
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_approval ON private.subscription_live_offer_approvals;
CREATE TRIGGER subscription_guard_starter_pilot_approval BEFORE INSERT
  ON private.subscription_live_offer_approvals FOR EACH ROW
  EXECUTE FUNCTION private.subscription_guard_starter_pilot_approval();

CREATE OR REPLACE FUNCTION private.subscription_guard_starter_pilot_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Pilot opening review evidence is immutable' USING ERRCODE='55000';
  ELSIF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'Pilot opening review evidence is immutable' USING ERRCODE='55000'; END IF;
  ELSIF NEW.reviewed_at>clock_timestamp() OR NOT EXISTS(
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.reviewed_by AND m.role='owner')
    OR NOT EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals a
      WHERE a.approval_id=NEW.offer_approval_id AND a.organization_id=NEW.organization_id
        AND a.merchant_id=NEW.merchant_id AND a.tier='starter' AND a.amount_minor=79900
        AND a.currency='INR' AND a.provider_mode='live'
        AND a.quote_validity_seconds=1800 AND a.term_policy='calendar_month_from_capture_event'
        AND a.revoked_at IS NULL AND a.approved_at<=NEW.reviewed_at) THEN
    RAISE EXCEPTION 'Owner-reviewed exact Starter offer required' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_review ON private.subscription_live_pilot_opening_reviews;
CREATE TRIGGER subscription_guard_starter_pilot_review BEFORE INSERT OR UPDATE OR DELETE
  ON private.subscription_live_pilot_opening_reviews FOR EACH ROW
  EXECUTE FUNCTION private.subscription_guard_starter_pilot_review();

-- Use COALESCE to avoid SQL CHECK's NULL-is-success behavior for an unbound row.
ALTER TABLE private.subscription_live_settings
  DROP CONSTRAINT IF EXISTS subscription_live_settings_orders_enabled_check,
  DROP CONSTRAINT IF EXISTS subscription_live_settings_refunds_enabled_check,
  DROP CONSTRAINT IF EXISTS subscription_live_quotes_closed,
  DROP CONSTRAINT IF EXISTS subscription_live_complimentary_conversion_closed,
  DROP CONSTRAINT IF EXISTS subscription_live_starter_pilot_scope;
ALTER TABLE private.subscription_live_settings
  ADD CONSTRAINT subscription_live_starter_pilot_scope CHECK(
    NOT (quotes_enabled OR orders_enabled OR refunds_enabled OR complimentary_conversion_enabled OR settlements_enabled)
    OR COALESCE(merchant_id='acc_TCJwBqanN9LTrK'
      AND pilot_organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID,FALSE));
ALTER TABLE private.subscription_live_settings
  DROP CONSTRAINT IF EXISTS subscription_live_starter_pilot_initiation;
ALTER TABLE private.subscription_live_settings
  ADD CONSTRAINT subscription_live_starter_pilot_initiation CHECK(
    (NOT (quotes_enabled OR orders_enabled OR refunds_enabled OR complimentary_conversion_enabled)
      OR (pilot_opening_review_id IS NOT NULL AND webhook_intake_enabled AND settlements_enabled))
    AND (NOT orders_enabled OR quotes_enabled)
    AND (NOT complimentary_conversion_enabled OR quotes_enabled));
-- subscription_live_renewals_closed is deliberately retained.

CREATE OR REPLACE FUNCTION private.subscription_guard_starter_pilot_settings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_review private.subscription_live_pilot_opening_reviews;
BEGIN
  IF TG_OP='UPDATE' AND NEW.pilot_opening_review_id IS DISTINCT FROM OLD.pilot_opening_review_id
    AND EXISTS(SELECT 1 FROM private.subscription_live_quotes) THEN
    RAISE EXCEPTION 'Pilot opening approval is pinned after the first quote' USING ERRCODE='55000'; END IF;
  -- A closed/rollback write must remain possible after revocation or a changed
  -- reminder policy. Settlement/intake do not depend on an active approval.
  IF NOT (NEW.quotes_enabled OR NEW.orders_enabled OR NEW.refunds_enabled OR NEW.complimentary_conversion_enabled) THEN
    RETURN NEW; END IF;
  SELECT * INTO v_review FROM private.subscription_live_pilot_opening_reviews
    WHERE review_id=NEW.pilot_opening_review_id;
  IF NOT FOUND OR v_review.revoked_at IS NOT NULL OR v_review.reviewed_at>clock_timestamp()
    OR v_review.organization_id IS DISTINCT FROM NEW.pilot_organization_id
    OR v_review.merchant_id IS DISTINCT FROM NEW.merchant_id
    OR NOT EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals a
      WHERE a.approval_id=v_review.offer_approval_id AND a.revoked_at IS NULL
        AND a.approved_at<=clock_timestamp() AND a.tier='starter' AND a.amount_minor=79900
        AND a.currency='INR' AND a.quote_validity_seconds=1800
        AND a.term_policy='calendar_month_from_capture_event')
    OR NOT EXISTS(SELECT 1 FROM private.subscription_billing_settings r WHERE r.singleton
      AND r.standard_reminder_policy_approved AND NULLIF(btrim(r.standard_reminder_policy_version),'') IS NOT NULL
      AND r.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND r.standard_reminder_hour_local=9) THEN
    RAISE EXCEPTION 'Approved pilot opening evidence and Starter reminder policy required'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_settings ON private.subscription_live_settings;
CREATE TRIGGER subscription_guard_starter_pilot_settings BEFORE INSERT OR UPDATE
  ON private.subscription_live_settings FOR EACH ROW
  EXECUTE FUNCTION private.subscription_guard_starter_pilot_settings();

CREATE OR REPLACE FUNCTION private.subscription_guard_starter_pilot_quote()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
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
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_quote ON private.subscription_live_quotes;
CREATE TRIGGER subscription_guard_starter_pilot_quote BEFORE INSERT
  ON private.subscription_live_quotes FOR EACH ROW
  EXECUTE FUNCTION private.subscription_guard_starter_pilot_quote();

-- The day-7 request-evidence guard remains installed. Tie the review policy
-- to the original immutable offer rather than accepting an unrelated string.
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
      AND q.organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID
      AND q.merchant_id='acc_TCJwBqanN9LTrK'
      AND NEW.approved_policy_reference=a.refund_policy_reference) THEN
    RAISE EXCEPTION 'Refund review must match the first Starter offer policy'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_refund_review ON private.subscription_live_refund_reviews;
CREATE TRIGGER subscription_guard_starter_pilot_refund_review BEFORE INSERT
  ON private.subscription_live_refund_reviews FOR EACH ROW
  EXECUTE FUNCTION private.subscription_guard_starter_pilot_refund_review();

-- Revocation stops initiation, preserving signed intake and GET reconciliation.
-- It does not rewrite/delete any quote, order, payment, term or refund evidence.
CREATE OR REPLACE FUNCTION private.subscription_stop_revoked_starter_pilot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    UPDATE private.subscription_live_settings s SET quotes_enabled=FALSE,orders_enabled=FALSE,
      refunds_enabled=FALSE,complimentary_conversion_enabled=FALSE
    WHERE s.singleton AND EXISTS(SELECT 1 FROM private.subscription_live_pilot_opening_reviews r
      WHERE r.review_id=s.pilot_opening_review_id
        AND ((TG_TABLE_NAME='subscription_live_offer_approvals' AND r.offer_approval_id=(to_jsonb(NEW)->>'approval_id')::UUID)
          OR (TG_TABLE_NAME='subscription_live_pilot_opening_reviews' AND r.review_id=(to_jsonb(NEW)->>'review_id')::UUID)));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_stop_revoked_starter_pilot_offer ON private.subscription_live_offer_approvals;
CREATE TRIGGER subscription_stop_revoked_starter_pilot_offer AFTER UPDATE OF revoked_at
  ON private.subscription_live_offer_approvals FOR EACH ROW
  EXECUTE FUNCTION private.subscription_stop_revoked_starter_pilot();
DROP TRIGGER IF EXISTS subscription_stop_revoked_starter_pilot_review ON private.subscription_live_pilot_opening_reviews;
CREATE TRIGGER subscription_stop_revoked_starter_pilot_review AFTER UPDATE OF revoked_at
  ON private.subscription_live_pilot_opening_reviews FOR EACH ROW
  EXECUTE FUNCTION private.subscription_stop_revoked_starter_pilot();

REVOKE ALL ON FUNCTION private.subscription_guard_starter_pilot_approval(),
  private.subscription_guard_starter_pilot_review(),private.subscription_guard_starter_pilot_settings(),
  private.subscription_guard_starter_pilot_quote(),private.subscription_guard_starter_pilot_refund_review(),
  private.subscription_stop_revoked_starter_pilot()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_guard_starter_pilot_approval() OWNER TO postgres;
ALTER FUNCTION private.subscription_guard_starter_pilot_review() OWNER TO postgres;
ALTER FUNCTION private.subscription_guard_starter_pilot_settings() OWNER TO postgres;
ALTER FUNCTION private.subscription_guard_starter_pilot_quote() OWNER TO postgres;
ALTER FUNCTION private.subscription_stop_revoked_starter_pilot() OWNER TO postgres;
ALTER FUNCTION private.subscription_guard_starter_pilot_refund_review() OWNER TO postgres;

-- A review saved after transaction start remains eligible at wall time.
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
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
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

REVOKE ALL ON FUNCTION public.subscription_claim_live_refund(UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_claim_live_refund(UUID,UUID,UUID,TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_claim_live_refund(UUID,UUID,UUID,TEXT) TO service_role;
