-- Defense in depth for environments where the containment function bodies
-- were applied separately from their final privilege statements.

REVOKE ALL ON FUNCTION public.record_razorpay_mandate_provider_status(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_mandate(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_razorpay_oauth_authorization_revoked(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_razorpay_oauth_disconnect(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(TEXT, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_razorpay_mandate_provider_status(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_mandate(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_razorpay_oauth_authorization_revoked(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_razorpay_oauth_disconnect(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(TEXT, UUID, INTEGER, INTEGER)
  TO service_role;
