-- ============================================================
-- 062_plan_pricing_options.sql — PushPress-style plan restructure.
--
-- Plans gain a TYPE and multiple BILLING OPTIONS:
--
--   * plan_type: 'recurring' (billing cycles, renewal chase, autopay-
--     eligible) | 'non_recurring' (fixed term, pay once, excluded from
--     renewal reminders/action lists) | 'session_pack' (punchcard —
--     sessions_count sessions, option duration = validity window;
--     remaining sessions are DERIVED from attendance, never stored).
--   * plan_pricing_options: one plan → many billing options
--     (duration_count × duration_unit day|week|month|year, price,
--     one-time setup_fee). Memberships/periods reference the chosen
--     option via pricing_option_id.
--   * attendance_limit_count/_interval: visit cap surfaced as a
--     WARN-with-override at check-in (period|week|month), NULL = unlimited.
--
-- Conventions established here:
--   * setup_fee is folded into the FIRST cycle's fee_amount in TS
--     (no ledger schema change); renewals bill option.price only.
--   * Duration math is calendar-accurate: TS addDuration() and SQL
--     date + N * INTERVAL '1 month' (Postgres clamps Jan 31 + 1mo → Feb 28).
--   * Legacy membership_plans.price/duration_days are FROZEN — kept for
--     rollback safety, mirrored on insert by the settings UI, but no
--     longer read by new code (except the legacy autopay fallback below).
--
-- BEHAVIOR CHANGE (flagged): record_gateway_charge auto-renewal now
-- bills option.price instead of reusing membership.fee_amount, and rolls
-- the membership pointer's fee_amount to it. Required — the first
-- cycle's fee_amount may embed the setup fee, which must not compound;
-- side effect: a custom-negotiated fee resets to the option price at
-- auto-renewal (the mandate max_amount already bounds charges).
--
-- RPC SIGNATURE CHANGES: renew_membership_transaction,
-- edit_membership_cycle and change_membership_plan gain a trailing
-- p_pricing_option_id UUID DEFAULT NULL. CREATE OR REPLACE with a new
-- parameter would create an OVERLOAD (PostgREST → HTTP 300 ambiguous),
-- so each is DROPped by its exact old identity first and its
-- GRANT/REVOKE re-applied. DEFAULT NULL keeps not-yet-deployed clients
-- working between migration apply and frontend deploy.
--
-- Supersedes 057's create_initial_membership_period() and 060's
-- record_gateway_charge() (re-running those older migrations would
-- clobber the versions defined here).
--
-- Idempotent: guarded enum, IF NOT EXISTS DDL, NULL-guarded backfills,
-- drop-then-create policies/functions.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_type_enum') THEN
    CREATE TYPE plan_type_enum AS ENUM ('recurring', 'non_recurring', 'session_pack');
  END IF;
END $$;

-- ============================================================
-- MEMBERSHIP_PLANS — type + attendance limit + pack size
-- (price/duration_days stay as frozen legacy columns.)
-- ============================================================
ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS plan_type plan_type_enum NOT NULL DEFAULT 'recurring',
  ADD COLUMN IF NOT EXISTS attendance_limit_count INTEGER
    CHECK (attendance_limit_count IS NULL OR attendance_limit_count > 0),
  ADD COLUMN IF NOT EXISTS attendance_limit_interval TEXT
    CHECK (attendance_limit_interval IS NULL OR attendance_limit_interval IN ('period', 'week', 'month')),
  ADD COLUMN IF NOT EXISTS sessions_count INTEGER
    CHECK (sessions_count IS NULL OR sessions_count > 0);

