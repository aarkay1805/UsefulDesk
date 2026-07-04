-- ============================================================
-- 031_gym_memberships.sql — Gym domain layer (Milestone 1)
--
-- Adds the "renewal wedge" data model on top of the existing
-- WhatsApp CRM. A *member* is a `contacts` row (the person, phone,
-- dedupe, WhatsApp thread all reused) that also has a `memberships`
-- row (the plan + expiry it carries over time). Money lives in an
-- append-only `payments` ledger.
--
-- Three parent-tenant tables, each carrying `account_id` — so RLS
-- copies the parent-table pattern from 017 verbatim (no child-join
-- policies needed). "expired" is DERIVED at read time
-- (status='active' AND end_date < today) so the wedge needs no cron;
-- the enum keeps an 'expired' value for a future cron to materialise.
--
-- Idempotent — safe to run multiple times. Enum guarded by a DO
-- block; tables/indexes use IF NOT EXISTS; policies dropped before
-- recreate (Postgres has no CREATE POLICY IF NOT EXISTS). Reuses
-- update_updated_at_column() (001) and gen_random_uuid() (Postgres core).
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status_enum') THEN
    CREATE TYPE membership_status_enum AS ENUM ('active', 'frozen', 'cancelled', 'expired');
  END IF;
END $$;

-- ============================================================
-- MEMBERSHIP_PLANS (settings-class → admin writes, members read)
--
-- What the gym sells: a name + price + duration in days. Never
-- hard-deleted while referenced (memberships.plan_id RESTRICT) —
-- the UI archives via is_active=false instead.
-- ============================================================
CREATE TABLE IF NOT EXISTS membership_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  price         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_plans_account ON membership_plans(account_id);
-- No two plans with the same name per account (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_plans_account_name
  ON membership_plans(account_id, lower(name));

ALTER TABLE membership_plans ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON membership_plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON membership_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- MEMBERSHIPS (operational → agent writes)
--
-- One row per member (UNIQUE account_id, contact_id). Renewals
-- mutate this row in place (extend end_date, set status='active');
-- the payments ledger is the history. end_date is the hot column
-- the renewal action lists scan, hence its composite index.
-- ============================================================
CREATE TABLE IF NOT EXISTS memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Creator/audit; never used for tenancy isolation (that's account_id).
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- RESTRICT: a plan in use cannot be deleted (UI offers Archive instead).
  plan_id     UUID REFERENCES membership_plans(id) ON DELETE RESTRICT,
  start_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date    DATE NOT NULL,
  status      membership_status_enum NOT NULL DEFAULT 'active',
  fee_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_status  TEXT NOT NULL DEFAULT 'due' CHECK (fee_status IN ('paid', 'due')),
  -- Set to the freeze date while status='frozen'; used to push end_date
  -- forward by the frozen span on unfreeze.
  frozen_at   DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_account        ON memberships(account_id);
CREATE INDEX IF NOT EXISTS idx_memberships_account_end    ON memberships(account_id, end_date);
CREATE INDEX IF NOT EXISTS idx_memberships_account_status ON memberships(account_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_contact        ON memberships(contact_id);
CREATE INDEX IF NOT EXISTS idx_memberships_plan           ON memberships(plan_id);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON memberships;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- PAYMENTS (append-only ledger = money + period history)
--
-- FKs are SET NULL so the financial record survives deletion of the
-- membership / contact / plan it referenced (mirrors deals, 004).
-- plan_id is a snapshot of the plan billed at pay time.
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  membership_id   UUID REFERENCES memberships(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  plan_id         UUID REFERENCES membership_plans(id) ON DELETE SET NULL,
  -- Who recorded the payment.
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  method          TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'upi', 'card', 'bank', 'other')),
  status          TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'due')),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start    DATE,
  period_end      DATE,
  -- Payment proof: public URL + object path in the existing chat-media bucket.
  screenshot_url  TEXT,
  screenshot_path TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_account_paid ON payments(account_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_membership   ON payments(membership_id);
CREATE INDEX IF NOT EXISTS idx_payments_contact      ON payments(contact_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS — parent-table pattern from 017
--
--   membership_plans : settings-class (admin write, member read)
--   memberships      : operational   (agent write)
--   payments         : operational   (agent write); delete admin-only
-- ============================================================

-- ---- membership_plans ------------------------------------------
DROP POLICY IF EXISTS membership_plans_select ON membership_plans;
DROP POLICY IF EXISTS membership_plans_insert ON membership_plans;
DROP POLICY IF EXISTS membership_plans_update ON membership_plans;
DROP POLICY IF EXISTS membership_plans_delete ON membership_plans;
CREATE POLICY membership_plans_select ON membership_plans FOR SELECT USING (is_account_member(account_id));
CREATE POLICY membership_plans_insert ON membership_plans FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY membership_plans_update ON membership_plans FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY membership_plans_delete ON membership_plans FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- memberships -----------------------------------------------
DROP POLICY IF EXISTS memberships_select ON memberships;
DROP POLICY IF EXISTS memberships_insert ON memberships;
DROP POLICY IF EXISTS memberships_update ON memberships;
DROP POLICY IF EXISTS memberships_delete ON memberships;
CREATE POLICY memberships_select ON memberships FOR SELECT USING (is_account_member(account_id));
CREATE POLICY memberships_insert ON memberships FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY memberships_update ON memberships FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY memberships_delete ON memberships FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- payments (delete restricted to admins — financial records) --
DROP POLICY IF EXISTS payments_select ON payments;
DROP POLICY IF EXISTS payments_insert ON payments;
DROP POLICY IF EXISTS payments_update ON payments;
DROP POLICY IF EXISTS payments_delete ON payments;
CREATE POLICY payments_select ON payments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY payments_insert ON payments FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY payments_update ON payments FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY payments_delete ON payments FOR DELETE USING (is_account_member(account_id, 'admin'));
