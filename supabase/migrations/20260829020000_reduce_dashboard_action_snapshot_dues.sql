-- Evaluate current membership-period balances once for dashboard dues.
--
-- The general membership_dues view previously let PostgreSQL parameterize the
-- membership_period_invoices expansion under each membership. At current
-- production scale that rebuilt invoice_line_balances 281 times. Materializing
-- the period projection keeps the exact view contract while doing the ledger
-- aggregation once. The selected-account policy remains row-scoped and RLS
-- authoritative; only its row-independent authorization lookup becomes an
-- initPlan, matching the existing hot read policies.

DROP POLICY IF EXISTS membership_periods_select
  ON public.membership_periods;
CREATE POLICY membership_periods_select ON public.membership_periods
  FOR SELECT
  USING (
    account_id = (SELECT private.authorized_selected_account_id())
  );

CREATE OR REPLACE VIEW public.membership_dues
WITH (security_invoker = true) AS
WITH current_periods AS MATERIALIZED (
  SELECT
    period.membership_id,
    period.period_end,
    period.amount_paid,
    period.collectible_balance,
    period.accounting_balance,
    period.requires_refund_review
  FROM public.membership_period_invoices AS period
)
SELECT
  membership.id AS membership_id,
  membership.account_id,
  membership.contact_id,
  membership.plan_id,
  membership.start_date,
  membership.end_date,
  membership.status,
  membership.fee_status,
  membership.fee_amount,
  COALESCE(current_period.amount_paid, 0)::NUMERIC(12, 2)
    AS collected_current,
  COALESCE(
    current_period.collectible_balance,
    membership.fee_amount
  )::NUMERIC(12, 2) AS balance,
  COALESCE(
    current_period.accounting_balance,
    membership.fee_amount
  )::NUMERIC(12, 2) AS accounting_balance,
  COALESCE(current_period.requires_refund_review, FALSE)
    AS requires_refund_review
FROM public.memberships AS membership
LEFT JOIN current_periods AS current_period
  ON current_period.membership_id = membership.id
 AND current_period.period_end = membership.end_date
WHERE membership.status <> 'cancelled';

ALTER VIEW public.membership_dues OWNER TO postgres;
REVOKE ALL ON public.membership_dues FROM anon;
GRANT SELECT ON public.membership_dues TO authenticated, service_role;
