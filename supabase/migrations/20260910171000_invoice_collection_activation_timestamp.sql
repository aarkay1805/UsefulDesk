-- Preserve the exact opt-in boundary. A date alone could accidentally include
-- an invoice created earlier on the day collection was enabled.
ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS invoice_collection_activated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.set_invoice_collection_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_timezone TEXT;
BEGIN
  IF NEW.invoice_collection_enabled
     AND NOT COALESCE(OLD.invoice_collection_enabled, FALSE) THEN
    SELECT timezone INTO v_timezone FROM public.accounts WHERE id = NEW.account_id;
    NEW.invoice_collection_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.invoice_collection_activated_at := NOW();
    NEW.invoice_collection_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
