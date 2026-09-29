-- Local/Test draft. Separates the current paid lifecycle generation from the
-- organization's immutable first payment/refund evidence. No restart checkout
-- or entitlement transition is enabled by this migration.
ALTER TABLE private.organization_paid_subscription_grants
  ADD COLUMN IF NOT EXISTS term_generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_generation_source_intent_id UUID
    REFERENCES private.organization_subscription_intents(request_id),
  ADD COLUMN IF NOT EXISTS current_generation_source_payment_id TEXT
    REFERENCES private.organization_subscription_payments(provider_payment_id),
  ADD COLUMN IF NOT EXISTS current_term_refunded_at TIMESTAMPTZ;
UPDATE private.organization_paid_subscription_grants
  SET current_generation_source_intent_id=COALESCE(current_generation_source_intent_id,source_intent_id),
    current_generation_source_payment_id=COALESCE(current_generation_source_payment_id,first_provider_payment_id),
    current_term_refunded_at=COALESCE(current_term_refunded_at,refund_confirmed_at)
  WHERE current_generation_source_intent_id IS NULL
    OR current_generation_source_payment_id IS NULL
    OR (refund_confirmed_at IS NOT NULL AND current_term_refunded_at IS NULL);
ALTER TABLE private.organization_paid_subscription_grants
  ALTER COLUMN current_generation_source_intent_id SET NOT NULL,
  ALTER COLUMN current_generation_source_payment_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.organization_paid_subscription_grants'::regclass
      AND conname='subscription_generation_positive') THEN
    ALTER TABLE private.organization_paid_subscription_grants
      ADD CONSTRAINT subscription_generation_positive CHECK(term_generation>0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS private.subscription_generation_history (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK(generation>0),
  origin_intent_id UUID NOT NULL REFERENCES private.organization_subscription_intents(request_id),
  origin_payment_id TEXT NOT NULL UNIQUE
    REFERENCES private.organization_subscription_payments(provider_payment_id),
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  close_reason TEXT CHECK(close_reason IN ('cancellation','first_payment_refund')),
  PRIMARY KEY(organization_id,generation),
  CHECK ((closed_at IS NULL AND close_reason IS NULL)
    OR (closed_at IS NOT NULL AND close_reason IS NOT NULL))
);
ALTER TABLE private.subscription_generation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_generation_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_generation_history TO service_role;
INSERT INTO private.subscription_generation_history(organization_id,generation,
  origin_intent_id,origin_payment_id,opened_at,closed_at,close_reason)
SELECT g.organization_id,g.term_generation,g.current_generation_source_intent_id,
  g.current_generation_source_payment_id,p.verified_at,g.current_term_refunded_at,
  CASE WHEN g.current_term_refunded_at IS NOT NULL THEN 'first_payment_refund' END
FROM private.organization_paid_subscription_grants g
JOIN private.organization_subscription_payments p
  ON p.provider_payment_id=g.current_generation_source_payment_id
ON CONFLICT(organization_id,generation) DO NOTHING;

CREATE OR REPLACE FUNCTION private.subscription_prepare_generation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.current_generation_source_intent_id:=
      COALESCE(NEW.current_generation_source_intent_id,NEW.source_intent_id);
    NEW.current_generation_source_payment_id:=
      COALESCE(NEW.current_generation_source_payment_id,NEW.first_provider_payment_id);
    IF NEW.term_generation<>1 OR NEW.current_term_refunded_at IS NOT NULL THEN
      RAISE EXCEPTION 'First paid generation required' USING ERRCODE='22023'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_intent_id IS DISTINCT FROM OLD.source_intent_id
    OR NEW.first_provider_payment_id IS DISTINCT FROM OLD.first_provider_payment_id
    OR (OLD.refund_confirmed_at IS NOT NULL
      AND NEW.refund_confirmed_at IS DISTINCT FROM OLD.refund_confirmed_at) THEN
    RAISE EXCEPTION 'First-payment history is immutable' USING ERRCODE='55000'; END IF;
  IF OLD.refund_confirmed_at IS NULL AND NEW.refund_confirmed_at IS NOT NULL THEN
    IF NEW.term_generation<>OLD.term_generation OR OLD.current_term_refunded_at IS NOT NULL
      OR NEW.current_generation_source_payment_id IS DISTINCT FROM NEW.first_provider_payment_id THEN
      RAISE EXCEPTION 'First refund does not match current generation' USING ERRCODE='55000'; END IF;
    NEW.current_term_refunded_at:=NEW.refund_confirmed_at;
  END IF;
  IF NEW.term_generation=OLD.term_generation THEN
    IF NEW.current_generation_source_intent_id IS DISTINCT FROM OLD.current_generation_source_intent_id
      OR NEW.current_generation_source_payment_id IS DISTINCT FROM OLD.current_generation_source_payment_id
      OR (OLD.current_term_refunded_at IS NOT NULL
        AND NEW.current_term_refunded_at IS DISTINCT FROM OLD.current_term_refunded_at)
      OR (NEW.current_term_refunded_at IS NOT NULL
        AND NEW.current_term_refunded_at IS DISTINCT FROM OLD.current_term_refunded_at
        AND (OLD.refund_confirmed_at IS NOT NULL
          OR NEW.refund_confirmed_at IS DISTINCT FROM NEW.current_term_refunded_at))
      OR (OLD.renewal_stopped_at IS NOT NULL
        AND NEW.renewal_stopped_at IS DISTINCT FROM OLD.renewal_stopped_at) THEN
      RAISE EXCEPTION 'Current generation history is immutable' USING ERRCODE='55000'; END IF;
  ELSIF NEW.term_generation=OLD.term_generation+1 THEN
    IF NEW.current_term_refunded_at IS NOT NULL OR
      NEW.current_generation_source_intent_id IS NOT DISTINCT FROM OLD.current_generation_source_intent_id OR
      NEW.current_generation_source_payment_id IS NOT DISTINCT FROM OLD.current_generation_source_payment_id OR
      NEW.refund_confirmed_at IS DISTINCT FROM OLD.refund_confirmed_at THEN
      RAISE EXCEPTION 'New paid generation needs new verified source' USING ERRCODE='55000'; END IF;
    IF OLD.current_term_refunded_at IS NULL AND NOT (
      now()>=OLD.paid_through_end AND EXISTS(
        SELECT 1 FROM private.subscription_renewal_changes c
        WHERE c.organization_id=OLD.organization_id
          AND c.source_period_end=OLD.paid_through_end AND c.target_tier IS NULL)) THEN
      RAISE EXCEPTION 'Ended cancellation or refund required' USING ERRCODE='55000'; END IF;
  ELSE
    RAISE EXCEPTION 'Paid generation cannot skip or rewind' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_prepare_generation ON private.organization_paid_subscription_grants;
CREATE TRIGGER subscription_prepare_generation
  BEFORE INSERT OR UPDATE ON private.organization_paid_subscription_grants
  FOR EACH ROW EXECUTE FUNCTION private.subscription_prepare_generation();

CREATE OR REPLACE FUNCTION private.subscription_record_generation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_opened_at TIMESTAMPTZ;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT verified_at INTO v_opened_at FROM private.organization_subscription_payments
      WHERE provider_payment_id=NEW.current_generation_source_payment_id
        AND intent_id=NEW.current_generation_source_intent_id
        AND organization_id=NEW.organization_id;
    IF v_opened_at IS NULL THEN
      RAISE EXCEPTION 'Verified generation payment required' USING ERRCODE='22023'; END IF;
    INSERT INTO private.subscription_generation_history(organization_id,generation,
      origin_intent_id,origin_payment_id,opened_at)
    VALUES(NEW.organization_id,NEW.term_generation,
      NEW.current_generation_source_intent_id,NEW.current_generation_source_payment_id,v_opened_at);
  ELSIF NEW.term_generation>OLD.term_generation THEN
    IF TG_OP='UPDATE' THEN
      UPDATE private.subscription_generation_history SET closed_at=OLD.paid_through_end,
        close_reason='cancellation'
        WHERE organization_id=OLD.organization_id AND generation=OLD.term_generation
          AND closed_at IS NULL;
    END IF;
    SELECT verified_at INTO v_opened_at FROM private.organization_subscription_payments
      WHERE provider_payment_id=NEW.current_generation_source_payment_id
        AND intent_id=NEW.current_generation_source_intent_id
        AND organization_id=NEW.organization_id;
    IF v_opened_at IS NULL THEN
      RAISE EXCEPTION 'Verified generation payment required' USING ERRCODE='22023'; END IF;
    INSERT INTO private.subscription_generation_history(organization_id,generation,
      origin_intent_id,origin_payment_id,opened_at)
    VALUES(NEW.organization_id,NEW.term_generation,
      NEW.current_generation_source_intent_id,NEW.current_generation_source_payment_id,v_opened_at);
  ELSIF OLD.current_term_refunded_at IS NULL AND NEW.current_term_refunded_at IS NOT NULL THEN
    UPDATE private.subscription_generation_history SET closed_at=NEW.current_term_refunded_at,
      close_reason='first_payment_refund'
      WHERE organization_id=NEW.organization_id AND generation=NEW.term_generation
        AND closed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_record_generation ON private.organization_paid_subscription_grants;
CREATE TRIGGER subscription_record_generation
  AFTER INSERT OR UPDATE ON private.organization_paid_subscription_grants
  FOR EACH ROW EXECUTE FUNCTION private.subscription_record_generation();

REVOKE ALL ON FUNCTION private.subscription_prepare_generation(),
  private.subscription_record_generation() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_prepare_generation() OWNER TO postgres;
ALTER FUNCTION private.subscription_record_generation() OWNER TO postgres;
