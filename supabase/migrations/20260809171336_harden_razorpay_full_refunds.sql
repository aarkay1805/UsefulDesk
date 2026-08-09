-- Make the deliberate service-only boundary visible to the database linter.
-- service_role bypasses RLS; every browser role is denied even if a grant is
-- accidentally introduced later.
DROP POLICY IF EXISTS gateway_refund_exceptions_service_only
  ON public.gateway_refund_exceptions;
CREATE POLICY gateway_refund_exceptions_service_only
  ON public.gateway_refund_exceptions FOR ALL TO PUBLIC
  USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS razorpay_reconciliation_state_service_only
  ON public.razorpay_reconciliation_state;
CREATE POLICY razorpay_reconciliation_state_service_only
  ON public.razorpay_reconciliation_state FOR ALL TO PUBLIC
  USING (FALSE) WITH CHECK (FALSE);

CREATE INDEX IF NOT EXISTS payment_refund_allocations_account_idx
  ON public.payment_refund_allocations(account_id);
CREATE INDEX IF NOT EXISTS invoice_adjustment_allocations_account_idx
  ON public.invoice_adjustment_allocations(account_id);
CREATE INDEX IF NOT EXISTS gateway_refund_exceptions_refund_idx
  ON public.gateway_refund_exceptions(refund_id) WHERE refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gateway_refund_exceptions_resolved_by_idx
  ON public.gateway_refund_exceptions(resolved_by) WHERE resolved_by IS NOT NULL;
