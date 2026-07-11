-- ============================================================
-- 057_membership_periods.sql — Billing periods / invoices (Phase 2)
--
-- Recurring monthly/quarterly members pay per CYCLE. Until now a
-- membership was ONE row mutated in place on renewal, so past cycles
-- were lost (only the append-only `payments` ledger hinted at them).
-- That can't express "this month is Unpaid" as a real, badgeable
-- invoice, nor an arrears trail across cycles.
--
-- This adds `membership_periods` — one persisted row per billing cycle
-- (the invoice). The membership row stays the "current pointer" (its
-- start/end/fee mirror the live cycle, so every existing read keeps
-- working); periods accumulate the HISTORY.
--
-- Reconciliation reuses the `membership_dues` (034) trick: payments
-- already carry a `period_end` snapshot, so a period's collected amount
-- = Σ payments whose period_end matches — NO new column on `payments`.
-- Exposed via the `membership_period_invoices` view (amount_paid +
-- balance). Paid/Unpaid/Upcoming status is DERIVED IN TS (needs the
-- account's "today" in its tz — geography never leaks into SQL, per the
-- localization rule), so the view stays tz-agnostic like 034.
--
-- Lifecycle:
--   * birth  — AFTER INSERT trigger on memberships auto-creates the
--              first period (covers all 5 create paths with no TS).
--   * renew  — inserts a NEW period (old one stays = real arrears).
--   * edit / unfreeze / convert — sync the current period's mirror.
--   * cancel / reactivate — flip state open<->void.
--   (renew + the syncs are done explicitly in TS via lib/memberships/
--    periods.ts — a trigger can't tell renew from an edit or unfreeze.)
--
-- Idempotent: guarded table/index/trigger/policy creates; backfill uses
-- ON CONFLICT DO NOTHING so re-runs are safe.
-- ============================================================

-- ---- table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  plan_id       UUID REFERENCES membership_plans(id) ON DELETE SET NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  -- Invoice total for this cycle, snapshotted (the plan price can change
  -- later without rewriting history).
  fee_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  -- open = a live invoice (paid/unpaid/upcoming derived); void = the
  -- cycle was cancelled and shouldn't count as owed.
  state         TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'void')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One cycle per end_date per membership — also the payment reconcile
  -- key (payments.period_end) and the ON CONFLICT target for backfill.
  UNIQUE (membership_id, period_end)
);

CREATE INDEX IF NOT EXISTS idx_membership_periods_account
  ON membership_periods(account_id);
CREATE INDEX IF NOT EXISTS idx_membership_periods_membership
  ON membership_periods(membership_id, period_start);
CREATE INDEX IF NOT EXISTS idx_membership_periods_account_state
  ON membership_periods(account_id, state);

ALTER TABLE membership_periods ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON membership_periods;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON membership_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- RLS (operational, mirrors memberships: agent write) -------
DROP POLICY IF EXISTS membership_periods_select ON membership_periods;
DROP POLICY IF EXISTS membership_periods_insert ON membership_periods;
DROP POLICY IF EXISTS membership_periods_update ON membership_periods;
DROP POLICY IF EXISTS membership_periods_delete ON membership_periods;
CREATE POLICY membership_periods_select ON membership_periods FOR SELECT USING (is_account_member(account_id));
CREATE POLICY membership_periods_insert ON membership_periods FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY membership_periods_update ON membership_periods FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY membership_periods_delete ON membership_periods FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- birth trigger: first period per new membership ------------
-- Runs as the inserting user (SECURITY INVOKER) — that user already
-- passed memberships_insert (agent), so membership_periods_insert
-- (agent) passes too. A cancelled-on-create membership births a void
-- period.
CREATE OR REPLACE FUNCTION create_initial_membership_period()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO membership_periods (
    account_id, membership_id, contact_id, plan_id,
    period_start, period_end, fee_amount, state
  )
  VALUES (
    NEW.account_id, NEW.id, NEW.contact_id, NEW.plan_id,
    NEW.start_date, NEW.end_date, NEW.fee_amount,
    CASE WHEN NEW.status = 'cancelled' THEN 'void' ELSE 'open' END
  )
  ON CONFLICT (membership_id, period_end) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_membership_initial_period ON memberships;
