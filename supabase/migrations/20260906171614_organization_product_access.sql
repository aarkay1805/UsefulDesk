-- Organization-wide SaaS access. Starts disabled for a staged application rollout.
-- Gym memberships/payment mandates and provider reconciliation are independent.
CREATE TABLE IF NOT EXISTS private.product_access_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trial_days INTEGER NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 1 AND 90),
  support_email TEXT,
  support_whatsapp TEXT CHECK (support_whatsapp IS NULL OR support_whatsapp ~ '^[1-9][0-9]{7,14}$')
);
INSERT INTO private.product_access_settings(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS private.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.organization_product_access (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('trial','manual','complimentary')),
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  access_starts_at TIMESTAMPTZ,
  access_ends_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((trial_started_at IS NULL AND trial_ends_at IS NULL) OR
    (trial_started_at IS NOT NULL AND trial_ends_at IS NOT NULL AND trial_ends_at > trial_started_at)),
  CHECK (mode <> 'manual' OR (access_starts_at IS NOT NULL AND access_ends_at IS NOT NULL AND access_ends_at > access_starts_at))
);
CREATE TABLE IF NOT EXISTS private.product_access_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  actor_user_id UUID,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_access_audit_organization_time
  ON private.product_access_audit(organization_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS private.product_support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_support_request_open
 ON private.product_support_requests(organization_id,requested_by) WHERE status='open';
ALTER TABLE private.product_access_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.organization_product_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.product_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.product_support_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.product_access_settings,private.platform_admins,
 private.organization_product_access,private.product_access_audit,private.product_support_requests
 FROM PUBLIC,anon,authenticated;
-- No end-user table grants: only the narrowly scoped functions below expose data.
GRANT ALL ON private.product_access_settings,private.platform_admins,
 private.organization_product_access,private.product_access_audit,private.product_support_requests TO service_role;

WITH inserted AS (
 INSERT INTO private.organization_product_access(organization_id,mode)
 SELECT id,'complimentary' FROM public.organizations ON CONFLICT DO NOTHING RETURNING *
)
INSERT INTO private.product_access_audit(organization_id,action,reason,after_state)
SELECT organization_id,'grandfather','Existing organization retains access',to_jsonb(inserted) FROM inserted;

CREATE OR REPLACE FUNCTION private.product_access_status(a private.organization_product_access)
RETURNS TEXT LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN a.suspended_at IS NOT NULL THEN 'suspended'
 WHEN a.mode='complimentary' THEN 'complimentary'
 WHEN a.mode='trial' AND a.trial_started_at IS NULL THEN 'pending'
 WHEN a.mode='trial' AND now() < a.trial_started_at THEN 'pending'
 WHEN a.mode='trial' AND now() < a.trial_ends_at THEN 'trial'
 WHEN a.mode='manual' AND now() < a.access_starts_at THEN 'pending'
 WHEN a.mode='manual' AND now() < a.access_ends_at THEN 'active'
 ELSE 'expired' END;
$$;
CREATE OR REPLACE FUNCTION private.organization_has_product_access(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT NOT enforcement_enabled FROM private.product_access_settings WHERE singleton),FALSE) OR COALESCE((SELECT
   private.product_access_status(a) IN ('trial','active','complimentary')
 FROM private.product_access_settings s
 JOIN private.organization_product_access a ON a.organization_id=p_organization_id
 WHERE s.singleton), FALSE);
$$;
CREATE OR REPLACE FUNCTION private.account_has_product_access(p_account_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT NOT enforcement_enabled FROM private.product_access_settings WHERE singleton),FALSE) OR COALESCE((SELECT private.organization_has_product_access(a.organization_id)
 FROM public.accounts a WHERE a.id=p_account_id),FALSE);
$$;
CREATE OR REPLACE FUNCTION private.has_product_account_membership(
 target_account_id UUID,min_role public.account_role_enum DEFAULT 'viewer')
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.has_account_membership(target_account_id,min_role)
 AND private.account_has_product_access(target_account_id);
