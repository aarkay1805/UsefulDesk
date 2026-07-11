-- ============================================================
-- Harden membership payments
--
-- 1. Make the payments ledger authoritative for fee_status.
-- 2. Validate every new payment against a real, open billing period.
-- 3. Add idempotent transactional RPCs for payment + renewal flows.
-- 4. Store new receipt proofs in a private, account-scoped bucket.
-- 5. Preserve financial history when a member profile is deleted.
-- 6. Add explicit Data API grants for payment tables/functions.
-- ============================================================

-- ---- ledger identity + private receipt metadata ----------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS receipt_bucket TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('paid', 'due', 'void'));

UPDATE public.payments
SET idempotency_key = gen_random_uuid()
WHERE idempotency_key IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN idempotency_key SET DEFAULT gen_random_uuid(),
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_account_idempotency
  ON public.payments(account_id, idempotency_key);

CREATE TABLE IF NOT EXISTS public.membership_operations (
  idempotency_key UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  operation TEXT NOT NULL CHECK (operation IN ('renew', 'convert')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.membership_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_operations_select ON public.membership_operations;
CREATE POLICY membership_operations_select ON public.membership_operations
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS membership_operations_insert ON public.membership_operations;
CREATE POLICY membership_operations_insert ON public.membership_operations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'agent'));

-- Existing zero-value rows remain readable as history, but all NEW rows
-- are rejected by validate_membership_payment below.