CREATE TRIGGER trg_membership_initial_period
  AFTER INSERT ON memberships
  FOR EACH ROW EXECUTE FUNCTION create_initial_membership_period();

-- ---- backfill --------------------------------------------------
-- (a) Current cycle for every existing membership.
INSERT INTO membership_periods (
  account_id, membership_id, contact_id, plan_id,
  period_start, period_end, fee_amount, state, created_at
)
SELECT
  m.account_id, m.id, m.contact_id, m.plan_id,
  m.start_date, m.end_date, m.fee_amount,
  CASE WHEN m.status = 'cancelled' THEN 'void' ELSE 'open' END,
  m.created_at
FROM memberships m
ON CONFLICT (membership_id, period_end) DO NOTHING;

-- (b) Past PAID cycles reconstructed from the ledger (distinct prior
-- period_end). fee = the LARGEST single payment for that period, NOT the
-- sum: old data sometimes stamped several full-fee payments (multiple
-- mis-recorded cycles) onto one period_end, and SUM inflated the invoice
-- total to a multiple of the real fee (e.g. 4×3999 = 15996 for a 3999
-- plan). MAX recovers the per-cycle fee; the view still sums payments
-- into amount_paid so balance = 0 → these read as "Paid" history.
-- (Heuristic — genuine partial installments under one period_end would
-- be under-stated, but full-fee-per-cycle is the real-world case here.)
-- Current cycle already covered by (a), so exclude the live end_date.
INSERT INTO membership_periods (
  account_id, membership_id, contact_id, plan_id,
  period_start, period_end, fee_amount, state
)
SELECT
  p.account_id, p.membership_id, p.contact_id, p.plan_id,
  COALESCE(p.period_start, p.period_end), p.period_end,
  MAX(p.amount), 'open'
FROM payments p
JOIN memberships m ON m.id = p.membership_id
WHERE p.status = 'paid'
  AND p.period_end IS NOT NULL
  AND p.period_end <> m.end_date
GROUP BY p.account_id, p.membership_id, p.contact_id, p.plan_id,
         COALESCE(p.period_start, p.period_end), p.period_end
ON CONFLICT (membership_id, period_end) DO NOTHING;

-- ---- reconciliation view --------------------------------------
-- amount_paid = Σ paid payments whose period_end matches the cycle
-- (same key as membership_dues). balance = fee_amount − amount_paid.
-- Paid/Unpaid/Upcoming is derived in TS from balance + period_start vs
-- the account's today + state (kept OUT of SQL — no tz here).
CREATE OR REPLACE VIEW membership_period_invoices
WITH (security_invoker = true) AS
SELECT
  mp.id,
  mp.account_id,
  mp.membership_id,
  mp.contact_id,
  mp.plan_id,
  mp.period_start,
  mp.period_end,
  mp.fee_amount,
  mp.state,
  mp.created_at,
  COALESCE(
    SUM(p.amount) FILTER (WHERE p.status = 'paid'),
    0
  )::numeric(12, 2) AS amount_paid,
  GREATEST(
    mp.fee_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'paid'), 0),
    0
  )::numeric(12, 2) AS balance
FROM membership_periods mp
LEFT JOIN payments p
  ON p.membership_id = mp.membership_id
  AND p.period_end IS NOT DISTINCT FROM mp.period_end
GROUP BY mp.id;

GRANT SELECT ON membership_period_invoices TO authenticated, anon, service_role;

-- Publish for realtime (mirrors 054) so the member lists refresh live
-- when a period is added/voided. Guarded — re-running is a no-op.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE membership_periods;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
