-- Profiles are projections of audited account membership, not a client-created
-- authority record. Signup provisions them atomically through handle_new_user(),
-- and invitation/member lifecycle functions mutate existing rows as postgres.
-- No browser or anonymous flow has a legitimate profile INSERT path.

DROP POLICY IF EXISTS profiles_insert ON public.profiles;

-- RLS now fails closed because no INSERT policy remains. Revoke the table-level
-- capability as defense in depth while preserving postgres-owned provisioning
-- and the existing service_role grant used by trusted backend administration.
REVOKE INSERT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
