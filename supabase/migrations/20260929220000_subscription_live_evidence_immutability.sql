-- Preserve merchant and provider evidence even from service-role writers.
CREATE OR REPLACE FUNCTION private.subscription_freeze_live_evidence()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Live billing evidence cannot be deleted' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='subscription_live_orders' THEN
    IF NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.provider_mode IS DISTINCT FROM OLD.provider_mode
      OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
      OR (OLD.provider_order_id IS NOT NULL
        AND NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id)
      OR (OLD.bound_at IS NOT NULL AND NEW.bound_at IS DISTINCT FROM OLD.bound_at)
      OR (OLD.state='review_required' AND NEW.state<>'review_required')
      OR (OLD.state='bound' AND NEW.state='claimed') THEN
      RAISE EXCEPTION 'Live order identity is immutable' USING ERRCODE='55000'; END IF;
  ELSIF TG_TABLE_NAME='subscription_live_payments' THEN
    RAISE EXCEPTION 'Live payment evidence is immutable' USING ERRCODE='55000';
  ELSIF TG_TABLE_NAME='subscription_live_grants' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
      OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.provider_mode IS DISTINCT FROM OLD.provider_mode
      OR NEW.tier IS DISTINCT FROM OLD.tier
      OR NEW.period_start IS DISTINCT FROM OLD.period_start
      OR NEW.paid_through_end IS DISTINCT FROM OLD.paid_through_end
      OR (OLD.refund_confirmed_at IS NOT NULL
        AND NEW.refund_confirmed_at IS DISTINCT FROM OLD.refund_confirmed_at)
      OR (OLD.renewal_stopped_at IS NOT NULL
        AND NEW.renewal_stopped_at IS DISTINCT FROM OLD.renewal_stopped_at) THEN
      RAISE EXCEPTION 'Live grant evidence is immutable' USING ERRCODE='55000'; END IF;
  ELSIF TG_TABLE_NAME='subscription_live_refund_reviews' THEN
    IF EXISTS(SELECT 1 FROM private.subscription_live_refunds
      WHERE refund_request_id=OLD.refund_request_id) THEN
      RAISE EXCEPTION 'Claimed Live refund review is immutable' USING ERRCODE='55000'; END IF;
  ELSIF TG_TABLE_NAME='subscription_live_refunds' THEN
    IF NEW.refund_request_id IS DISTINCT FROM OLD.refund_request_id
      OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.provider_mode IS DISTINCT FROM OLD.provider_mode
      OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
      OR NEW.provider_requested_at IS DISTINCT FROM OLD.provider_requested_at
      OR (OLD.provider_refund_id IS NOT NULL
        AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id)
      OR (OLD.confirmed_at IS NOT NULL
        AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at)
      OR (OLD.review_reason IS NOT NULL
        AND NEW.review_reason IS DISTINCT FROM OLD.review_reason)
      OR (OLD.state='processed' AND NEW.state NOT IN ('processed','review_required'))
      OR (OLD.state='review_required' AND NEW.state<>'review_required') THEN
      RAISE EXCEPTION 'Live refund identity is immutable' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_freeze_live_order_evidence
  ON private.subscription_live_orders;
CREATE TRIGGER subscription_freeze_live_order_evidence BEFORE UPDATE OR DELETE
  ON private.subscription_live_orders FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_evidence();
DROP TRIGGER IF EXISTS subscription_freeze_live_payment_evidence
  ON private.subscription_live_payments;
CREATE TRIGGER subscription_freeze_live_payment_evidence BEFORE UPDATE OR DELETE
  ON private.subscription_live_payments FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_evidence();
DROP TRIGGER IF EXISTS subscription_freeze_live_grant_evidence
  ON private.subscription_live_grants;
CREATE TRIGGER subscription_freeze_live_grant_evidence BEFORE UPDATE OR DELETE
  ON private.subscription_live_grants FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_evidence();
DROP TRIGGER IF EXISTS subscription_freeze_live_refund_review
  ON private.subscription_live_refund_reviews;
CREATE TRIGGER subscription_freeze_live_refund_review BEFORE UPDATE OR DELETE
  ON private.subscription_live_refund_reviews FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_evidence();
DROP TRIGGER IF EXISTS subscription_freeze_live_refund_evidence
  ON private.subscription_live_refunds;
CREATE TRIGGER subscription_freeze_live_refund_evidence BEFORE UPDATE OR DELETE
  ON private.subscription_live_refunds FOR EACH ROW
  EXECUTE FUNCTION private.subscription_freeze_live_evidence();
REVOKE ALL ON FUNCTION private.subscription_freeze_live_evidence()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_freeze_live_evidence() OWNER TO postgres;
