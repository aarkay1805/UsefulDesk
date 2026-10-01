RESET ROLE;
SAVEPOINT recovery_refund_checks;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',5,
 'e1111111-1111-4111-8111-111111111111'))=1,'Unbound refund not discovered after shutdown');
SELECT public.subscription_observe_live_refund('d6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_RecoveryOnly','acc_TCJwBqanN9LTrK',79900,'INR','pending');
SELECT public.subscription_finish_live_recovery_item('refund',
 'd6666666-6666-4666-8666-666666666666','e1111111-1111-4111-8111-111111111111',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','pending','refund_pending');
RESET ROLE;
UPDATE private.subscription_live_recovery_queue SET next_attempt_at=clock_timestamp()-interval '1 second';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',5,
 'e2222222-2222-4222-8222-222222222222')->0->>'provider_refund_id'='rfnd_RecoveryOnly',
 'Bound pending refund not polled without webhook');
SELECT public.subscription_observe_live_refund('d6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_RecoveryOnly','acc_TCJwBqanN9LTrK',79900,'INR','failed');
SELECT public.subscription_finish_live_recovery_item('refund',
 'd6666666-6666-4666-8666-666666666666','e2222222-2222-4222-8222-222222222222',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','failed','refund_failed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access_ends_at>now() FROM private.organization_product_access WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'),
 'Failed/pending refund changed paid access');
UPDATE private.subscription_live_recovery_queue SET next_attempt_at=clock_timestamp()-interval '1 second';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',5,
 'e3333333-3333-4333-8333-333333333333'))=1,'Bound failed refund lost recovery');
RESET ROLE;
UPDATE private.subscription_live_recovery_queue SET lease_expires_at=clock_timestamp()-interval '1 second';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',5,
 'e4444444-4444-4444-8444-444444444444'))=1,'Expired lease could not be recovered');
SELECT pg_temp.expect_error($q$SELECT public.subscription_finish_live_recovery_item('refund',
 'd6666666-6666-4666-8666-666666666666','e3333333-3333-4333-8333-333333333333',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','retry','provider_lookup_unverified')$q$,'55000');
SELECT public.subscription_observe_live_refund('d6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_RecoveryOnly','acc_TCJwBqanN9LTrK',79900,'INR','processed');
SELECT pg_temp.expect_error($q$SELECT public.subscription_finish_live_recovery_item('refund',
 'd6666666-6666-4666-8666-666666666666','e4444444-4444-4444-8444-444444444444',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','recovered','refund_confirmed')$q$,'55000');
RESET ROLE;
SAVEPOINT recovery_refund_hold_race;
UPDATE private.organization_product_access SET access_ends_at=access_ends_at+interval '1 day'
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_full_refund('d6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_RecoveryOnly','acc_TCJwBqanN9LTrK',79900,'INR')->>'state'='review_required',
 'Refund access drift not held');
SELECT pg_temp.assert_true((public.subscription_finish_live_recovery_item('refund',
 'd6666666-6666-4666-8666-666666666666','e4444444-4444-4444-8444-444444444444',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','pending','refund_pending')->>'completed')::BOOLEAN,
 'Canonical refund hold race did not stop automatic retry');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status<>'resolved' AND original_reason='refund_pending'
 FROM private.subscription_live_recovery_exceptions WHERE item_type='refund')
 AND (SELECT confirmed_at IS NULL FROM private.subscription_live_refunds),'Held refund race was falsely resolved');
ROLLBACK TO recovery_refund_hold_race;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_full_refund('d6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_RecoveryOnly','acc_TCJwBqanN9LTrK',79900,'INR')->>'confirmed_at' IS NOT NULL,
 'Existing refund settlement did not finish');
RESET ROLE;
SAVEPOINT recovery_refund_commit_crash;
UPDATE private.subscription_live_recovery_queue SET lease_expires_at=clock_timestamp()-interval '1 second';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8'))=0,
 'Canonical confirmed refund was fetched again after worker crash');
SELECT pg_temp.assert_true((SELECT completed_at IS NOT NULL AND last_outcome='recovered'
 FROM private.subscription_live_recovery_queue) AND (SELECT status='resolved'
 FROM private.subscription_live_recovery_exceptions WHERE item_type='refund'),
 'Refund commit crash stranded queue/exception metadata');
RESET ROLE;
ROLLBACK TO recovery_refund_commit_crash;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true((public.subscription_finish_live_recovery_item('refund',
 'd6666666-6666-4666-8666-666666666666','e4444444-4444-4444-8444-444444444444',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8','pending','refund_pending')->>'completed')::BOOLEAN,
 'Canonical confirmed refund not completed');
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items(
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8'))=0,'Confirmed refund selected again');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT original_reason='refund_pending' AND latest_reason='refund_confirmed' AND status='resolved'
 FROM private.subscription_live_recovery_exceptions WHERE item_type='refund'),
 'Refund recovery overwrote reason history');
ROLLBACK TO recovery_refund_checks;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT 'PASS: shutdown unbound/pending/failed refund recovery, stale lease refusal, canonical confirmation/hold races and crash metadata closeout';
