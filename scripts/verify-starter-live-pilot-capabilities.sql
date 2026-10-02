\set ON_ERROR_STOP on
-- Included only by the disposable opening runner after its unmodified signed
-- capture fixture, before refunds. Synthetic capability evidence, no provider
-- calls or durable changes. Verified empty staging may run the same assembled
-- fixture; never Production. The caller wraps everything in BEGIN/ROLLBACK.
CREATE TEMP TABLE pg_temp.starter_capability_original AS SELECT
 (SELECT to_jsonb(g) FROM private.subscription_live_grants g
  WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'
    AND request_id='d9999999-9999-4999-8999-999999999999'
    AND provider_payment_id='pay_StarterOpeningSynthetic') AS grant_state,
 (SELECT to_jsonb(a) FROM private.organization_product_access a
  WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8') AS access_state,
 (SELECT to_jsonb(s) FROM private.subscription_billing_settings s WHERE singleton) AS billing_state,
 (SELECT to_jsonb(s) FROM private.product_access_settings s WHERE singleton) AS enforcement_state;
SELECT pg_temp.assert_true((SELECT grant_state IS NOT NULL FROM pg_temp.starter_capability_original),
 'Capability acceptance requires the exact verified synthetic opening fixture');
SAVEPOINT starter_capability_acceptance;

-- NOW() is fixed at BEGIN, while the parent capture deliberately uses wall
-- time. Align only this synthetic grant/access start for valid active reads in
-- this transaction. This setup is not settlement evidence. Restore protection
-- before every assertion; the enclosing savepoint restores original facts.
ALTER TABLE private.subscription_live_grants DISABLE TRIGGER subscription_freeze_live_grant_evidence;
UPDATE private.subscription_live_grants SET period_start=now()-interval '1 minute'
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'
   AND request_id='d9999999-9999-4999-8999-999999999999'
   AND provider_payment_id='pay_StarterOpeningSynthetic' AND refund_confirmed_at IS NULL;
UPDATE private.organization_product_access a SET access_starts_at=g.period_start
 FROM private.subscription_live_grants g
 WHERE a.organization_id=g.organization_id
   AND g.organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'
   AND g.request_id='d9999999-9999-4999-8999-999999999999'
   AND g.provider_payment_id='pay_StarterOpeningSynthetic';
ALTER TABLE private.subscription_live_grants ENABLE TRIGGER subscription_freeze_live_grant_evidence;
SELECT pg_temp.assert_true((SELECT tgenabled='O' FROM pg_trigger
 WHERE tgrelid='private.subscription_live_grants'::regclass
   AND tgname='subscription_freeze_live_grant_evidence'), 'Grant protection was not restored');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_grants SET period_start=now()-interval '2 minutes'
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'
 AND request_id='d9999999-9999-4999-8999-999999999999'$q$,'55000');
UPDATE private.product_access_settings SET enforcement_enabled=true WHERE singleton;

CREATE TEMP TABLE pg_temp.starter_capability_names AS
 SELECT unnest(ARRAY['standard_renewal_reminders','custom_renewal_schedules',
 'bulk_campaigns','configurable_automations','gym_payment_links','gym_autopay']) AS capability;
CREATE TEMP TABLE pg_temp.starter_nonpilot_fixtures(account_id UUID,organization_id UUID,mode TEXT);
INSERT INTO pg_temp.starter_nonpilot_fixtures VALUES
 ('e1111111-1111-4111-8111-111111111111','e2222222-2222-4222-8222-222222222221','manual'),
 ('e1111111-1111-4111-8111-111111111112','e2222222-2222-4222-8222-222222222222','trial'),
 ('e1111111-1111-4111-8111-111111111113','e2222222-2222-4222-8222-222222222223','complimentary');
INSERT INTO public.organizations(id,name)
 SELECT organization_id,'Synthetic unchanged '||mode FROM pg_temp.starter_nonpilot_fixtures;
