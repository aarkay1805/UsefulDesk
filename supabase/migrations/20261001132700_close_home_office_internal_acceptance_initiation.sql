-- Close the completed owner-approved internal test; retain original recovery.
-- Owner instruction, 1 October: proceed with other pending items while bank
-- credit evidence is deferred. No provider call, access write or revocation.
DO $$
DECLARE
  v_org UUID := '8826d9aa-03f2-4ad7-ae91-0553052131f8';
  v_settings private.subscription_live_settings;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=v_org FOR UPDATE;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton FOR UPDATE;
  IF v_settings.provider_mode IS DISTINCT FROM 'live'
    OR v_settings.merchant_id IS DISTINCT FROM 'acc_TCJwBqanN9LTrK'
    OR v_settings.pilot_organization_id IS DISTINCT FROM v_org
    OR NOT v_settings.webhook_intake_enabled OR NOT v_settings.settlements_enabled
    OR v_settings.renewals_enabled
    OR NOT EXISTS(SELECT 1 FROM private.subscription_live_pilot_opening_reviews r
      JOIN private.subscription_live_offer_approvals a ON a.approval_id=r.offer_approval_id
      WHERE r.review_id=v_settings.pilot_opening_review_id AND r.organization_id=v_org
        AND r.merchant_id=v_settings.merchant_id AND r.commercial_context='internal_acceptance'
        AND r.release_sha='71d897a6dfd17b7938129d2b7a3cfbb808531a80'
        AND r.migration_manifest_sha256='21abf5bd14a46d4feaf6510c92e82280489a9f85883d4c3106f5d6d63d53c494'
        AND r.revoked_at IS NULL AND a.revoked_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM private.subscription_live_grants g
      JOIN private.subscription_live_payments p ON p.provider_payment_id=g.provider_payment_id
      JOIN private.subscription_live_refunds f ON f.provider_payment_id=p.provider_payment_id
      JOIN private.organization_product_access x ON x.organization_id=g.organization_id
      WHERE g.organization_id=v_org AND p.state='verified' AND p.amount_minor=79900
        AND p.currency='INR' AND p.provider_mode='live' AND p.merchant_id=v_settings.merchant_id
        AND f.state='processed' AND f.confirmed_at IS NOT NULL AND f.review_reason IS NULL
        AND g.refund_confirmed_at=f.confirmed_at AND g.renewal_stopped_at=f.confirmed_at
        AND x.mode='manual' AND x.version=3 AND x.access_ends_at=f.confirmed_at)
    OR NOT EXISTS(SELECT 1 FROM private.subscription_billing_settings
      WHERE singleton AND NOT enabled AND NOT refunds_enabled AND NOT capabilities_enabled
        AND NOT advanced_payments_enabled AND NOT advanced_commercial_approved)
  THEN RAISE EXCEPTION 'Completed internal refund/recovery scope must match before containment'; END IF;
  UPDATE private.subscription_live_settings SET quotes_enabled=false,
    orders_enabled=false,refunds_enabled=false,complimentary_conversion_enabled=false
    WHERE singleton;
  -- Intake/settlements and immutable evidence identities remain untouched.
END;
$$;
