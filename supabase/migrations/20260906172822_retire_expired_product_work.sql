-- Do not resume old outbound work after a missed expiry or administrative suspension.
CREATE OR REPLACE FUNCTION private.retire_blocked_product_work()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_broadcasts INTEGER; v_pending INTEGER; v_flows INTEGER;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.product_access_settings WHERE singleton AND enforcement_enabled) THEN RETURN NEW; END IF;
 IF NOT (private.product_access_status(OLD) IN ('expired','suspended')
 OR (OLD.suspended_at IS NULL AND NEW.suspended_at IS NOT NULL)) THEN RETURN NEW; END IF;
 UPDATE public.broadcast_recipients r SET status='failed',error_message='UsefulDesk access ended; create a new broadcast to send again',
 send_lease_owner=NULL,send_lease_until=NULL
 FROM public.broadcasts b JOIN public.accounts a ON a.id=b.account_id
 WHERE r.broadcast_id=b.id AND a.organization_id=NEW.organization_id AND r.status='pending';
 UPDATE public.broadcasts b SET status='failed',updated_at=now()
 FROM public.accounts a WHERE a.id=b.account_id AND a.organization_id=NEW.organization_id AND b.status IN ('scheduled','sending');
 GET DIAGNOSTICS v_broadcasts=ROW_COUNT;
 UPDATE public.automation_pending_executions e SET status='failed',lease_owner=NULL,lease_until=NULL
 FROM public.automations automation JOIN public.accounts a ON a.id=automation.account_id
 WHERE e.automation_id=automation.id AND a.organization_id=NEW.organization_id AND e.status IN ('pending','running');
 GET DIAGNOSTICS v_pending=ROW_COUNT;
 UPDATE public.flow_runs r SET status='failed',ended_at=now(),end_reason='UsefulDesk access ended; old run will not resume'
 FROM public.flows f JOIN public.accounts a ON a.id=f.account_id
 WHERE r.flow_id=f.id AND a.organization_id=NEW.organization_id AND r.status IN ('active','paused_by_agent');
 GET DIAGNOSTICS v_flows=ROW_COUNT;
 IF v_broadcasts+v_pending+v_flows>0 THEN
 INSERT INTO private.product_access_audit(organization_id,actor_user_id,action,reason,before_state,after_state)
 VALUES(NEW.organization_id,auth.uid(),'queued_work_retired','Old outbound work must not replay after an access interruption',
 NULL,jsonb_build_object('broadcasts',v_broadcasts,'pending_automations',v_pending,'flow_runs',v_flows));
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.retire_blocked_product_work() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS retire_blocked_product_work ON private.organization_product_access;
CREATE TRIGGER retire_blocked_product_work AFTER UPDATE OF trial_ends_at,access_ends_at,suspended_at,mode
 ON private.organization_product_access FOR EACH ROW EXECUTE FUNCTION private.retire_blocked_product_work();

-- Public token possession cannot keep an expired organization's capture form live.
DO $$ DECLARE v_sql TEXT; v_original TEXT; BEGIN
 SELECT pg_get_functiondef('public.peek_lead_capture_form(text)'::regprocedure) INTO v_original;
 v_sql:=replace(v_original,'IF NOT v_form.is_active THEN',
 'IF NOT v_form.is_active OR NOT private.account_has_product_access(v_form.account_id) THEN');
 IF v_sql=v_original AND strpos(v_original,'OR NOT private.account_has_product_access(v_form.account_id)')=0 THEN
 RAISE EXCEPTION 'Lead capture form shape changed'; END IF;
 EXECUTE v_sql;
END $$;
