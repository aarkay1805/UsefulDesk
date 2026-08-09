-- Razorpay application-webhook dual-ingress observation ledger.
-- This relation is service-only and never owns financial processing state.

CREATE TABLE IF NOT EXISTS public.razorpay_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_mode TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_identity_source TEXT NOT NULL,
  ingress TEXT NOT NULL,
  external_account_id TEXT,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  signature_secret_generation TEXT NOT NULL,
  shadow_only BOOLEAN NOT NULL,
  canonical_mutation_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT razorpay_webhook_deliveries_mode_check
    CHECK (provider_mode IN ('test', 'live')),
  CONSTRAINT razorpay_webhook_deliveries_identity_source_check
    CHECK (event_identity_source IN ('header', 'payload_hash_fallback')),
  CONSTRAINT razorpay_webhook_deliveries_ingress_check
    CHECK (ingress IN ('legacy_account', 'application')),
  CONSTRAINT razorpay_webhook_deliveries_signature_generation_check
    CHECK (signature_secret_generation IN ('account', 'current', 'previous')),
  CONSTRAINT razorpay_webhook_deliveries_payload_hash_check
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT razorpay_webhook_deliveries_shadow_no_mutation_check
    CHECK (NOT shadow_only OR NOT canonical_mutation_attempted),
  CONSTRAINT razorpay_webhook_deliveries_identity_unique
    UNIQUE (provider_mode, provider_event_id, ingress)
);

ALTER TABLE public.razorpay_webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_webhook_deliveries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.razorpay_webhook_deliveries TO service_role;

CREATE INDEX IF NOT EXISTS razorpay_webhook_deliveries_account_received_idx
  ON public.razorpay_webhook_deliveries (account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS razorpay_webhook_deliveries_external_received_idx
  ON public.razorpay_webhook_deliveries
    (provider_mode, external_account_id, received_at DESC);

CREATE OR REPLACE VIEW public.razorpay_webhook_delivery_parity
WITH (security_invoker = true)
AS
SELECT
  provider_mode,
  provider_event_id,
  (ARRAY_AGG(account_id) FILTER (WHERE ingress = 'legacy_account'))[1]
    AS legacy_account_id,
  (ARRAY_AGG(account_id) FILTER (WHERE ingress = 'application'))[1]
    AS application_account_id,
  MAX(event_type) FILTER (WHERE ingress = 'legacy_account') AS legacy_event_type,
  MAX(event_type) FILTER (WHERE ingress = 'application') AS application_event_type,
  MAX(payload_sha256) FILTER (WHERE ingress = 'legacy_account') AS legacy_payload_sha256,
  MAX(payload_sha256) FILTER (WHERE ingress = 'application') AS application_payload_sha256,
  MIN(received_at) FILTER (WHERE ingress = 'legacy_account') AS legacy_received_at,
  MIN(received_at) FILTER (WHERE ingress = 'application') AS application_received_at,
  COUNT(*) FILTER (WHERE ingress = 'legacy_account') AS legacy_deliveries,
  COUNT(*) FILTER (WHERE ingress = 'application') AS application_deliveries,
  BOOL_OR(canonical_mutation_attempted AND shadow_only)
    AS shadow_mutation_attempted
FROM public.razorpay_webhook_deliveries
GROUP BY provider_mode, provider_event_id;

REVOKE ALL ON public.razorpay_webhook_delivery_parity
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.razorpay_webhook_delivery_parity TO service_role;

COMMENT ON TABLE public.razorpay_webhook_deliveries IS
  'Service-only immutable Razorpay webhook ingress observations. Never authorizes or records canonical financial processing.';
COMMENT ON VIEW public.razorpay_webhook_delivery_parity IS
  'Service-only dual-ingress comparison surface used before Razorpay application-webhook cutover.';
