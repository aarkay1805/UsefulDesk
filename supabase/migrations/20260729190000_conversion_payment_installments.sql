-- ============================================================
-- Lead-conversion payment installments
--
-- A conversion can settle its first invoice in full now or record a
-- fixed 60/40 promise: 60% is paid immediately and the remaining 40%
-- is due 28 account-local days later. The promise remains attached to
-- the same membership period/invoice; it never creates a second invoice.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.membership_installment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  period_end DATE NOT NULL,
  first_payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  first_amount NUMERIC(12, 2) NOT NULL CHECK (first_amount > 0),
  second_amount NUMERIC(12, 2) NOT NULL CHECK (second_amount > 0),
  second_due_on DATE NOT NULL,
  split_percent_now SMALLINT NOT NULL DEFAULT 60
    CHECK (split_percent_now = 60),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
    DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (membership_id, period_end),
  UNIQUE (first_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_installments_account_due
  ON public.membership_installment_plans(account_id, second_due_on);

ALTER TABLE public.membership_installment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS membership_installments_select
  ON public.membership_installment_plans;
DROP POLICY IF EXISTS membership_installments_insert
  ON public.membership_installment_plans;

CREATE POLICY membership_installments_select
  ON public.membership_installment_plans
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

CREATE POLICY membership_installments_insert
  ON public.membership_installment_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND created_by = (SELECT auth.uid())
  );

-- Claim-first WhatsApp delivery ledger. Dashboard clients can read the
-- audit history; only the service-role reminder route writes claims.
CREATE TABLE IF NOT EXISTS public.installment_reminders_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  installment_plan_id UUID NOT NULL
    REFERENCES public.membership_installment_plans(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  due_on DATE NOT NULL,
  days_before INTEGER NOT NULL CHECK (days_before IN (0, 1, 3, 7)),
  wa_message_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installment_plan_id, due_on, days_before)
);

CREATE INDEX IF NOT EXISTS idx_installment_reminders_account_time
  ON public.installment_reminders_sent(account_id, sent_at DESC);

ALTER TABLE public.installment_reminders_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installment_reminders_select
  ON public.installment_reminders_sent;

CREATE POLICY installment_reminders_select
  ON public.installment_reminders_sent
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

-- Defense in depth for direct Data API inserts: even an agent can only
-- create the exact promise backed by a real, paid 60% ledger row for the
-- same open invoice. Normal UI writes go through the RPC below.
CREATE OR REPLACE FUNCTION public.validate_membership_installment_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_fee NUMERIC(12, 2);
  v_payment public.payments%ROWTYPE;
  v_membership public.memberships%ROWTYPE;
  v_timezone TEXT;
  v_expected_first NUMERIC(12, 2);
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = NEW.membership_id;

  IF NOT FOUND
    OR v_membership.account_id <> NEW.account_id
    OR v_membership.contact_id <> NEW.contact_id
    OR NOT public.is_account_member(NEW.account_id, 'agent')
  THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;

  SELECT mp.fee_amount INTO v_fee
  FROM public.membership_periods mp
  WHERE mp.membership_id = NEW.membership_id
    AND mp.period_end = NEW.period_end
    AND mp.state = 'open';

  IF v_fee IS NULL THEN
    RAISE EXCEPTION 'Open membership invoice not found';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = NEW.first_payment_id
    AND account_id = NEW.account_id
    AND membership_id = NEW.membership_id
    AND contact_id = NEW.contact_id
    AND period_end = NEW.period_end
    AND status = 'paid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The first installment payment was not recorded';
  END IF;

  v_expected_first := ROUND(v_fee * 0.60, 2);
  IF NEW.first_amount <> v_expected_first
    OR NEW.second_amount <> ROUND(v_fee - v_expected_first, 2)
    OR v_payment.amount <> NEW.first_amount
    OR NEW.split_percent_now <> 60
  THEN
    RAISE EXCEPTION 'Installment amounts must use the 60/40 invoice split';
  END IF;

  SELECT timezone INTO v_timezone
  FROM public.accounts
  WHERE id = NEW.account_id;

  IF NEW.second_due_on <>
    ((v_payment.paid_at AT TIME ZONE COALESCE(v_timezone, 'Asia/Kolkata'))::date + 28)
  THEN
    RAISE EXCEPTION 'The second installment must be due 28 days after payment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_membership_installment_plan
  ON public.membership_installment_plans;
