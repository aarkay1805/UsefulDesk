-- Closed installation: GET recovery metadata only. No switches or financial
-- evidence are rewritten; existing bind/observe/commit RPCs remain authoritative.
CREATE TABLE IF NOT EXISTS private.subscription_live_recovery_queue (
  item_type TEXT NOT NULL CHECK(item_type IN ('order','refund')),
  item_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  last_outcome TEXT CHECK(last_outcome IN ('recovered','pending','failed','review_required','retry')),
  last_reason TEXT CHECK(last_reason ~ '^[a-z][a-z0-9_]{0,95}$'),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(item_type,item_id),
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS subscription_live_recovery_due ON
  private.subscription_live_recovery_queue(merchant_id,organization_id,next_attempt_at)
  WHERE completed_at IS NULL;
CREATE TABLE IF NOT EXISTS private.subscription_live_recovery_exceptions (
  item_type TEXT NOT NULL CHECK(item_type IN ('order','refund','payment')),
  item_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  original_reason TEXT NOT NULL CHECK(original_reason ~ '^[a-z][a-z0-9_]{0,95}$'),
  latest_reason TEXT NOT NULL CHECK(latest_reason ~ '^[a-z][a-z0-9_]{0,95}$'),
  status TEXT NOT NULL DEFAULT 'waiting_owner' CHECK(status IN
    ('investigating','waiting_provider','waiting_owner','recovery_approved','resolved')),
  owner_reference TEXT NOT NULL DEFAULT 'Rajat Kashyap' CHECK(length(btrim(owner_reference)) BETWEEN 1 AND 200),
  next_action TEXT NOT NULL DEFAULT 'Review exact saved obligation and provider evidence' CHECK(length(btrim(next_action)) BETWEEN 1 AND 1000),
  next_action_due_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(item_type,item_id),
  CHECK((status='resolved')=(resolved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS private.subscription_live_recovery_reviews (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type TEXT NOT NULL,
  item_id UUID NOT NULL,
  operator_id UUID NOT NULL REFERENCES auth.users(id),
  authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 500),
  evidence_reference TEXT NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 500),
  before_state JSONB NOT NULL,
  after_state JSONB NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(item_type,item_id) REFERENCES private.subscription_live_recovery_exceptions(item_type,item_id)
);
ALTER TABLE private.subscription_live_recovery_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_live_recovery_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_live_recovery_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_recovery_queue,
  private.subscription_live_recovery_exceptions,private.subscription_live_recovery_reviews
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_live_recovery_queue,
  private.subscription_live_recovery_exceptions,private.subscription_live_recovery_reviews TO service_role;
DROP TRIGGER IF EXISTS subscription_live_recovery_queue_updated ON private.subscription_live_recovery_queue;
CREATE TRIGGER subscription_live_recovery_queue_updated BEFORE UPDATE ON private.subscription_live_recovery_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS subscription_live_recovery_exceptions_updated ON private.subscription_live_recovery_exceptions;
CREATE TRIGGER subscription_live_recovery_exceptions_updated BEFORE UPDATE ON private.subscription_live_recovery_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION private.subscription_record_live_recovery_exception(
  p_item_type TEXT,p_item_id UUID,p_organization_id UUID,p_merchant_id TEXT,p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO private.subscription_live_recovery_exceptions
    (item_type,item_id,organization_id,merchant_id,original_reason,latest_reason)
  VALUES(p_item_type,p_item_id,p_organization_id,p_merchant_id,p_reason,p_reason)
  ON CONFLICT(item_type,item_id) DO UPDATE SET latest_reason=excluded.latest_reason,
    last_observed_at=clock_timestamp(),
    status=CASE WHEN subscription_live_recovery_exceptions.status='resolved'
      THEN 'waiting_owner' ELSE subscription_live_recovery_exceptions.status END,
    resolved_at=NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.subscription_record_live_recovery_exception(TEXT,UUID,UUID,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_record_live_recovery_exception(TEXT,UUID,UUID,TEXT,TEXT) OWNER TO postgres;

ALTER TABLE private.subscription_live_payments ADD COLUMN IF NOT EXISTS hold_reason TEXT
  CHECK(hold_reason IS NULL OR hold_reason ~ '^[a-z][a-z0-9_]{0,95}$');
-- Older holds have no saved reason: expose that evidence gap without guessing or
-- updating the immutable payment. New captures save their computed reason below.
INSERT INTO private.subscription_live_recovery_exceptions
  (item_type,item_id,organization_id,merchant_id,original_reason,latest_reason)
SELECT 'payment',request_id,organization_id,merchant_id,
  'prior_hold_reason_unavailable','prior_hold_reason_unavailable'
FROM private.subscription_live_payments WHERE state='review_required'
ON CONFLICT DO NOTHING;
INSERT INTO private.subscription_live_recovery_exceptions
  (item_type,item_id,organization_id,merchant_id,original_reason,latest_reason)
SELECT 'refund',refund_request_id,organization_id,merchant_id,
  COALESCE(review_reason,'prior_hold_reason_unavailable'),COALESCE(review_reason,'prior_hold_reason_unavailable')
FROM private.subscription_live_refunds WHERE state='review_required'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION private.subscription_record_live_financial_hold()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.state='review_required' THEN
    IF TG_TABLE_NAME='subscription_live_payments' THEN
      PERFORM private.subscription_record_live_recovery_exception('payment',NEW.request_id,
        NEW.organization_id,NEW.merchant_id,COALESCE(NEW.hold_reason,'prior_hold_reason_unavailable'));
    ELSE
      PERFORM private.subscription_record_live_recovery_exception('refund',NEW.refund_request_id,
        NEW.organization_id,NEW.merchant_id,COALESCE(NEW.review_reason,'refund_review_required'));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.subscription_record_live_financial_hold() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_record_live_financial_hold() OWNER TO postgres;
DROP TRIGGER IF EXISTS subscription_record_live_payment_hold ON private.subscription_live_payments;
CREATE TRIGGER subscription_record_live_payment_hold AFTER INSERT ON private.subscription_live_payments
  FOR EACH ROW EXECUTE FUNCTION private.subscription_record_live_financial_hold();
DROP TRIGGER IF EXISTS subscription_record_live_refund_hold ON private.subscription_live_refunds;
CREATE TRIGGER subscription_record_live_refund_hold AFTER INSERT OR UPDATE ON private.subscription_live_refunds
  FOR EACH ROW EXECUTE FUNCTION private.subscription_record_live_financial_hold();

CREATE OR REPLACE FUNCTION public.subscription_claim_live_recovery_items(
  p_provider_merchant_id TEXT,p_pilot_organization_id UUID,p_limit INTEGER DEFAULT 5,
  p_lease_token UUID DEFAULT gen_random_uuid())
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings; v_item RECORD;
  v_result JSONB:='[]'::JSONB; v_claimed INTEGER;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live' OR NOT v_settings.webhook_intake_enabled
    OR NOT v_settings.settlements_enabled
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live recovery is disabled or unbound' USING ERRCODE='55000'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>5 OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'Invalid bounded recovery claim' USING ERRCODE='22023'; END IF;
  -- Bound/confirmed facts may have landed before a worker crashed. Only reap
  -- expired/unleased metadata, within the same scope/batch; never provider facts.
  WITH terminal AS (
    SELECT w.item_type,w.item_id,
      CASE WHEN w.item_type='order' THEN 'order_bound_signed_event_required'
        WHEN EXISTS(SELECT 1 FROM private.subscription_live_refunds r
          WHERE r.refund_request_id=w.item_id AND r.confirmed_at IS NOT NULL)
          THEN 'refund_confirmed' ELSE 'refund_review_required' END AS reason
    FROM private.subscription_live_recovery_queue w
    WHERE w.merchant_id=p_provider_merchant_id AND w.organization_id=p_pilot_organization_id
      AND w.completed_at IS NULL AND (w.lease_expires_at IS NULL OR w.lease_expires_at<=clock_timestamp())
      AND ((w.item_type='order' AND EXISTS(SELECT 1 FROM private.subscription_live_orders o
        WHERE o.request_id=w.item_id AND o.organization_id=w.organization_id
          AND o.merchant_id=w.merchant_id AND o.provider_order_id IS NOT NULL))
        OR (w.item_type='refund' AND EXISTS(SELECT 1 FROM private.subscription_live_refunds r
          WHERE r.refund_request_id=w.item_id AND r.organization_id=w.organization_id
            AND r.merchant_id=w.merchant_id AND (r.confirmed_at IS NOT NULL OR r.state='review_required'))))
    ORDER BY w.next_attempt_at,w.item_type,w.item_id LIMIT p_limit FOR UPDATE OF w SKIP LOCKED
  ), closed AS (
    UPDATE private.subscription_live_recovery_queue w SET completed_at=clock_timestamp(),
      lease_token=NULL,lease_expires_at=NULL,
      last_outcome=CASE WHEN t.reason='refund_review_required' THEN 'review_required' ELSE 'recovered' END,
      last_reason=t.reason FROM terminal t WHERE w.item_type=t.item_type AND w.item_id=t.item_id
    RETURNING w.item_type,w.item_id,w.last_reason
  )
  UPDATE private.subscription_live_recovery_exceptions e SET latest_reason=c.last_reason,
    last_observed_at=clock_timestamp(),status=CASE WHEN c.last_reason='refund_review_required'
      THEN 'waiting_owner' ELSE 'resolved' END,
    resolved_at=CASE WHEN c.last_reason='refund_review_required' THEN NULL ELSE clock_timestamp() END
    FROM closed c WHERE e.item_type=c.item_type AND e.item_id=c.item_id;
  FOR v_item IN
    SELECT c.* FROM (
      SELECT 'order'::TEXT AS item_type,o.request_id AS item_id,o.request_id,
        o.organization_id,o.merchant_id,o.provider_order_id,
        NULL::TEXT AS provider_payment_id,NULL::TEXT AS provider_refund_id,
        q.amount_minor,q.currency,o.claimed_at
      FROM private.subscription_live_orders o JOIN private.subscription_live_quotes q
        ON q.request_id=o.request_id AND q.organization_id=o.organization_id AND q.merchant_id=o.merchant_id
      WHERE o.provider_mode='live' AND o.organization_id=p_pilot_organization_id
        AND o.merchant_id=p_provider_merchant_id AND o.state='claimed' AND o.provider_order_id IS NULL
      UNION ALL
      SELECT 'refund',r.refund_request_id,p.request_id,r.organization_id,r.merchant_id,
        p.provider_order_id,r.provider_payment_id,r.provider_refund_id,r.amount_minor,r.currency,r.claimed_at
      FROM private.subscription_live_refunds r JOIN private.subscription_live_payments p
        ON p.provider_payment_id=r.provider_payment_id AND p.organization_id=r.organization_id AND p.merchant_id=r.merchant_id
      WHERE r.provider_mode='live' AND r.organization_id=p_pilot_organization_id
        AND r.merchant_id=p_provider_merchant_id AND r.confirmed_at IS NULL
        AND r.state IN ('claimed','pending','failed','processed')
    ) c LEFT JOIN private.subscription_live_recovery_queue w
      ON w.item_type=c.item_type AND w.item_id=c.item_id
    WHERE (w.item_id IS NULL OR (w.completed_at IS NULL AND w.next_attempt_at<=clock_timestamp()
      AND (w.lease_expires_at IS NULL OR w.lease_expires_at<=clock_timestamp())))
    ORDER BY COALESCE(w.next_attempt_at,c.claimed_at),c.item_type,c.item_id LIMIT p_limit
  LOOP
    INSERT INTO private.subscription_live_recovery_queue(item_type,item_id,organization_id,merchant_id)
    VALUES(v_item.item_type,v_item.item_id,v_item.organization_id,v_item.merchant_id) ON CONFLICT DO NOTHING;
    UPDATE private.subscription_live_recovery_queue SET lease_token=p_lease_token,
      lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1
    WHERE item_type=v_item.item_type AND item_id=v_item.item_id AND completed_at IS NULL
      AND next_attempt_at<=clock_timestamp()
      AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp());
    GET DIAGNOSTICS v_claimed=ROW_COUNT;
    IF v_claimed=1 THEN
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'item_type',v_item.item_type,'item_id',v_item.item_id,'lease_token',p_lease_token,
        'request_id',v_item.request_id,'organization_id',v_item.organization_id,
        'provider_merchant_id',v_item.merchant_id,'provider_order_id',v_item.provider_order_id,
        'provider_payment_id',v_item.provider_payment_id,'provider_refund_id',v_item.provider_refund_id,
        'amount_minor',v_item.amount_minor,'currency',v_item.currency));
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_claim_live_recovery_items(TEXT,UUID,INTEGER,UUID)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_claim_live_recovery_items(TEXT,UUID,INTEGER,UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_claim_live_recovery_items(TEXT,UUID,INTEGER,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_finish_live_recovery_item(
  p_item_type TEXT,p_item_id UUID,p_lease_token UUID,p_provider_merchant_id TEXT,
  p_pilot_organization_id UUID,p_outcome TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings; v_queue private.subscription_live_recovery_queue;
  v_terminal BOOLEAN:=FALSE; v_held BOOLEAN:=FALSE;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id THEN
    RAISE EXCEPTION 'Live recovery identity unbound' USING ERRCODE='55000'; END IF;
  IF p_item_type IS NULL OR p_item_type NOT IN ('order','refund') OR p_outcome IS NULL
    OR p_outcome NOT IN ('recovered','pending','failed','review_required','retry')
    OR p_reason IS NULL OR p_reason !~ '^[a-z][a-z0-9_]{0,95}$' THEN
    RAISE EXCEPTION 'Invalid recovery result' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_queue FROM private.subscription_live_recovery_queue
    WHERE item_type=p_item_type AND item_id=p_item_id FOR UPDATE;
  IF NOT FOUND OR v_queue.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_queue.organization_id IS DISTINCT FROM p_pilot_organization_id
    OR v_queue.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL
    OR v_queue.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Recovery lease lost or expired' USING ERRCODE='55000'; END IF;
  -- A genuine webhook may have committed while the GET worker was running.
  -- Canonical durable completion wins over its stale pending/retry observation.
  IF p_item_type='order' THEN
    SELECT EXISTS(SELECT 1 FROM private.subscription_live_orders
      WHERE request_id=p_item_id AND organization_id=p_pilot_organization_id
        AND merchant_id=p_provider_merchant_id AND provider_order_id IS NOT NULL) INTO v_terminal;
  ELSE
    SELECT EXISTS(SELECT 1 FROM private.subscription_live_refunds
      WHERE refund_request_id=p_item_id AND organization_id=p_pilot_organization_id
        AND merchant_id=p_provider_merchant_id AND confirmed_at IS NOT NULL),
      EXISTS(SELECT 1 FROM private.subscription_live_refunds
      WHERE refund_request_id=p_item_id AND organization_id=p_pilot_organization_id
        AND merchant_id=p_provider_merchant_id AND state='review_required')
      INTO v_terminal,v_held;
  END IF;
  IF p_outcome='recovered' AND NOT v_terminal THEN
    RAISE EXCEPTION 'Canonical recovery completion missing' USING ERRCODE='55000'; END IF;
  IF v_terminal THEN
    p_outcome:='recovered';
    p_reason:=CASE WHEN p_item_type='order' THEN 'order_bound_signed_event_required' ELSE 'refund_confirmed' END;
    UPDATE private.subscription_live_recovery_exceptions SET status='resolved',resolved_at=clock_timestamp(),
      latest_reason=p_reason,last_observed_at=clock_timestamp()
      WHERE item_type=p_item_type AND item_id=p_item_id;
  ELSE
    IF v_held THEN p_outcome:='review_required'; p_reason:='refund_review_required'; END IF;
    PERFORM private.subscription_record_live_recovery_exception(p_item_type,p_item_id,
      p_pilot_organization_id,p_provider_merchant_id,p_reason);
  END IF;
  UPDATE private.subscription_live_recovery_queue SET lease_token=NULL,lease_expires_at=NULL,
    last_outcome=p_outcome,last_reason=p_reason,
    next_attempt_at=clock_timestamp()+interval '5 minutes',
    completed_at=CASE WHEN v_terminal OR v_held THEN clock_timestamp() ELSE NULL END
    WHERE item_type=p_item_type AND item_id=p_item_id RETURNING * INTO v_queue;
  RETURN jsonb_build_object('item_type',p_item_type,'item_id',p_item_id,
    'outcome',p_outcome,'reason',p_reason,'completed',v_queue.completed_at IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_finish_live_recovery_item(TEXT,UUID,UUID,TEXT,UUID,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_finish_live_recovery_item(TEXT,UUID,UUID,TEXT,UUID,TEXT,TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_finish_live_recovery_item(TEXT,UUID,UUID,TEXT,UUID,TEXT,TEXT) TO service_role;

-- Same verified settlement contract; persist its existing hold decision atomically.
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
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
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
  IF NOT v_offer_active THEN
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

-- Metadata review is not a payment/refund/access resolution. It cannot clear a
-- financial hold or authorize a provider POST; original reasons remain intact.
CREATE OR REPLACE FUNCTION private.subscription_live_recovery_operator_allowed(
  p_organization_id UUID,p_operator_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.organization_memberships
  WHERE organization_id=p_organization_id AND user_id=p_operator_id AND role='owner')
$$;
REVOKE ALL ON FUNCTION private.subscription_live_recovery_operator_allowed(UUID,UUID)
 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_live_recovery_operator_allowed(UUID,UUID) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.subscription_review_live_recovery_exception(
  p_item_type TEXT,p_item_id UUID,p_provider_merchant_id TEXT,p_pilot_organization_id UUID,
  p_operator_id UUID,p_authorization_reference TEXT,p_evidence_reference TEXT,
  p_status TEXT,p_owner_reference TEXT,p_next_action TEXT,p_next_action_due_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_settings private.subscription_live_settings;
  v_before private.subscription_live_recovery_exceptions;
  v_after private.subscription_live_recovery_exceptions; v_review_id UUID;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR v_settings.provider_mode<>'live'
    OR v_settings.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_settings.pilot_organization_id IS DISTINCT FROM p_pilot_organization_id
    OR NOT private.subscription_live_recovery_operator_allowed(p_pilot_organization_id,p_operator_id) THEN
    RAISE EXCEPTION 'Exact Live organization owner review required' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('investigating','waiting_provider','waiting_owner','recovery_approved')
    OR p_next_action_due_at IS NULL OR NOT isfinite(p_next_action_due_at)
    OR p_owner_reference IS NULL OR length(btrim(p_owner_reference)) NOT BETWEEN 1 AND 200
    OR p_next_action IS NULL OR length(btrim(p_next_action)) NOT BETWEEN 1 AND 1000
    OR p_authorization_reference IS NULL OR length(btrim(p_authorization_reference)) NOT BETWEEN 1 AND 500
    OR p_evidence_reference IS NULL OR length(btrim(p_evidence_reference)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Bounded metadata review and next action required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_before FROM private.subscription_live_recovery_exceptions
    WHERE item_type=p_item_type AND item_id=p_item_id FOR UPDATE;
  IF NOT FOUND OR v_before.merchant_id IS DISTINCT FROM p_provider_merchant_id
    OR v_before.organization_id IS DISTINCT FROM p_pilot_organization_id OR v_before.status='resolved' THEN
    RAISE EXCEPTION 'Unresolved exact Live exception required' USING ERRCODE='55000'; END IF;
  UPDATE private.subscription_live_recovery_exceptions SET status=p_status,
    owner_reference=btrim(p_owner_reference),next_action=btrim(p_next_action),
    next_action_due_at=p_next_action_due_at
    WHERE item_type=p_item_type AND item_id=p_item_id RETURNING * INTO v_after;
  INSERT INTO private.subscription_live_recovery_reviews
    (item_type,item_id,operator_id,authorization_reference,evidence_reference,before_state,after_state)
  VALUES(p_item_type,p_item_id,p_operator_id,btrim(p_authorization_reference),btrim(p_evidence_reference),
    to_jsonb(v_before),to_jsonb(v_after)) RETURNING review_id INTO v_review_id;
  RETURN jsonb_build_object('item_type',p_item_type,'item_id',p_item_id,'status',v_after.status,
    'review_id',v_review_id,'financial_hold_unchanged',TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_review_live_recovery_exception(TEXT,UUID,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ)
 FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_review_live_recovery_exception(TEXT,UUID,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_review_live_recovery_exception(TEXT,UUID,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_freeze_live_recovery_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Live recovery review audit is append-only' USING ERRCODE='55000';
END;
$$;
REVOKE ALL ON FUNCTION private.subscription_freeze_live_recovery_review() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_freeze_live_recovery_review() OWNER TO postgres;
DROP TRIGGER IF EXISTS subscription_freeze_live_recovery_review ON private.subscription_live_recovery_reviews;
CREATE TRIGGER subscription_freeze_live_recovery_review BEFORE UPDATE OR DELETE ON private.subscription_live_recovery_reviews
 FOR EACH ROW EXECUTE FUNCTION private.subscription_freeze_live_recovery_review();

-- A replay keeps the durable original decision visible.
CREATE OR REPLACE FUNCTION public.subscription_live_payment_replay_status(
  p_provider_order_id TEXT,p_provider_payment_id TEXT,
  p_provider_merchant_id TEXT,p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_payment private.subscription_live_payments;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_payment FROM private.subscription_live_payments
    WHERE provider_payment_id=p_provider_payment_id AND provider_order_id=p_provider_order_id
      AND merchant_id=p_provider_merchant_id AND organization_id=p_pilot_organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('status',v_payment.state,'reason',v_payment.hold_reason,
    'request_id',v_payment.request_id,'organization_id',v_payment.organization_id,
    'provider_payment_id',v_payment.provider_payment_id);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_live_payment_replay_status(TEXT,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_live_payment_replay_status(TEXT,TEXT,TEXT,UUID)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_live_payment_replay_status(TEXT,TEXT,TEXT,UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.subscription_commit_live_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ)
 FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.subscription_commit_live_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_commit_live_initial_payment(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ) TO service_role;