INSERT INTO public.legal_entities(id,organization_id,name)
 SELECT organization_id,organization_id,'Synthetic capability entity' FROM pg_temp.starter_nonpilot_fixtures;
INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id)
 SELECT account_id,'Synthetic unchanged '||mode,organization_id,
 'd1111111-1111-4111-8111-111111111111',organization_id FROM pg_temp.starter_nonpilot_fixtures;
INSERT INTO public.organization_memberships(organization_id,user_id,role)
 SELECT organization_id,'d1111111-1111-4111-8111-111111111111','owner' FROM pg_temp.starter_nonpilot_fixtures;
INSERT INTO public.account_memberships(account_id,user_id,role)
 SELECT account_id,'d1111111-1111-4111-8111-111111111111','owner' FROM pg_temp.starter_nonpilot_fixtures;
UPDATE private.organization_product_access a SET mode=f.mode,
 trial_started_at=CASE WHEN f.mode='trial' THEN now()-interval '1 day' END,
 trial_ends_at=CASE WHEN f.mode='trial' THEN now()+interval '13 days' END,
 access_starts_at=CASE WHEN f.mode='manual' THEN now()-interval '1 day' END,
 access_ends_at=CASE WHEN f.mode='manual' THEN now()+interval '29 days' END,
 suspended_at=NULL FROM pg_temp.starter_nonpilot_fixtures f WHERE a.organization_id=f.organization_id;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_temp.starter_nonpilot_fixtures f
 JOIN private.organization_paid_subscription_grants g USING(organization_id))
 AND NOT EXISTS(SELECT 1 FROM pg_temp.starter_nonpilot_fixtures f
 JOIN private.subscription_live_grants g USING(organization_id)), 'Nonpilot fixtures have paid grants');
CREATE TEMP TABLE pg_temp.starter_nonpilot_before AS SELECT f.account_id,n.capability,
 private.subscription_capability_allowed(f.account_id,n.capability) AS allowed
 FROM pg_temp.starter_nonpilot_fixtures f CROSS JOIN pg_temp.starter_capability_names n;
SELECT pg_temp.assert_true((SELECT count(*)=18 AND bool_and(allowed) FROM pg_temp.starter_nonpilot_before),
 'Valid nonpilot fixtures were not permitted before capability activation');

INSERT INTO public.renewal_reminder_settings(account_id,days_before,service_days_before)
 VALUES('d4444444-4444-4444-8444-444444444444',ARRAY[7,3,1],ARRAY[7,3,1])
 ON CONFLICT(account_id) DO UPDATE SET days_before=excluded.days_before,service_days_before=excluded.service_days_before;
UPDATE private.subscription_billing_settings SET capabilities_enabled=true WHERE singleton;
CREATE TEMP TABLE pg_temp.starter_nonpilot_after AS SELECT f.account_id,n.capability,
 private.subscription_capability_allowed(f.account_id,n.capability) AS allowed
 FROM pg_temp.starter_nonpilot_fixtures f CROSS JOIN pg_temp.starter_capability_names n;
SELECT pg_temp.assert_true(NOT EXISTS(
 (SELECT * FROM pg_temp.starter_nonpilot_before EXCEPT SELECT * FROM pg_temp.starter_nonpilot_after)
 UNION ALL
 (SELECT * FROM pg_temp.starter_nonpilot_after EXCEPT SELECT * FROM pg_temp.starter_nonpilot_before)),
 'Capability activation changed valid nonpilot manual/trial/complimentary access');
SELECT pg_temp.assert_true((SELECT bool_and(private.subscription_capability_allowed(
 'd4444444-4444-4444-8444-444444444444',capability)=(capability='standard_renewal_reminders'))
 FROM pg_temp.starter_capability_names), 'Paid Live Starter capability matrix differs from the offer');
