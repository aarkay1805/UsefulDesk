-- Human selection of future gym businesses is distinct from commercial approval.
-- This empty, private queue never prepares an offer or opens payment/access.
CREATE TABLE IF NOT EXISTS private.subscription_starter_signup_policies (
 policy_id UUID PRIMARY KEY,
 selection_scope TEXT NOT NULL CHECK(selection_scope='all_new_gym_business_accounts'),
 registrations_from TIMESTAMPTZ NOT NULL CHECK(isfinite(registrations_from)),
 approved_by UUID NOT NULL REFERENCES auth.users(id),
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 1000),
 approved_at TIMESTAMPTZ NOT NULL CHECK(isfinite(approved_at)),
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 revoked_at TIMESTAMPTZ CHECK(revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=approved_at))
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_starter_signup_one_active_policy
 ON private.subscription_starter_signup_policies(enabled) WHERE enabled AND revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS private.subscription_starter_signup_selections (
 -- An audit UUID snapshot must not block the existing organization erasure RPC.
 organization_id UUID PRIMARY KEY,
 policy_id UUID NOT NULL REFERENCES private.subscription_starter_signup_policies(policy_id),
 organization_created_at TIMESTAMPTZ NOT NULL CHECK(isfinite(organization_created_at)),
 selected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(selected_at))
);
ALTER TABLE private.subscription_starter_signup_selections
 DROP CONSTRAINT IF EXISTS subscription_starter_signup_selections_organization_id_fkey;
ALTER TABLE private.subscription_starter_signup_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.subscription_starter_signup_selections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_starter_signup_policies,private.subscription_starter_signup_selections
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_starter_signup_policies,private.subscription_starter_signup_selections TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_guard_signup_policy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
   (to_jsonb(NEW)-ARRAY['enabled','revoked_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['enabled','revoked_at'])
   OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at))) THEN
  RAISE EXCEPTION 'Signup selection authorization is immutable' USING ERRCODE='55000'; END IF;
 IF NEW.approved_at>clock_timestamp() OR NEW.registrations_from>clock_timestamp()
  OR ((TG_OP='INSERT' OR NEW.enabled) AND NOT EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=NEW.approved_by))
  OR (NEW.enabled AND NEW.revoked_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Actual operator signup selection authorization required' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_signup_policy ON private.subscription_starter_signup_policies;
CREATE TRIGGER subscription_guard_signup_policy BEFORE INSERT OR UPDATE OR DELETE
 ON private.subscription_starter_signup_policies FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_signup_policy();

CREATE OR REPLACE FUNCTION private.subscription_freeze_signup_selection()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Signup selection history is immutable' USING ERRCODE='55000';
END;
$$;
DROP TRIGGER IF EXISTS subscription_freeze_signup_selection ON private.subscription_starter_signup_selections;
CREATE TRIGGER subscription_freeze_signup_selection BEFORE UPDATE OR DELETE
 ON private.subscription_starter_signup_selections FOR EACH ROW EXECUTE FUNCTION private.subscription_freeze_signup_selection();

CREATE OR REPLACE FUNCTION private.subscription_select_new_gym_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p private.subscription_starter_signup_policies;
BEGIN
 SELECT * INTO p FROM private.subscription_starter_signup_policies
  WHERE enabled AND revoked_at IS NULL AND approved_at<=clock_timestamp()
   AND registrations_from<=NEW.created_at AND NEW.created_at<=clock_timestamp()
  FOR SHARE;
 IF FOUND THEN
  INSERT INTO private.subscription_starter_signup_selections(organization_id,policy_id,organization_created_at)
   VALUES(NEW.id,p.policy_id,NEW.created_at) ON CONFLICT(organization_id) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_select_new_gym_signup ON public.organizations;
CREATE TRIGGER subscription_select_new_gym_signup AFTER INSERT ON public.organizations
 FOR EACH ROW EXECUTE FUNCTION private.subscription_select_new_gym_signup();

-- The existing admin predicate requires both platform membership and aal2.
-- Queue states are derived from actual ledgers, never authored as owner consent.
CREATE OR REPLACE FUNCTION public.platform_admin_starter_signup_queue(p_limit INTEGER DEFAULT 50,p_offset INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB;
BEGIN
 PERFORM private.require_platform_admin();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 THEN
  RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::JSONB) INTO v_result FROM (
  SELECT s.organization_id,o.name,s.policy_id,s.selected_at,p.approved_by operator_user_id,
   private.product_access_status(x) access_status,
   (SELECT count(*) FROM public.accounts a WHERE a.organization_id=s.organization_id AND a.branch_status='active') active_branches,
   CASE
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_payments a WHERE a.organization_id=s.organization_id AND a.state='verified') THEN 'payment_verified'
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes a
      JOIN private.subscription_live_settings l ON l.singleton AND l.merchant_id=a.merchant_id
      WHERE a.organization_id=s.organization_id AND a.quotes_enabled AND a.orders_enabled
       AND l.webhook_intake_enabled AND l.settlements_enabled
       AND private.subscription_customer_review_active(a.organization_id,a.review_id)) THEN 'checkout_opened'
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes a WHERE a.organization_id=s.organization_id AND a.quotes_enabled AND a.orders_enabled) THEN 'checkout_paused'
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews a WHERE a.organization_id=s.organization_id AND a.revoked_at IS NULL) THEN 'owner_reviewed'
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations a WHERE a.organization_id=s.organization_id
      AND private.subscription_customer_preparation_eligible(a.review_id,a.owner_user_id)) THEN 'owner_review_required'
    ELSE 'commercial_review_required' END review_status
  FROM private.subscription_starter_signup_selections s
  JOIN private.subscription_starter_signup_policies p ON p.policy_id=s.policy_id
  JOIN public.organizations o ON o.id=s.organization_id
  LEFT JOIN private.organization_product_access x ON x.organization_id=s.organization_id
  ORDER BY s.selected_at,s.organization_id LIMIT p_limit OFFSET p_offset
 ) q;
 RETURN jsonb_build_object('items',v_result,'total',(SELECT count(*) FROM private.subscription_starter_signup_selections s
  JOIN public.organizations o ON o.id=s.organization_id));
END;
$$;

ALTER FUNCTION private.subscription_guard_signup_policy() OWNER TO postgres;
ALTER FUNCTION private.subscription_freeze_signup_selection() OWNER TO postgres;
ALTER FUNCTION private.subscription_select_new_gym_signup() OWNER TO postgres;
ALTER FUNCTION public.platform_admin_starter_signup_queue(INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_guard_signup_policy(),private.subscription_freeze_signup_selection(),
 private.subscription_select_new_gym_signup(),public.platform_admin_starter_signup_queue(INTEGER,INTEGER)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_starter_signup_queue(INTEGER,INTEGER) TO authenticated;
