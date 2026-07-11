-- 054: publish the gym-domain tables for realtime.
--
-- The Members page subscribes to postgres_changes on memberships /
-- payments / attendance so every open session's action lists refresh
-- live (a front-desk check-in or payment shows up on the owner's screen
-- without a manual reload). RLS still applies to realtime — a client
-- only receives change events for rows it can read (account-scoped).
--
-- Idempotent, same form as 001/050: add each table to the
-- supabase_realtime publication only if it isn't already in it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'memberships'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE memberships;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payments;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'attendance'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
  END IF;
END $$;
