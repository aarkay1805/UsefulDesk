-- invoice_balances reads invoice_line_balances, whose paid/refunded sections
-- depend on these allocation tables. Publish them so the tenant-filtered
-- Finance Overview and Invoices subscriptions refresh after allocation-only
-- corrections as well as ordinary payment/refund writes.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'payment_allocations'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.payment_allocations;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'payment_refund_allocations'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.payment_refund_allocations;
  END IF;
END
$migration$;
