-- Owner-authorized operator opening, 1 October 2026. No provider call/paid grant.
-- Authority and actual bank-message recording method are retained in this chat
-- and docs/subscription-production-pilot-review.md#owner-decision-and-accounting-record.
-- Implementation release and its 28-source manifest are separately pinned below;
-- this operator selector is recorded by its own source hash/history, avoiding a
-- self-referential manifest. Never use this scope for a customer invoice.
DO $$
DECLARE
  v_org UUID := '8826d9aa-03f2-4ad7-ae91-0553052131f8';
  v_owner UUID := '94b588be-e996-47ec-9372-4a6e8bff8dc8';
  v_merchant TEXT := 'acc_TCJwBqanN9LTrK';
  v_release TEXT := '71d897a6dfd17b7938129d2b7a3cfbb808531a80';
  v_manifest TEXT := '21abf5bd14a46d4feaf6510c92e82280489a9f85883d4c3106f5d6d63d53c494';
  v_authority TEXT := 'docs/subscription-production-pilot-review.md#owner-decision-and-accounting-record; owner Confirmed and approved plus bank-message recording reply, 2026-10-01';
  v_offer UUID;
  v_review UUID;
  v_existing private.subscription_live_pilot_opening_reviews;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=v_org FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.organization_memberships
    WHERE organization_id=v_org AND user_id=v_owner AND role='owner') THEN
    RAISE EXCEPTION 'Exact reviewed organization owner required'; END IF;
  SELECT * INTO v_existing FROM private.subscription_live_pilot_opening_reviews
    WHERE organization_id=v_org AND authorization_reference=v_authority;
  IF FOUND THEN
    IF v_existing.reviewed_by IS DISTINCT FROM v_owner
      OR v_existing.merchant_id IS DISTINCT FROM v_merchant
      OR v_existing.release_sha IS DISTINCT FROM v_release
      OR v_existing.migration_manifest_sha256 IS DISTINCT FROM v_manifest
      OR v_existing.commercial_context IS DISTINCT FROM 'internal_acceptance'
      OR NOT EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals a
        WHERE a.approval_id=v_existing.offer_approval_id AND a.organization_id=v_org
          AND a.merchant_id=v_merchant AND a.tier='starter' AND a.amount_minor=79900
          AND a.currency='INR' AND a.quote_validity_seconds=1800) THEN
      RAISE EXCEPTION 'Existing opening does not match reviewed identity'; END IF;
    -- A replay cannot reopen initiation after containment or revocation.
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM private.subscription_live_settings
    WHERE singleton AND provider_mode='live' AND merchant_id=v_merchant
      AND pilot_organization_id=v_org AND webhook_intake_enabled
      AND NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled
      AND NOT settlements_enabled AND NOT complimentary_conversion_enabled
      AND NOT renewals_enabled AND pilot_opening_review_id IS NULL)
    OR NOT EXISTS(SELECT 1 FROM private.subscription_billing_settings
      WHERE singleton AND NOT enabled AND NOT refunds_enabled
        AND NOT capabilities_enabled AND NOT advanced_payments_enabled
        AND NOT advanced_commercial_approved AND test_merchant_account_id IS NULL
        AND NOT standard_reminder_policy_approved)
    OR NOT EXISTS(SELECT 1 FROM private.organization_product_access
      WHERE organization_id=v_org AND mode='complimentary' AND version=1
        AND suspended_at IS NULL AND access_ends_at IS NULL)
    OR (SELECT count(*) FROM public.accounts WHERE organization_id=v_org AND branch_status='active')<>1
    OR NOT EXISTS(SELECT 1 FROM public.accounts
      WHERE id='50a9e8f9-d7e5-44d2-ba04-c367509b981e' AND organization_id=v_org
        AND branch_status='active' AND default_currency='INR' AND timezone='Asia/Kolkata') THEN
    RAISE EXCEPTION 'Reviewed closed settings/access/branch baseline changed'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals)
    OR EXISTS(SELECT 1 FROM private.subscription_live_pilot_opening_reviews)
    OR EXISTS(SELECT 1 FROM private.subscription_live_quotes)
    OR EXISTS(SELECT 1 FROM private.subscription_live_orders)
    OR EXISTS(SELECT 1 FROM private.subscription_live_payments)
    OR EXISTS(SELECT 1 FROM private.subscription_live_refunds)
    OR EXISTS(SELECT 1 FROM private.subscription_live_terms)
    OR EXISTS(SELECT 1 FROM private.subscription_live_grants)
    OR EXISTS(SELECT 1 FROM private.subscription_live_refund_reviews)
    OR EXISTS(SELECT 1 FROM private.subscription_live_recovery_queue)
    OR EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions)
    OR EXISTS(SELECT 1 FROM private.subscription_live_recovery_reviews) THEN
    RAISE EXCEPTION 'First-term opening requires the reviewed empty Live ledgers'; END IF;
  IF (SELECT md5(coalesce(string_agg(row_to_json(a)::text,'|' ORDER BY id),'')) FROM public.accounts a)
      IS DISTINCT FROM '4e9261d4fe6dad606691c2a8458199f8'
    OR (SELECT md5(coalesce(string_agg(row_to_json(o)::text,'|' ORDER BY id),'')) FROM public.organizations o)
      IS DISTINCT FROM '811505278063f66b442dbf7fdb6844eb'
    OR (SELECT md5(coalesce(string_agg(row_to_json(l)::text,'|' ORDER BY id),'')) FROM public.legal_entities l)
      IS DISTINCT FROM '5e5ef2ddb79af1816cb905381bc95dbf'
    OR (SELECT md5(coalesce(string_agg(row_to_json(p)::text,'|' ORDER BY organization_id),'')) FROM private.organization_product_access p)
      IS DISTINCT FROM '81afb08043fff0d87f00567efb4046f1'
    OR (SELECT count(*) FROM public.payments)<>554 THEN
    RAISE EXCEPTION 'Preservation fingerprint changed before opening'; END IF;
  INSERT INTO private.subscription_live_offer_approvals
    (approval_id,organization_id,merchant_id,tier,amount_minor,currency,provider_mode,
     term_policy,quote_validity_seconds,offer_reference,tax_decision_reference,
     refund_policy_reference,merchant_approval_reference,customer_tax_note,customer_terms_note,approved_at)
  VALUES(gen_random_uuid(),v_org,v_merchant,'starter',79900,'INR','live',
    'calendar_month_from_capture_event',1800,
    'docs/subscription-production-pilot-review.md#pinned-release-and-scope; Home office internal Starter 799 v1',
    'docs/subscription-production-pilot-review.md#owner-decision-and-accounting-record; owner-reviewed internal test, no self-invoice; bank-message screenshots and actual provider facts',
    'UsefulDesk Starter pilot v1, effective 2026-09-30; https://usefulmade.com/useful-desk/refunds/; original full payment through local day 7',
    'docs/subscription-production-install-record.md#closed-pr-21-releaseinstall--1-october-2026; existing merchant credentials/webhook and accepted Test/mixed-routing preflight',
    'Internal test only. No customer sale or self-invoice.',
    'Starter costs 799 INR for one month from verified payment capture. There is no automatic renewal. A confirmed full refund ends paid access. Free access will not return automatically. Request the first-payment refund by the end of local day 7. Reminders run 7, 3 and 1 days before expiry after 09:00 when WhatsApp is ready.',
    clock_timestamp()) RETURNING approval_id INTO v_offer;
  INSERT INTO private.subscription_live_pilot_opening_reviews
    (review_id,offer_approval_id,organization_id,merchant_id,commercial_context,
     reviewed_by,release_sha,migration_manifest_sha256,authorization_reference,
     provider_acceptance_reference,tax_receipt_review_reference,backup_recovery_reference,reviewed_at)
  VALUES(gen_random_uuid(),v_offer,v_org,v_merchant,'internal_acceptance',v_owner,
    v_release,v_manifest,v_authority,
    'docs/subscription-production-install-record.md#closed-pr-21-releaseinstall--1-october-2026; authenticated Live prerequisite, exact five-event webhook, accepted Test/routing evidence; genuine Live capture remains pending',
    'docs/subscription-production-pilot-review.md#owner-decision-and-accounting-record; 2026-10-01 actual owner confirmation and bank debit/credit message/screenshots method; fees from actual Razorpay facts, no assumed amount',
    'https://github.com/aarkay1805/UsefulDesk/actions/runs/36846306908; verified full encrypted DB/Storage backup 2026-10-01; accepted 2026-08-23 restore drill and custody limits; Rajat recovery owner; fresh primary workers healthy, redundant GitHub SEV-3 retained',
    clock_timestamp()) RETURNING review_id INTO v_review;
  UPDATE private.subscription_billing_settings
    SET standard_reminder_policy_approved=true,
      standard_reminder_policy_version='starter-731-after09-owner-reviewed-20261001-v1',
      standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[],standard_reminder_hour_local=9
    WHERE singleton;
  UPDATE private.subscription_live_settings SET pilot_opening_review_id=v_review,
    quotes_enabled=true,orders_enabled=true,refunds_enabled=true,
    settlements_enabled=true,complimentary_conversion_enabled=true
    WHERE singleton;
END;
$$;
