-- Keep Razorpay operator health strictly scoped to the stored provider mode and
-- merchant identity. Pre-OAuth legacy events intentionally retain NULL mode and
-- identity facts and must not contaminate a reviewed Test or Live connection.

CREATE OR REPLACE VIEW public.razorpay_missing_payment_ledger
WITH (security_invoker = true)
AS
SELECT
  we.id AS event_id,
  we.account_id,
  we.payload #>> '{payload,payment,entity,id}' AS gateway_payment_id,
  we.payload #>> '{payload,subscription,entity,notes,membership_id}'
    AS membership_id,
  we.processing_status,
  we.attempt_count,
  we.last_error,
  we.created_at,
  we.last_attempt_at,
  we.processed_at,
  we.provider_mode,
  we.external_account_id
FROM public.webhook_events AS we
LEFT JOIN public.payments AS payment
  ON payment.account_id = we.account_id
 AND payment.gateway_payment_id =
   we.payload #>> '{payload,payment,entity,id}'
WHERE we.gateway = 'razorpay'
  AND we.type = 'subscription.charged'
  AND we.payload #>> '{payload,payment,entity,id}' IS NOT NULL
  AND payment.id IS NULL;

REVOKE ALL ON public.razorpay_missing_payment_ledger
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.razorpay_missing_payment_ledger TO service_role;

COMMENT ON VIEW public.razorpay_missing_payment_ledger IS
  'Service-only mode- and merchant-scoped diagnostics for Razorpay charged webhook events with no matching payments.gateway_payment_id. Read-only; never replays or reconciles.';
