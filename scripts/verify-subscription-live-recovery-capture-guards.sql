-- All failures stay immutable captured-money evidence, never automatic grants.
SAVEPOINT recovery_access_version_drift;
UPDATE private.organization_product_access SET version=version+1
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'd9999999-9999-4999-8999-999999999999','order_StarterOpeningSynthetic','pay_StarterOpeningSynthetic',
 'acc_TCJwBqanN9LTrK',79900,'INR',(SELECT at FROM pg_temp.starter_capture))->>'reason'='access_changed',
 'Access version drift silently granted paid access');
SELECT pg_temp.assert_true(public.subscription_live_payment_replay_status('order_StarterOpeningSynthetic',
 'pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8')->>'reason'='access_changed',
 'Provider replay path lost original reason');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants)
 AND (SELECT mode='complimentary' FROM private.organization_product_access
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'),'Version drift changed entitlement');
ROLLBACK TO recovery_access_version_drift;
SAVEPOINT recovery_late_capture;
INSERT INTO private.subscription_live_quotes
 SELECT (jsonb_populate_record(NULL::private.subscription_live_quotes,to_jsonb(q)||jsonb_build_object(
  'request_id','e5555555-5555-4555-8555-555555555555',
  'starter_reminder_reset_accepted',false,'starter_reminder_policy_version',NULL,
  'owner_reviewed_at',now()-interval '1 hour','expires_at',now()-interval '30 minutes'))).*
 FROM private.subscription_live_quotes q WHERE request_id='d9999999-9999-4999-8999-999999999999';
INSERT INTO private.subscription_live_orders(request_id,organization_id,merchant_id,state,
 provider_order_id,claimed_at,bound_at)
VALUES('e5555555-5555-4555-8555-555555555555','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'acc_TCJwBqanN9LTrK','bound','order_LateRecoveryOnly',now()-interval '45 minutes',now()-interval '45 minutes');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'evt_LateRecoveryOnly','payment.captured','order_LateRecoveryOnly','pay_LateRecoveryOnly',
 NULL,repeat('c',64),now()-interval '29 minutes');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'e5555555-5555-4555-8555-555555555555','order_LateRecoveryOnly','pay_LateRecoveryOnly',
 'acc_TCJwBqanN9LTrK',79900,'INR',now()-interval '29 minutes')->>'reason'='quote_expired_or_changed',
 'Late signed capture silently granted access');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT hold_reason='quote_expired_or_changed'
 FROM private.subscription_live_payments WHERE provider_payment_id='pay_LateRecoveryOnly')
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants),'Late capture not held immutably');
ROLLBACK TO recovery_late_capture;
SELECT 'PASS: signed late capture and access version drift preserve access and persist original review hold';
