-- Default-off Test draft. Bridge the capability migration's owner-approved
-- Starter reminder policy to the existing initial/renewal payment transactions.
-- The order claim trigger runs before any provider POST; the grant trigger
-- applies the policy inside the verified-payment transaction, before the grant.
CREATE OR REPLACE FUNCTION private.subscription_assert_starter_order_claim()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.order_requested_at IS NOT NULL AND OLD.order_requested_at IS NULL
    AND NEW.tier='starter' THEN
    PERFORM private.subscription_assert_starter_reminder_review(
      NEW.organization_id,NEW.request_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_assert_starter_order_claim
  ON private.organization_subscription_intents;
CREATE TRIGGER subscription_assert_starter_order_claim
  BEFORE UPDATE OF order_requested_at ON private.organization_subscription_intents
  FOR EACH ROW EXECUTE FUNCTION private.subscription_assert_starter_order_claim();

CREATE OR REPLACE FUNCTION private.subscription_apply_starter_on_grant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_intent_id UUID; v_entering BOOLEAN;
BEGIN
  IF NEW.tier<>'starter' OR NOT EXISTS(
    SELECT 1 FROM private.subscription_billing_settings
    WHERE singleton AND capabilities_enabled) THEN
    RETURN NEW;
  END IF;
  v_entering:=TG_OP='INSERT';
  IF TG_OP='UPDATE' THEN
    v_entering:=OLD.tier<>'starter' OR NEW.term_generation>OLD.term_generation;
  END IF;
  IF NOT v_entering THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    v_intent_id:=NEW.source_intent_id;
  ELSIF NEW.term_generation>OLD.term_generation THEN
    v_intent_id:=NEW.current_generation_source_intent_id;
  ELSE
    SELECT i.request_id INTO v_intent_id
    FROM private.organization_subscription_intents i
    WHERE i.organization_id=NEW.organization_id AND i.kind='renewal'
      AND i.source_period_end=OLD.paid_through_end AND i.tier='starter'
      AND i.provider_order_id IS NOT NULL AND i.state='pending';
  END IF;
  IF v_intent_id IS NULL THEN
    RAISE EXCEPTION 'Starter payment intent and reminder review required'
      USING ERRCODE='55000';
  END IF;
  PERFORM private.subscription_apply_starter_reminder_policy(
    NEW.organization_id,v_intent_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_apply_starter_on_grant
  ON private.organization_paid_subscription_grants;
CREATE TRIGGER subscription_apply_starter_on_grant
  BEFORE INSERT OR UPDATE OF tier,term_generation
  ON private.organization_paid_subscription_grants
  FOR EACH ROW EXECUTE FUNCTION private.subscription_apply_starter_on_grant();

REVOKE ALL ON FUNCTION private.subscription_assert_starter_order_claim(),
  private.subscription_apply_starter_on_grant()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_assert_starter_order_claim() OWNER TO postgres;
ALTER FUNCTION private.subscription_apply_starter_on_grant() OWNER TO postgres;
