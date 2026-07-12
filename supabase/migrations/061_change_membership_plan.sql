-- ============================================================
-- 061_change_membership_plan.sql — mid-cycle plan change ("swap /
-- upgrade membership") as ONE transaction.
--
-- A member switching plans before their cycle ends is neither an edit
-- (which rewrites the current cycle in place) nor a renewal (which
-- opens the next cycle at the old expiry). The correct shape:
--
--   1. TRUNCATE the current period at the switch date and re-invoice
--      it at the pro-rated value of the days actually used
--      (p_old_fee_amount, computed in TS by planChangeQuote — day math
--      stays out of SQL, same convention as unfreeze). Its payments are
--      re-stamped to the new period key under the 058 GUC so they keep
--      reconciling; any over-payment on the truncated cycle IS the
--      credit that moves forward.
--   2. OPEN a new period on the new plan from the switch date, invoiced
--      at p_fee_amount (new plan price minus the credit — also quoted
--      in TS, staff-overridable like every other fee field).
--   3. Roll the membership pointer to the new cycle.
--   4. Optionally record a first collection against it.
--
-- Idempotent via membership_operations ('plan_change' joins the CHECK).
-- SECURITY INVOKER like its 058 siblings; the payment re-stamp is the
-- only privileged step and rides the transaction-local
-- app.allow_payment_restamp GUC.
-- ============================================================

-- 'plan_change' becomes a recognised idempotent operation.
ALTER TABLE public.membership_operations
  DROP CONSTRAINT IF EXISTS membership_operations_operation_check;
ALTER TABLE public.membership_operations
  ADD CONSTRAINT membership_operations_operation_check
  CHECK (operation IN ('renew', 'convert', 'plan_change'));

CREATE OR REPLACE FUNCTION public.change_membership_plan(
  p_membership_id UUID,
  p_plan_id UUID,
  p_switch_date DATE,
  p_period_end DATE,
  p_old_fee_amount NUMERIC,
  p_fee_amount NUMERIC,
  p_collect_amount NUMERIC,
  p_method TEXT,
  p_idempotency_key UUID
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
    account_id, membership_id, contact_id, plan_id,
    period_start, period_end, fee_amount, state
  )
  VALUES (
    v_membership.account_id, v_membership.id, v_membership.contact_id,
    p_plan_id, p_switch_date, p_period_end, p_fee_amount, 'open'
  );

  UPDATE public.memberships
  SET plan_id = p_plan_id,
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
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_membership_plan(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID
) TO authenticated;