-- ============================================================
-- PLAN_PRICING_OPTIONS (settings-class → admin writes, members read)
--
-- One row per billing option a plan sells. For recurring plans the
-- duration is the billing cycle; for non_recurring the fixed term; for
-- session_pack the pack's validity window.
-- ============================================================
CREATE TABLE IF NOT EXISTS plan_pricing_options (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id        UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
  duration_count INTEGER NOT NULL CHECK (duration_count > 0),
  duration_unit  TEXT NOT NULL CHECK (duration_unit IN ('day', 'week', 'month', 'year')),
  price          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  -- One-time joining/admission fee; billed on the FIRST cycle only.
  setup_fee      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_pricing_options_plan    ON plan_pricing_options(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_pricing_options_account ON plan_pricing_options(account_id);

ALTER TABLE plan_pricing_options ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON plan_pricing_options;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON plan_pricing_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — settings-class, copied from membership_plans (031).
DROP POLICY IF EXISTS plan_pricing_options_select ON plan_pricing_options;
DROP POLICY IF EXISTS plan_pricing_options_insert ON plan_pricing_options;
DROP POLICY IF EXISTS plan_pricing_options_update ON plan_pricing_options;
DROP POLICY IF EXISTS plan_pricing_options_delete ON plan_pricing_options;
CREATE POLICY plan_pricing_options_select ON plan_pricing_options FOR SELECT USING (is_account_member(account_id));
CREATE POLICY plan_pricing_options_insert ON plan_pricing_options FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY plan_pricing_options_update ON plan_pricing_options FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY plan_pricing_options_delete ON plan_pricing_options FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- REFERENCE COLUMNS
-- RESTRICT on memberships mirrors plan_id (UI archives instead of
-- deleting a referenced option); SET NULL on periods (fee is
-- snapshotted, history survives an option's deletion).
-- ============================================================
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS pricing_option_id UUID REFERENCES plan_pricing_options(id) ON DELETE RESTRICT;
ALTER TABLE membership_periods
  ADD COLUMN IF NOT EXISTS pricing_option_id UUID REFERENCES plan_pricing_options(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_pricing_option ON memberships(pricing_option_id);

-- ============================================================
-- BACKFILL (order load-bearing: options → memberships → periods;
-- every step guarded so a re-run is a no-op)
-- ============================================================

-- (1) One legacy option per plan, mirroring the frozen scalar columns.
INSERT INTO plan_pricing_options (account_id, plan_id, duration_count, duration_unit, price, setup_fee, sort_order)
SELECT p.account_id, p.id, p.duration_days, 'day', p.price, 0, 0
FROM membership_plans p
WHERE NOT EXISTS (SELECT 1 FROM plan_pricing_options o WHERE o.plan_id = p.id);

-- (2) Point memberships at their plan's (single, backfilled) option.
UPDATE memberships m
SET pricing_option_id = o.id
FROM plan_pricing_options o
WHERE m.plan_id = o.plan_id
  AND m.pricing_option_id IS NULL;

-- (3) Stamp current periods for traceability (best-effort).
UPDATE membership_periods pp
SET pricing_option_id = m.pricing_option_id
FROM memberships m
WHERE pp.membership_id = m.id
  AND pp.pricing_option_id IS NULL
  AND pp.period_end = m.end_date;

-- ============================================================
-- BIRTH TRIGGER (supersedes 057's version) — first period now carries
-- the membership's pricing option.
-- ============================================================
CREATE OR REPLACE FUNCTION create_initial_membership_period()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO membership_periods (
    account_id, membership_id, contact_id, plan_id, pricing_option_id,
    period_start, period_end, fee_amount, state
  )
  VALUES (
    NEW.account_id, NEW.id, NEW.contact_id, NEW.plan_id, NEW.pricing_option_id,
    NEW.start_date, NEW.end_date, NEW.fee_amount,
    CASE WHEN NEW.status = 'cancelled' THEN 'void' ELSE 'open' END
  )
  ON CONFLICT (membership_id, period_end) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- record_gateway_charge (supersedes 060's version) — option-driven
-- auto-renewal. Signature unchanged → plain CREATE OR REPLACE.
--
--   * Only plan_type='recurring' may auto-renew.
--   * Next cycle length = pricing option's duration_count × unit
--     (calendar interval — month/year clamp natively); renewal fee =
--     option.price (NEVER setup_fee — that was first-cycle-only).
--   * Legacy fallback (membership with no option, pre-backfill data):
--     old behavior — plan.duration_days + membership.fee_amount.
--   * The membership pointer's fee_amount rolls to the renewal fee so a
--     first cycle's embedded setup fee can't compound.
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_gateway_charge(
  p_account_id UUID,
  p_membership_id UUID,
  p_gateway_payment_id TEXT,
  p_amount NUMERIC,
  p_method TEXT,
  p_mandate_id UUID
)
RETURNS TABLE(payment_id UUID, renewed BOOLEAN, settled_period_end DATE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_plan public.membership_plans%ROWTYPE;
  v_option public.plan_pricing_options%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
  v_has_option BOOLEAN := FALSE;
  v_collected NUMERIC(12, 2);
  v_balance NUMERIC(12, 2);
  v_payment_id UUID;
  v_renew_fee NUMERIC(12, 2);
  v_new_start DATE;
  v_new_end DATE;
  v_target_end DATE;
  v_renewed BOOLEAN := FALSE;
BEGIN
  IF p_gateway_payment_id IS NULL OR btrim(p_gateway_payment_id) = '' THEN
    RAISE EXCEPTION 'A gateway payment id is required';
  END IF;

  -- Idempotency: a retry of an already-recorded charge returns the same
  -- row and does NOT renew again (the whole op is one transaction, so the
  -- first commit is all-or-nothing).
  SELECT id INTO v_payment_id
  FROM public.payments
  WHERE account_id = p_account_id
    AND gateway_payment_id = p_gateway_payment_id;
  IF v_payment_id IS NOT NULL THEN
    RETURN QUERY SELECT v_payment_id, FALSE, NULL::DATE;
    RETURN;
  END IF;

  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;
  IF NOT FOUND OR v_membership.account_id <> p_account_id THEN
    RAISE EXCEPTION 'Membership not found for this account';
  END IF;

  -- The current cycle (pointer) = the latest period.
  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = v_membership.id
  ORDER BY period_start DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No billing period for this membership';
  END IF;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12, 2)
  INTO v_collected
  FROM public.payments
  WHERE membership_id = v_membership.id
    AND period_end = v_period.period_end
    AND status = 'paid';
  v_balance := v_period.fee_amount - v_collected;

  IF v_balance > 0 AND v_period.state = 'open' THEN
    -- First charge (or a catch-up): settle the current, still-owing cycle.
    v_target_end := v_period.period_end;
  ELSE
    -- Renewal: the current cycle is settled (or void) → open the next one
    -- and roll the membership forward.
    SELECT * INTO v_plan
    FROM public.membership_plans
    WHERE id = v_membership.plan_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cannot auto-renew: membership has no plan';
    END IF;
    IF v_plan.plan_type <> 'recurring' THEN
      RAISE EXCEPTION 'Only recurring plans can auto-renew';
    END IF;

    SELECT * INTO v_option
    FROM public.plan_pricing_options
    WHERE id = v_membership.pricing_option_id;
    v_has_option := FOUND;

    v_new_start := v_membership.end_date;
    IF v_has_option THEN
      v_new_end := (v_new_start + (v_option.duration_count * CASE v_option.duration_unit
        WHEN 'day'   THEN INTERVAL '1 day'
        WHEN 'week'  THEN INTERVAL '1 week'
        WHEN 'month' THEN INTERVAL '1 month'
        WHEN 'year'  THEN INTERVAL '1 year'
      END))::DATE;
      v_renew_fee := v_option.price;
    ELSE
      -- Legacy fallback: un-backfilled membership → frozen scalar columns.
      IF v_plan.duration_days IS NULL THEN
        RAISE EXCEPTION 'Cannot auto-renew: membership has no plan duration';
      END IF;
      v_new_end := v_new_start + v_plan.duration_days;
      v_renew_fee := v_membership.fee_amount;
    END IF;

    INSERT INTO public.membership_periods (
      account_id, membership_id, contact_id, plan_id, pricing_option_id,
      period_start, period_end, fee_amount, state
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      v_membership.plan_id, v_membership.pricing_option_id,
      v_new_start, v_new_end, v_renew_fee, 'open'
    );

    UPDATE public.memberships
    SET start_date = v_new_start,
        end_date = v_new_end,
        fee_amount = v_renew_fee,
        status = 'active'
    WHERE id = v_membership.id;

    v_target_end := v_new_end;
    v_renewed := TRUE;
  END IF;

  -- Insert the payment against the resolved period, under the system GUC
  -- so validate_membership_payment authorises it (financial guards intact).
  PERFORM set_config('app.system_payment', '1', TRUE);
  INSERT INTO public.payments (
    account_id, membership_id, contact_id, plan_id, user_id,
    amount, method, status, paid_at, period_end,
    source, mandate_id, gateway_payment_id
  )
  VALUES (
    v_membership.account_id, v_membership.id, v_membership.contact_id,
    v_membership.plan_id, NULL,
    p_amount, p_method, 'paid', NOW(), v_target_end,
    'auto', p_mandate_id, p_gateway_payment_id
  )
  RETURNING id INTO v_payment_id;
  PERFORM set_config('app.system_payment', '', TRUE);

  RETURN QUERY SELECT v_payment_id, v_renewed, v_target_end;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_gateway_charge(UUID, UUID, TEXT, NUMERIC, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gateway_charge(UUID, UUID, TEXT, NUMERIC, TEXT, UUID)
  TO service_role;

-- ============================================================
-- renew_membership_transaction — gains p_pricing_option_id.
-- DROP first: CREATE OR REPLACE with an extra param would create an
-- overload and PostgREST would answer HTTP 300 on every call.
-- ============================================================
DROP FUNCTION IF EXISTS public.renew_membership_transaction(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, TEXT, BOOLEAN, UUID
);

CREATE FUNCTION public.renew_membership_transaction(
  p_membership_id UUID,
  p_plan_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_fee_amount NUMERIC,
  p_collect_amount NUMERIC,
  p_method TEXT,
  p_is_conversion BOOLEAN,
  p_idempotency_key UUID,
  p_pricing_option_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_plan public.membership_plans%ROWTYPE;
  v_period_id UUID;
  v_operation_key UUID;
  v_option_id UUID;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_account_member(v_membership.account_id, 'agent') THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;

  IF v_membership.is_trial AND NOT p_is_conversion THEN
    RAISE EXCEPTION 'A trial must use the conversion flow';
  END IF;
  IF p_is_conversion AND NOT v_membership.is_trial THEN
    RAISE EXCEPTION 'Only a trial can be converted';
  END IF;

  INSERT INTO public.membership_operations (
    idempotency_key, account_id, membership_id, operation
  )
  VALUES (
    p_idempotency_key, v_membership.account_id, v_membership.id,
    CASE WHEN p_is_conversion THEN 'convert' ELSE 'renew' END
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING idempotency_key INTO v_operation_key;

  -- A committed operation with this key already completed. If a prior
  -- attempt rolled back, its marker rolled back too and this insert wins.
  IF v_operation_key IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.membership_operations
      WHERE idempotency_key = p_idempotency_key
        AND account_id = v_membership.account_id
        AND membership_id = v_membership.id
        AND operation = CASE WHEN p_is_conversion THEN 'convert' ELSE 'renew' END
    ) THEN
      RAISE EXCEPTION 'Idempotency key already belongs to another operation';
    END IF;
    RETURN v_membership.id;
  END IF;

  SELECT * INTO v_plan
  FROM public.membership_plans
  WHERE id = p_plan_id
    AND account_id = v_membership.account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership plan not found';
  END IF;

  IF p_pricing_option_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.plan_pricing_options
    WHERE id = p_pricing_option_id
      AND plan_id = p_plan_id
      AND account_id = v_membership.account_id
  ) THEN
    RAISE EXCEPTION 'Pricing option not found for this plan';
  END IF;

  IF p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'Billing period end must be after its start';
  END IF;
  IF p_fee_amount < 0 THEN
    RAISE EXCEPTION 'Fee cannot be negative';
  END IF;
  IF COALESCE(p_collect_amount, 0) < 0
     OR COALESCE(p_collect_amount, 0) > p_fee_amount THEN
    RAISE EXCEPTION 'Collected amount must be between zero and the fee';
  END IF;

  -- Option to stamp: the caller's choice; a legacy caller (NULL) keeps
  -- the existing option only while the plan is unchanged — a stale
  -- option must never point across plans.
  v_option_id := CASE
    WHEN p_pricing_option_id IS NOT NULL THEN p_pricing_option_id
    WHEN v_membership.plan_id IS NOT DISTINCT FROM p_plan_id THEN v_membership.pricing_option_id
    ELSE NULL
  END;

  UPDATE public.memberships
  SET
    plan_id = p_plan_id,
    pricing_option_id = v_option_id,
    start_date = p_period_start,
    end_date = p_period_end,
    status = 'active',
    fee_amount = p_fee_amount,
    frozen_at = NULL,
    is_trial = CASE WHEN p_is_conversion THEN FALSE ELSE is_trial END,
    converted_at = CASE
      WHEN p_is_conversion THEN NOW()
      ELSE converted_at
    END
  WHERE id = v_membership.id;

  IF p_is_conversion THEN
    SELECT id INTO v_period_id
    FROM public.membership_periods
    WHERE membership_id = v_membership.id
    ORDER BY period_start DESC, created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_period_id IS NULL THEN
      RAISE EXCEPTION 'Current billing period not found';
    END IF;

    UPDATE public.membership_periods
    SET
      plan_id = p_plan_id,
      pricing_option_id = v_option_id,
      period_start = p_period_start,
      period_end = p_period_end,
      fee_amount = p_fee_amount,
      state = 'open'
    WHERE id = v_period_id;
  ELSE
    INSERT INTO public.membership_periods (
      account_id, membership_id, contact_id, plan_id, pricing_option_id,
      period_start, period_end, fee_amount, state
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      p_plan_id, v_option_id, p_period_start, p_period_end, p_fee_amount, 'open'
    );
  END IF;

  IF COALESCE(p_collect_amount, 0) > 0 THEN
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id,
      amount, method, status, period_start, period_end, idempotency_key
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      p_plan_id, (SELECT auth.uid()), p_collect_amount, p_method, 'paid',
      p_period_start, p_period_end, p_idempotency_key
    );
  END IF;

  RETURN v_membership.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.renew_membership_transaction(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, TEXT, BOOLEAN, UUID, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_membership_transaction(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, TEXT, BOOLEAN, UUID, UUID
) TO authenticated;

-- ============================================================
-- edit_membership_cycle — gains p_pricing_option_id (same DROP-first
-- rationale).
-- ============================================================
DROP FUNCTION IF EXISTS public.edit_membership_cycle(
  UUID, UUID, DATE, DATE, NUMERIC, BOOLEAN, TEXT
);

CREATE FUNCTION public.edit_membership_cycle(
  p_membership_id UUID,
  p_plan_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_fee_amount NUMERIC,
  p_is_trial BOOLEAN,
  p_notes TEXT,
  p_pricing_option_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
  v_option_id UUID;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_account_member(v_membership.account_id, 'agent') THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;
  IF p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'Billing period end must be after its start';
  END IF;
  IF p_fee_amount IS NULL OR p_fee_amount < 0 THEN
    RAISE EXCEPTION 'Fee cannot be negative';
  END IF;
  IF p_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membership_plans
    WHERE id = p_plan_id AND account_id = v_membership.account_id
  ) THEN
    RAISE EXCEPTION 'Membership plan not found';
  END IF;
  IF p_pricing_option_id IS NOT NULL THEN
    IF p_plan_id IS NULL THEN
      RAISE EXCEPTION 'A pricing option requires a plan';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.plan_pricing_options
      WHERE id = p_pricing_option_id
        AND plan_id = p_plan_id
        AND account_id = v_membership.account_id
    ) THEN
      RAISE EXCEPTION 'Pricing option not found for this plan';
    END IF;
  END IF;

  -- Caller's option wins; a legacy caller (NULL) keeps the existing
  -- option only while the plan is unchanged.
  v_option_id := CASE
    WHEN p_pricing_option_id IS NOT NULL THEN p_pricing_option_id
    WHEN v_membership.plan_id IS NOT DISTINCT FROM p_plan_id THEN v_membership.pricing_option_id
    ELSE NULL
  END;

  -- Sync the current period (re-stamp payments + move the period)
  -- BEFORE the membership update so derive_membership_fee_status sees
  -- the ledger already on the new key.
  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = v_membership.id
  ORDER BY period_start DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_period.period_end IS DISTINCT FROM p_period_end THEN
      PERFORM set_config('app.allow_payment_restamp', '1', TRUE);
      UPDATE public.payments
      SET period_start = p_period_start,
          period_end = p_period_end
      WHERE membership_id = v_membership.id
        AND period_end = v_period.period_end;
      PERFORM set_config('app.allow_payment_restamp', '', TRUE);
    END IF;

    UPDATE public.membership_periods
    SET plan_id = p_plan_id,
        pricing_option_id = v_option_id,
        period_start = p_period_start,
        period_end = p_period_end,
        fee_amount = p_fee_amount
    WHERE id = v_period.id;
  END IF;

  UPDATE public.memberships
  SET plan_id = p_plan_id,
      pricing_option_id = v_option_id,
      start_date = p_period_start,
      end_date = p_period_end,
      fee_amount = p_fee_amount,
      is_trial = p_is_trial,
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_membership.id;

  RETURN v_membership.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.edit_membership_cycle(
  UUID, UUID, DATE, DATE, NUMERIC, BOOLEAN, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_membership_cycle(
  UUID, UUID, DATE, DATE, NUMERIC, BOOLEAN, TEXT, UUID
) TO authenticated;

-- ============================================================
-- change_membership_plan — gains p_pricing_option_id (same DROP-first
-- rationale).
-- ============================================================
DROP FUNCTION IF EXISTS public.change_membership_plan(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID
);

CREATE FUNCTION public.change_membership_plan(
  p_membership_id UUID,
  p_plan_id UUID,
  p_switch_date DATE,
  p_period_end DATE,
  p_old_fee_amount NUMERIC,
  p_fee_amount NUMERIC,
  p_collect_amount NUMERIC,
  p_method TEXT,
  p_idempotency_key UUID,
  p_pricing_option_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_plan public.membership_plans%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
  v_operation_key UUID;
  v_option_id UUID;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_account_member(v_membership.account_id, 'agent') THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;
  IF v_membership.is_trial THEN
    RAISE EXCEPTION 'A trial must use the conversion flow';
  END IF;
  IF v_membership.status = 'cancelled' THEN
    RAISE EXCEPTION 'Reactivate the membership before changing its plan';
  END IF;
  IF v_membership.status = 'frozen' THEN
    RAISE EXCEPTION 'Resume the membership before changing its plan';
  END IF;

  INSERT INTO public.membership_operations (
    idempotency_key, account_id, membership_id, operation
  )
  VALUES (
    p_idempotency_key, v_membership.account_id, v_membership.id, 'plan_change'
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING idempotency_key INTO v_operation_key;

  -- A committed operation with this key already completed. If a prior
  -- attempt rolled back, its marker rolled back too and this insert wins.
  IF v_operation_key IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.membership_operations
      WHERE idempotency_key = p_idempotency_key
        AND account_id = v_membership.account_id
        AND membership_id = v_membership.id
        AND operation = 'plan_change'
    ) THEN
      RAISE EXCEPTION 'Idempotency key already belongs to another operation';
    END IF;
    RETURN v_membership.id;
  END IF;

  SELECT * INTO v_plan
  FROM public.membership_plans
  WHERE id = p_plan_id
    AND account_id = v_membership.account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership plan not found';
  END IF;

  IF p_pricing_option_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.plan_pricing_options
    WHERE id = p_pricing_option_id
      AND plan_id = p_plan_id
      AND account_id = v_membership.account_id
  ) THEN
    RAISE EXCEPTION 'Pricing option not found for this plan';
  END IF;

  IF p_period_end <= p_switch_date THEN
    RAISE EXCEPTION 'Billing period end must be after its start';
  END IF;
  IF p_fee_amount IS NULL OR p_fee_amount < 0
     OR p_old_fee_amount IS NULL OR p_old_fee_amount < 0 THEN
    RAISE EXCEPTION 'Fee cannot be negative';
  END IF;
  IF COALESCE(p_collect_amount, 0) < 0
     OR COALESCE(p_collect_amount, 0) > p_fee_amount THEN
    RAISE EXCEPTION 'Collected amount must be between zero and the fee';
  END IF;

  -- The new cycle's period_end must not collide with any existing
  -- period (UNIQUE membership_id, period_end would abort mid-flight
  -- with an opaque error).
  IF EXISTS (
    SELECT 1 FROM public.membership_periods
    WHERE membership_id = v_membership.id
      AND period_end = p_period_end
  ) THEN
    RAISE EXCEPTION 'A billing period already ends on %; pick a different switch date or plan', p_period_end;
  END IF;

  -- Caller's option wins; a legacy caller (NULL) keeps the existing
  -- option only while the plan is unchanged.
  v_option_id := CASE
    WHEN p_pricing_option_id IS NOT NULL THEN p_pricing_option_id
    WHEN v_membership.plan_id IS NOT DISTINCT FROM p_plan_id THEN v_membership.pricing_option_id
    ELSE NULL
  END;

  -- Truncate the CURRENT cycle at the switch date (only when the switch
  -- lands inside it — switching on/after the old expiry is a plain
  -- succession and the old cycle stays whole).
  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = v_membership.id
  ORDER BY period_start DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND p_switch_date < v_period.period_end THEN
    IF p_switch_date <= v_period.period_start THEN
      RAISE EXCEPTION 'The switch date must be after the current cycle starts (%)', v_period.period_start;
    END IF;
    -- Truncation never raises the old invoice — the pro-rated fee is
    -- capped by what the full cycle cost.
    IF p_old_fee_amount > v_period.fee_amount THEN
      RAISE EXCEPTION 'The old cycle''s pro-rated fee cannot exceed its original fee';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.membership_periods
      WHERE membership_id = v_membership.id
        AND period_end = p_switch_date
        AND id <> v_period.id
    ) THEN
      RAISE EXCEPTION 'A billing period already ends on %; pick a different switch date', p_switch_date;
    END IF;

    -- Re-stamp the truncated cycle's payments to the new key so they
    -- keep reconciling (058: agents may only do this inside an RPC).
    PERFORM set_config('app.allow_payment_restamp', '1', TRUE);
    UPDATE public.payments
    SET period_end = p_switch_date
    WHERE membership_id = v_membership.id
      AND period_end = v_period.period_end;
    PERFORM set_config('app.allow_payment_restamp', '', TRUE);

    UPDATE public.membership_periods
    SET period_end = p_switch_date,
        fee_amount = p_old_fee_amount
    WHERE id = v_period.id;
  END IF;

  -- The new cycle on the new plan.
  INSERT INTO public.membership_periods (
    account_id, membership_id, contact_id, plan_id, pricing_option_id,
    period_start, period_end, fee_amount, state
  )
  VALUES (
    v_membership.account_id, v_membership.id, v_membership.contact_id,
    p_plan_id, v_option_id, p_switch_date, p_period_end, p_fee_amount, 'open'
  );

  UPDATE public.memberships
  SET plan_id = p_plan_id,
      pricing_option_id = v_option_id,
      start_date = p_switch_date,
      end_date = p_period_end,
      fee_amount = p_fee_amount,
      frozen_at = NULL
  WHERE id = v_membership.id;

  IF COALESCE(p_collect_amount, 0) > 0 THEN
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id,
      amount, method, status, period_start, period_end, idempotency_key
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      p_plan_id, (SELECT auth.uid()), p_collect_amount, p_method, 'paid',
      p_switch_date, p_period_end, p_idempotency_key
    );
  END IF;

  RETURN v_membership.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.change_membership_plan(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_membership_plan(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, UUID
) TO authenticated;
