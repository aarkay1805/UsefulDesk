CREATE OR REPLACE FUNCTION public.finance_payment_refund_summary(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_search TEXT DEFAULT NULL,
  p_methods TEXT[] DEFAULT NULL,
  p_statuses TEXT[] DEFAULT NULL,
  p_sources TEXT[] DEFAULT NULL,
  p_plan_ids UUID[] DEFAULT NULL,
  p_recorded_by UUID[] DEFAULT NULL,
  p_view TEXT DEFAULT 'all',
  p_purposes TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
WITH base AS (
  SELECT payment.id,payment.amount,payment.method,payment.status,payment.source,
    COALESCE(refunds.amount,0)::NUMERIC(12,2) processed_refund_amount,
    COALESCE(refunds.count,0)::BIGINT refund_count
  FROM public.payments payment
  LEFT JOIN public.contacts contact ON contact.id=payment.contact_id AND contact.account_id=payment.account_id
  LEFT JOIN public.memberships membership ON membership.id=payment.membership_id AND membership.account_id=payment.account_id
  LEFT JOIN LATERAL (
    SELECT SUM(refund.amount) amount,COUNT(*) count FROM public.payment_refunds refund
    WHERE refund.payment_id=payment.id AND refund.status='processed'
  ) refunds ON TRUE
  WHERE public.is_account_member(payment.account_id)
    AND payment.paid_at>=p_start AND payment.paid_at<p_end
    AND (NULLIF(BTRIM(p_search),'') IS NULL OR STRPOS(LOWER(CONCAT_WS(' ',payment.id::TEXT,
      CONCAT('#',UPPER(LEFT(REPLACE(payment.id::TEXT,'-',''),8))),payment.gateway_payment_id,
      contact.name,contact.phone,membership.member_number::TEXT)),LOWER(BTRIM(p_search)))>0)
    AND (COALESCE(CARDINALITY(p_methods),0)=0 OR payment.method=ANY(p_methods))
    AND (COALESCE(CARDINALITY(p_statuses),0)=0 OR payment.status=ANY(p_statuses))
    AND (COALESCE(CARDINALITY(p_sources),0)=0 OR payment.source=ANY(p_sources))
    AND (COALESCE(CARDINALITY(p_purposes),0)=0 OR payment.payment_purpose=ANY(p_purposes))
    AND (COALESCE(CARDINALITY(p_plan_ids),0)=0 OR payment.plan_id=ANY(p_plan_ids))
    AND (COALESCE(CARDINALITY(p_recorded_by),0)=0 OR payment.user_id=ANY(p_recorded_by))
), filtered AS (
  SELECT * FROM base WHERE CASE p_view
    WHEN 'collected' THEN status='paid'
    WHEN 'autopay' THEN status='paid' AND source='auto'
    WHEN 'voided' THEN status='void'
    ELSE TRUE END
), methods AS (
  SELECT CASE WHEN method IN ('bank','other') THEN 'bank_other' ELSE method END method,
    COALESCE(SUM(processed_refund_amount) FILTER(WHERE status='paid'),0) refunds
  FROM filtered GROUP BY 1
)
SELECT JSONB_BUILD_OBJECT(
  'processedRefunds',COALESCE(SUM(processed_refund_amount) FILTER(WHERE status='paid'),0),
  'refundCount',COALESCE(SUM(refund_count) FILTER(WHERE status='paid'),0),
  'autopayRefunds',COALESCE(SUM(processed_refund_amount) FILTER(WHERE status='paid' AND source='auto'),0),
  'methodRefunds',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('method',method,'amount',refunds)) FROM methods),'[]'::JSONB)
) FROM filtered;
$$;

REVOKE ALL ON FUNCTION public.finance_payment_refund_summary(
  TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT[],TEXT[],TEXT[],UUID[],UUID[],TEXT,TEXT[]
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_payment_refund_summary(
  TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT[],TEXT[],TEXT[],UUID[],UUID[],TEXT,TEXT[]
) TO authenticated;

COMMENT ON FUNCTION public.finance_payment_refund_summary(
  TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT[],TEXT[],TEXT[],UUID[],UUID[],TEXT,TEXT[]
) IS 'Tenant-scoped processed-refund totals matching the Finance Payments filter contract.';
