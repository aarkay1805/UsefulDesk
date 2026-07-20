-- Supabase grants new public-schema functions to API roles explicitly.
-- These trigger-only functions must not be exposed through PostgREST.
REVOKE ALL ON FUNCTION public.assign_membership_member_number()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.protect_membership_member_number()
  FROM PUBLIC, anon, authenticated;
