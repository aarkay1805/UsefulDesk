-- Supabase grants newly-created public functions to anon through its
-- database-level default privileges. Keep the analytical finance RPC
-- authenticated-only even though its query also has an explicit tenant
-- membership guard and reads RLS-protected tables.

REVOKE ALL ON FUNCTION public.finance_payment_ledger(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT[],
  TEXT[],
  TEXT[],
  UUID[],
  UUID[],
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon;
