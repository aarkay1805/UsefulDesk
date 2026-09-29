-- PRIVATE TEST DRAFT. Do not apply to Production or enable until standard
-- reminder policy, UI gates, and full-schema/send-boundary acceptance are done.
-- Financial reconciliation and existing provider mandates are never cancelled here.
ALTER TABLE private.subscription_billing_settings
  ADD COLUMN IF NOT EXISTS capabilities_enabled BOOLEAN NOT NULL DEFAULT FALSE;

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
