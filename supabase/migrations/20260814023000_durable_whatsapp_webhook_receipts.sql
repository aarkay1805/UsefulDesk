-- Meta stops retrying after a 2xx response, so verified WhatsApp webhook
-- payloads must cross this service-only durable boundary before the route
-- acknowledges them. Byte-identical retries share one SHA-256 claim.

CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_receipts (
  body_sha256 TEXT PRIMARY KEY,
  payload JSONB,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_attempt_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.whatsapp_webhook_receipts
  DROP CONSTRAINT IF EXISTS whatsapp_webhook_receipts_hash_check;
ALTER TABLE public.whatsapp_webhook_receipts
  ADD CONSTRAINT whatsapp_webhook_receipts_hash_check
  CHECK (body_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE public.whatsapp_webhook_receipts
  DROP CONSTRAINT IF EXISTS whatsapp_webhook_receipts_status_check;
ALTER TABLE public.whatsapp_webhook_receipts
  ADD CONSTRAINT whatsapp_webhook_receipts_status_check
  CHECK (processing_status IN ('pending', 'processing', 'processed', 'failed'));

ALTER TABLE public.whatsapp_webhook_receipts
  DROP CONSTRAINT IF EXISTS whatsapp_webhook_receipts_attempt_count_check;
ALTER TABLE public.whatsapp_webhook_receipts
  ADD CONSTRAINT whatsapp_webhook_receipts_attempt_count_check
  CHECK (attempt_count >= 0);

ALTER TABLE public.whatsapp_webhook_receipts
  DROP CONSTRAINT IF EXISTS whatsapp_webhook_receipts_payload_state_check;
ALTER TABLE public.whatsapp_webhook_receipts
  ADD CONSTRAINT whatsapp_webhook_receipts_payload_state_check
  CHECK (
    (
      processing_status = 'processed'
      AND payload IS NULL
      AND processed_at IS NOT NULL
    )
    OR (
      processing_status <> 'processed'
      AND payload IS NOT NULL
      AND jsonb_typeof(payload) = 'object'
      AND processed_at IS NULL
    )
  );

ALTER TABLE public.whatsapp_webhook_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_webhook_receipts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_webhook_receipts
  TO service_role;

CREATE INDEX IF NOT EXISTS whatsapp_webhook_receipts_recovery_idx
  ON public.whatsapp_webhook_receipts (
    processing_status,
    next_attempt_at,
    received_at
  )
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.record_whatsapp_webhook_receipt(
  p_body_sha256 TEXT,
  p_payload JSONB
)
RETURNS TABLE(receipt_id TEXT, receipt_status TEXT)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH inserted AS (
    INSERT INTO public.whatsapp_webhook_receipts (
      body_sha256,
      payload
    )
    VALUES (
      p_body_sha256,
      p_payload
    )
    ON CONFLICT (body_sha256) DO NOTHING
    RETURNING body_sha256, processing_status
  )
  SELECT inserted.body_sha256, inserted.processing_status
  FROM inserted
  UNION ALL
  SELECT receipt.body_sha256, receipt.processing_status
  FROM public.whatsapp_webhook_receipts AS receipt
  WHERE receipt.body_sha256 = p_body_sha256
    AND NOT EXISTS (SELECT 1 FROM inserted)
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_webhook_receipts(
  p_limit INTEGER DEFAULT 5,
  p_receipt_id TEXT DEFAULT NULL,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(
  receipt_id TEXT,
  payload JSONB,
  attempt_count INTEGER,
  received_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH candidates AS (
    SELECT receipt.body_sha256
    FROM public.whatsapp_webhook_receipts AS receipt
    WHERE receipt.processed_at IS NULL
      AND receipt.payload IS NOT NULL
      AND (p_receipt_id IS NULL OR receipt.body_sha256 = p_receipt_id)
      AND (
        receipt.processing_status = 'pending'
        OR (
          receipt.processing_status = 'failed'
          AND (
            receipt.next_attempt_at IS NULL
            OR receipt.next_attempt_at <= clock_timestamp()
          )
        )
        OR (
          receipt.processing_status = 'processing'
          AND (
            receipt.processing_started_at IS NULL
            OR receipt.processing_started_at
              < clock_timestamp()
                - make_interval(
                    secs => LEAST(GREATEST(p_lease_seconds, 30), 300)
                  )
          )
        )
      )
    ORDER BY receipt.received_at, receipt.body_sha256
    LIMIT LEAST(GREATEST(p_limit, 1), 25)
    FOR UPDATE OF receipt SKIP LOCKED
  ), claimed AS (
    UPDATE public.whatsapp_webhook_receipts AS receipt
    SET processing_status = 'processing',
        attempt_count = receipt.attempt_count + 1,
        last_attempt_at = clock_timestamp(),
        processing_started_at = clock_timestamp(),
        next_attempt_at = NULL,
        last_error = NULL,
        updated_at = clock_timestamp()
    FROM candidates
    WHERE receipt.body_sha256 = candidates.body_sha256
    RETURNING receipt.*
  )
  SELECT
    claimed.body_sha256,
    claimed.payload,
    claimed.attempt_count,
    claimed.received_at
  FROM claimed
  ORDER BY claimed.received_at, claimed.body_sha256;
$function$;

CREATE OR REPLACE FUNCTION public.complete_whatsapp_webhook_receipt(
  p_body_sha256 TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  UPDATE public.whatsapp_webhook_receipts
  SET processing_status = 'processed',
      payload = NULL,
      processed_at = clock_timestamp(),
      processing_started_at = NULL,
      next_attempt_at = NULL,
      last_error = NULL,
      updated_at = clock_timestamp()
  WHERE body_sha256 = p_body_sha256
    AND processing_status = 'processing'
    AND processed_at IS NULL
  RETURNING TRUE;
$function$;

CREATE OR REPLACE FUNCTION public.fail_whatsapp_webhook_receipt(
  p_body_sha256 TEXT,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  UPDATE public.whatsapp_webhook_receipts
  SET processing_status = 'failed',
      processing_started_at = NULL,
      next_attempt_at = clock_timestamp() + INTERVAL '5 minutes',
      last_error = LEFT(p_error, 4000),
      updated_at = clock_timestamp()
  WHERE body_sha256 = p_body_sha256
    AND processing_status = 'processing'
    AND processed_at IS NULL
  RETURNING TRUE;
$function$;

REVOKE ALL ON FUNCTION public.record_whatsapp_webhook_receipt(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_whatsapp_webhook_receipts(INTEGER, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_whatsapp_webhook_receipt(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_whatsapp_webhook_receipt(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_whatsapp_webhook_receipt(TEXT, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_webhook_receipts(INTEGER, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_webhook_receipt(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_whatsapp_webhook_receipt(TEXT, TEXT)
  TO service_role;

COMMENT ON TABLE public.whatsapp_webhook_receipts IS
  'Service-only durable WhatsApp webhook receipts; payload is erased after successful processing.';
