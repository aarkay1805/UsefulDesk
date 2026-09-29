-- DRAFT, DEFAULT OFF. Read-only owner quote view and a one-time Starter
-- reminder acknowledgment. No quote writer or payable switch is added.
ALTER TABLE private.subscription_live_quotes
  ADD COLUMN IF NOT EXISTS starter_reminder_reset_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS starter_reminder_policy_version TEXT;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='private.subscription_live_quotes'::regclass
      AND conname='subscription_live_starter_reminder_ack_version') THEN
    ALTER TABLE private.subscription_live_quotes
      ADD CONSTRAINT subscription_live_starter_reminder_ack_version
      CHECK ((starter_reminder_reset_accepted AND
        NULLIF(btrim(starter_reminder_policy_version),'') IS NOT NULL)
        OR (NOT starter_reminder_reset_accepted AND
          starter_reminder_policy_version IS NULL));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.enforce_live_starter_reminder_ack()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.starter_reminder_reset_accepted OR
      NEW.starter_reminder_policy_version IS NOT NULL THEN
      RAISE EXCEPTION 'Owner reminder review must follow quote creation'
        USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.starter_reminder_reset_accepted IS DISTINCT FROM OLD.starter_reminder_reset_accepted
    OR NEW.starter_reminder_policy_version IS DISTINCT FROM OLD.starter_reminder_policy_version THEN
    IF OLD.starter_reminder_reset_accepted OR NOT NEW.starter_reminder_reset_accepted
      OR OLD.tier<>'starter' OR auth.uid() IS DISTINCT FROM OLD.requested_by
      OR NOT public.is_organization_owner(OLD.organization_id)
      OR EXISTS(SELECT 1 FROM private.subscription_live_orders
        WHERE request_id=OLD.request_id) THEN
      RAISE EXCEPTION 'Starter reminder review is immutable'
        USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_live_reminder_ack
  ON private.subscription_live_quotes;
CREATE TRIGGER subscription_live_reminder_ack
  BEFORE INSERT OR UPDATE OF starter_reminder_reset_accepted,starter_reminder_policy_version
  ON private.subscription_live_quotes FOR EACH ROW
  EXECUTE FUNCTION private.enforce_live_starter_reminder_ack();
