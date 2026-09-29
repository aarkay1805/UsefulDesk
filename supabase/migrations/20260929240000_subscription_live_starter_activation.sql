-- A Live Starter grant must pass the same activation audit as a Test Starter
-- grant. Keep this separate from the Test migration so its invariant is intact.
CREATE OR REPLACE FUNCTION private.enforce_live_starter_capability_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT NEW.capabilities_enabled OR OLD.capabilities_enabled THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_grants g
    JOIN public.accounts a ON a.organization_id=g.organization_id
    JOIN public.renewal_reminder_settings r ON r.account_id=a.id
    WHERE g.tier='starter' AND (r.days_before IS DISTINCT FROM NEW.standard_reminder_days_before
      OR r.service_days_before IS DISTINCT FROM NEW.standard_reminder_days_before)) THEN
    RAISE EXCEPTION 'Live Starter reminder schedules need owner review'
      USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_grants g
    JOIN public.accounts a ON a.organization_id=g.organization_id
    JOIN public.renewal_reminders_sent r ON r.account_id=a.id
    WHERE g.tier='starter' AND r.delivery_state='claimed'
      AND r.provider_attempted_at IS NULL
      AND NOT (r.days_before=ANY(NEW.standard_reminder_days_before))) THEN
    RAISE EXCEPTION 'Live Starter reminder claims need owner review'
      USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_grants g
    JOIN public.accounts a ON a.organization_id=g.organization_id
    JOIN public.service_renewal_reminders_sent r ON r.account_id=a.id
    WHERE g.tier='starter' AND r.status IN ('claimed','failed')
      AND r.provider_attempted_at IS NULL
      AND NOT (r.days_before=ANY(NEW.standard_reminder_days_before))) THEN
    RAISE EXCEPTION 'Live Starter service claims need owner review'
      USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_live_starter_capability_activation
  ON private.subscription_billing_settings;
CREATE TRIGGER subscription_live_starter_capability_activation
  BEFORE UPDATE OF capabilities_enabled
  ON private.subscription_billing_settings FOR EACH ROW
  EXECUTE FUNCTION private.enforce_live_starter_capability_activation();
REVOKE ALL ON FUNCTION private.enforce_live_starter_capability_activation()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.enforce_live_starter_capability_activation() OWNER TO postgres;
