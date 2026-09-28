-- Disposable local schema slice for SQL acceptance. No production data or URLs.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE TYPE public.account_role_enum AS ENUM ('owner','admin','agent','viewer');
CREATE TYPE public.organization_role_enum AS ENUM ('owner');
CREATE TYPE public.branch_status_enum AS ENUM ('active','read_only','archived');
CREATE TYPE public.branch_readiness_enum AS ENUM ('setup','ready','attention');
CREATE TABLE public.organizations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL
);
CREATE TABLE public.accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL,
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 branch_status public.branch_status_enum NOT NULL DEFAULT 'active',
 readiness_state public.branch_readiness_enum NOT NULL DEFAULT 'setup',
 archived_at TIMESTAMPTZ,
 setup_reviewed_at TIMESTAMPTZ,
 setup_reviewed_by UUID,
 default_currency TEXT NOT NULL DEFAULT 'INR',
 timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'
);
CREATE TABLE public.organization_memberships (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 user_id UUID NOT NULL REFERENCES auth.users(id),
 role public.organization_role_enum NOT NULL DEFAULT 'owner',
 PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE public.account_memberships (
 account_id UUID NOT NULL REFERENCES public.accounts(id),
 user_id UUID NOT NULL REFERENCES auth.users(id),
 role public.account_role_enum NOT NULL,
 PRIMARY KEY(account_id,user_id)
);
CREATE TABLE public.organization_audit_log (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 account_id UUID REFERENCES public.accounts(id),
 actor_user_id UUID REFERENCES auth.users(id),
 operation TEXT NOT NULL,
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE private.organization_product_access (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id),
 mode TEXT NOT NULL CHECK (mode IN ('trial','manual','complimentary')),
 trial_started_at TIMESTAMPTZ,
 trial_ends_at TIMESTAMPTZ,
 access_starts_at TIMESTAMPTZ,
 access_ends_at TIMESTAMPTZ,
 suspended_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE private.product_access_audit (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL,
 actor_user_id UUID,
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 before_state JSONB,
 after_state JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.is_organization_owner(target_organization_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.organization_memberships
  WHERE organization_id=target_organization_id AND user_id=auth.uid() AND role='owner');
$$;
CREATE OR REPLACE FUNCTION public.has_account_membership(
 target_account_id UUID,min_role public.account_role_enum DEFAULT 'viewer')
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.account_memberships
  WHERE account_id=target_account_id AND user_id=auth.uid()
    AND CASE role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END
    >= CASE min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END);
$$;
CREATE TABLE IF NOT EXISTS private.product_access_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trial_days INTEGER NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 1 AND 90),
  support_email TEXT,
  support_whatsapp TEXT CHECK (support_whatsapp IS NULL OR support_whatsapp ~ '^[1-9][0-9]{7,14}$')
);
INSERT INTO private.product_access_settings(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;
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