$$;
CREATE OR REPLACE FUNCTION private.is_product_organization_owner(target_organization_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_organization_owner(target_organization_id)
 AND private.organization_has_product_access(target_organization_id);
$$;
CREATE OR REPLACE FUNCTION private.product_access_snapshot(p_organization_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('access',to_jsonb(a),'status',private.product_access_status(a),
 'allowed',private.organization_has_product_access(a.organization_id),
 'enforcement_enabled',s.enforcement_enabled,'support_email',s.support_email,'support_whatsapp',s.support_whatsapp)
 FROM private.organization_product_access a CROSS JOIN private.product_access_settings s
 WHERE a.organization_id=p_organization_id AND s.singleton;
$$;
CREATE OR REPLACE FUNCTION public.product_access_for_account(p_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org UUID;
BEGIN
 IF (SELECT auth.jwt()->>'role') IS DISTINCT FROM 'service_role'
 AND (auth.uid() IS NULL OR NOT public.has_account_membership(p_account_id)) THEN
   RAISE EXCEPTION 'Account access required' USING ERRCODE='42501';
 END IF;
 SELECT organization_id INTO v_org FROM public.accounts WHERE id=p_account_id;
 IF v_org IS NULL THEN RAISE EXCEPTION 'Account not found' USING ERRCODE='22023'; END IF;
 RETURN private.product_access_snapshot(v_org);
END;
$$;

-- New unverified signups stay pending. Verification begins the clock exactly once.
CREATE OR REPLACE FUNCTION private.provision_organization_product_access()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_mode TEXT; v_row private.organization_product_access;
BEGIN
 SELECT CASE WHEN enforcement_enabled THEN 'trial' ELSE 'complimentary' END INTO v_mode
 FROM private.product_access_settings WHERE singleton;
 INSERT INTO private.organization_product_access(organization_id,mode)
 VALUES(NEW.id,v_mode) RETURNING * INTO v_row;
 INSERT INTO private.product_access_audit(organization_id,action,reason,after_state)
 VALUES(NEW.id,'created','Organization access provisioned',to_jsonb(v_row));
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS provision_organization_product_access ON public.organizations;
CREATE TRIGGER provision_organization_product_access AFTER INSERT ON public.organizations
 FOR EACH ROW EXECUTE FUNCTION private.provision_organization_product_access();
CREATE OR REPLACE FUNCTION private.start_verified_organization_trial(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_days INTEGER; v_row private.organization_product_access;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL) THEN RETURN; END IF;
 SELECT trial_days INTO v_days FROM private.product_access_settings WHERE singleton;
 FOR v_row IN SELECT a.* FROM private.organization_product_access a
 JOIN public.organization_memberships m ON m.organization_id=a.organization_id
 WHERE m.user_id=p_user_id AND m.role='owner' AND a.mode='trial' AND a.trial_started_at IS NULL
 FOR UPDATE OF a LOOP
 UPDATE private.organization_product_access SET trial_started_at=now(),trial_ends_at=now()+make_interval(days=>v_days),
 version=version+1,updated_at=now() WHERE organization_id=v_row.organization_id AND trial_started_at IS NULL;
 IF FOUND THEN
 INSERT INTO private.product_access_audit(organization_id,actor_user_id,action,reason,before_state,after_state)
 SELECT organization_id,p_user_id,'trial_started','Verified organization owner',to_jsonb(v_row),to_jsonb(a)
 FROM private.organization_product_access a WHERE organization_id=v_row.organization_id;
 END IF;
 END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION private.start_trial_on_owner_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.start_verified_organization_trial(NEW.user_id); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS start_trial_on_owner_membership ON public.organization_memberships;
CREATE TRIGGER start_trial_on_owner_membership AFTER INSERT ON public.organization_memberships
 FOR EACH ROW EXECUTE FUNCTION private.start_trial_on_owner_membership();
CREATE OR REPLACE FUNCTION private.start_trial_on_verification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.start_verified_organization_trial(NEW.id); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS start_trial_on_verification ON auth.users;
CREATE TRIGGER start_trial_on_verification AFTER UPDATE OF email_confirmed_at ON auth.users
 FOR EACH ROW WHEN(OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
 EXECUTE FUNCTION private.start_trial_on_verification();

CREATE OR REPLACE FUNCTION public.platform_admin_status()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('is_admin',EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=auth.uid()),
 'mfa_required',EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=auth.uid()) AND
 (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2');
$$;
CREATE OR REPLACE FUNCTION private.require_platform_admin()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=auth.uid())
 OR (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
 RAISE EXCEPTION 'Platform administrator access and MFA are required' USING ERRCODE='42501'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.platform_admin_organizations(p_search TEXT DEFAULT '',p_limit INTEGER DEFAULT 50,p_offset INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB;
BEGIN
 PERFORM private.require_platform_admin();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 OR length(p_search)>200 THEN
 RAISE EXCEPTION 'Invalid search or pagination' USING ERRCODE='22023'; END IF;
 WITH matches AS (
 SELECT o.id organization_id,o.name,to_jsonb(a) access,private.product_access_status(a) status,
 (SELECT u.email FROM public.organization_memberships m JOIN auth.users u ON u.id=m.user_id
 WHERE m.organization_id=o.id AND m.role='owner' ORDER BY m.created_at,m.user_id LIMIT 1) owner_email
 FROM public.organizations o JOIN private.organization_product_access a ON a.organization_id=o.id
 WHERE COALESCE(p_search,'')='' OR strpos(lower(o.name),lower(p_search))>0 OR EXISTS(
 SELECT 1 FROM public.organization_memberships m JOIN auth.users u ON u.id=m.user_id
 WHERE m.organization_id=o.id AND strpos(lower(u.email),lower(p_search))>0)
 ), page AS(SELECT * FROM matches ORDER BY name,organization_id LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),
 'total',(SELECT count(*) FROM matches)) INTO v_result;
 RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION public.platform_admin_update_access(p_organization_id UUID,p_action TEXT,
 p_ends_at TIMESTAMPTZ,p_reason TEXT,p_expected_version INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before private.organization_product_access; v_after private.organization_product_access;
BEGIN
 PERFORM private.require_platform_admin();
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
 RAISE EXCEPTION 'A reason of 3 to 1000 characters is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_before FROM private.organization_product_access WHERE organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE='22023'; END IF;
 IF p_expected_version IS DISTINCT FROM v_before.version THEN
 RAISE EXCEPTION 'Access changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 IF p_action IN ('extend_trial','activate') AND
 (p_ends_at IS NULL OR NOT isfinite(p_ends_at) OR p_ends_at<=now() OR p_ends_at>now()+interval '10 years') THEN
 RAISE EXCEPTION 'Choose a future expiry within ten years' USING ERRCODE='22023'; END IF;
 IF p_action='extend_trial' THEN
 IF v_before.mode<>'trial' OR v_before.suspended_at IS NOT NULL OR
 p_ends_at<=COALESCE(v_before.trial_ends_at,now()) THEN
 RAISE EXCEPTION 'Only an unsuspended trial can be extended beyond its current expiry' USING ERRCODE='22023'; END IF;
 UPDATE private.organization_product_access SET trial_started_at=COALESCE(trial_started_at,now()),trial_ends_at=p_ends_at WHERE organization_id=p_organization_id;
 ELSIF p_action='activate' THEN
 IF v_before.suspended_at IS NOT NULL THEN RAISE EXCEPTION 'Restore suspended access first' USING ERRCODE='22023'; END IF;
 UPDATE private.organization_product_access SET mode='manual',access_starts_at=now(),access_ends_at=p_ends_at WHERE organization_id=p_organization_id;
 ELSIF p_action='suspend' THEN
 IF v_before.suspended_at IS NOT NULL THEN RAISE EXCEPTION 'Access is already suspended' USING ERRCODE='22023'; END IF;
 UPDATE private.organization_product_access SET suspended_at=now() WHERE organization_id=p_organization_id;
 ELSIF p_action='restore' THEN
 IF v_before.suspended_at IS NULL THEN RAISE EXCEPTION 'Access is not suspended' USING ERRCODE='22023'; END IF;
 UPDATE private.organization_product_access SET suspended_at=NULL WHERE organization_id=p_organization_id;
 ELSE RAISE EXCEPTION 'Unknown access action' USING ERRCODE='22023'; END IF;
 UPDATE private.organization_product_access SET version=version+1,updated_at=now() WHERE organization_id=p_organization_id RETURNING * INTO v_after;
 INSERT INTO private.product_access_audit(organization_id,actor_user_id,action,reason,before_state,after_state)
 VALUES(p_organization_id,auth.uid(),p_action,btrim(p_reason),to_jsonb(v_before),to_jsonb(v_after));
 RETURN private.product_access_snapshot(p_organization_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.platform_admin_access_history(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.require_platform_admin();
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM (
 SELECT * FROM private.product_access_audit WHERE organization_id=p_organization_id ORDER BY created_at DESC,id DESC LIMIT 100
 ) e),'[]'::jsonb); END;
$$;
CREATE OR REPLACE FUNCTION public.product_access_request_support(p_account_id UUID,p_message TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org UUID; v_id UUID;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_account_membership(p_account_id) THEN
 RAISE EXCEPTION 'Account access required' USING ERRCODE='42501'; END IF;
 IF p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 2000 THEN
 RAISE EXCEPTION 'A message of 1 to 2000 characters is required' USING ERRCODE='22023'; END IF;
 SELECT organization_id INTO v_org FROM public.accounts WHERE id=p_account_id;
 INSERT INTO private.product_support_requests(organization_id,requested_by,message)
 VALUES(v_org,auth.uid(),btrim(p_message)) ON CONFLICT(organization_id,requested_by) WHERE status='open'
 DO UPDATE SET message=private.product_support_requests.message RETURNING id INTO v_id;
 RETURN v_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.platform_admin_support_requests(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.require_platform_admin();
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM (
 SELECT * FROM private.product_support_requests WHERE organization_id=p_organization_id ORDER BY created_at DESC LIMIT 100
 ) r),'[]'::jsonb); END;
$$;

-- Revoke PostgreSQL's default function EXECUTE grant, including internal trigger helpers.
DO $$ DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::regprocedure identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='private' AND p.proname IN ('product_access_status','organization_has_product_access',
 'account_has_product_access','has_product_account_membership','is_product_organization_owner','product_access_snapshot',
 'provision_organization_product_access','start_verified_organization_trial','start_trial_on_owner_membership',
 'start_trial_on_verification','require_platform_admin')) OR (n.nspname='public' AND p.proname IN
 ('product_access_for_account','platform_admin_status','platform_admin_organizations','platform_admin_update_access',
 'platform_admin_access_history','product_access_request_support','platform_admin_support_requests')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.identity);
 EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.identity);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.product_access_for_account(UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_status(),public.platform_admin_organizations(TEXT,INTEGER,INTEGER),
 public.platform_admin_update_access(UUID,TEXT,TIMESTAMPTZ,TEXT,INTEGER),public.platform_admin_access_history(UUID),
 public.product_access_request_support(UUID,TEXT),public.platform_admin_support_requests(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.organization_has_product_access(UUID),private.account_has_product_access(UUID),
 private.has_product_account_membership(UUID,public.account_role_enum),private.is_product_organization_owner(UUID) TO authenticated,service_role;

-- Keep identity-only membership predicates intact for recovery and branch discovery.
-- Operational definers use the composed predicates; preserve their existing bodies,
-- authorization ordering, return shapes, and grants rather than copying old versions.
DO $$ DECLARE f RECORD; v_sql TEXT; BEGIN
 FOR f IN SELECT p.oid,p.proname,pg_get_functiondef(p.oid) definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND p.proname NOT IN ('has_account_membership','is_organization_owner','my_branch_accounts',
 'record_branch_switch','redeem_invitation','product_access_for_account','product_access_request_support')
 AND (p.prosrc LIKE '%public.has_account_membership(%' OR p.prosrc LIKE '%public.is_organization_owner(%') LOOP
 v_sql:=replace(replace(f.definition,'public.has_account_membership(',
 'private.has_product_account_membership('),'public.is_organization_owner(',
 'private.is_product_organization_owner(');
 EXECUTE v_sql;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.authorized_selected_account_id(min_role public.account_role_enum DEFAULT 'viewer')
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.id FROM public.accounts a
 WHERE a.id=private.requested_account_id() AND a.branch_status<>'archived'
 AND public.has_account_membership(a.id,min_role) AND private.account_has_product_access(a.id);
$$;
REVOKE ALL ON FUNCTION private.authorized_selected_account_id(public.account_role_enum) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.authorized_selected_account_id(public.account_role_enum) TO authenticated,service_role;

-- Bootstrap metadata is still readable even when operational access has expired.
DROP POLICY IF EXISTS accounts_select ON public.accounts;
CREATE POLICY accounts_select ON public.accounts FOR SELECT TO authenticated
 USING(id=private.requested_account_id() AND public.has_account_membership(id) AND branch_status<>'archived');
DROP POLICY IF EXISTS account_memberships_select ON public.account_memberships;
CREATE POLICY account_memberships_select ON public.account_memberships FOR SELECT TO authenticated
 USING(user_id=auth.uid() OR public.is_account_member(account_id));

-- Restrictive policies compose with every existing permissive policy. Indirect
-- child rows continue to use their existing parent-scoped RLS rules.
DO $$ DECLARE t RECORD; BEGIN
 FOR t IN SELECT c.table_name FROM information_schema.columns c
 JOIN pg_class pc ON pc.relname=c.table_name JOIN pg_namespace pn ON pn.oid=pc.relnamespace
 WHERE c.table_schema='public' AND pn.nspname='public' AND pc.relkind='r'
 AND c.column_name='account_id' AND c.data_type='uuid'
 AND c.table_name NOT IN ('profiles','account_memberships') LOOP
 EXECUTE format('DROP POLICY IF EXISTS product_access_required ON public.%I',t.table_name);
 EXECUTE format('CREATE POLICY product_access_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(private.account_has_product_access(account_id)) WITH CHECK(private.account_has_product_access(account_id))',t.table_name);
 END LOOP;
 FOR t IN SELECT c.table_name FROM information_schema.columns c
 JOIN pg_class pc ON pc.relname=c.table_name JOIN pg_namespace pn ON pn.oid=pc.relnamespace
 WHERE c.table_schema='public' AND pn.nspname='public' AND pc.relkind='r'
 AND c.column_name='organization_id' AND c.data_type='uuid'
 AND c.table_name NOT IN ('accounts','organization_memberships') LOOP
 EXECUTE format('DROP POLICY IF EXISTS product_organization_access_required ON public.%I',t.table_name);
 EXECUTE format('CREATE POLICY product_organization_access_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(private.organization_has_product_access(organization_id)) WITH CHECK(private.organization_has_product_access(organization_id))',t.table_name);
 END LOOP;
END $$;
DROP POLICY IF EXISTS product_account_insert ON public.accounts;
CREATE POLICY product_account_insert ON public.accounts AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(private.organization_has_product_access(organization_id));
DROP POLICY IF EXISTS product_account_update ON public.accounts;
CREATE POLICY product_account_update ON public.accounts AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(private.organization_has_product_access(organization_id)) WITH CHECK(private.organization_has_product_access(organization_id));
DROP POLICY IF EXISTS product_account_delete ON public.accounts;
CREATE POLICY product_account_delete ON public.accounts AS RESTRICTIVE FOR DELETE TO authenticated
 USING(private.organization_has_product_access(organization_id));

CREATE OR REPLACE FUNCTION private.can_receive_mobile_inbox_topic(target_topic TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.user_id=auth.uid()
 AND target_topic='account:'||m.account_id::text AND private.account_has_product_access(m.account_id));
$$;
REVOKE ALL ON FUNCTION private.can_receive_mobile_inbox_topic(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.can_receive_mobile_inbox_topic(TEXT) TO authenticated,service_role;

-- Already-authorized realtime sockets may outlive a trial; suppress publishing as
-- well as subscription admission. Inbound rows still commit normally.
DO $$ DECLARE f RECORD; v_sql TEXT; BEGIN
 FOR f IN SELECT p.oid,p.proname,pg_get_functiondef(p.oid) definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN ('broadcast_mobile_inbox_change','broadcast_mobile_inbox_reaction_change') LOOP
 v_sql:=replace(f.definition,'IF target_account_id IS NOT NULL THEN',
 'IF target_account_id IS NOT NULL AND private.account_has_product_access(target_account_id) THEN');
 IF v_sql=f.definition AND strpos(f.definition,'IF target_account_id IS NOT NULL AND private.account_has_product_access(target_account_id) THEN')=0 THEN
 RAISE EXCEPTION 'Realtime publisher shape changed: %',f.proname; END IF;
 EXECUTE v_sql;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
