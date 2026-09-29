-- PRIVATE TEST DRAFT. Do not apply to Production or enable until standard
-- reminder policy, UI gates, and full-schema/send-boundary acceptance are done.
-- Financial reconciliation and existing provider mandates are never cancelled here.
ALTER TABLE private.subscription_billing_settings
  ADD COLUMN IF NOT EXISTS capabilities_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS standard_reminder_policy_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS standard_reminder_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS standard_reminder_days_before INTEGER[],
  ADD COLUMN IF NOT EXISTS standard_reminder_hour_local INTEGER;

-- The owner approved the worker's 7/3/1 after-09:00 account-local schedule
-- for Starter on 29 September 2026. Saved custom schedules and send boundaries
-- still require rollout review before this switch can turn on. A later policy
-- change requires coordinated code and migration changes.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.subscription_billing_settings'::regclass
   AND conname='subscription_standard_reminder_approval_required') THEN
   ALTER TABLE private.subscription_billing_settings ADD CONSTRAINT subscription_standard_reminder_approval_required
     CHECK (NOT capabilities_enabled OR COALESCE(
       standard_reminder_policy_approved
       AND NULLIF(btrim(standard_reminder_policy_version),'') IS NOT NULL
       AND standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[]
       AND standard_reminder_hour_local=9,FALSE));
 END IF;
END $$;

ALTER TABLE private.organization_subscription_intents
  ADD COLUMN IF NOT EXISTS starter_reminder_reset_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS starter_reminder_policy_version TEXT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.organization_subscription_intents'::regclass
   AND conname='subscription_starter_reminder_ack_version') THEN
   ALTER TABLE private.organization_subscription_intents ADD CONSTRAINT subscription_starter_reminder_ack_version
     CHECK (NOT starter_reminder_reset_accepted OR NULLIF(btrim(starter_reminder_policy_version),'') IS NOT NULL);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION private.enforce_subscription_reminder_ack()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.starter_reminder_reset_accepted OR NEW.starter_reminder_policy_version IS NOT NULL THEN
     RAISE EXCEPTION 'Owner reminder review must follow intent creation' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.starter_reminder_reset_accepted IS DISTINCT FROM OLD.starter_reminder_reset_accepted
   OR NEW.starter_reminder_policy_version IS DISTINCT FROM OLD.starter_reminder_policy_version THEN
   IF OLD.starter_reminder_reset_accepted OR OLD.order_requested_at IS NOT NULL
     OR OLD.provider_order_id IS NOT NULL OR OLD.state<>'pending'
     OR NOT NEW.starter_reminder_reset_accepted
     OR auth.uid() IS DISTINCT FROM OLD.requested_by
     OR NOT public.is_organization_owner(OLD.organization_id) THEN
     RAISE EXCEPTION 'Starter reminder review is immutable' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_subscription_reminder_ack() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS subscription_reminder_ack ON private.organization_subscription_intents;
CREATE TRIGGER subscription_reminder_ack BEFORE INSERT OR UPDATE OF starter_reminder_reset_accepted,starter_reminder_policy_version
 ON private.organization_subscription_intents FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_reminder_ack();

CREATE OR REPLACE FUNCTION private.subscription_capability_allowed(p_account_id UUID,p_capability TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT
   p_capability=ANY(ARRAY['standard_renewal_reminders','custom_renewal_schedules',
     'bulk_campaigns','configurable_automations','gym_payment_links','gym_autopay'])
   AND private.account_has_product_access(ac.id)
   AND CASE
     WHEN NOT s.capabilities_enabled THEN TRUE
     WHEN private.product_access_status(a) IN ('trial','complimentary') THEN TRUE
     WHEN private.product_access_status(a)<>'active' THEN FALSE
     WHEN g.organization_id IS NULL THEN TRUE -- grandfathered manual term
     WHEN a.mode<>'manual' OR a.access_starts_at IS DISTINCT FROM g.period_start THEN FALSE
     WHEN (a.access_ends_at=g.paid_through_end OR (
       a.access_ends_at=g.paid_through_end+interval '72 hours' AND EXISTS(
         SELECT 1 FROM private.organization_subscription_intents i
         WHERE i.organization_id=g.organization_id AND i.kind='renewal'
           AND i.source_period_end=g.paid_through_end AND i.first_failed_at IS NOT NULL
           AND i.expected_access_version=a.version))) IS NOT TRUE THEN FALSE
     ELSE p_capability='standard_renewal_reminders' OR g.tier IN ('growth','ultimate')
   END
 FROM public.accounts ac
 JOIN private.organization_product_access a ON a.organization_id=ac.organization_id
 CROSS JOIN private.subscription_billing_settings s
 LEFT JOIN private.organization_paid_subscription_grants g ON g.organization_id=ac.organization_id
 WHERE ac.id=p_account_id AND s.singleton),FALSE);
