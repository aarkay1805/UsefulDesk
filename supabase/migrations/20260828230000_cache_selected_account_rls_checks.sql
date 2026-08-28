-- Cache the selected-account authorization context for the All-members listing
-- dependency path. Each policy still compares its row's tenant key explicitly;
-- only the request/user/membership/branch lookup is moved into an initPlan.
--
-- Do not replace is_account_member(account_id) mechanically elsewhere. This
-- helper is safe to wrap in SELECT only because it has no current-row input.

CREATE OR REPLACE FUNCTION private.authorized_selected_account_id(
  min_role public.account_role_enum DEFAULT 'viewer'
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_account_id UUID := private.requested_account_id();
  v_user_id UUID := auth.uid();
BEGIN
  IF v_account_id IS NULL OR v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.account_memberships AS membership
    JOIN public.accounts AS account
      ON account.id = membership.account_id
    WHERE membership.account_id = v_account_id
      AND membership.user_id = v_user_id
      AND account.branch_status <> 'archived'
      AND CASE membership.role
            WHEN 'owner' THEN 4
            WHEN 'admin' THEN 3
            WHEN 'agent' THEN 2
            WHEN 'viewer' THEN 1
          END
          >=
          CASE min_role
            WHEN 'owner' THEN 4
            WHEN 'admin' THEN 3
            WHEN 'agent' THEN 2
            WHEN 'viewer' THEN 1
          END
  ) THEN
    RETURN v_account_id;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION private.authorized_selected_account_id(
  public.account_role_enum
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.authorized_selected_account_id(
  public.account_role_enum
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.authorized_selected_account_id(
  public.account_role_enum
) TO authenticated, service_role;

COMMENT ON FUNCTION private.authorized_selected_account_id(
  public.account_role_enum
) IS 'Returns the active selected account only when auth.uid() has the requested minimum branch role; row-independent so RLS policies may cache it through an initPlan.';

DROP POLICY IF EXISTS accounts_select ON public.accounts;
CREATE POLICY accounts_select ON public.accounts
  FOR SELECT
  USING (id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts
  FOR SELECT
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS memberships_select ON public.memberships;
CREATE POLICY memberships_select ON public.memberships
  FOR SELECT
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS membership_plans_select ON public.membership_plans;
CREATE POLICY membership_plans_select ON public.membership_plans
  FOR SELECT
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS member_services_select ON public.member_services;
CREATE POLICY member_services_select ON public.member_services
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS invoice_lines_select ON public.invoice_lines;
CREATE POLICY invoice_lines_select ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments
  FOR SELECT
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS payment_allocations_select ON public.payment_allocations;
CREATE POLICY payment_allocations_select ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS invoice_credit_allocations_select
  ON public.invoice_credit_allocations;
CREATE POLICY invoice_credit_allocations_select
  ON public.invoice_credit_allocations
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS payment_refunds_select ON public.payment_refunds;
CREATE POLICY payment_refunds_select ON public.payment_refunds
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS payment_refund_allocations_select
  ON public.payment_refund_allocations;
CREATE POLICY payment_refund_allocations_select
  ON public.payment_refund_allocations
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS invoice_adjustments_select ON public.invoice_adjustments;
CREATE POLICY invoice_adjustments_select ON public.invoice_adjustments
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS invoice_adjustment_allocations_select
  ON public.invoice_adjustment_allocations;
CREATE POLICY invoice_adjustment_allocations_select
  ON public.invoice_adjustment_allocations
  FOR SELECT TO authenticated
  USING (account_id = (SELECT private.authorized_selected_account_id()));

DROP POLICY IF EXISTS follow_ups_select ON public.follow_ups;
CREATE POLICY follow_ups_select ON public.follow_ups
  FOR SELECT
  USING (account_id = (SELECT private.authorized_selected_account_id()));
