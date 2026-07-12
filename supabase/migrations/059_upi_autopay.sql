-- ============================================================
-- 059_upi_autopay.sql — UPI AutoPay (mandate auto-debit), Phase 2
--
-- Adds a gateway-driven recurring auto-debit layer ON TOP of the manual
-- payments ledger. Auto and manual collection share ONE ledger: every
-- rupee still lands in `payments` and settles a `membership_periods`
-- invoice, so dues / invoices / fee_status / reports are unaware there
-- are two modes. `source='manual'` = today's behaviour (zero regression).
--
-- The load-bearing change: a webhook runs as the service role with NO
-- auth.uid(), so `validate_membership_payment`'s agent-access check would
-- reject a gateway insert. We add a transaction-local GUC
-- `app.system_payment` (mirrors 058's `app.allow_payment_restamp`): the
-- SECURITY DEFINER RPC `record_gateway_payment` sets it, and the validate
-- trigger skips ONLY the agent check when it is set — every financial
-- guard (real open period, amount > 0, amount <= outstanding balance)
-- still runs. Clients cannot set GUCs through PostgREST, so the only path
-- to a system payment is the definer RPC, called from the verified
-- webhook route.
--
-- Idempotent: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, drop-then-
-- create policies, DO $$ guards on enum-like additions.
-- ============================================================

-- ---- 1. ledger: distinguish auto from manual, allow system rows --
-- A gateway charge has no human recorder, so user_id becomes nullable
-- (manual rows still set it via the RPC / validate trigger).
ALTER TABLE public.payments
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS mandate_id UUID,
  ADD COLUMN IF NOT EXISTS gateway_payment_id TEXT;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_source_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_source_check CHECK (source IN ('manual', 'auto'));

-- One ledger row per gateway payment id (webhook retries can't double-credit).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_gateway_payment_id
  ON public.payments(account_id, gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

-- ---- 2. membership: which collection mode chases dues ------------
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS collection_mode TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_collection_mode_check;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_collection_mode_check
  CHECK (collection_mode IN ('manual', 'auto'));

-- ---- 3. payment_mandates — the saved recurring method -----------
CREATE TABLE IF NOT EXISTS public.payment_mandates (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  membership_id           UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  contact_id              UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  gateway                 TEXT NOT NULL DEFAULT 'razorpay',
  gateway_customer_id     TEXT,
  gateway_token_id        TEXT,
  gateway_subscription_id TEXT,
  vpa                     TEXT,
  method                  TEXT NOT NULL DEFAULT 'upi' CHECK (method IN ('upi', 'card', 'emandate')),
  max_amount              NUMERIC(12, 2),
  frequency               TEXT CHECK (frequency IN ('monthly', 'quarterly')),
  status                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'paused', 'revoked', 'expired', 'failed')),
  authed_at               TIMESTAMPTZ,
  next_charge_at          DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_mandates_account    ON public.payment_mandates(account_id);
CREATE INDEX IF NOT EXISTS idx_payment_mandates_membership ON public.payment_mandates(membership_id);
-- One live mandate per membership.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_mandate_active
  ON public.payment_mandates(membership_id) WHERE status = 'active';

-- Now that the table exists, wire the ledger FK.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_mandate_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_mandate_id_fkey
  FOREIGN KEY (mandate_id) REFERENCES public.payment_mandates(id) ON DELETE SET NULL;

ALTER TABLE public.payment_mandates ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.payment_mandates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.payment_mandates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Read = any member (drives the UI badge); write = agent; delete = admin.
-- Most writes happen server-side, but the invoker paths (staff pause /
-- cancel) go through these.
DROP POLICY IF EXISTS payment_mandates_select ON public.payment_mandates;
CREATE POLICY payment_mandates_select ON public.payment_mandates
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS payment_mandates_insert ON public.payment_mandates;
CREATE POLICY payment_mandates_insert ON public.payment_mandates
  FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS payment_mandates_update ON public.payment_mandates;
CREATE POLICY payment_mandates_update ON public.payment_mandates
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS payment_mandates_delete ON public.payment_mandates;
CREATE POLICY payment_mandates_delete ON public.payment_mandates
  FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'));

-- ---- 4. webhook_events — idempotency + audit (service-role only) -
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id           TEXT PRIMARY KEY,            -- gateway event id
  account_id   UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  gateway      TEXT NOT NULL DEFAULT 'razorpay',
  type         TEXT NOT NULL,
  payload      JSONB,
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- RLS on with NO policies = no client (authenticated/anon) access; the
-- webhook route uses the service role, which bypasses RLS.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ---- 5. gateway credentials — admin-only, secret never member-read
-- Kept OFF `accounts` (whose row is member-readable) so the webhook
-- secret can't leak to a member SELECT. Server routes use the service
-- role, which bypasses RLS, so they read it regardless.
CREATE TABLE IF NOT EXISTS public.account_payment_credentials (
  account_id            UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  gateway               TEXT NOT NULL DEFAULT 'razorpay',
  razorpay_key_id       TEXT,
  razorpay_key_secret   TEXT,
  razorpay_webhook_secret TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.account_payment_credentials ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.account_payment_credentials;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.account_payment_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Admin-only read AND write (secret material). Non-admins get nothing.
DROP POLICY IF EXISTS account_payment_credentials_all ON public.account_payment_credentials;
CREATE POLICY account_payment_credentials_all ON public.account_payment_credentials
  FOR ALL TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- ============================================================
-- 6. validate_membership_payment — add the system-payment bypass.
--
-- Reproduced verbatim from 20260711173414 EXCEPT the agent-access check,
-- which is now skipped when the transaction-local GUC `app.system_payment`
-- is '1'. Every other guard is unchanged, so a system row must still hit
-- a real, open, unsettled period for an amount within its balance.
-- ============================================================
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
  v_system BOOLEAN := COALESCE(current_setting('app.system_payment', TRUE), '') = '1';
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

  -- System (gateway) inserts have no auth.uid(); the definer RPC that
  -- sets the GUC has already authorised them. Human inserts still need
  -- agent access.
  IF NOT v_system
     AND NOT public.is_account_member(v_membership.account_id, 'agent') THEN
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

-- ============================================================
-- 7. record_gateway_payment — the money path for the webhook.
--
-- SECURITY DEFINER: no JWT in a service-role webhook, so this runs as the
-- table owner, authorises the row via the `app.system_payment` GUC, and
-- inserts a `source='auto'` ledger row. Dedupes on gateway_payment_id so
-- webhook retries are safe. Every financial guard runs inside the
-- validate trigger above.
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_gateway_payment(
  p_account_id UUID,
  p_membership_id UUID,
  p_gateway_payment_id TEXT,
  p_amount NUMERIC,
  p_method TEXT,
  p_period_end DATE,
  p_mandate_id UUID
)
RETURNS TABLE(payment_id UUID, amount_paid NUMERIC, balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_payment_id UUID;
  v_period_end DATE;
BEGIN
  IF p_gateway_payment_id IS NULL OR btrim(p_gateway_payment_id) = '' THEN
    RAISE EXCEPTION 'A gateway payment id is required';
  END IF;

  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND OR v_membership.account_id <> p_account_id THEN
    RAISE EXCEPTION 'Membership not found for this account';
  END IF;

  v_period_end := COALESCE(p_period_end, v_membership.end_date);

  -- Idempotency: a retry of an already-recorded gateway payment returns
  -- the existing row instead of inserting again.
  SELECT id INTO v_payment_id
  FROM public.payments
  WHERE account_id = p_account_id
    AND gateway_payment_id = p_gateway_payment_id;

  IF v_payment_id IS NULL THEN
    PERFORM set_config('app.system_payment', '1', TRUE);
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id,
      amount, method, status, paid_at, period_end,
      source, mandate_id, gateway_payment_id
    )
    VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      v_membership.plan_id, NULL,
      p_amount, p_method, 'paid', NOW(), v_period_end,
      'auto', p_mandate_id, p_gateway_payment_id
    )
    RETURNING id INTO v_payment_id;
    PERFORM set_config('app.system_payment', '', TRUE);
  END IF;

  RETURN QUERY
  SELECT
    v_payment_id,
    mpi.amount_paid,
    mpi.balance
  FROM public.membership_period_invoices mpi
  WHERE mpi.membership_id = v_membership.id
    AND mpi.period_end = v_period_end;
END;
$$;

-- ============================================================
-- 8. mandate lifecycle (definer) — called from the verified webhook.
--    activate: mandate goes live -> membership switches to auto.
--    revoke:   mandate ends       -> membership falls back to manual
--              chase (renewal cron + WhatsApp remind).
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_mandate(
  p_mandate_id UUID,
  p_token_id TEXT,
  p_subscription_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mandate public.payment_mandates%ROWTYPE;
BEGIN
  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE id = p_mandate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mandate not found';
  END IF;

  UPDATE public.payment_mandates
  SET status = 'active',
      gateway_token_id = COALESCE(p_token_id, gateway_token_id),
      gateway_subscription_id = COALESCE(p_subscription_id, gateway_subscription_id),
      authed_at = COALESCE(authed_at, NOW())
  WHERE id = p_mandate_id;

  UPDATE public.memberships
  SET collection_mode = 'auto'
  WHERE id = v_mandate.membership_id;

  RETURN p_mandate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_mandate(
  p_mandate_id UUID,
  p_status TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mandate public.payment_mandates%ROWTYPE;
BEGIN
  IF p_status NOT IN ('paused', 'revoked', 'expired', 'failed') THEN
    RAISE EXCEPTION 'Invalid mandate end state';
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE id = p_mandate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mandate not found';
  END IF;

  UPDATE public.payment_mandates
  SET status = p_status
  WHERE id = p_mandate_id;

  -- No other active mandate -> back to manual collection.
  UPDATE public.memberships m
  SET collection_mode = 'manual'
  WHERE m.id = v_mandate.membership_id
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_mandates pm
      WHERE pm.membership_id = m.id AND pm.status = 'active'
    );

  RETURN p_mandate_id;
END;
$$;

-- ---- 9. privileges ----------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_mandates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.account_payment_credentials TO authenticated;
REVOKE ALL ON public.webhook_events FROM anon, authenticated;
REVOKE ALL ON public.payment_mandates FROM anon;
REVOKE ALL ON public.account_payment_credentials FROM anon;

-- The gateway RPCs are DEFINER and must NOT be reachable by clients — only
-- the service-role webhook route calls them.
REVOKE EXECUTE ON FUNCTION public.record_gateway_payment(UUID, UUID, TEXT, NUMERIC, TEXT, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.activate_mandate(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_mandate(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The webhook route runs as the service role: grant it the tables + the
-- definer RPCs explicitly, since REVOKE ... FROM PUBLIC above stripped the
-- implicit EXECUTE it inherited.
GRANT SELECT, INSERT, UPDATE ON public.webhook_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payment_mandates TO service_role;
GRANT SELECT ON public.account_payment_credentials TO service_role;
GRANT EXECUTE ON FUNCTION public.record_gateway_payment(UUID, UUID, TEXT, NUMERIC, TEXT, DATE, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_mandate(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_mandate(UUID, TEXT) TO service_role;
