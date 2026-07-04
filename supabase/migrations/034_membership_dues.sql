-- ============================================================
-- 034_membership_dues.sql — Outstanding-balance read model (Phase 2)
--
-- Payment-due buckets + reconciliation need a *balance* per member,
-- not the binary memberships.fee_status. The append-only `payments`
-- ledger (031) is the source of truth for money collected, so the
-- balance is DERIVED, not stored:
--
--   collected_current = Σ payments.amount for the CURRENT period
--                       (payments carry a period_end snapshot; the
--                        current period is the one whose period_end
--                        equals the membership's live end_date, so a
--                        renewal automatically scopes to the new cycle)
--   balance           = fee_amount − collected_current
--
-- Exposed as a VIEW so partial payments reduce a balance instead of a
-- one-shot paid/due flip, and the aged "who owes" buckets read it in a
-- single indexed query (idx_payments_membership).
--
-- security_invoker=true → the view runs with the QUERYING user's rights,
-- so the base-table RLS on memberships/payments (031) still filters rows
-- by is_account_member. No separate policy needed on the view.
--
-- Idempotent: CREATE OR REPLACE VIEW; grants are re-runnable.
-- ============================================================

CREATE OR REPLACE VIEW membership_dues
WITH (security_invoker = true) AS
SELECT
  m.id            AS membership_id,
  m.account_id,
  m.contact_id,
  m.plan_id,
  m.start_date,
  m.end_date,
  m.status,
  m.fee_status,
  m.fee_amount,
  COALESCE(
    SUM(p.amount) FILTER (
      WHERE p.status = 'paid' AND p.period_end IS NOT DISTINCT FROM m.end_date
    ),
    0
  )::numeric(12, 2) AS collected_current,
  GREATEST(
    m.fee_amount - COALESCE(
      SUM(p.amount) FILTER (
        WHERE p.status = 'paid' AND p.period_end IS NOT DISTINCT FROM m.end_date
      ),
      0
    ),
    0
  )::numeric(12, 2) AS balance
FROM memberships m
LEFT JOIN payments p ON p.membership_id = m.id
WHERE m.status <> 'cancelled'
GROUP BY m.id;

-- PostgREST reaches the view through the exposed public schema; grant the
-- API roles SELECT. Row visibility is still gated by security_invoker RLS.
GRANT SELECT ON membership_dues TO authenticated, anon, service_role;
