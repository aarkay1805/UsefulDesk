-- Shutdown hold remains durable and review cannot mutate payment or access.
SELECT pg_temp.assert_true((SELECT hold_reason='access_changed' FROM private.subscription_live_payments),
 'Shutdown hold reason not persisted');
SELECT pg_temp.assert_true((SELECT original_reason='access_changed' AND status='waiting_owner'
 AND owner_reference='Rajat Kashyap' FROM private.subscription_live_recovery_exceptions
 WHERE item_type='payment'),'Shutdown hold lacks owned durable exception');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'd9999999-9999-4999-8999-999999999999','order_StarterOpeningSynthetic','pay_StarterOpeningSynthetic',
 'acc_TCJwBqanN9LTrK',79900,'INR',(SELECT at FROM pg_temp.starter_capture))->>'reason'='access_changed',
 'Replay lost durable hold reason');
SELECT pg_temp.expect_error($q$SELECT public.subscription_review_live_recovery_exception('payment',
 'd9999999-9999-4999-8999-999999999999','acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'd1111111-1111-4111-8111-111111111111','synthetic-authorization','synthetic-evidence','resolved',
 'Synthetic delegate','Grant late payment',clock_timestamp()+interval '1 day')$q$,'22023');
SELECT pg_temp.assert_true((public.subscription_review_live_recovery_exception('payment',
 'd9999999-9999-4999-8999-999999999999','acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'd1111111-1111-4111-8111-111111111111','synthetic-authorization','synthetic-evidence','waiting_owner',
 'Synthetic delegate','Review exact shutdown capture',clock_timestamp()+interval '1 day')->>'financial_hold_unchanged')::BOOLEAN,
 'Review failed to record bounded metadata');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_recovery_reviews SET evidence_reference='changed'$q$,'42501');
RESET ROLE;
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_live_recovery_reviews$q$,'55000');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_recovery_reviews)
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants)
 AND (SELECT mode='complimentary' AND access_ends_at IS NULL FROM private.organization_product_access WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'),
 'Exception ownership review changed financial/access facts');
SELECT 'PASS: persisted shutdown hold and replay reason, owned next action, append-only review without financial resolver';
