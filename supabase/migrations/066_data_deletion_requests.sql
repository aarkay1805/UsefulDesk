-- ============================================================
-- 066_data_deletion_requests
--
-- Audit log for data-deletion requests, backing two flows:
--   1. Meta's Data Deletion Request Callback (POST /api/meta/data-
--      deletion) — records the app-scoped Facebook user_id and issues
--      a confirmation code Meta shows the user; the public status page
--      (/data-deletion?code=…) reads the row back by that code.
--   2. Owner-initiated account erasure (DELETE /api/account) — records
--      that a whole gym's Platform Data was purged, for our own audit.
--
-- Deliberately has NO foreign key to accounts: the whole point of the
-- account_id column is to survive the deletion of that account (an
-- ON DELETE CASCADE would erase the audit trail we're trying to keep).
--
-- Holds no user-readable business data; RLS is enabled with no policies
-- so the anon/authenticated roles are denied entirely. Both the
-- callback route and the status page read/write it with the service
-- role, which bypasses RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which flow created this row.
  source            TEXT NOT NULL
                      CHECK (source IN ('meta_callback', 'account_erasure')),

  -- App-scoped Facebook user id from the signed_request. NULL for
  -- owner-initiated account erasures (no Facebook user involved).
  meta_user_id      TEXT,

  -- The gym account this concerns, when known. Plain UUID, no FK — see
  -- header note. NULL for a Meta callback we couldn't map to an account.
  account_id        UUID,

  -- Token returned to Meta / the requester to look the request up.
  confirmation_code TEXT NOT NULL UNIQUE,

  status            TEXT NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received', 'processing', 'completed')),

  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS data_deletion_requests_code_idx
  ON data_deletion_requests (confirmation_code);

ALTER TABLE data_deletion_requests ENABLE ROW LEVEL SECURITY;

-- No policies by design: only the service role (which bypasses RLS)
-- touches this table. Enabling RLS without policies denies every
-- anon/authenticated read or write.
