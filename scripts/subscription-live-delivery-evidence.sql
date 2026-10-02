-- Read-only, aggregate-only inspection AFTER delivery receipt installation.
-- Candidates require private provider-log/identity and preservation review.
-- No result here declares genuine gym routing or customer readiness passed.
SELECT jsonb_build_object(
  'checked_at',clock_timestamp(),
  'collection_started_at',(SELECT min(recorded_at) FROM private.subscription_live_delivery_receipts),
  'classification_counts',(SELECT jsonb_agg(x) FROM (
    SELECT classification,event_id_source,count(*) AS receipts
    FROM private.subscription_live_delivery_receipts
    GROUP BY classification,event_id_source ORDER BY classification,event_id_source) x),
  'same_event_redelivery_candidates',(SELECT count(*) FROM (
    SELECT merchant_id,event_id,body_sha256 FROM private.subscription_live_delivery_receipts
    WHERE classification='saas' AND event_id_source='provider'
    GROUP BY merchant_id,event_id,body_sha256 HAVING count(*)>1) x),
  'original_event_states',(SELECT jsonb_agg(x) FROM (
    SELECT state,count(*) FROM private.subscription_live_webhook_events GROUP BY state) x),
  'financial_counts',jsonb_build_object(
    'payments',(SELECT count(*) FROM private.subscription_live_payments),
    'refunds',(SELECT count(*) FROM private.subscription_live_refunds),
    'grants',(SELECT count(*) FROM private.subscription_live_grants),
    'gym_payments',(SELECT count(*) FROM public.payments)),
  'review_required',true
) AS delivery_evidence;
