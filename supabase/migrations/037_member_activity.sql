-- ============================================================
-- 037_member_activity.sql — Last-visit read model (Phase 3)
--
-- The retention action lists ("inactive 10+ days", "never visited")
-- need each member's LAST check-in, not just the recent-activity diff
-- the dashboard tile uses. Same view approach as membership_dues
-- (034): derived, not stored — attendance (032) is the source of
-- truth, so last_visit_at/visit_count are aggregated at read time
-- over idx_attendance_account_contact_time.
--
-- Contact + plan display fields are flattened in (a view exposes no
-- FKs, so PostgREST embeds don't resolve on it).
--
-- security_invoker=true → the querying user's RLS on memberships /
-- attendance / contacts still filters rows by is_account_member.
--
-- Idempotent: CREATE OR REPLACE VIEW; grants are re-runnable.
-- ============================================================

CREATE OR REPLACE VIEW member_activity
WITH (security_invoker = true) AS
SELECT
  m.id             AS membership_id,
  m.account_id,
  m.contact_id,
  m.plan_id,
  m.start_date,
  m.end_date,
  m.status,
  m.fee_status,
  m.fee_amount,
  m.is_trial,
  c.name           AS contact_name,
  c.phone          AS contact_phone,
  p.name           AS plan_name,
  MAX(a.checked_in_at) AS last_visit_at,
  COUNT(a.id)::int     AS visit_count
FROM memberships m
JOIN contacts c        ON c.id = m.contact_id
LEFT JOIN membership_plans p ON p.id = m.plan_id
LEFT JOIN attendance a ON a.account_id = m.account_id
                      AND a.contact_id = m.contact_id
WHERE m.status <> 'cancelled'
GROUP BY m.id, c.name, c.phone, p.name;

-- PostgREST reaches the view through the exposed public schema; grant the
-- API roles SELECT. Row visibility is still gated by security_invoker RLS.
GRANT SELECT ON member_activity TO authenticated, anon, service_role;
