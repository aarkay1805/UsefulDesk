-- DRAFT, DEFAULT OFF. Capture the first Live payment's billing timezone and
-- require evidence of the actual refund request before the one-POST claim.
-- This does not enable Live quotes, orders, refunds or capabilities.

ALTER TABLE private.subscription_live_payments
  ADD COLUMN IF NOT EXISTS billing_timezone TEXT;

CREATE OR REPLACE FUNCTION private.subscription_live_set_payment_timezone()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  SELECT a.timezone INTO NEW.billing_timezone
  FROM private.subscription_live_quotes q
  JOIN public.accounts a ON a.id=q.billing_account_id
  WHERE q.request_id=NEW.request_id
    AND q.organization_id=NEW.organization_id
    AND a.organization_id=NEW.organization_id;
  IF NEW.state='verified' AND (
    NEW.billing_timezone IS NULL OR NOT EXISTS(
      SELECT 1 FROM pg_catalog.pg_timezone_names z
      WHERE z.name=NEW.billing_timezone
    )
  ) THEN
    RAISE EXCEPTION 'Verified Live payment requires billing timezone'
      USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_live_set_payment_timezone
  ON private.subscription_live_payments;
CREATE TRIGGER subscription_live_set_payment_timezone BEFORE INSERT
  ON private.subscription_live_payments FOR EACH ROW
  EXECUTE FUNCTION private.subscription_live_set_payment_timezone();
REVOKE ALL ON FUNCTION private.subscription_live_set_payment_timezone()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_live_set_payment_timezone() OWNER TO postgres;

ALTER TABLE private.subscription_live_refund_reviews
  ADD COLUMN IF NOT EXISTS request_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS request_evidence_reference TEXT,
  ADD COLUMN IF NOT EXISTS review_kind TEXT NOT NULL DEFAULT 'standard_first_week',
  ADD COLUMN IF NOT EXISTS exception_reason TEXT;
ALTER TABLE private.subscription_live_refund_reviews
  ALTER COLUMN request_received_at SET NOT NULL,
  ALTER COLUMN request_evidence_reference SET NOT NULL;
ALTER TABLE private.subscription_live_refund_reviews
  DROP CONSTRAINT IF EXISTS subscription_live_refund_review_kind_check;
ALTER TABLE private.subscription_live_refund_reviews
  ADD CONSTRAINT subscription_live_refund_review_kind_check CHECK(
    review_kind IN ('standard_first_week','exception_review') AND
    length(btrim(request_evidence_reference))>0 AND
    (review_kind='standard_first_week' AND exception_reason IS NULL OR
     review_kind='exception_review' AND COALESCE(length(btrim(exception_reason)),0)>0)
  );

CREATE OR REPLACE FUNCTION private.subscription_live_guard_refund_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_payment private.subscription_live_payments;
  v_elapsed_days INTEGER;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Live refund review is immutable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE provider_payment_id=NEW.provider_payment_id;
  IF NOT FOUND OR v_payment.state<>'verified'
    OR v_payment.organization_id<>NEW.organization_id
    OR v_payment.merchant_id<>NEW.merchant_id
    OR v_payment.amount_minor<>NEW.amount_minor
    OR v_payment.currency<>NEW.currency
    OR v_payment.capture_event_at IS NULL
    OR v_payment.billing_timezone IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z
      WHERE z.name=v_payment.billing_timezone)
    OR NOT isfinite(NEW.request_received_at)
    OR NEW.request_received_at<v_payment.capture_event_at
    OR NEW.request_received_at>clock_timestamp()+interval '5 minutes'
    OR NEW.owner_reviewed_at<NEW.request_received_at
    OR NEW.owner_reviewed_at>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'Live refund request evidence is invalid'
      USING ERRCODE='22023';
  END IF;
  v_elapsed_days :=
    (NEW.request_received_at AT TIME ZONE v_payment.billing_timezone)::date -
    (v_payment.capture_event_at AT TIME ZONE v_payment.billing_timezone)::date;
  IF NEW.review_kind='standard_first_week' AND
    (v_elapsed_days<0 OR v_elapsed_days>7) THEN
    RAISE EXCEPTION 'First Live refund request is outside seven local days'
      USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_live_guard_refund_review
  ON private.subscription_live_refund_reviews;
CREATE TRIGGER subscription_live_guard_refund_review BEFORE INSERT OR UPDATE OR DELETE
  ON private.subscription_live_refund_reviews FOR EACH ROW
  EXECUTE FUNCTION private.subscription_live_guard_refund_review();
REVOKE ALL ON FUNCTION private.subscription_live_guard_refund_review()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_live_guard_refund_review() OWNER TO postgres;
