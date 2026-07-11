-- ============================================================
-- 058_payment_hardening_followups.sql — close the gaps left by the
-- payment-hardening pass (20260711173414):
--
-- 1. Payments' period columns (period_start/period_end/plan_id) become
--    protected financial fields: they define which invoice a payment
--    reconciles to, so an agent moving them via a direct table update
--    could forge fee_status ("paid" without money) or hide arrears.
--    Legitimate re-stamps (edit / unfreeze move the cycle key) now only
--    happen inside the transactional RPCs below, which raise a
--    transaction-local GUC (`app.allow_payment_restamp`) the trigger
--    honours. Clients cannot set GUCs through PostgREST, so the only
--    path to a re-stamp is a validated RPC (or an admin).
--
-- 2. The former client-side membership-lifecycle flows (edit, unfreeze,
--    cancel, reactivate) were 2–3 sequential writes; a failure midway
--    left membership / period / payments on different period keys and a
--    fully-paid cycle read back as Unpaid. Each is now one RPC = one
--    transaction:
--      * edit_membership_cycle      — edit plan/dates/fee (+ trial flag,
--                                     notes), sync period, re-stamp.
--      * unfreeze_membership        — resume + shift end_date, sync
--                                     period, re-stamp.
--      * set_membership_cancellation— cancel/reactivate + flip the
--                                     current period open<->void.
--
-- 3. Storage: the payment-receipts DELETE policy matched every object,
--    so any agent could destroy the proof behind a persisted payment
--    (void is admin-only + reasoned, but its evidence wasn't). Agents
--    may now only delete UNREFERENCED (staged) objects; admins retain
--    full delete for moderation.
--
-- 4. membership_periods DELETE drops from agent to admin — deleting a
--    period erases an arrears invoice and orphans its payments; nothing
--    in the product deletes periods, so this is defense only.
--
-- Idempotent: CREATE OR REPLACE + drop-then-create policies.
-- ============================================================

-- ---- 1. protect the reconciliation key on payments ---------------
CREATE OR REPLACE FUNCTION public.protect_payment_financial_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Service-role / definer paths (no JWT) and admins are unrestricted.
  IF (SELECT auth.uid()) IS NULL
     OR public.is_account_member(OLD.account_id, 'admin') THEN
    RETURN NEW;
  END IF;

  -- Core financial identity: never agent-editable.
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
     OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
     OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
  THEN
    RAISE EXCEPTION 'Only an admin can alter a recorded payment';
  END IF;

  -- The period key decides WHICH invoice this money settles — equally
  -- financial. Agent re-stamps are only allowed inside the lifecycle
  -- RPCs below, which set this transaction-local flag.
  IF (
       NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     )
     AND COALESCE(current_setting('app.allow_payment_restamp', TRUE), '') <> '1'
  THEN
    RAISE EXCEPTION 'Payments can only be moved between billing periods by an admin or a membership-lifecycle operation';
  END IF;

  RETURN NEW;
END;
$$;

-- NOTE: the "sync current period" logic (lock latest period → re-stamp
-- its payments under the GUC → move the period) is deliberately INLINED
-- in edit_membership_cycle and unfreeze_membership rather than a shared
-- helper. A helper callable by `authenticated` would itself be the
-- restamp primitive this migration removes; one revoked from
-- `authenticated` can't be called from these SECURITY INVOKER RPCs.

-- ---- 2a. transactional membership edit ---------------------------
CREATE OR REPLACE FUNCTION public.edit_membership_cycle(
  p_membership_id UUID,
  p_plan_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_fee_amount NUMERIC,
  p_is_trial BOOLEAN,
  p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
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
        period_start = p_period_start,
        period_end = p_period_end,
        fee_amount = p_fee_amount
    WHERE id = v_period.id;
  END IF;

  UPDATE public.memberships
  SET plan_id = p_plan_id,
      start_date = p_period_start,
      end_date = p_period_end,
      fee_amount = p_fee_amount,
      is_trial = p_is_trial,
      notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = v_membership.id;

  RETURN v_membership.id;
END;
$$;

-- ---- 2b. transactional unfreeze ----------------------------------
CREATE OR REPLACE FUNCTION public.unfreeze_membership(
  p_membership_id UUID,
  p_new_end_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_account_member(v_membership.account_id, 'agent') THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;
  IF v_membership.status <> 'frozen' THEN
    RAISE EXCEPTION 'Only a frozen membership can be resumed';
  END IF;
  IF p_new_end_date < v_membership.end_date THEN
    RAISE EXCEPTION 'Resuming cannot shorten the membership';
  END IF;

  -- Same cycle, shifted forward by the frozen days: re-stamp the
  -- cycle's payments to the new end so they keep reconciling, then
  -- move the period itself.
  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = v_membership.id
  ORDER BY period_start DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_period.period_end IS DISTINCT FROM p_new_end_date THEN
      PERFORM set_config('app.allow_payment_restamp', '1', TRUE);
      UPDATE public.payments
      SET period_start = v_membership.start_date,
          period_end = p_new_end_date
      WHERE membership_id = v_membership.id
        AND period_end = v_period.period_end;
      PERFORM set_config('app.allow_payment_restamp', '', TRUE);
    END IF;

    UPDATE public.membership_periods
    SET period_start = v_membership.start_date,
        period_end = p_new_end_date
    WHERE id = v_period.id;
  END IF;

  UPDATE public.memberships
  SET status = 'active',
      frozen_at = NULL,
      end_date = p_new_end_date
  WHERE id = v_membership.id;

  RETURN v_membership.id;
END;
$$;

-- ---- 2c. transactional cancel / reactivate -----------------------
CREATE OR REPLACE FUNCTION public.set_membership_cancellation(
  p_membership_id UUID,
  p_cancelled BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_period_id UUID;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_account_member(v_membership.account_id, 'agent') THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;

  IF p_cancelled THEN
    UPDATE public.memberships
    SET status = 'cancelled', frozen_at = NULL
    WHERE id = v_membership.id;
  ELSE
    IF v_membership.status <> 'cancelled' THEN
      RAISE EXCEPTION 'Only a cancelled membership can be reactivated';
    END IF;
    UPDATE public.memberships
    SET status = 'active'
    WHERE id = v_membership.id;
  END IF;

  -- Flip the CURRENT cycle's invoice; settled past cycles stay as-is.
  SELECT id INTO v_period_id
  FROM public.membership_periods
  WHERE membership_id = v_membership.id
  ORDER BY period_start DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_period_id IS NOT NULL THEN
    UPDATE public.membership_periods
    SET state = CASE WHEN p_cancelled THEN 'void' ELSE 'open' END
    WHERE id = v_period_id;
  END IF;

  RETURN v_membership.id;
END;
$$;

-- ---- 3. storage: agents may only delete UNREFERENCED receipts ----
DROP POLICY IF EXISTS "Agents can delete staged payment receipts" ON storage.objects;
CREATE POLICY "Agents can delete staged payment receipts"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] LIKE 'account-%'
      THEN
        public.is_account_member(
          substring((storage.foldername(name))[1] FROM 9)::UUID,
          'agent'
        )
        AND (
          -- Admins may remove any receipt (moderation); agents only
          -- objects no persisted payment points at (staged uploads).
          public.is_account_member(
            substring((storage.foldername(name))[1] FROM 9)::UUID,
            'admin'
          )
          OR NOT EXISTS (
            SELECT 1 FROM public.payments p
            WHERE p.receipt_bucket = 'payment-receipts'
              AND p.screenshot_path = storage.objects.name
          )
        )
      ELSE FALSE
    END
  );

-- ---- 4. membership_periods delete: admin only --------------------
DROP POLICY IF EXISTS membership_periods_delete ON public.membership_periods;
CREATE POLICY membership_periods_delete ON public.membership_periods
  FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

-- ---- privileges ---------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.edit_membership_cycle(
  UUID, UUID, DATE, DATE, NUMERIC, BOOLEAN, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_membership_cycle(
  UUID, UUID, DATE, DATE, NUMERIC, BOOLEAN, TEXT
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.unfreeze_membership(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unfreeze_membership(UUID, DATE) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_membership_cancellation(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_membership_cancellation(UUID, BOOLEAN) TO authenticated;
