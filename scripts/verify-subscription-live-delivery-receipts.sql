-- Runs after verify-subscription-live-full.sql in the same disposable savepoint.
-- Synthetic signatures/identities never constitute genuine provider acceptance.
RESET ROLE;
CREATE TEMP TABLE delivery_receipt_preservation AS
SELECT jsonb_build_object(
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY provider_payment_id) FROM private.subscription_live_payments p),
  'refunds',(SELECT jsonb_agg(to_jsonb(r) ORDER BY refund_request_id) FROM private.subscription_live_refunds r),
  'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY organization_id) FROM private.subscription_live_grants g),
  'access',(SELECT jsonb_agg(to_jsonb(a) ORDER BY organization_id) FROM private.organization_product_access a),
  'settings',(SELECT to_jsonb(s) FROM private.subscription_live_settings s),
  'gym',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.payments p)
) AS facts;

SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class
  WHERE oid='private.subscription_live_delivery_receipts'::regclass),'Receipt RLS disabled');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','private.subscription_live_delivery_receipts','SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated','private.subscription_live_delivery_receipts','SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('service_role','private.subscription_live_delivery_receipts','INSERT,UPDATE,DELETE,TRUNCATE')
  AND has_table_privilege('service_role','private.subscription_live_delivery_receipts','SELECT'),
  'Receipt grants are not service SELECT-only');

CREATE OR REPLACE FUNCTION pg_temp.receipt(classification TEXT DEFAULT 'saas', digest TEXT DEFAULT repeat('a',64))
RETURNS JSONB LANGUAGE sql AS $$
 SELECT public.subscription_record_live_delivery_receipt(
   'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
   'evt_LiveSynthetic1','provider','payment.captured','order_LiveSynthetic1',
   'pay_LiveSynthetic1',NULL,digest,now()-interval '1 minute',classification)
$$;
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.receipt()$q$,'42501');
SET LOCAL ROLE authenticated;
-- Even a spoofed service claim has no execute/table grant.
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.receipt()$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT * FROM private.subscription_live_delivery_receipts$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(pg_temp.receipt()->>'status'='recorded','First receipt failed');
SELECT pg_temp.assert_true(pg_temp.receipt()->>'status'='recorded','Repeated receipt failed');
SELECT pg_temp.assert_true((SELECT count(*)=2 AND count(DISTINCT delivery_id)=2
  FROM private.subscription_live_delivery_receipts WHERE event_id='evt_LiveSynthetic1'),
  'Repeated delivery was discarded or reused receipt identity');
SELECT pg_temp.expect_error($q$SELECT pg_temp.receipt('saas',repeat('b',64))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.receipt('unrelated_order')$q$,'22023');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_delivery_receipts DEFAULT VALUES$q$,'42501');

SELECT pg_temp.assert_true(public.subscription_record_live_delivery_receipt(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_Foreign','provider','payment.captured','order_Foreign','pay_Foreign',NULL,
 repeat('f',64),now(),'unrelated_order')->>'status'='recorded','Foreign receipt failed');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_live_delivery_receipt(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_Foreign','provider','payment.captured','order_Foreign','pay_Foreign',NULL,
 repeat('b',64),now(),'unrelated_order')$q$,'23505');
SELECT pg_temp.assert_true(public.subscription_record_live_delivery_receipt(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 repeat('d',64),'body_digest','refund.processed',NULL,'pay_NoOrder','rfnd_NoOrder',
 repeat('d',64),now(),'unrelated_no_order')->>'status'='recorded','Orderless receipt failed');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_live_delivery_receipt(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_NotDigest','body_digest','refund.processed',NULL,'pay_NoOrder','rfnd_NoOrder',
 repeat('d',64),now(),'unrelated_no_order')$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_live_delivery_receipt(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_Unbound','provider','payment.captured','order_Unbound','pay_Unbound',NULL,
 repeat('d',64),now(),'saas')$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_live_delivery_receipt(
 'acc_Foreign','b2222222-2222-4222-8222-222222222222',
 'evt_Other','provider','payment.captured','order_Foreign','pay_Foreign',NULL,
 repeat('f',64),now(),'unrelated_order')$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_live_delivery_receipt(
 'acc_UsefulmadeLiveSynthetic','b1111111-1111-4111-8111-111111111111',
 'evt_Other','provider','payment.captured','order_Foreign','pay_Foreign',NULL,
 repeat('f',64),now(),'unrelated_order')$q$,'55000');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_delivery_receipts SET event_id='changed'$q$,'55000');
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_live_delivery_receipts$q$,'55000');
SAVEPOINT receipt_intake_disabled;
UPDATE private.subscription_live_settings SET webhook_intake_enabled=false WHERE singleton;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.receipt()$q$,'55000');
ROLLBACK TO receipt_intake_disabled;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT facts FROM delivery_receipt_preservation)=jsonb_build_object(
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY provider_payment_id) FROM private.subscription_live_payments p),
  'refunds',(SELECT jsonb_agg(to_jsonb(r) ORDER BY refund_request_id) FROM private.subscription_live_refunds r),
  'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY organization_id) FROM private.subscription_live_grants g),
  'access',(SELECT jsonb_agg(to_jsonb(a) ORDER BY organization_id) FROM private.organization_product_access a),
  'settings',(SELECT to_jsonb(s) FROM private.subscription_live_settings s),
  'gym',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.payments p)
),'Receipt collection changed financial, access, gym or gate facts');
SELECT 'PASS: delivery receipt replay, distinct repeats, unrelated isolation, identity conflicts, RLS, append-only and financial preservation';
