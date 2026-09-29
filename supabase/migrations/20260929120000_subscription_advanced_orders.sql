-- Default-off Test-only advanced billing. Do not set advanced_payments_enabled
-- until owner-approved commercial/tax policy and add-on renewal/cancellation
-- transactions, UI, provider recovery, and full acceptance are complete.
ALTER TABLE private.subscription_billing_settings
  ADD COLUMN IF NOT EXISTS advanced_payments_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS advanced_commercial_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS advanced_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS advanced_quote_lifetime_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS advanced_tax_policy TEXT,
  ADD COLUMN IF NOT EXISTS advanced_addon_proration_policy TEXT,
  ADD COLUMN IF NOT EXISTS advanced_addon_renewal_policy TEXT,
  ADD COLUMN IF NOT EXISTS advanced_addon_cancellation_policy TEXT,
  ADD COLUMN IF NOT EXISTS advanced_restart_policy TEXT;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.subscription_billing_settings'::regclass
      AND conname='subscription_advanced_commercial_gate') THEN
    ALTER TABLE private.subscription_billing_settings
      ADD CONSTRAINT subscription_advanced_commercial_gate CHECK (
        NOT advanced_payments_enabled OR COALESCE(
          enabled AND advanced_commercial_approved
          AND NULLIF(btrim(advanced_policy_version),'') IS NOT NULL
          AND advanced_quote_lifetime_seconds BETWEEN 60 AND 3600
          AND advanced_tax_policy='unregistered_no_gst_confirmed'
          AND advanced_addon_proration_policy='actual_remaining_term'
          AND advanced_addon_renewal_policy='with_base_term'
          AND advanced_addon_cancellation_policy='at_renewal_exact_roster'
          AND advanced_restart_policy='fresh_month_at_verification',FALSE));
  END IF;
END $$;

ALTER TABLE private.organization_subscription_intents
  DROP CONSTRAINT IF EXISTS organization_subscription_intents_kind_check;
ALTER TABLE private.organization_subscription_intents
  DROP CONSTRAINT IF EXISTS organization_subscription_intents_state_check;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.organization_subscription_intents'::regclass
      AND conname='subscription_intent_kind') THEN
    ALTER TABLE private.organization_subscription_intents
      ADD CONSTRAINT subscription_intent_kind
      CHECK(kind IN ('initial','renewal','upgrade','addon_purchase','restart'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.organization_subscription_intents'::regclass
      AND conname='subscription_intent_state') THEN
    ALTER TABLE private.organization_subscription_intents
      ADD CONSTRAINT subscription_intent_state
      CHECK(state IN ('pending','failed','verified','review_required'));
  END IF;
END $$;
ALTER TABLE private.organization_subscription_intents
  ADD COLUMN IF NOT EXISTS advanced_review_id UUID
    REFERENCES private.subscription_advanced_reviews(request_id),
  ADD COLUMN IF NOT EXISTS quote_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commercial_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS source_term_generation INTEGER,
  ADD COLUMN IF NOT EXISTS quoted_slot_count INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_one_claimed_advanced_order
  ON private.organization_subscription_intents(organization_id)
  WHERE kind IN ('upgrade','addon_purchase','restart')
    AND state='pending' AND order_requested_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_one_advanced_quote_per_review
  ON private.organization_subscription_intents(advanced_review_id)
  WHERE advanced_review_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS private.subscription_paid_branch_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK(generation>0),
  source_intent_id UUID NOT NULL UNIQUE
    REFERENCES private.organization_subscription_intents(request_id),
  source_payment_id TEXT NOT NULL UNIQUE
    REFERENCES private.organization_subscription_payments(provider_payment_id),
  active_from TIMESTAMPTZ NOT NULL,
  paid_through_end TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  CHECK(paid_through_end>active_from)
);
CREATE INDEX IF NOT EXISTS subscription_paid_branch_slots_capacity
  ON private.subscription_paid_branch_slots(organization_id,generation,paid_through_end)
  WHERE cancelled_at IS NULL;
ALTER TABLE private.subscription_paid_branch_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_paid_branch_slots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_paid_branch_slots TO service_role;

CREATE TABLE IF NOT EXISTS private.subscription_advanced_payment_exceptions (
  provider_payment_id TEXT PRIMARY KEY,
  intent_id UUID NOT NULL UNIQUE REFERENCES private.organization_subscription_intents(request_id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_merchant_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  reason TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
ALTER TABLE private.subscription_advanced_payment_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_advanced_payment_exceptions
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_advanced_payment_exceptions TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_assert_advanced_policy()
RETURNS private.subscription_billing_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_billing_settings;
BEGIN
  SELECT * INTO s FROM private.subscription_billing_settings WHERE singleton;
  IF NOT COALESCE(s.advanced_payments_enabled AND s.enabled
    AND s.advanced_commercial_approved
    AND NULLIF(btrim(s.advanced_policy_version),'') IS NOT NULL
    AND s.advanced_quote_lifetime_seconds BETWEEN 60 AND 3600
    AND s.advanced_tax_policy='unregistered_no_gst_confirmed'
    AND s.advanced_addon_proration_policy='actual_remaining_term'
    AND s.advanced_addon_renewal_policy='with_base_term'
    AND s.advanced_addon_cancellation_policy='at_renewal_exact_roster'
    AND s.advanced_restart_policy='fresh_month_at_verification',FALSE) THEN
    RAISE EXCEPTION 'Advanced Test billing policy is not approved'
      USING ERRCODE='55000';
  END IF;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_active_paid_slots(p_organization_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT count(*)::INTEGER FROM private.subscription_paid_branch_slots s
  JOIN private.organization_paid_subscription_grants g
    ON g.organization_id=s.organization_id AND g.term_generation=s.generation
  WHERE s.organization_id=p_organization_id AND s.cancelled_at IS NULL
    AND s.active_from<=now() AND s.paid_through_end>=g.paid_through_end;
$$;

REVOKE ALL ON FUNCTION private.subscription_assert_advanced_policy(),
  private.subscription_active_paid_slots(UUID) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION private.subscription_assert_advanced_policy() OWNER TO postgres;
ALTER FUNCTION private.subscription_active_paid_slots(UUID) OWNER TO postgres;
