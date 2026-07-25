-- ============================================================
-- Block direct tenant / role changes on profiles.
--
-- profiles_update intentionally lets a user edit their own personal
-- fields. Its row-level WITH CHECK cannot also freeze account_id or
-- account_role, so an authenticated Data API caller could previously
-- move their profile to another readable account or self-promote.
--
-- Legitimate membership changes already use the audited SECURITY
-- DEFINER functions from migrations 017-019 and 049:
--   handle_new_user, set_member_role, remove_account_member,
--   transfer_account_ownership, and redeem_invitation.
-- Those functions execute as postgres and continue through this
-- guard; ordinary Data API updates execute as authenticated and fail.
-- Service-role onboarding / administration is also preserved.
--
-- Idempotent: the function is replaced and the trigger is recreated.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_profile_membership_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND (
       NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.account_role IS DISTINCT FROM OLD.account_role
     ) THEN
    RAISE EXCEPTION 'Profile account and role changes require an approved membership operation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_profile_membership_fields() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_profile_membership_fields() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_profile_membership_fields() FROM anon;
REVOKE ALL ON FUNCTION public.protect_profile_membership_fields() FROM authenticated;

DROP TRIGGER IF EXISTS protect_profile_membership_fields ON public.profiles;
CREATE TRIGGER protect_profile_membership_fields
  BEFORE UPDATE OF account_id, account_role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_membership_fields();
