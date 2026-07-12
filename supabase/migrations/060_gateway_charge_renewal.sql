-- ============================================================
-- 060_gateway_charge_renewal.sql — auto-renew on auto-debit charge.
--
-- The webhook's `subscription.charged` handler used record_gateway_payment,
-- which only ever settles the CURRENT period. That works for the FIRST
-- charge but breaks on every renewal: the current period is already paid,
-- so a 2nd-cycle charge hits "billing period already settled" and the
-- money lands nowhere.
--
-- `record_gateway_charge` fixes this in ONE transaction:
--   - Idempotent on gateway_payment_id (a webhook retry is a no-op).
--   - If the current period still owes money → settle it (first charge /
--     catch-up).
--   - If the current period is fully paid → this is a renewal: open the
--     next cycle's period, roll the membership pointer forward, and settle
--     THAT period.
-- The payment insert still runs through validate_membership_payment (open
-- period, amount>0, ≤ balance) under the `app.system_payment` GUC, so a
-- forged charge still can't overpay.
--
-- SECURITY DEFINER + granted only to service_role (the webhook), like the
-- other gateway RPCs.
-- ============================================================

-- OUT column is `settled_period_end` (not `period_end`) so it can't
-- collide with the `payments.period_end` table column referenced in the
-- balance query below. DROP first since renaming an OUT column can't be
-- done through CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.record_gateway_charge(UUID, UUID, TEXT, NUMERIC, TEXT, UUID);

CREATE FUNCTION public.record_gateway_charge(
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
  v_period public.membership_periods%ROWTYPE;
  v_collected NUMERIC(12, 2);
  v_balance NUMERIC(12, 2);
  v_payment_id UUID;
  v_duration INT;
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
    SELECT duration_days INTO v_duration
    FROM public.membership_plans
    WHERE id = v_membership.plan_id;
    IF v_duration IS NULL THEN
      RAISE EXCEPTION 'Cannot auto-renew: membership has no plan duration';
    END IF;

    v_new_start := v_membership.end_date;
    v_new_end := v_new_start + v_duration;

    INSERT INTO public.membership_periods (
      account_id, membership_id, contact_id, plan_id,
      period_start, period_end, fee_amount, state
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      v_membership.plan_id, v_new_start, v_new_end, v_membership.fee_amount, 'open'
    );

    UPDATE public.memberships
    SET start_date = v_new_start,
        end_date = v_new_end,
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