$$;

-- Reuse the existing authorized snapshot: browser, native and service callers
-- get the same database-clock decision. No new public private-ledger reader.
CREATE OR REPLACE FUNCTION public.product_access_for_account(p_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org UUID; v_capabilities JSONB;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'service_role'
 AND (auth.uid() IS NULL OR NOT public.has_account_membership(p_account_id)) THEN
   RAISE EXCEPTION 'Account access required' USING ERRCODE='42501';
 END IF;
 SELECT organization_id INTO v_org FROM public.accounts WHERE id=p_account_id;
 IF v_org IS NULL THEN RAISE EXCEPTION 'Account not found' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(jsonb_agg(capability),'[]'::JSONB) INTO v_capabilities
 FROM unnest(ARRAY['standard_renewal_reminders','custom_renewal_schedules',
   'bulk_campaigns','configurable_automations','gym_payment_links','gym_autopay']) capability
 WHERE private.subscription_capability_allowed(p_account_id,capability);
 RETURN private.product_access_snapshot(v_org)||jsonb_build_object('subscription_capabilities',v_capabilities);
END;
$$;

-- The trigger also runs inside SECURITY DEFINER writers and service-role writes.
-- Preserve history and allow deleting/disabling rules; prevent new work/configuration.
CREATE OR REPLACE FUNCTION private.enforce_subscription_feature_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_account UUID; v_old_account UUID; v_capability TEXT:=TG_ARGV[0];
BEGIN
 IF TG_TABLE_NAME='automation_steps' THEN
   SELECT account_id INTO v_account FROM public.automations WHERE id=NEW.automation_id;
   IF TG_OP='UPDATE' THEN
     SELECT account_id INTO v_old_account FROM public.automations WHERE id=OLD.automation_id;
   END IF;
 ELSE
   v_account:=NEW.account_id;
   IF TG_OP='UPDATE' THEN v_old_account:=OLD.account_id; END IF;
 END IF;
 -- Subscription commits use this same lock. A concurrent tier change must
 -- finish before a feature write decides which grant authorizes new work.
 PERFORM 1 FROM public.organizations o WHERE o.id IN (
   SELECT ac.organization_id FROM public.accounts ac WHERE ac.id IN (v_account,v_old_account)
 ) ORDER BY o.id FOR UPDATE;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='automations' THEN
   IF NEW.account_id=OLD.account_id AND NOT NEW.is_active
     AND (to_jsonb(NEW)-'is_active'-'updated_at')=(to_jsonb(OLD)-'is_active'-'updated_at') THEN
     RETURN NEW;
   END IF;
 END IF;
 IF NOT private.subscription_capability_allowed(v_account,v_capability)
   OR (v_old_account IS NOT NULL AND NOT private.subscription_capability_allowed(v_old_account,v_capability)) THEN
   RAISE EXCEPTION 'Your plan does not include this action. Contact your gym owner.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscription_automation_write ON public.automations;
CREATE TRIGGER subscription_automation_write BEFORE INSERT OR UPDATE OF account_id,name,description,trigger_type,trigger_config,is_active
 ON public.automations FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_feature_write('configurable_automations');
DROP TRIGGER IF EXISTS subscription_automation_step_write ON public.automation_steps;
CREATE TRIGGER subscription_automation_step_write BEFORE INSERT OR UPDATE ON public.automation_steps
 FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_feature_write('configurable_automations');
DROP TRIGGER IF EXISTS subscription_broadcast_create ON public.broadcasts;
CREATE TRIGGER subscription_broadcast_create BEFORE INSERT OR UPDATE OF account_id,name,template_name,template_language,template_variables,audience_filter,scheduled_at
 ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_feature_write('bulk_campaigns');
DROP TRIGGER IF EXISTS subscription_payment_link_create ON public.razorpay_payment_links;
CREATE TRIGGER subscription_payment_link_create BEFORE INSERT ON public.razorpay_payment_links
 FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_feature_write('gym_payment_links');
DROP TRIGGER IF EXISTS subscription_mandate_create ON public.payment_mandates;
CREATE TRIGGER subscription_mandate_create BEFORE INSERT ON public.payment_mandates
 FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_feature_write('gym_autopay');

-- A Starter account may turn the standard renewal messages on or off, but
-- changing their membership/service day offsets is a Growth capability.
-- Existing defaults are only a compatibility baseline: the approved standard
-- days and time must be chosen before capabilities_enabled can be switched on.
CREATE OR REPLACE FUNCTION private.enforce_subscription_reminder_schedule()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
   RAISE EXCEPTION 'Reminder settings cannot move between branches' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND NEW.days_before IS NOT DISTINCT FROM OLD.days_before
   AND NEW.service_days_before IS NOT DISTINCT FROM OLD.service_days_before THEN
   RETURN NEW;
 END IF;
 PERFORM 1 FROM public.organizations o JOIN public.accounts a ON a.organization_id=o.id
   WHERE a.id=NEW.account_id FOR UPDATE OF o;
 IF private.subscription_capability_allowed(NEW.account_id,'custom_renewal_schedules') THEN
   RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM private.subscription_billing_settings s WHERE s.singleton
   AND s.standard_reminder_policy_approved
   AND NEW.days_before=s.standard_reminder_days_before
   AND NEW.service_days_before=s.standard_reminder_days_before) THEN
   RETURN NEW; -- safe normalization, even after a paid Starter term begins
 END IF;
 RAISE EXCEPTION 'Your plan does not include this action. Contact your gym owner.' USING ERRCODE='42501';
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_subscription_reminder_schedule() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS subscription_reminder_schedule_write ON public.renewal_reminder_settings;
CREATE TRIGGER subscription_reminder_schedule_write BEFORE INSERT OR UPDATE OF account_id,days_before,service_days_before
 ON public.renewal_reminder_settings FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_reminder_schedule();