SELECT pg_temp.assert_true(NOT private.subscription_capability_allowed(
 'd4444444-4444-4444-8444-444444444444','unknown_capability')
 AND (SELECT bool_and(NOT private.subscription_capability_allowed(account_id,'unknown_capability'))
 FROM pg_temp.starter_nonpilot_fixtures), 'Unknown capability was granted');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SET LOCAL request.headers='{"x-usefuldesk-account-id":"d4444444-4444-4444-8444-444444444444"}';
SELECT pg_temp.assert_true(public.is_account_member('d4444444-4444-4444-8444-444444444444','admin')
 AND (SELECT count(*)=1 FROM public.renewal_reminder_settings
 WHERE account_id='d4444444-4444-4444-8444-444444444444'),
 'Authenticated custom-write check lacks selected-branch admin access or a visible settings row');
WITH writable AS (UPDATE public.renewal_reminder_settings SET days_before=days_before
 WHERE account_id='d4444444-4444-4444-8444-444444444444' RETURNING account_id)
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM writable),
 'Settings UPDATE was silently denied by selected-account RLS');
SELECT pg_temp.assert_true(public.product_access_for_account('d4444444-4444-4444-8444-444444444444')
 ->'subscription_capabilities'='["standard_renewal_reminders"]'::jsonb,
 'Authenticated web/native pilot snapshot differs from the named predicate');
SELECT pg_temp.assert_true((public.product_access_for_account('e1111111-1111-4111-8111-111111111111')->>'allowed')::boolean
 AND jsonb_array_length(public.product_access_for_account('e1111111-1111-4111-8111-111111111111')->'subscription_capabilities')=6
 AND (public.product_access_for_account('e1111111-1111-4111-8111-111111111112')->>'allowed')::boolean
 AND jsonb_array_length(public.product_access_for_account('e1111111-1111-4111-8111-111111111112')->'subscription_capabilities')=6
 AND (public.product_access_for_account('e1111111-1111-4111-8111-111111111113')->>'allowed')::boolean
 AND jsonb_array_length(public.product_access_for_account('e1111111-1111-4111-8111-111111111113')->'subscription_capabilities')=6,
 'Authenticated web/native nonpilot snapshots lost access or a capability');
SELECT pg_temp.expect_error($q$UPDATE public.renewal_reminder_settings SET days_before=ARRAY[14,7,3,1]
 WHERE account_id='d4444444-4444-4444-8444-444444444444'$q$,'42501');
SELECT pg_temp.expect_error($q$UPDATE public.renewal_reminder_settings SET service_days_before=ARRAY[14,7,3,1]
 WHERE account_id='d4444444-4444-4444-8444-444444444444'$q$,'42501');
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
SELECT pg_temp.assert_true((SELECT days_before=ARRAY[7,3,1] AND service_days_before=ARRAY[7,3,1]
 FROM public.renewal_reminder_settings WHERE account_id='d4444444-4444-4444-8444-444444444444'),
 'Rejected custom writes changed persisted standard schedules');
SELECT 'PASS: rollback capability activation leaves nonpilot manual/trial/complimentary unchanged; paid Starter has only standard reminders; custom writes refused';

-- Live Starter capacity must not depend on the separate, closed Test switch.
SELECT pg_temp.expect_error($q$INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id)
 VALUES('e9999999-9999-4999-8999-999999999999','Synthetic second Starter branch',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111',
 'd3333333-3333-4333-8333-333333333333')$q$,'22023');
SELECT 'PASS: Live Starter second active branch refused while Test billing remains closed';
SAVEPOINT starter_capacity_activation;
INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id,branch_status)
 VALUES('e9999999-9999-4999-8999-999999999999','Synthetic archived Starter branch',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111',
 'd3333333-3333-4333-8333-333333333333','archived');
SELECT pg_temp.expect_error($q$UPDATE public.accounts SET branch_status='active'
 WHERE id='e9999999-9999-4999-8999-999999999999'$q$,'22023');
