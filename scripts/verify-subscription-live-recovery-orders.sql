-- Included inside the opening fixture transaction. No remote/provider access.
RESET ROLE;
SAVEPOINT recovery_order_checks;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8')$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_recovery_items(
 'acc_Wrong','8826d9aa-03f2-4ad7-ae91-0553052131f8')$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',6)$q$,'22023');
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',5,
 'e1111111-1111-4111-8111-111111111111'))=1,'Unbound order not discovered');
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',5,
 'e2222222-2222-4222-8222-222222222222'))=0,'Concurrent worker stole active lease');
SELECT pg_temp.expect_error($q$SELECT public.subscription_finish_live_recovery_item('order',
 'd9999999-9999-4999-8999-999999999999','e1111111-1111-4111-8111-111111111111',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','recovered','order_bound_signed_event_required')$q$,'55000');
SELECT public.subscription_finish_live_recovery_item('order',
 'd9999999-9999-4999-8999-999999999999','e1111111-1111-4111-8111-111111111111',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','review_required','lookup_not_unique');
SELECT pg_temp.expect_error($q$SELECT public.subscription_finish_live_recovery_item('order',
 'd9999999-9999-4999-8999-999999999999','e1111111-1111-4111-8111-111111111111',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','retry','invalid_claim')$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_recovery_queue SET attempts=0$q$,'42501');
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_live_recovery_exceptions$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='waiting_owner' AND original_reason='lookup_not_unique'
 FROM private.subscription_live_recovery_exceptions),'Missing owned ambiguity');
UPDATE private.subscription_live_recovery_queue SET next_attempt_at=clock_timestamp()-interval '1 second';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',5,
 'e2222222-2222-4222-8222-222222222222'))=1,'Ambiguity could not be safely retried');
SELECT public.subscription_bind_live_order('d9999999-9999-4999-8999-999999999999','order_RecoveryOnly',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8');
RESET ROLE;
SAVEPOINT recovery_bind_crash;
UPDATE private.subscription_live_recovery_queue SET lease_expires_at=clock_timestamp()-interval '1 second';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8'))=0,
 'Canonical bound order was fetched again after worker crash');
SELECT pg_temp.assert_true((SELECT completed_at IS NOT NULL AND last_outcome='recovered'
 FROM private.subscription_live_recovery_queue) AND (SELECT status='resolved'
 FROM private.subscription_live_recovery_exceptions),'Bind crash stranded queue/exception metadata');
RESET ROLE;
ROLLBACK TO recovery_bind_crash;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true((public.subscription_finish_live_recovery_item('order',
 'd9999999-9999-4999-8999-999999999999','e2222222-2222-4222-8222-222222222222',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','recovered','order_bound_signed_event_required')->>'completed')::BOOLEAN,
 'Verified bind not completed');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_payments)
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants),'Order lookup granted access');
SELECT pg_temp.assert_true((SELECT status='resolved' AND original_reason='lookup_not_unique'
 FROM private.subscription_live_recovery_exceptions),'Recovery rewrote original exception');
ROLLBACK TO recovery_order_checks;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT 'PASS: original order discovery, exact scope/role/limit, exclusive lease, ambiguity retry and canonical bind without grant';