ALTER TABLE public.renewal_reminders_sent DROP CONSTRAINT IF EXISTS renewal_reminders_sent_delivery_state_check;
ALTER TABLE public.renewal_reminders_sent ADD CONSTRAINT renewal_reminders_sent_delivery_state_check
 CHECK (delivery_state IN ('unconfirmed','claimed','attempting','accepted','ambiguous','retired'));
ALTER TABLE public.service_renewal_reminders_sent DROP CONSTRAINT IF EXISTS service_renewal_reminders_sent_status_check;
ALTER TABLE public.service_renewal_reminders_sent ADD CONSTRAINT service_renewal_reminders_sent_status_check
 CHECK (status IN ('claimed','attempting','sent','failed','ambiguous','retired'));

-- Owner acceptance is bound to an immutable intent and the exact policy
-- version shown before order creation. A reset acknowledgement cannot be
-- added after a provider order may already have been requested.
CREATE OR REPLACE FUNCTION public.subscription_acknowledge_starter_reminders(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents; s private.subscription_billing_settings;
BEGIN
 SELECT * INTO i FROM private.organization_subscription_intents WHERE request_id=p_request_id FOR UPDATE;
 IF i.request_id IS NULL OR i.tier<>'starter' OR auth.uid() IS NULL
   OR NOT public.is_organization_owner(i.organization_id) OR i.requested_by IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'Starter owner intent required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO s FROM private.subscription_billing_settings WHERE singleton;
 IF NOT s.capabilities_enabled OR NOT s.standard_reminder_policy_approved
   OR s.standard_reminder_policy_version IS NULL THEN
   RAISE EXCEPTION 'Starter reminder policy is not approved' USING ERRCODE='55000';
 END IF;
 IF i.starter_reminder_reset_accepted THEN
   IF i.starter_reminder_policy_version IS DISTINCT FROM s.standard_reminder_policy_version THEN
     RAISE EXCEPTION 'Reminder policy changed; review again' USING ERRCODE='55000';
   END IF;
   RETURN jsonb_build_object('request_id',i.request_id,'policy_version',i.starter_reminder_policy_version);
 END IF;
 IF i.state<>'pending' OR i.order_requested_at IS NOT NULL OR i.provider_order_id IS NOT NULL THEN
   RAISE EXCEPTION 'Review reminders before creating an order' USING ERRCODE='55000';
 END IF;
 UPDATE private.organization_subscription_intents SET starter_reminder_reset_accepted=TRUE,
   starter_reminder_policy_version=s.standard_reminder_policy_version
   WHERE request_id=p_request_id;
 RETURN jsonb_build_object('request_id',p_request_id,'policy_version',s.standard_reminder_policy_version);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_acknowledge_starter_reminders(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.subscription_acknowledge_starter_reminders(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION private.subscription_assert_starter_reminder_review(p_organization_id UUID,p_intent_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents; s private.subscription_billing_settings;
BEGIN
 SELECT * INTO i FROM private.organization_subscription_intents WHERE request_id=p_intent_id;
 IF i.request_id IS NULL OR i.organization_id IS DISTINCT FROM p_organization_id THEN
   RAISE EXCEPTION 'Subscription intent does not match organization' USING ERRCODE='22023';
 END IF;
 IF i.tier<>'starter' THEN RETURN; END IF;
 SELECT * INTO s FROM private.subscription_billing_settings WHERE singleton;
 IF NOT s.capabilities_enabled THEN RETURN; END IF;
 IF NOT s.standard_reminder_policy_approved OR NOT i.starter_reminder_reset_accepted
   OR i.starter_reminder_policy_version IS DISTINCT FROM s.standard_reminder_policy_version
   OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m
     WHERE m.organization_id=p_organization_id AND m.user_id=i.requested_by AND m.role='owner') THEN
   RAISE EXCEPTION 'Starter reminder schedule needs owner review' USING ERRCODE='55000';
 END IF;
END;
$$;

-- Call inside the verified payment transaction before the Starter grant is
-- inserted/updated. This changes future schedules only; a provider-attempted
-- claim remains audit history and is never retried by this hook.
CREATE OR REPLACE FUNCTION private.subscription_apply_starter_reminder_policy(p_organization_id UUID,p_intent_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.organization_subscription_intents; s private.subscription_billing_settings;
  v_settings INTEGER:=0; v_membership INTEGER:=0; v_service INTEGER:=0;
BEGIN
 PERFORM private.subscription_assert_starter_reminder_review(p_organization_id,p_intent_id);
 SELECT * INTO i FROM private.organization_subscription_intents WHERE request_id=p_intent_id;
 SELECT * INTO s FROM private.subscription_billing_settings WHERE singleton;
 IF i.tier<>'starter' OR NOT s.capabilities_enabled THEN
   RETURN jsonb_build_object('applied',FALSE);
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
 UPDATE public.renewal_reminder_settings r SET days_before=s.standard_reminder_days_before,
   service_days_before=s.standard_reminder_days_before
 FROM public.accounts a WHERE r.account_id=a.id AND a.organization_id=p_organization_id
   AND (r.days_before IS DISTINCT FROM s.standard_reminder_days_before
     OR r.service_days_before IS DISTINCT FROM s.standard_reminder_days_before);
 GET DIAGNOSTICS v_settings=ROW_COUNT;
 UPDATE public.renewal_reminders_sent r SET delivery_state='retired',
   last_error='Plan changed; custom reminder retired before sending'
 FROM public.accounts a WHERE r.account_id=a.id AND a.organization_id=p_organization_id
   AND r.delivery_state='claimed' AND r.provider_attempted_at IS NULL
   AND NOT (r.days_before=ANY(s.standard_reminder_days_before));
 GET DIAGNOSTICS v_membership=ROW_COUNT;
 UPDATE public.service_renewal_reminders_sent r SET status='retired',
   last_error='Plan changed; custom reminder retired before sending',updated_at=now()
 FROM public.accounts a WHERE r.account_id=a.id AND a.organization_id=p_organization_id
   AND r.status IN ('claimed','failed') AND r.provider_attempted_at IS NULL
   AND NOT (r.days_before=ANY(s.standard_reminder_days_before));
 GET DIAGNOSTICS v_service=ROW_COUNT;
 PERFORM set_config('app.subscription_starter_reviewed_org_id',p_organization_id::TEXT,TRUE);
 INSERT INTO private.product_access_audit(organization_id,actor_user_id,action,reason,before_state,after_state)
 VALUES(p_organization_id,i.requested_by,'subscription_starter_reminders_applied',
   'Owner accepted the approved Starter reminder schedule',
   jsonb_build_object('intent_id',p_intent_id),
   jsonb_build_object('policy_version',s.standard_reminder_policy_version,
     'settings_normalized',v_settings,'membership_claims_retired',v_membership,
     'service_claims_retired',v_service));
 RETURN jsonb_build_object('applied',TRUE,'policy_version',s.standard_reminder_policy_version,
   'settings_normalized',v_settings,'membership_claims_retired',v_membership,
   'service_claims_retired',v_service);
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_starter_reminder_grant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_entering_starter BOOLEAN;
BEGIN
 v_entering_starter:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN v_entering_starter:=OLD.tier<>'starter'; END IF;
 IF NEW.tier='starter' AND v_entering_starter
   AND EXISTS(SELECT 1 FROM private.subscription_billing_settings WHERE singleton AND capabilities_enabled)
   AND current_setting('app.subscription_starter_reviewed_org_id',TRUE) IS DISTINCT FROM NEW.organization_id::TEXT THEN
   RAISE EXCEPTION 'Starter reminder review and normalization required' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_starter_reminder_grant ON private.organization_paid_subscription_grants;
CREATE TRIGGER subscription_starter_reminder_grant BEFORE INSERT OR UPDATE OF tier
 ON private.organization_paid_subscription_grants FOR EACH ROW EXECUTE FUNCTION private.enforce_starter_reminder_grant();

CREATE OR REPLACE FUNCTION private.enforce_subscription_capability_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.capabilities_enabled AND NEW.capabilities_enabled AND (
   NEW.standard_reminder_policy_approved IS DISTINCT FROM OLD.standard_reminder_policy_approved
   OR NEW.standard_reminder_policy_version IS DISTINCT FROM OLD.standard_reminder_policy_version
   OR NEW.standard_reminder_days_before IS DISTINCT FROM OLD.standard_reminder_days_before
   OR NEW.standard_reminder_hour_local IS DISTINCT FROM OLD.standard_reminder_hour_local) THEN
   RAISE EXCEPTION 'Disable capability enforcement before changing the approved reminder policy' USING ERRCODE='55000';
 END IF;
 IF NEW.capabilities_enabled AND NOT OLD.capabilities_enabled AND EXISTS(
   SELECT 1 FROM private.organization_paid_subscription_grants g
   JOIN public.accounts a ON a.organization_id=g.organization_id
   JOIN public.renewal_reminder_settings r ON r.account_id=a.id
   WHERE g.tier='starter' AND (r.days_before IS DISTINCT FROM NEW.standard_reminder_days_before
     OR r.service_days_before IS DISTINCT FROM NEW.standard_reminder_days_before)) THEN
   RAISE EXCEPTION 'Existing Starter reminder schedules need owner review' USING ERRCODE='55000';
 END IF;
 IF NEW.capabilities_enabled AND NOT OLD.capabilities_enabled AND EXISTS(
   SELECT 1 FROM private.organization_paid_subscription_grants g
   JOIN public.accounts a ON a.organization_id=g.organization_id
   JOIN public.renewal_reminders_sent r ON r.account_id=a.id
   WHERE g.tier='starter' AND r.delivery_state='claimed' AND r.provider_attempted_at IS NULL
     AND NOT (r.days_before=ANY(NEW.standard_reminder_days_before))) THEN
   RAISE EXCEPTION 'Existing Starter reminder claims need owner review' USING ERRCODE='55000';
 END IF;
 IF NEW.capabilities_enabled AND NOT OLD.capabilities_enabled AND EXISTS(
   SELECT 1 FROM private.organization_paid_subscription_grants g
   JOIN public.accounts a ON a.organization_id=g.organization_id
   JOIN public.service_renewal_reminders_sent r ON r.account_id=a.id
   WHERE g.tier='starter' AND r.status IN ('claimed','failed') AND r.provider_attempted_at IS NULL
     AND NOT (r.days_before=ANY(NEW.standard_reminder_days_before))) THEN
   RAISE EXCEPTION 'Existing Starter service claims need owner review' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_capability_activation ON private.subscription_billing_settings;
CREATE TRIGGER subscription_capability_activation BEFORE UPDATE OF capabilities_enabled,
 standard_reminder_policy_approved,standard_reminder_policy_version,
 standard_reminder_days_before,standard_reminder_hour_local
 ON private.subscription_billing_settings FOR EACH ROW EXECUTE FUNCTION private.enforce_subscription_capability_activation();

REVOKE ALL ON FUNCTION private.subscription_assert_starter_reminder_review(UUID,UUID),
 private.subscription_apply_starter_reminder_policy(UUID,UUID),
 private.enforce_starter_reminder_grant(),private.enforce_subscription_capability_activation()
 FROM PUBLIC,anon,authenticated;

-- Claim only eligible service work. The worker repeats this check immediately
-- before Meta, because a paid term or tier can change after this claim.
CREATE OR REPLACE FUNCTION public.claim_service_renewal_reminders(p_limit INTEGER DEFAULT 100)
RETURNS SETOF public.service_renewal_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_candidate public.service_renewal_queue%ROWTYPE;
BEGIN
 FOR v_candidate IN
   SELECT queue.* FROM public.service_renewal_queue queue
   WHERE queue.service_enabled
     AND private.subscription_capability_allowed(queue.account_id,'standard_renewal_reminders')
     AND queue.days_until_expiry = ANY(queue.service_days_before)
     AND queue.current_renewal_price IS NOT NULL
     AND queue.item_is_active AND queue.option_is_active
     AND EXTRACT(HOUR FROM NOW() AT TIME ZONE queue.timezone) >= 9
   ORDER BY queue.end_date, queue.id
   LIMIT LEAST(GREATEST(p_limit, 1), 500)
 LOOP
   INSERT INTO public.service_renewal_reminders_sent (
     account_id, member_service_id, end_date, days_before,
     status, claimed_at, provider_attempted_at, sent_at, attempts
   ) VALUES (
     v_candidate.account_id, v_candidate.id, v_candidate.end_date,
     v_candidate.days_until_expiry, 'claimed', NOW(), NULL, NULL, 1
   )
   ON CONFLICT (member_service_id, end_date, days_before) DO UPDATE SET
     status='claimed', claimed_at=NOW(), provider_attempted_at=NULL,
     sent_at=NULL, attempts=public.service_renewal_reminders_sent.attempts+1,
     last_error=NULL, updated_at=NOW()
   WHERE public.service_renewal_reminders_sent.status='failed'
     AND public.service_renewal_reminders_sent.provider_attempted_at IS NULL;
   IF FOUND THEN RETURN NEXT v_candidate; END IF;
 END LOOP;
 RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_service_renewal_reminders(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_service_renewal_reminders(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION private.subscription_capability_allowed(UUID,TEXT),
 private.enforce_subscription_feature_write() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.subscription_capability_allowed(UUID,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.product_access_for_account(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_access_for_account(UUID) TO authenticated,service_role;

-- A worker may be offline for the whole lower-tier term. Retire its old leases
-- atomically with downgrade, so a later upgrade cannot replay overdue sends.
CREATE OR REPLACE FUNCTION private.retire_subscription_tier_work()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_broadcasts INTEGER; v_pending INTEGER;
BEGIN
 IF NEW.tier<>'starter' OR OLD.tier='starter' OR NOT EXISTS(
   SELECT 1 FROM private.subscription_billing_settings WHERE singleton AND capabilities_enabled
 ) THEN RETURN NEW; END IF;
 UPDATE public.broadcast_recipients r SET status='failed',
   error_message='Plan changed; create a new broadcast to send again',send_lease_owner=NULL,send_lease_until=NULL
 FROM public.broadcasts b JOIN public.accounts a ON a.id=b.account_id
 WHERE r.broadcast_id=b.id AND a.organization_id=NEW.organization_id AND r.status='pending';
 UPDATE public.broadcasts b SET status='failed',updated_at=now()
 FROM public.accounts a WHERE a.id=b.account_id AND a.organization_id=NEW.organization_id
   AND b.status IN ('scheduled','sending');
 GET DIAGNOSTICS v_broadcasts=ROW_COUNT;
 UPDATE public.automation_pending_executions e SET status='failed',lease_owner=NULL,lease_until=NULL
 FROM public.automations automation JOIN public.accounts a ON a.id=automation.account_id
 WHERE e.automation_id=automation.id AND a.organization_id=NEW.organization_id AND e.status IN ('pending','running');
 GET DIAGNOSTICS v_pending=ROW_COUNT;
 IF v_broadcasts+v_pending>0 THEN
   INSERT INTO private.product_access_audit(organization_id,actor_user_id,action,reason,before_state,after_state)
   VALUES(NEW.organization_id,auth.uid(),'subscription_tier_work_retired','Plan changed; old campaigns and automation waits must not resume',
     jsonb_build_object('tier',OLD.tier),jsonb_build_object('tier',NEW.tier,'broadcasts',v_broadcasts,'pending_automations',v_pending));
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.retire_subscription_tier_work() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS retire_subscription_tier_work ON private.organization_paid_subscription_grants;
CREATE TRIGGER retire_subscription_tier_work AFTER UPDATE OF tier ON private.organization_paid_subscription_grants
 FOR EACH ROW EXECUTE FUNCTION private.retire_subscription_tier_work();
