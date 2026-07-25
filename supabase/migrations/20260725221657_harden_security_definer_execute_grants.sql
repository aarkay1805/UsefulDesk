-- ============================================================
-- Harden SECURITY DEFINER execution grants.
--
-- Supabase's legacy default privileges granted every new public
-- function to anon/authenticated/service_role, while Postgres grants
-- EXECUTE to PUBLIC by default.  SECURITY DEFINER functions therefore
-- became Data API RPCs unless each migration remembered to revoke them.
--
-- This migration:
--   1. stops PUBLIC/anon/authenticated grants on future postgres-owned
--      functions in public;
--   2. removes those client grants from every current public
--      SECURITY DEFINER function;
--   3. restores only audited caller-facing RPCs; and
--   4. explicitly preserves the service-role-only AI/webhook helpers.
--
-- Trigger functions need no direct EXECUTE grant at runtime.  The
-- service_role default is retained for compatibility with trusted
-- backend code; client-facing roles are opt-in from here onward.
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function
    );
  END LOOP;
END;
$$;

-- Anonymous/token-backed reads.  Both functions validate the opaque
-- token internally and return a deliberately fixed response shape.
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peek_lead_capture_form(TEXT)
  TO anon, authenticated;

-- Signed-in RPCs whose bodies validate auth.uid(), account membership,
-- and (where applicable) the caller's minimum role before mutation.
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, account_role_enum)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_lead_assignment(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_lead_transfer(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_lead_assignment(UUID, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_lead_transfer(UUID, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_lead_assignment(UUID, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_lead_transfer(UUID, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_presence(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense(
  DATE, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_expense(UUID, TEXT)
  TO authenticated;

-- Trusted backend paths.  These functions intentionally bypass RLS for
-- atomicity/account-scoped retrieval and are never browser-callable.
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(UUID, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(UUID, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(UUID, INTEGER)
  TO service_role;
