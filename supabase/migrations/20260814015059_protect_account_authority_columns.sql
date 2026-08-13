-- Account RLS decides which branch row an admin may edit. Column privileges
-- and this trigger independently ensure browser/Data API roles cannot rewrite
-- authority-bearing fields outside the audited lifecycle RPCs.

REVOKE UPDATE ON TABLE public.accounts FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (
  owner_user_id,
  organization_id,
  legal_entity_id
) ON TABLE public.accounts
  FROM PUBLIC, anon, authenticated;

-- Keep ordinary branch settings editable by authenticated admins through the
-- existing accounts_update row policy. Authority, lifecycle, readiness, and
-- integration credentials remain function-only or backend-only.
GRANT UPDATE (
  name,
  default_currency,
  upi_vpa,
  upi_payee_name,
  country_code,
  locale,
  timezone,
  date_order,
  time_format,
  week_start,
  phone_country_code,
  measurement_system,
  onboarding_dismissed_at
) ON TABLE public.accounts TO authenticated;

CREATE OR REPLACE FUNCTION private.protect_account_authority_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (
       NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
     ) THEN
    RAISE EXCEPTION
      'Account authority columns may only change through an authorized lifecycle operation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.protect_account_authority_columns() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.protect_account_authority_columns()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_accounts_protect_authority_columns
  ON public.accounts;
CREATE TRIGGER trg_accounts_protect_authority_columns
  BEFORE UPDATE OF owner_user_id, organization_id, legal_entity_id
  ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_account_authority_columns();
