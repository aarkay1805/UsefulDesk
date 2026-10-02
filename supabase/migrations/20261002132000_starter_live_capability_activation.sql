-- Recognize independently administered access after a refunded Live term.
-- Dark until capabilities_enabled. No approval/financial/access rows are changed.
-- Existing trial, complimentary, manual and Test behavior remains intact.
CREATE OR REPLACE FUNCTION private.subscription_has_post_refund_manual_term(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.organization_product_access a
 JOIN private.subscription_live_grants g USING(organization_id)
 WHERE a.organization_id=p_organization_id AND a.mode='manual'
   AND private.product_access_status(a)='active'
   AND g.refund_confirmed_at IS NOT NULL
   AND a.access_starts_at>g.refund_confirmed_at
   AND EXISTS(SELECT 1 FROM private.product_access_audit h
     WHERE h.organization_id=a.organization_id AND h.action='activate'
       AND h.actor_user_id IS NOT NULL AND h.created_at=a.access_starts_at
       AND h.after_state @> jsonb_build_object('organization_id',a.organization_id,
         'mode','manual','access_starts_at',a.access_starts_at,
         'access_ends_at',a.access_ends_at,'suspended_at',NULL)));
$$;
REVOKE ALL ON FUNCTION private.subscription_has_post_refund_manual_term(UUID)
 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_has_post_refund_manual_term(UUID) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.subscription_capability_allowed(
  p_account_id UUID,p_capability TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT
   p_capability=ANY(ARRAY['standard_renewal_reminders','custom_renewal_schedules',
     'bulk_campaigns','configurable_automations','gym_payment_links','gym_autopay'])
   AND private.account_has_product_access(ac.id)
   AND CASE
     WHEN NOT s.capabilities_enabled THEN TRUE
     WHEN private.product_access_status(a) IN ('trial','complimentary') THEN TRUE
     WHEN private.product_access_status(a)<>'active' THEN FALSE
     WHEN g.organization_id IS NOT NULL AND lg.organization_id IS NOT NULL THEN FALSE
     WHEN lg.organization_id IS NOT NULL
       AND private.subscription_has_post_refund_manual_term(a.organization_id) THEN TRUE
     WHEN lg.organization_id IS NOT NULL THEN
       a.mode='manual'
       AND a.access_starts_at IS NOT DISTINCT FROM lg.period_start
       AND a.access_ends_at IS NOT DISTINCT FROM lg.paid_through_end
       AND lg.refund_confirmed_at IS NULL
       AND (p_capability='standard_renewal_reminders'
         OR lg.tier IN ('growth','ultimate'))
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
 LEFT JOIN private.organization_paid_subscription_grants g
   ON g.organization_id=ac.organization_id
 LEFT JOIN private.subscription_live_grants lg
   ON lg.organization_id=ac.organization_id
 WHERE ac.id=p_account_id AND s.singleton),FALSE);
$$;
REVOKE ALL ON FUNCTION private.subscription_capability_allowed(UUID,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_capability_allowed(UUID,TEXT) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.enforce_live_starter_capability_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT NEW.capabilities_enabled OR OLD.capabilities_enabled THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_grants g
    JOIN private.organization_product_access x USING(organization_id)
    WHERE g.tier='starter' AND x.mode NOT IN ('trial','complimentary')
      AND NOT private.subscription_has_post_refund_manual_term(g.organization_id)
      AND (SELECT count(*) FROM public.accounts a WHERE a.organization_id=g.organization_id
        AND a.branch_status='active')>private.subscription_base_included_branches(g.tier)) THEN
    RAISE EXCEPTION 'Live Starter active branches need owner review'
      USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_grants g
    JOIN public.accounts a ON a.organization_id=g.organization_id
    JOIN public.renewal_reminder_settings r ON r.account_id=a.id
    WHERE g.tier='starter'
      AND NOT private.subscription_has_post_refund_manual_term(g.organization_id) AND (r.days_before IS DISTINCT FROM NEW.standard_reminder_days_before
      OR r.service_days_before IS DISTINCT FROM NEW.standard_reminder_days_before)) THEN
    RAISE EXCEPTION 'Live Starter reminder schedules need owner review'
      USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_grants g
    JOIN public.accounts a ON a.organization_id=g.organization_id
    JOIN public.renewal_reminders_sent r ON r.account_id=a.id
    WHERE g.tier='starter'
      AND NOT private.subscription_has_post_refund_manual_term(g.organization_id) AND r.delivery_state='claimed'
      AND r.provider_attempted_at IS NULL
      AND NOT (r.days_before=ANY(NEW.standard_reminder_days_before))) THEN
    RAISE EXCEPTION 'Live Starter reminder claims need owner review'
      USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM private.subscription_live_grants g
    JOIN public.accounts a ON a.organization_id=g.organization_id
    JOIN public.service_renewal_reminders_sent r ON r.account_id=a.id
    WHERE g.tier='starter'
      AND NOT private.subscription_has_post_refund_manual_term(g.organization_id) AND r.status IN ('claimed','failed')
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

CREATE OR REPLACE FUNCTION private.enforce_subscription_active_branch_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_limit INTEGER; v_active INTEGER; v_access private.organization_product_access;
  v_live private.subscription_live_grants; v_test_enabled BOOLEAN; v_capabilities BOOLEAN;
BEGIN
  IF NEW.branch_status<>'active' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.branch_status='active'
    AND OLD.organization_id=NEW.organization_id THEN RETURN NEW; END IF;
  SELECT enabled,capabilities_enabled INTO v_test_enabled,v_capabilities
    FROM private.subscription_billing_settings WHERE singleton FOR SHARE;
  IF NOT COALESCE(v_test_enabled OR v_capabilities,FALSE) THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.organizations WHERE id=NEW.organization_id FOR UPDATE;
  SELECT * INTO v_access FROM private.organization_product_access
    WHERE organization_id=NEW.organization_id;
  SELECT * INTO v_live FROM private.subscription_live_grants
    WHERE organization_id=NEW.organization_id;
  IF v_capabilities AND v_live.organization_id IS NOT NULL
    AND v_access.mode NOT IN ('trial','complimentary')
    AND NOT private.subscription_has_post_refund_manual_term(NEW.organization_id) THEN
    -- Live add-ons remain closed. A historical refunded grant may be superseded
    -- only by the exact independently audited manual term, never by row drift.
    v_limit:=private.subscription_base_included_branches(v_live.tier);
  ELSIF NOT v_test_enabled THEN RETURN NEW;
  ELSIF v_access.mode='trial' THEN
    v_limit:=5;
  ELSE
    SELECT private.subscription_base_included_branches(g.tier)+
      private.subscription_active_paid_slots(NEW.organization_id)
      INTO v_limit FROM private.organization_paid_subscription_grants g
      WHERE g.organization_id=NEW.organization_id;
  END IF;
  IF v_limit IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_active FROM public.accounts WHERE organization_id=NEW.organization_id
    AND branch_status='active';
  IF v_active>=v_limit THEN
    RAISE EXCEPTION 'Active branch allowance is full' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_subscription_active_branch_limit() OWNER TO postgres;