UPDATE private.subscription_billing_settings SET capabilities_enabled=false WHERE singleton;
UPDATE public.accounts SET branch_status='active' WHERE id='e9999999-9999-4999-8999-999999999999';
SELECT pg_temp.expect_error($q$UPDATE private.subscription_billing_settings SET capabilities_enabled=true WHERE singleton$q$,'55000');
ROLLBACK TO starter_capacity_activation;
RELEASE starter_capacity_activation;
SELECT 'PASS: Live Starter restore and over-capacity activation refused';

SAVEPOINT starter_capability_expiry;
UPDATE private.organization_product_access SET access_starts_at=now()-interval '2 hours',
 access_ends_at=now()-interval '1 hour'
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8';
SELECT pg_temp.assert_true((SELECT bool_and(NOT private.subscription_capability_allowed(
 'd4444444-4444-4444-8444-444444444444',capability)) FROM pg_temp.starter_capability_names),
 'Expired Starter retained a capability');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(NOT (public.product_access_for_account('d4444444-4444-4444-8444-444444444444')->>'allowed')::boolean
 AND public.product_access_for_account('d4444444-4444-4444-8444-444444444444')->'subscription_capabilities'='[]'::jsonb,
 'Expired web/native snapshot retained paid access or capabilities');
RESET ROLE;
ROLLBACK TO starter_capability_expiry;
RELEASE starter_capability_expiry;

-- Synthetic full refund is observed/committed through the real service-only
-- RPCs. The outer savepoint restores it before the parent's separate checks.
WITH review_clock AS MATERIALIZED (SELECT clock_timestamp() AS observed_at)
INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,
 approved_policy_reference,request_received_at,request_evidence_reference,owner_reviewed_at)
 SELECT 'e6666666-6666-4666-8666-666666666666','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'd1111111-1111-4111-8111-111111111111','pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,
 'synthetic-first-week-full-refund',review_clock.observed_at,'synthetic-capability-refund-request',review_clock.observed_at FROM review_clock;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_claim_live_refund('e6666666-6666-4666-8666-666666666666',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','acc_TCJwBqanN9LTrK');
SELECT public.subscription_observe_live_refund('e6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_StarterCapabilitySynthetic','acc_TCJwBqanN9LTrK',79900,'INR','processed');
SELECT pg_temp.assert_true(public.subscription_commit_live_full_refund('e6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_StarterCapabilitySynthetic','acc_TCJwBqanN9LTrK',79900,'INR')->>'confirmed_at' IS NOT NULL,
 'Synthetic full refund was not confirmed');
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
SELECT pg_temp.assert_true((SELECT bool_and(NOT private.subscription_capability_allowed(
 'd4444444-4444-4444-8444-444444444444',capability)) FROM pg_temp.starter_capability_names),
 'Confirmed refund retained a Starter capability');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.product_access_for_account('d4444444-4444-4444-8444-444444444444')
 ->'subscription_capabilities'='[]'::jsonb, 'Refunded web/native snapshot retained a capability');
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
SELECT pg_temp.assert_true((SELECT mode='manual' AND access_ends_at<=clock_timestamp()
 FROM private.organization_product_access WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'),
 'Confirmed refund failed to end the paid access term');
SELECT pg_temp.assert_true((SELECT bool_and(private.subscription_capability_allowed(f.account_id,n.capability))
 FROM pg_temp.starter_nonpilot_fixtures f CROSS JOIN pg_temp.starter_capability_names n),
 'Pilot expiry/refund changed a valid nonpilot capability');
SELECT 'PASS: expired Starter denies access/capabilities; confirmed synthetic full refund revokes every paid capability';

SAVEPOINT starter_refunded_manual;
-- Reproduce a real post-refund admin activation without changing paid history.
INSERT INTO private.platform_admins(user_id) VALUES('d1111111-1111-4111-8111-111111111111')
 ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_update_access('8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'activate',now()+interval '90 days','Synthetic explicit post-refund manual activation',
 (SELECT (public.product_access_for_account('d4444444-4444-4444-8444-444444444444')->'access'->>'version')::integer));
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
-- status uses fixed NOW(), so compare against an earlier synthetic refund/start.
ALTER TABLE private.subscription_live_grants DISABLE TRIGGER subscription_freeze_live_grant_evidence;
UPDATE private.subscription_live_grants SET refund_confirmed_at=now()-interval '2 minutes'
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8';
ALTER TABLE private.subscription_live_grants ENABLE TRIGGER subscription_freeze_live_grant_evidence;
UPDATE private.organization_product_access SET access_starts_at=now()-interval '1 minute'
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8';
UPDATE private.product_access_audit h SET created_at=a.access_starts_at,after_state=to_jsonb(a)
 FROM private.organization_product_access a WHERE h.organization_id=a.organization_id
 AND h.action='activate' AND h.reason='Synthetic explicit post-refund manual activation';
SELECT pg_temp.assert_true((SELECT bool_and(private.subscription_capability_allowed(
 'd4444444-4444-4444-8444-444444444444',capability)) FROM pg_temp.starter_capability_names),
 'Audited post-refund manual term lost capabilities');
UPDATE private.subscription_billing_settings SET capabilities_enabled=false WHERE singleton;
UPDATE public.renewal_reminder_settings SET days_before=ARRAY[14,7,3,1],service_days_before=ARRAY[14,7,3,1]
 WHERE account_id='d4444444-4444-4444-8444-444444444444';
UPDATE private.subscription_billing_settings SET capabilities_enabled=true WHERE singleton;
INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id)
 VALUES('e9999999-9999-4999-8999-999999999999','Synthetic second grandfathered manual branch',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111',
 'd3333333-3333-4333-8333-333333333333');
