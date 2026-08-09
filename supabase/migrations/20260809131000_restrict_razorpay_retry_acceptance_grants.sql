-- Fresh Supabase projects may grant broad service_role table privileges by
-- default. Keep the Test retry-acceptance audit writable only in the ways its
-- SECURITY INVOKER RPCs and completion trigger require.

REVOKE ALL ON public.razorpay_webhook_retry_acceptances FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.razorpay_webhook_retry_acceptances
  TO service_role;