-- ---- private payment-receipt bucket -----------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  FALSE,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Account members can read payment receipts" ON storage.objects;
CREATE POLICY "Account members can read payment receipts"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] LIKE 'account-%'
      THEN public.is_account_member(
        substring((storage.foldername(name))[1] FROM 9)::UUID
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Agents can upload payment receipts" ON storage.objects;
CREATE POLICY "Agents can upload payment receipts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] LIKE 'account-%'
      THEN public.is_account_member(
        substring((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Agents can delete staged payment receipts" ON storage.objects;
CREATE POLICY "Agents can delete staged payment receipts"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] LIKE 'account-%'
      THEN public.is_account_member(
        substring((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

-- ---- enforce valid payments at the database boundary -----------
CREATE OR REPLACE FUNCTION public.validate_membership_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
  v_collected NUMERIC(12, 2);
  v_balance NUMERIC(12, 2);
BEGIN
  IF NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'New ledger rows must be paid payments';
  END IF;

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF NEW.membership_id IS NULL THEN
    RAISE EXCEPTION 'A membership is required';
  END IF;

  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = NEW.membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;

  IF NOT public.is_account_member(v_membership.account_id, 'agent') THEN
    RAISE EXCEPTION 'Insufficient access to record this payment';
  END IF;

  NEW.account_id := v_membership.account_id;
  NEW.contact_id := v_membership.contact_id;
  NEW.user_id := COALESCE((SELECT auth.uid()), NEW.user_id);
  NEW.period_end := COALESCE(NEW.period_end, v_membership.end_date);

  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = v_membership.id
    AND period_end = NEW.period_end
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing period not found';
  END IF;

  IF v_period.state = 'void' THEN
    RAISE EXCEPTION 'Payments cannot be recorded against a void billing period';
  END IF;

  NEW.period_start := v_period.period_start;
  NEW.period_end := v_period.period_end;
  NEW.plan_id := v_period.plan_id;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12, 2)
  INTO v_collected
  FROM public.payments
  WHERE membership_id = v_membership.id
    AND period_end = v_period.period_end
    AND status = 'paid';

  v_balance := GREATEST(v_period.fee_amount - v_collected, 0);
  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'This billing period is already settled';
  END IF;

  IF NEW.amount > v_balance THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding balance of %', v_balance;
  END IF;

  IF NEW.receipt_bucket IS NOT NULL
     AND NEW.receipt_bucket <> 'payment-receipts' THEN
    RAISE EXCEPTION 'Unsupported receipt bucket';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_membership_payment ON public.payments;
CREATE TRIGGER trg_validate_membership_payment
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_membership_payment();

-- Agents need to move period snapshots when a membership is edited or
-- unfrozen, but only admins may alter the financial meaning of a row.
CREATE OR REPLACE FUNCTION public.protect_payment_financial_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT public.is_account_member(OLD.account_id, 'admin')
     AND (
       NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
       OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
       OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
       OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
     )
  THEN
    RAISE EXCEPTION 'Only an admin can alter a recorded payment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_payment_financial_fields ON public.payments;
CREATE TRIGGER trg_protect_payment_financial_fields
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_payment_financial_fields();

-- ---- fee_status is a database-maintained cache of ledger balance --
CREATE OR REPLACE FUNCTION public.derive_membership_fee_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_collected NUMERIC(12, 2);
BEGIN
  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12, 2)
  INTO v_collected
  FROM public.payments
  WHERE membership_id = NEW.id
    AND period_end IS NOT DISTINCT FROM NEW.end_date
    AND status = 'paid';

  NEW.fee_status := CASE
    WHEN NEW.is_trial OR NEW.status = 'cancelled' OR NEW.fee_amount <= v_collected
      THEN 'paid'
    ELSE 'due'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_membership_fee_status ON public.memberships;
CREATE TRIGGER trg_derive_membership_fee_status
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.derive_membership_fee_status();

CREATE OR REPLACE FUNCTION public.refresh_membership_fee_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID := COALESCE(NEW.membership_id, OLD.membership_id);
BEGIN
  IF v_membership_id IS NOT NULL THEN
    -- The memberships trigger ignores the supplied value and derives it
    -- from the ledger inside the same transaction.
    UPDATE public.memberships
    SET fee_status = fee_status
    WHERE id = v_membership_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_membership_fee_status ON public.payments;
CREATE TRIGGER trg_refresh_membership_fee_status
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.refresh_membership_fee_status();

-- Reconcile any rows previously changed through "Mark paid only" or a
-- partially failed client-side payment flow.
UPDATE public.memberships SET fee_status = fee_status;

-- ---- idempotent, transactional payment API ----------------------
CREATE OR REPLACE FUNCTION public.record_membership_payment(
  p_membership_id UUID,
  p_period_end DATE,
  p_amount NUMERIC,
  p_method TEXT,
  p_paid_at TIMESTAMPTZ,
  p_note TEXT,
  p_receipt_path TEXT,
  p_idempotency_key UUID
)
RETURNS TABLE(payment_id UUID, amount_paid NUMERIC, balance NUMERIC)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_payment_id UUID;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_account_member(v_membership.account_id, 'agent') THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;

  SELECT id INTO v_payment_id
  FROM public.payments
  WHERE account_id = v_membership.account_id
    AND idempotency_key = p_idempotency_key;

  IF v_payment_id IS NULL THEN
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id,
      amount, method, status, paid_at, period_end,
      screenshot_url, screenshot_path, receipt_bucket, note,
      idempotency_key
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      v_membership.plan_id, (SELECT auth.uid()),
      p_amount, p_method, 'paid', p_paid_at,
      COALESCE(p_period_end, v_membership.end_date),
      NULL, p_receipt_path,
      CASE WHEN p_receipt_path IS NULL THEN NULL ELSE 'payment-receipts' END,
      NULLIF(btrim(p_note), ''), p_idempotency_key
    )
    RETURNING id INTO v_payment_id;
  END IF;

  RETURN QUERY
  SELECT
    v_payment_id,
    mpi.amount_paid,
    mpi.balance
  FROM public.membership_period_invoices mpi
  WHERE mpi.membership_id = v_membership.id
    AND mpi.period_end = COALESCE(p_period_end, v_membership.end_date);
END;
$$;

-- ---- transactional renewal / trial conversion ------------------
CREATE OR REPLACE FUNCTION public.renew_membership_transaction(
  p_membership_id UUID,
  p_plan_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_fee_amount NUMERIC,
  p_collect_amount NUMERIC,
  p_method TEXT,
  p_is_conversion BOOLEAN,
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
  v_period_id UUID;
  v_operation_key UUID;
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

  UPDATE public.memberships
  SET
    plan_id = p_plan_id,
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
      period_start = p_period_start,
      period_end = p_period_end,
      fee_amount = p_fee_amount,
      state = 'open'
    WHERE id = v_period_id;
  ELSE
    INSERT INTO public.membership_periods (
      account_id, membership_id, contact_id, plan_id,
      period_start, period_end, fee_amount, state
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      p_plan_id, p_period_start, p_period_end, p_fee_amount, 'open'
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

-- ---- append-preserving correction path -------------------------
CREATE OR REPLACE FUNCTION public.void_membership_payment(
  p_payment_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_account_member(v_payment.account_id, 'admin') THEN
    RAISE EXCEPTION 'Payment not found or admin access required';
  END IF;
  IF v_payment.status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid payment can be voided';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  UPDATE public.payments
  SET
    status = 'void',
    voided_at = NOW(),
    voided_by = (SELECT auth.uid()),
    void_reason = btrim(p_reason)
  WHERE id = p_payment_id;

  RETURN p_payment_id;
END;
$$;

-- ---- preserve the financial ledger on member deletion ----------
CREATE OR REPLACE FUNCTION public.delete_member(p_contact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account
  FROM public.contacts
  WHERE id = p_contact_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF NOT public.is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Only an owner or admin can delete a member';
  END IF;

  -- payments.contact_id and payments.membership_id are SET NULL, so the
  -- financial ledger survives while personal/member data is removed.
  DELETE FROM public.contacts WHERE id = p_contact_id;
END;
$$;

-- ---- explicit privileges + function hardening ------------------
GRANT SELECT, INSERT, UPDATE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.memberships TO authenticated;
GRANT SELECT, INSERT ON public.membership_operations TO authenticated;
GRANT SELECT ON public.membership_dues TO authenticated;
GRANT SELECT ON public.membership_period_invoices TO authenticated;

REVOKE ALL ON public.payments FROM anon;
REVOKE ALL ON public.membership_periods FROM anon;
REVOKE ALL ON public.membership_operations FROM anon;
REVOKE SELECT ON public.membership_dues FROM anon;
REVOKE SELECT ON public.membership_period_invoices FROM anon;

REVOKE EXECUTE ON FUNCTION public.record_membership_payment(
  UUID, DATE, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_membership_payment(
  UUID, DATE, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.renew_membership_transaction(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, TEXT, BOOLEAN, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_membership_transaction(
  UUID, UUID, DATE, DATE, NUMERIC, NUMERIC, TEXT, BOOLEAN, UUID
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_member(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.void_membership_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_membership_payment(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.validate_membership_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.derive_membership_fee_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_membership_fee_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_payment_financial_fields() FROM PUBLIC, anon, authenticated;

-- Tighten write policies so account_id cannot be reassigned during an update.
DROP POLICY IF EXISTS payments_update ON public.payments;
CREATE POLICY payments_update ON public.payments FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS membership_periods_update ON public.membership_periods;
CREATE POLICY membership_periods_update ON public.membership_periods FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS memberships_update ON public.memberships;
CREATE POLICY memberships_update ON public.memberships FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));