SAVEPOINT manual_missing_audit;
DELETE FROM private.product_access_audit WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8' AND action='activate';
SELECT pg_temp.assert_true((SELECT bool_and(NOT private.subscription_capability_allowed(
 'd4444444-4444-4444-8444-444444444444',capability)) FROM pg_temp.starter_capability_names),
 'Unaudited refunded manual term gained capabilities');
ROLLBACK TO manual_missing_audit;
RELEASE manual_missing_audit;
UPDATE private.organization_product_access SET access_ends_at=access_ends_at+interval '1 day'
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8';
SELECT pg_temp.assert_true((SELECT bool_and(NOT private.subscription_capability_allowed(
 'd4444444-4444-4444-8444-444444444444',capability)) FROM pg_temp.starter_capability_names),
 'Mismatched audited manual term gained capabilities');
ROLLBACK TO starter_refunded_manual;
RELEASE starter_refunded_manual;
SELECT 'PASS: audited post-refund manual term preserves capabilities, schedules and capacity; absent or mismatched audit denied';

ROLLBACK TO starter_capability_acceptance;
RELEASE starter_capability_acceptance;
SELECT pg_temp.assert_true((SELECT grant_state=(SELECT to_jsonb(g) FROM private.subscription_live_grants g
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8')
 AND access_state=(SELECT to_jsonb(a) FROM private.organization_product_access a
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8')
 AND billing_state=(SELECT to_jsonb(s) FROM private.subscription_billing_settings s WHERE singleton)
 AND enforcement_state=(SELECT to_jsonb(s) FROM private.product_access_settings s WHERE singleton)
 FROM pg_temp.starter_capability_original), 'Capability savepoint failed to restore original grant/access/settings');
SELECT pg_temp.assert_true((SELECT tgenabled='O' FROM pg_trigger
 WHERE tgrelid='private.subscription_live_grants'::regclass
 AND tgname='subscription_freeze_live_grant_evidence'), 'Grant immutability trigger changed after rollback');
DROP TABLE pg_temp.starter_capability_original;
SELECT 'PASS: capability fixture clock setup, grants, access and global switches restored exactly';