REVOKE ALL ON FUNCTION private.enforce_live_starter_reminder_ack()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.enforce_live_starter_reminder_ack() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.subscription_live_owner_quote(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes;
  s private.subscription_live_settings;
  r private.subscription_billing_settings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_live_settings WHERE singleton;
  IF NOT FOUND OR s.pilot_organization_id IS DISTINCT FROM p_organization_id
    OR s.provider_mode<>'live' THEN RETURN NULL; END IF;
  SELECT * INTO q FROM private.subscription_live_quotes
    WHERE organization_id=p_organization_id AND requested_by=auth.uid()
      AND merchant_id=s.merchant_id AND provider_mode='live'
    ORDER BY created_at DESC,request_id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM private.subscription_billing_settings WHERE singleton;
  RETURN jsonb_build_object('request_id',q.request_id,'tier',q.tier,
    'amount_minor',q.amount_minor,'currency',q.currency,
    'expires_at',q.expires_at,'owner_reviewed_at',q.owner_reviewed_at,
    'starter_reminder_reset_accepted',q.starter_reminder_reset_accepted,
    'starter_reminder_policy_version',q.starter_reminder_policy_version,
    'approved_starter_reminder_policy',CASE
      WHEN r.standard_reminder_policy_approved
        AND r.standard_reminder_policy_version IS NOT NULL
        AND r.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[]
        AND r.standard_reminder_hour_local=9 THEN jsonb_build_object(
          'version',r.standard_reminder_policy_version,
          'days_before',r.standard_reminder_days_before,
          'hour_local',r.standard_reminder_hour_local)
      ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_live_owner_quote(UUID) FROM PUBLIC,anon;
ALTER FUNCTION public.subscription_live_owner_quote(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_live_owner_quote(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.subscription_acknowledge_live_starter_reminders(
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes;
  s private.subscription_live_settings;
  r private.subscription_billing_settings;
BEGIN
  SELECT * INTO q FROM private.subscription_live_quotes
    WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR q.tier<>'starter' OR auth.uid() IS NULL
    OR q.requested_by IS DISTINCT FROM auth.uid()
    OR NOT public.is_organization_owner(q.organization_id) THEN
    RAISE EXCEPTION 'Starter owner quote required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM private.subscription_live_settings WHERE singleton;
  SELECT * INTO r FROM private.subscription_billing_settings WHERE singleton;
  IF s.pilot_organization_id IS DISTINCT FROM q.organization_id
    OR s.merchant_id IS DISTINCT FROM q.merchant_id
    OR NOT COALESCE(r.standard_reminder_policy_approved AND
      r.standard_reminder_policy_version IS NOT NULL AND
      r.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND
      r.standard_reminder_hour_local=9,FALSE) THEN
    RAISE EXCEPTION 'Starter reminder policy is not approved' USING ERRCODE='55000'; END IF;
  IF q.starter_reminder_reset_accepted THEN
    IF q.starter_reminder_policy_version IS DISTINCT FROM r.standard_reminder_policy_version THEN
      RAISE EXCEPTION 'Reminder policy changed; review again' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('request_id',q.request_id,
      'policy_version',q.starter_reminder_policy_version);
  END IF;
  IF now()>=q.expires_at OR EXISTS(SELECT 1 FROM private.subscription_live_orders
    WHERE request_id=p_request_id) THEN
    RAISE EXCEPTION 'Review reminders before creating an order' USING ERRCODE='55000'; END IF;
  UPDATE private.subscription_live_quotes SET starter_reminder_reset_accepted=TRUE,
    starter_reminder_policy_version=r.standard_reminder_policy_version
    WHERE request_id=p_request_id;
  RETURN jsonb_build_object('request_id',p_request_id,
    'policy_version',r.standard_reminder_policy_version);
END;
$$;
REVOKE ALL ON FUNCTION public.subscription_acknowledge_live_starter_reminders(UUID)
  FROM PUBLIC,anon;
ALTER FUNCTION public.subscription_acknowledge_live_starter_reminders(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.subscription_acknowledge_live_starter_reminders(UUID)
  TO authenticated;

-- The same transaction that grants Live Starter normalizes all branch reminder
-- settings and retires only unsent, unattempted custom claims.
CREATE OR REPLACE FUNCTION private.subscription_apply_live_starter_reminder_policy(
  p_organization_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes;
  r private.subscription_billing_settings;
  v_settings INTEGER:=0; v_membership INTEGER:=0; v_service INTEGER:=0;
BEGIN
  SELECT * INTO q FROM private.subscription_live_quotes WHERE request_id=p_request_id;
  SELECT * INTO r FROM private.subscription_billing_settings WHERE singleton;
  IF q.organization_id IS DISTINCT FROM p_organization_id OR q.tier<>'starter'
    OR NOT COALESCE(r.standard_reminder_policy_approved AND
      r.standard_reminder_policy_version IS NOT NULL AND
      r.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND
      r.standard_reminder_hour_local=9 AND q.starter_reminder_reset_accepted AND
      q.starter_reminder_policy_version=r.standard_reminder_policy_version,FALSE)
    OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id=p_organization_id AND m.user_id=q.requested_by
        AND m.role='owner') THEN
    RAISE EXCEPTION 'Starter reminders need owner review' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  UPDATE public.renewal_reminder_settings x SET days_before=r.standard_reminder_days_before,
    service_days_before=r.standard_reminder_days_before
  FROM public.accounts a WHERE x.account_id=a.id AND a.organization_id=p_organization_id
    AND (x.days_before IS DISTINCT FROM r.standard_reminder_days_before
      OR x.service_days_before IS DISTINCT FROM r.standard_reminder_days_before);
  GET DIAGNOSTICS v_settings=ROW_COUNT;
  UPDATE public.renewal_reminders_sent x SET delivery_state='retired',
    last_error='Plan changed; custom reminder retired before sending'
  FROM public.accounts a WHERE x.account_id=a.id AND a.organization_id=p_organization_id
    AND x.delivery_state='claimed' AND x.provider_attempted_at IS NULL
    AND NOT (x.days_before=ANY(r.standard_reminder_days_before));
  GET DIAGNOSTICS v_membership=ROW_COUNT;
  UPDATE public.service_renewal_reminders_sent x SET status='retired',
    last_error='Plan changed; custom reminder retired before sending',updated_at=now()
  FROM public.accounts a WHERE x.account_id=a.id AND a.organization_id=p_organization_id
    AND x.status IN ('claimed','failed') AND x.provider_attempted_at IS NULL
    AND NOT (x.days_before=ANY(r.standard_reminder_days_before));
  GET DIAGNOSTICS v_service=ROW_COUNT;
  PERFORM set_config('app.subscription_live_starter_reviewed_org_id',p_organization_id::TEXT,TRUE);
  INSERT INTO private.product_access_audit(organization_id,actor_user_id,action,reason,before_state,after_state)
  VALUES(p_organization_id,q.requested_by,'subscription_live_starter_reminders_applied',
    'Owner accepted the approved Starter reminder schedule',
    jsonb_build_object('request_id',p_request_id),
    jsonb_build_object('policy_version',r.standard_reminder_policy_version,
      'settings_normalized',v_settings,'membership_claims_retired',v_membership,
      'service_claims_retired',v_service));
  RETURN jsonb_build_object('applied',TRUE,'policy_version',r.standard_reminder_policy_version,
    'settings_normalized',v_settings,'membership_claims_retired',v_membership,
    'service_claims_retired',v_service);
END;
$$;
REVOKE ALL ON FUNCTION private.subscription_apply_live_starter_reminder_policy(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_apply_live_starter_reminder_policy(UUID,UUID) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.enforce_live_starter_reminder_grant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.tier='starter' AND current_setting(
      'app.subscription_live_starter_reviewed_org_id',TRUE)
      IS DISTINCT FROM NEW.organization_id::TEXT THEN
    RAISE EXCEPTION 'Live Starter reminder review and normalization required'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_live_starter_reminder_grant
  ON private.subscription_live_grants;
CREATE TRIGGER subscription_live_starter_reminder_grant BEFORE INSERT
  ON private.subscription_live_grants FOR EACH ROW
  EXECUTE FUNCTION private.enforce_live_starter_reminder_grant();
REVOKE ALL ON FUNCTION private.enforce_live_starter_reminder_grant()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.enforce_live_starter_reminder_grant() OWNER TO postgres;
