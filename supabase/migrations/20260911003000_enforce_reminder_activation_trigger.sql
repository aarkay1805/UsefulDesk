-- Run the system-managed activation guard for direct updates too, not only
-- toggle updates. This prevents a client from moving the no-backfill boundary.
DROP TRIGGER IF EXISTS trg_invoice_collection_activation
  ON public.renewal_reminder_settings;
CREATE TRIGGER trg_invoice_collection_activation
  BEFORE INSERT OR UPDATE ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_collection_activation();