CREATE TRIGGER trg_validate_membership_installment_plan
  BEFORE INSERT ON public.membership_installment_plans
  FOR EACH ROW EXECUTE FUNCTION public.validate_membership_installment_plan();

CREATE OR REPLACE FUNCTION public.record_membership_installment_payment(
  p_membership_id UUID,
  p_period_end DATE,
  p_method TEXT,
  p_paid_at TIMESTAMPTZ,
  p_idempotency_key UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_fee NUMERIC(12, 2);
  v_first_amount NUMERIC(12, 2);
  v_second_amount NUMERIC(12, 2);
  v_payment_id UUID;
  v_plan_id UUID;
  v_timezone TEXT;
BEGIN
  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND
    OR NOT public.is_account_member(v_membership.account_id, 'agent')
  THEN
    RAISE EXCEPTION 'Membership not found or access denied';
  END IF;

  SELECT mp.fee_amount INTO v_fee
  FROM public.membership_periods mp
  WHERE mp.membership_id = v_membership.id
    AND mp.period_end = p_period_end
    AND mp.state = 'open'
  FOR UPDATE;

  IF v_fee IS NULL OR v_fee <= 0 THEN
    RAISE EXCEPTION 'Open membership invoice not found';
  END IF;

  v_first_amount := ROUND(v_fee * 0.60, 2);
  v_second_amount := ROUND(v_fee - v_first_amount, 2);

  IF v_first_amount <= 0 OR v_second_amount <= 0 THEN
    RAISE EXCEPTION 'Invoice is too small to split into installments';
  END IF;

  SELECT rp.payment_id INTO v_payment_id
  FROM public.record_membership_payment(
    v_membership.id,
    p_period_end,
    v_first_amount,
    p_method,
    p_paid_at,
    '',
    NULL,
    p_idempotency_key
  ) rp;

  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'The first installment payment could not be recorded';
  END IF;

  SELECT timezone INTO v_timezone
  FROM public.accounts
  WHERE id = v_membership.account_id;

  INSERT INTO public.membership_installment_plans (
    account_id,
    membership_id,
    contact_id,
    period_end,
    first_payment_id,
    first_amount,
    second_amount,
    second_due_on,
    split_percent_now,
    created_by
  )
  VALUES (
    v_membership.account_id,
    v_membership.id,
    v_membership.contact_id,
    p_period_end,
    v_payment_id,
    v_first_amount,
    v_second_amount,
    (
      p_paid_at AT TIME ZONE COALESCE(v_timezone, 'Asia/Kolkata')
    )::date + 28,
    60,
    (SELECT auth.uid())
  )
  ON CONFLICT (membership_id, period_end) DO NOTHING
  RETURNING id INTO v_plan_id;

  IF v_plan_id IS NULL THEN
    SELECT id INTO v_plan_id
    FROM public.membership_installment_plans
    WHERE membership_id = v_membership.id
      AND period_end = p_period_end;
  END IF;

  RETURN v_plan_id;
END;
$$;

GRANT SELECT, INSERT ON public.membership_installment_plans TO authenticated;
GRANT SELECT ON public.installment_reminders_sent TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.membership_installment_plans, public.installment_reminders_sent
  TO service_role;

REVOKE ALL ON public.membership_installment_plans,
  public.installment_reminders_sent FROM anon;

REVOKE EXECUTE ON FUNCTION public.record_membership_installment_payment(
  UUID, DATE, TEXT, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_membership_installment_payment(
  UUID, DATE, TEXT, TIMESTAMPTZ, UUID
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.validate_membership_installment_plan()
  FROM PUBLIC, anon, authenticated;
