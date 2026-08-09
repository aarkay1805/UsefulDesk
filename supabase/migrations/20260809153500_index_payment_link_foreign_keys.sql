-- Cover Stage 3 foreign keys used by operator exception and link lookups.
CREATE INDEX IF NOT EXISTS idx_razorpay_payment_links_created_by
  ON public.razorpay_payment_links(created_by);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_invoice
  ON public.gateway_payment_exceptions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_payment_link
  ON public.gateway_payment_exceptions(payment_link_id);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_webhook_event
  ON public.gateway_payment_exceptions(webhook_event_id);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_resolved_by
  ON public.gateway_payment_exceptions(resolved_by);
