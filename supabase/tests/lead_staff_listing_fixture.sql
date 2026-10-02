-- Disposable local database only. Deliberately models profiles whose legacy
-- home branch differs from the selected account_memberships branch.
CREATE TYPE public.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');
CREATE TABLE public.profiles (user_id UUID PRIMARY KEY, account_id UUID, full_name TEXT, email TEXT, avatar_url TEXT);
CREATE TABLE public.account_memberships (account_id UUID, user_id UUID, role public.account_role_enum, created_at TIMESTAMPTZ, PRIMARY KEY (account_id, user_id));
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY, account_id UUID, user_id UUID, created_by UUID,
  assigned_to UUID, pending_invitation_id UUID, name TEXT, phone TEXT,
  email TEXT, company TEXT, source TEXT, gender TEXT, received_via TEXT,
  lead_status TEXT, created_at TIMESTAMPTZ
);
CREATE TABLE public.memberships (account_id UUID, contact_id UUID);
CREATE TABLE public.member_services (account_id UUID, contact_id UUID);
CREATE TABLE public.follow_ups (account_id UUID, contact_id UUID, status TEXT);
CREATE TABLE public.tags (id UUID, account_id UUID, name TEXT);
CREATE TABLE public.contact_tags (contact_id UUID, tag_id UUID);
CREATE TABLE public.custom_fields (id UUID, account_id UUID, field_type TEXT);
CREATE TABLE public.contact_custom_values (contact_id UUID, custom_field_id UUID, value TEXT);

CREATE FUNCTION public.is_account_member(target_account_id UUID, min_role public.account_role_enum DEFAULT 'viewer')
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT target_account_id = current_setting('test.selected_account')::UUID
    AND EXISTS (SELECT 1 FROM public.account_memberships m
      WHERE m.account_id = target_account_id AND m.user_id = auth.uid())
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON public.profiles FOR SELECT
  USING (user_id = auth.uid() OR public.is_account_member(account_id));
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_select ON public.contacts FOR SELECT
  USING (public.is_account_member(account_id));
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

INSERT INTO public.profiles VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'Zara', NULL, '/zara.webp'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000010', 'Asha', NULL, '/asha.webp');
INSERT INTO public.account_memberships VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001', 'owner', now()),
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000002', 'agent', now());
INSERT INTO public.contacts (id, account_id, user_id, created_by, assigned_to, name, phone, received_via, created_at) VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Newest enquiry', '+919876543211', 'manual', '2026-09-29'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'Older enquiry', '+919876543212', 'import', '2026-09-28');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SELECT set_config('test.selected_account', '00000000-0000-4000-8000-000000000020', true);
