-- Razorpay Stage 3: durable, retry-safe Payment Links for exact INR invoice
-- balances. Browser roles may read tenant-scoped link status only; every
-- provider mutation and financial write crosses a service-role-only RPC.

-- ---------------------------------------------------------------------------
-- Payment provenance and immutable gateway facts
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_source_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_source_check
  CHECK (source IN ('manual', 'auto', 'payment_link'));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS gateway_metadata JSONB;

CREATE OR REPLACE FUNCTION public.protect_gateway_payment_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source
     OR NEW.mandate_id IS DISTINCT FROM OLD.mandate_id
     OR NEW.gateway_payment_id IS DISTINCT FROM OLD.gateway_payment_id
     OR NEW.gateway_metadata IS DISTINCT FROM OLD.gateway_metadata
     OR NEW.payment_purpose IS DISTINCT FROM OLD.payment_purpose THEN
    RAISE EXCEPTION 'Gateway payment identity and provenance are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_gateway_payment_identity ON public.payments;
CREATE TRIGGER trg_protect_gateway_payment_identity
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_gateway_payment_identity();

REVOKE ALL ON FUNCTION public.protect_gateway_payment_identity()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Local Payment Link intent/revision ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.razorpay_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  reference_id TEXT NOT NULL CHECK (
    length(reference_id) BETWEEN 10 AND 40
    AND reference_id ~ '^[A-Za-z0-9_-]+$'
  ),
  gateway_link_id TEXT,
  expected_amount NUMERIC(12, 2) NOT NULL CHECK (expected_amount > 0),
  expected_amount_subunits BIGINT NOT NULL CHECK (expected_amount_subunits > 0),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  short_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (
    status IN (
      'creating', 'created', 'cancel_requested', 'paid', 'cancelled',
      'expired', 'orphaned', 'failed'
    )
  ),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  setup_error TEXT,
  remote_status TEXT,
  last_verified_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  next_reconcile_at TIMESTAMPTZ,
  recovery_owner UUID,
  recovery_lease_until TIMESTAMPTZ,
  reconcile_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (reconcile_attempt_count >= 0),
  last_whatsapp_message_id TEXT,
  last_sent_at TIMESTAMPTZ,
  last_delivery_error TEXT,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, invoice_id, revision),
  UNIQUE (account_id, reference_id),
  UNIQUE (account_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_payment_links_gateway
  ON public.razorpay_payment_links(account_id, gateway_link_id)
  WHERE gateway_link_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_payment_links_blocking_invoice
  ON public.razorpay_payment_links(invoice_id)
  WHERE status IN ('creating', 'created', 'cancel_requested', 'orphaned');
CREATE INDEX IF NOT EXISTS idx_razorpay_payment_links_recovery
  ON public.razorpay_payment_links(next_reconcile_at, created_at)
  WHERE status IN ('creating', 'created', 'cancel_requested', 'orphaned');
CREATE INDEX IF NOT EXISTS idx_razorpay_payment_links_created_by
  ON public.razorpay_payment_links(created_by);

ALTER TABLE public.razorpay_payment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS razorpay_payment_links_select
  ON public.razorpay_payment_links;
CREATE POLICY razorpay_payment_links_select
  ON public.razorpay_payment_links FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

REVOKE ALL ON public.razorpay_payment_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.razorpay_payment_links TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.razorpay_payment_links TO service_role;

-- Provider-confirmed Payment Link money that cannot safely enter the ledger.
CREATE TABLE IF NOT EXISTS public.gateway_payment_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  payment_link_id UUID REFERENCES public.razorpay_payment_links(id) ON DELETE SET NULL,
  webhook_event_id TEXT REFERENCES public.webhook_events(id) ON DELETE SET NULL,
  gateway TEXT NOT NULL DEFAULT 'razorpay' CHECK (gateway = 'razorpay'),
  gateway_link_id TEXT,
  gateway_payment_id TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT,
  method TEXT,
  payment_status TEXT,
  reason_code TEXT NOT NULL,
  reason_message TEXT NOT NULL,
  provider_facts JSONB,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'ignored')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  UNIQUE (account_id, gateway_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_invoice
  ON public.gateway_payment_exceptions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_payment_link
  ON public.gateway_payment_exceptions(payment_link_id);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_webhook_event
  ON public.gateway_payment_exceptions(webhook_event_id);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_resolved_by
  ON public.gateway_payment_exceptions(resolved_by);

CREATE INDEX IF NOT EXISTS idx_gateway_payment_exceptions_open
  ON public.gateway_payment_exceptions(account_id, first_seen_at DESC)
  WHERE status = 'open';

ALTER TABLE public.gateway_payment_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_payment_exceptions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.gateway_payment_exceptions
  TO service_role;

-- ---------------------------------------------------------------------------
-- Reservation/finalization state machine
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_invoice_payment_link(
  p_account_id UUID,
  p_invoice_id UUID,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_balance public.invoice_balances%ROWTYPE;
  v_existing public.razorpay_payment_links%ROWTYPE;
  v_id UUID := gen_random_uuid();
  v_revision INTEGER;
  v_subunits BIGINT;
BEGIN
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND account_id = p_account_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  SELECT * INTO v_balance FROM public.invoice_balances WHERE id = v_invoice.id;
  IF v_invoice.state <> 'open' THEN RAISE EXCEPTION 'This invoice is void'; END IF;
  IF v_invoice.currency <> 'INR' THEN
    RAISE EXCEPTION 'Razorpay Payment Links are available only for INR invoices';
  END IF;
  IF v_invoice.contact_id IS NULL OR v_invoice.membership_id IS NULL THEN
    RAISE EXCEPTION 'This invoice is not linked to a member';
  END IF;
  v_subunits := ROUND(v_balance.balance * 100)::BIGINT;
  IF v_subunits < 50 THEN RAISE EXCEPTION 'This invoice has no collectible balance'; END IF;

  SELECT * INTO v_existing
  FROM public.razorpay_payment_links
  WHERE invoice_id = v_invoice.id
    AND status IN ('creating', 'created', 'cancel_requested', 'orphaned')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'created'
       AND v_existing.expected_amount_subunits = v_subunits
       AND v_existing.currency = v_invoice.currency
       AND v_existing.expires_at >= now() + interval '24 hours' THEN
      RETURN jsonb_build_object('outcome', 'reused', 'link', to_jsonb(v_existing));
    END IF;
    IF v_existing.status = 'created' THEN
      UPDATE public.razorpay_payment_links
      SET status = 'cancel_requested',
          cancel_reason = 'invoice_balance_or_eligibility_changed',
          next_reconcile_at = now(),
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_existing;
      RETURN jsonb_build_object(
        'outcome', 'cancellation_required', 'link', to_jsonb(v_existing)
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'busy', 'link', to_jsonb(v_existing));
  END IF;

  SELECT COALESCE(MAX(revision), 0) + 1 INTO v_revision
  FROM public.razorpay_payment_links WHERE invoice_id = v_invoice.id;

  INSERT INTO public.razorpay_payment_links (
    id, account_id, invoice_id, revision, reference_id,
    expected_amount, expected_amount_subunits, currency, expires_at,
    status, created_by, next_reconcile_at
  ) VALUES (
    v_id, p_account_id, v_invoice.id, v_revision,
    'udpl_' || replace(v_id::TEXT, '-', ''),
    v_balance.balance, v_subunits, v_invoice.currency,
    date_trunc('second', now() + interval '7 days'), 'creating', p_created_by,
    now() + interval '2 minutes'
  ) RETURNING * INTO v_existing;

  RETURN jsonb_build_object('outcome', 'created_intent', 'link', to_jsonb(v_existing));
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_invoice_payment_link(
  p_account_id UUID,
  p_link_id UUID,
  p_gateway_link_id TEXT,
  p_short_url TEXT,
  p_remote_status TEXT,
  p_remote_amount_subunits BIGINT,
  p_remote_currency TEXT,
  p_remote_reference_id TEXT,
  p_remote_expires_at TIMESTAMPTZ
)
RETURNS public.razorpay_payment_links
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_link public.razorpay_payment_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.razorpay_payment_links
  WHERE id = p_link_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment Link intent not found'; END IF;
  IF v_link.status NOT IN ('creating', 'orphaned', 'created') THEN
    RAISE EXCEPTION 'Payment Link cannot be finalized from state %', v_link.status;
  END IF;
  IF NULLIF(btrim(p_gateway_link_id), '') IS NULL
     OR NULLIF(btrim(p_short_url), '') IS NULL
     OR p_remote_status NOT IN ('created', 'paid', 'partially_paid', 'cancelled', 'expired')
     OR p_remote_amount_subunits <> v_link.expected_amount_subunits
     OR p_remote_currency <> v_link.currency
     OR p_remote_reference_id <> v_link.reference_id
     OR p_remote_expires_at IS DISTINCT FROM v_link.expires_at THEN
    RAISE EXCEPTION 'Razorpay Payment Link facts do not match the reserved intent';
  END IF;
  UPDATE public.razorpay_payment_links
  SET gateway_link_id = COALESCE(gateway_link_id, p_gateway_link_id),
      short_url = COALESCE(short_url, p_short_url), status = 'created',
      remote_status = p_remote_status, setup_error = NULL,
      last_verified_at = now(), last_reconciled_at = now(),
      next_reconcile_at = now() + interval '15 minutes',
      recovery_owner = NULL, recovery_lease_until = NULL, updated_at = now()
  WHERE id = v_link.id
    AND (gateway_link_id IS NULL OR gateway_link_id = p_gateway_link_id)
  RETURNING * INTO v_link;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment Link gateway identity conflict'; END IF;
  RETURN v_link;
END;
$$;

CREATE OR REPLACE FUNCTION public.park_invoice_payment_link(
  p_account_id UUID,
  p_link_id UUID,
  p_status TEXT,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_status NOT IN ('orphaned', 'failed') THEN
    RAISE EXCEPTION 'Invalid Payment Link recovery state';
  END IF;
  UPDATE public.razorpay_payment_links
  SET status = p_status, setup_error = left(COALESCE(p_error, ''), 500),
      next_reconcile_at = CASE WHEN p_status = 'orphaned'
        THEN now() + interval '5 minutes' ELSE NULL END,
      recovery_owner = NULL, recovery_lease_until = NULL, updated_at = now()
  WHERE id = p_link_id AND account_id = p_account_id
    AND status IN ('creating', 'orphaned');
  RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------
-- Link invalidation on every currently shipped invoice-balance mutation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_invoice_link_cancellation(
  p_invoice_id UUID,
  p_reason TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_balance public.invoice_balances%ROWTYPE;
  v_subunits BIGINT := 0;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO v_balance FROM public.invoice_balances WHERE id = v_invoice.id;
  IF v_balance.id IS NOT NULL THEN
    v_subunits := ROUND(v_balance.balance * 100)::BIGINT;
  END IF;
  UPDATE public.razorpay_payment_links
  SET status = 'cancel_requested',
      cancel_reason = left(COALESCE(NULLIF(btrim(p_reason), ''), 'invoice_changed'), 250),
      next_reconcile_at = now(), updated_at = now()
  WHERE invoice_id = v_invoice.id AND status = 'created'
    AND (
      v_invoice.state <> 'open' OR v_invoice.currency <> 'INR'
      OR v_invoice.contact_id IS NULL OR v_invoice.membership_id IS NULL
      OR v_subunits < 50 OR expected_amount_subunits <> v_subunits
      OR currency <> v_invoice.currency
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_invoice_payment_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice_id UUID;
  v_payment_source TEXT;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    v_payment_source := COALESCE(NEW.source, OLD.source);
    IF v_payment_source = 'payment_link' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  ELSIF TG_TABLE_NAME IN ('payment_allocations', 'invoice_credit_allocations') THEN
    SELECT invoice_id INTO v_invoice_id FROM public.invoice_lines
    WHERE id = COALESCE(NEW.invoice_line_id, OLD.invoice_line_id);
    IF TG_TABLE_NAME = 'payment_allocations' THEN
      SELECT source INTO v_payment_source FROM public.payments
      WHERE id = COALESCE(NEW.payment_id, OLD.payment_id);
      IF v_payment_source = 'payment_link' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'invoice_lines' THEN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  ELSIF TG_TABLE_NAME = 'invoices' THEN
    v_invoice_id := COALESCE(NEW.id, OLD.id);
  END IF;
  IF v_invoice_id IS NOT NULL THEN
    PERFORM public.request_invoice_link_cancellation(v_invoice_id, TG_TABLE_NAME || '_changed');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_invoice_link_payments ON public.payments;
CREATE TRIGGER trg_invalidate_invoice_link_payments
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_invoice_payment_link();
DROP TRIGGER IF EXISTS trg_invalidate_invoice_link_allocations ON public.payment_allocations;
CREATE TRIGGER trg_invalidate_invoice_link_allocations
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_invoice_payment_link();
DROP TRIGGER IF EXISTS trg_invalidate_invoice_link_credits ON public.invoice_credit_allocations;
CREATE TRIGGER trg_invalidate_invoice_link_credits
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_credit_allocations
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_invoice_payment_link();
DROP TRIGGER IF EXISTS trg_invalidate_invoice_link_lines ON public.invoice_lines;
CREATE TRIGGER trg_invalidate_invoice_link_lines
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_invoice_payment_link();
DROP TRIGGER IF EXISTS trg_invalidate_invoice_link_invoice ON public.invoices;
CREATE TRIGGER trg_invalidate_invoice_link_invoice
  AFTER UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_invoice_payment_link();

REVOKE ALL ON FUNCTION public.invalidate_invoice_payment_link()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Provider-verified settlement and exception containment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_gateway_invoice_payment(
  p_account_id UUID,
  p_payment_link_id UUID,
  p_webhook_event_id TEXT,
  p_gateway_link_id TEXT,
  p_gateway_payment_id TEXT,
  p_amount_subunits BIGINT,
  p_currency TEXT,
  p_method TEXT,
  p_payment_status TEXT,
  p_payment_captured BOOLEAN,
  p_reference_id TEXT,
  p_provider_contract_valid BOOLEAN,
  p_partial BOOLEAN DEFAULT FALSE,
  p_provider_facts JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link public.razorpay_payment_links%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_balance public.invoice_balances%ROWTYPE;
  v_payment_id UUID;
  v_existing_source TEXT;
  v_existing_invoice_id UUID;
  v_existing_gateway_link_id TEXT;
  v_exception_id UUID;
  v_reason_code TEXT;
  v_reason_message TEXT;
  v_method TEXT;
BEGIN
  SELECT * INTO v_link FROM public.razorpay_payment_links
  WHERE id = p_payment_link_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment Link not found'; END IF;
  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = v_link.invoice_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment Link invoice not found'; END IF;

  SELECT id, source, invoice_id, gateway_metadata->>'payment_link_id'
  INTO v_payment_id, v_existing_source, v_existing_invoice_id,
       v_existing_gateway_link_id
  FROM public.payments
  WHERE account_id = p_account_id AND gateway_payment_id = p_gateway_payment_id;
  IF v_payment_id IS NOT NULL
     AND v_existing_source = 'payment_link'
     AND v_existing_invoice_id = v_invoice.id
     AND v_existing_gateway_link_id = p_gateway_link_id
     AND p_provider_contract_valid IS TRUE
     AND p_payment_status = 'captured'
     AND p_payment_captured IS TRUE
     AND p_partial IS FALSE
     AND p_amount_subunits = v_link.expected_amount_subunits
     AND p_currency = v_link.currency THEN
    UPDATE public.razorpay_payment_links
    SET status = 'paid', remote_status = 'paid', paid_at = COALESCE(paid_at, now()),
        last_verified_at = now(), last_reconciled_at = now(),
        next_reconcile_at = NULL, recovery_owner = NULL,
        recovery_lease_until = NULL, updated_at = now()
    WHERE id = v_link.id;
    RETURN jsonb_build_object('outcome', 'duplicate', 'payment_id', v_payment_id);
  END IF;

  SELECT * INTO v_balance FROM public.invoice_balances WHERE id = v_invoice.id;
  IF v_payment_id IS NOT NULL THEN
    v_reason_code := 'gateway_payment_identity_conflict';
    v_reason_message := 'This provider payment identity is already attached to another ledger fact.';
  ELSIF p_provider_contract_valid IS NOT TRUE THEN
    v_reason_code := 'provider_contract_mismatch';
    v_reason_message := 'Provider link or payment facts do not match the reserved UsefulDesk contract.';
  ELSIF p_partial THEN
    v_reason_code := 'unexpected_partial_payment';
    v_reason_message := 'Razorpay confirmed a partial payment for a UsefulDesk full-balance link.';
  ELSIF p_payment_status <> 'captured' OR p_payment_captured IS NOT TRUE THEN
    v_reason_code := 'payment_not_captured';
    v_reason_message := 'The provider payment is not captured.';
  ELSIF p_gateway_link_id <> v_link.gateway_link_id
     OR p_reference_id <> v_link.reference_id THEN
    v_reason_code := 'link_identity_mismatch';
    v_reason_message := 'Provider link identity does not match the reserved UsefulDesk link.';
  ELSIF p_currency <> v_link.currency OR p_amount_subunits <> v_link.expected_amount_subunits THEN
    v_reason_code := 'amount_currency_mismatch';
    v_reason_message := 'Provider amount or currency differs from the reserved full balance.';
  ELSIF v_invoice.state <> 'open'
     OR ROUND(v_balance.balance * 100)::BIGINT <> p_amount_subunits THEN
    v_reason_code := 'invoice_balance_changed';
    v_reason_message := 'The captured payment no longer fits the locked collectible invoice balance.';
  END IF;

  IF v_reason_code IS NULL THEN
    v_method := CASE p_method
      WHEN 'upi' THEN 'upi'
      WHEN 'card' THEN 'card'
      WHEN 'netbanking' THEN 'bank'
      WHEN 'bank_transfer' THEN 'bank'
      ELSE 'other'
    END;
    BEGIN
      PERFORM set_config('app.system_payment', '1', TRUE);
      PERFORM set_config('app.payment_purpose', 'due', TRUE);
      INSERT INTO public.payments (
        account_id, membership_id, contact_id, user_id, invoice_id,
        amount, method, status, paid_at, source, mandate_id,
        gateway_payment_id, gateway_metadata
      ) VALUES (
        p_account_id, v_invoice.membership_id, v_invoice.contact_id, NULL,
        v_invoice.id, p_amount_subunits::NUMERIC / 100, v_method, 'paid', now(),
        'payment_link', NULL, p_gateway_payment_id,
        jsonb_build_object(
          'gateway', 'razorpay', 'payment_link_id', p_gateway_link_id,
          'raw_method', p_method, 'webhook_event_id', p_webhook_event_id
        )
      ) RETURNING id INTO v_payment_id;
      PERFORM set_config('app.payment_purpose', '', TRUE);
      PERFORM set_config('app.system_payment', '', TRUE);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('app.payment_purpose', '', TRUE);
      PERFORM set_config('app.system_payment', '', TRUE);
      v_reason_code := 'ledger_rejected';
      v_reason_message := left(SQLERRM, 500);
    END;
  END IF;

  IF v_reason_code IS NOT NULL THEN
    INSERT INTO public.gateway_payment_exceptions AS existing (
      account_id, invoice_id, payment_link_id, webhook_event_id,
      gateway_link_id, gateway_payment_id, amount, currency, method,
      payment_status, reason_code, reason_message, provider_facts
    ) VALUES (
      p_account_id, v_invoice.id, v_link.id, p_webhook_event_id,
      p_gateway_link_id, p_gateway_payment_id,
      p_amount_subunits::NUMERIC / 100, p_currency, p_method,
      p_payment_status, v_reason_code, v_reason_message, p_provider_facts
    )
    ON CONFLICT (account_id, gateway_payment_id) DO UPDATE SET
      webhook_event_id = COALESCE(existing.webhook_event_id, EXCLUDED.webhook_event_id),
      last_seen_at = now(), attempt_count = existing.attempt_count + 1,
      reason_code = EXCLUDED.reason_code,
      reason_message = EXCLUDED.reason_message,
      provider_facts = EXCLUDED.provider_facts
    RETURNING id INTO v_exception_id;
  END IF;

  UPDATE public.razorpay_payment_links
  SET status = 'paid', remote_status = 'paid', paid_at = COALESCE(paid_at, now()),
      last_verified_at = now(), last_reconciled_at = now(),
      next_reconcile_at = NULL, recovery_owner = NULL,
      recovery_lease_until = NULL, updated_at = now()
  WHERE id = v_link.id;

  IF v_exception_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'exception', 'exception_id', v_exception_id);
  END IF;
  RETURN jsonb_build_object('outcome', 'recorded', 'payment_id', v_payment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_invoice_payment_link_terminal(
  p_account_id UUID,
  p_link_id UUID,
  p_gateway_link_id TEXT,
  p_remote_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_remote_status NOT IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'Invalid terminal Payment Link state';
  END IF;
  UPDATE public.razorpay_payment_links
  SET gateway_link_id = COALESCE(gateway_link_id, p_gateway_link_id),
      status = p_remote_status, remote_status = p_remote_status,
      cancelled_at = CASE WHEN p_remote_status = 'cancelled' THEN now() ELSE cancelled_at END,
      expired_at = CASE WHEN p_remote_status = 'expired' THEN now() ELSE expired_at END,
      last_verified_at = now(), last_reconciled_at = now(),
      next_reconcile_at = NULL, recovery_owner = NULL,
      recovery_lease_until = NULL, updated_at = now()
  WHERE id = p_link_id AND account_id = p_account_id
    AND (gateway_link_id IS NULL OR gateway_link_id = p_gateway_link_id)
    AND status IN ('created', 'cancel_requested', 'orphaned');
  RETURN FOUND;
END;
$$;

-- The generic insert validator needs a separate trusted branch for a
-- Payment Link: it validates the locked invoice balance rather than forcing
-- a mixed-invoice payment through AutoPay's membership-period-only rule.
CREATE OR REPLACE FUNCTION public.validate_membership_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
  v_membership public.memberships%ROWTYPE;
  v_balance NUMERIC(12, 2);
  v_system BOOLEAN := COALESCE(current_setting('app.system_payment', TRUE), '') = '1';
BEGIN
  IF NEW.status <> 'paid' THEN RAISE EXCEPTION 'New ledger rows must be paid payments'; END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;

  IF NEW.invoice_id IS NULL THEN
    IF NEW.membership_id IS NULL THEN RAISE EXCEPTION 'An invoice or membership is required'; END IF;
    SELECT * INTO v_membership FROM public.memberships
    WHERE id = NEW.membership_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
    NEW.period_end := COALESCE(NEW.period_end, v_membership.end_date);
    SELECT * INTO v_period FROM public.membership_periods
    WHERE membership_id = v_membership.id AND period_end = NEW.period_end FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing period not found'; END IF;
    SELECT invoice.* INTO v_invoice
    FROM public.invoices invoice
    JOIN public.invoice_lines line ON line.invoice_id = invoice.id
    WHERE line.id = v_period.invoice_line_id FOR UPDATE OF invoice;
    NEW.invoice_id := v_invoice.id;
  ELSE
    SELECT * INTO v_invoice FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF v_invoice.membership_period_id IS NOT NULL THEN
      SELECT * INTO v_period FROM public.membership_periods
      WHERE id = v_invoice.membership_period_id;
    END IF;
    IF v_invoice.membership_id IS NOT NULL THEN
      SELECT * INTO v_membership FROM public.memberships
      WHERE id = v_invoice.membership_id;
    END IF;
  END IF;

  IF NEW.source = 'payment_link' THEN
    IF NOT v_system OR NEW.gateway_payment_id IS NULL
       OR NEW.mandate_id IS NOT NULL OR NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid trusted Payment Link payment';
    END IF;
    IF v_invoice.currency <> 'INR' OR v_invoice.membership_id IS NULL
       OR v_invoice.contact_id IS NULL THEN
      RAISE EXCEPTION 'Payment Link invoice is not collectible';
    END IF;
  ELSIF NEW.source = 'auto' THEN
    IF NOT v_system OR NEW.gateway_payment_id IS NULL
       OR NEW.mandate_id IS NULL OR NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid trusted AutoPay payment';
    END IF;
  ELSIF NEW.source = 'manual' THEN
    IF NEW.gateway_payment_id IS NOT NULL OR NEW.mandate_id IS NOT NULL
       OR NEW.gateway_metadata IS NOT NULL THEN
      RAISE EXCEPTION 'Manual payments cannot carry gateway provenance';
    END IF;
    IF NOT v_system AND NOT public.is_account_member(v_invoice.account_id, 'agent') THEN
      RAISE EXCEPTION 'Insufficient access to record this payment';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported payment source';
  END IF;
  IF v_invoice.state <> 'open' THEN
    RAISE EXCEPTION 'Payments cannot be recorded against a void invoice';
  END IF;

  SELECT GREATEST(
    COALESCE(SUM(CASE WHEN line.state = 'active' THEN line.line_amount ELSE 0 END), 0)
      - COALESCE((
          SELECT SUM(allocation.amount)
          FROM public.payment_allocations allocation
          JOIN public.payments payment ON payment.id = allocation.payment_id
          WHERE allocation.invoice_line_id IN (
            SELECT id FROM public.invoice_lines WHERE invoice_id = v_invoice.id
          ) AND payment.status = 'paid'
        ), 0)
      - COALESCE((
          SELECT SUM(credit.amount)
          FROM public.invoice_credit_allocations credit
          WHERE credit.invoice_line_id IN (
            SELECT id FROM public.invoice_lines WHERE invoice_id = v_invoice.id
          )
        ), 0),
    0
  )::NUMERIC(12, 2) INTO v_balance
  FROM public.invoice_lines line WHERE line.invoice_id = v_invoice.id;

  IF v_balance <= 0 THEN RAISE EXCEPTION 'This invoice is already settled'; END IF;
  IF NEW.source = 'payment_link' THEN
    IF ROUND(NEW.amount * 100)::BIGINT <> ROUND(v_balance * 100)::BIGINT THEN
      RAISE EXCEPTION 'Payment Link amount must equal the full invoice balance';
    END IF;
  ELSIF NEW.amount > v_balance THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding balance of %', v_balance;
  END IF;

  IF NEW.receipt_bucket IS NOT NULL AND NEW.receipt_bucket <> 'payment-receipts' THEN
    RAISE EXCEPTION 'Unsupported receipt bucket';
  END IF;
  NEW.account_id := v_invoice.account_id;
  NEW.contact_id := v_invoice.contact_id;
  NEW.membership_id := v_invoice.membership_id;
  NEW.user_id := CASE WHEN NEW.source = 'payment_link'
    THEN NULL ELSE COALESCE((SELECT auth.uid()), NEW.user_id) END;
  IF v_period.id IS NOT NULL THEN
    IF v_period.state = 'void' THEN
      RAISE EXCEPTION 'Payments cannot be recorded against a void billing period';
    END IF;
    NEW.period_start := v_period.period_start;
    NEW.period_end := v_period.period_end;
    NEW.plan_id := v_period.plan_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Gateway rows are reversed only through the later provider-refund lifecycle.
CREATE OR REPLACE FUNCTION public.void_membership_payment(
  p_payment_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_payment public.payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_payment.account_id, 'admin') THEN
    RAISE EXCEPTION 'Payment not found or admin access required';
  END IF;
  IF v_payment.gateway_payment_id IS NOT NULL OR v_payment.source IN ('auto', 'payment_link') THEN
    RAISE EXCEPTION 'Gateway payments cannot be voided; use the provider refund workflow';
  END IF;
  IF v_payment.status <> 'paid' THEN RAISE EXCEPTION 'Only a paid payment can be voided'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE public.payments SET status = 'void', voided_at = now(),
    voided_by = (SELECT auth.uid()), void_reason = btrim(p_reason)
  WHERE id = p_payment_id;
  RETURN p_payment_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Five-minute owner leases for cancellation, ambiguous-create adoption, and
-- provider verification of active links.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_razorpay_payment_link_recovery_batch(
  p_provider_mode TEXT,
  p_recovery_owner UUID,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.razorpay_payment_links
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_provider_mode NOT IN ('test', 'live') THEN RAISE EXCEPTION 'Invalid provider mode'; END IF;
  IF p_limit < 1 OR p_limit > 100 OR p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'Invalid Payment Link recovery bounds';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT link.id
    FROM public.razorpay_payment_links link
    JOIN public.account_payment_credentials credential
      ON credential.account_id = link.account_id
     AND credential.gateway = 'razorpay'
     AND credential.provider_mode = p_provider_mode
     AND credential.connection_status = 'ready'
    WHERE link.status IN ('creating', 'created', 'cancel_requested', 'orphaned')
      AND link.next_reconcile_at <= now()
      AND (link.recovery_lease_until IS NULL OR link.recovery_lease_until < now())
    ORDER BY link.next_reconcile_at, link.created_at
    LIMIT p_limit
    FOR UPDATE OF link SKIP LOCKED
  )
  UPDATE public.razorpay_payment_links link
  SET recovery_owner = p_recovery_owner,
      recovery_lease_until = now() + make_interval(secs => p_lease_seconds),
      reconcile_attempt_count = link.reconcile_attempt_count + 1,
      updated_at = now()
  FROM candidates WHERE link.id = candidates.id
  RETURNING link.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_razorpay_payment_link_verification(
  p_account_id UUID,
  p_link_id UUID,
  p_recovery_owner UUID,
  p_remote_status TEXT,
  p_next_reconcile_seconds INTEGER DEFAULT 21600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.razorpay_payment_links
  SET remote_status = p_remote_status, last_verified_at = now(),
      last_reconciled_at = now(),
      next_reconcile_at = now() + make_interval(
        secs => greatest(900, least(p_next_reconcile_seconds, 21600))
      ),
      recovery_owner = NULL, recovery_lease_until = NULL, updated_at = now()
  WHERE id = p_link_id AND account_id = p_account_id
    AND recovery_owner = p_recovery_owner AND status = 'created';
  RETURN FOUND;
END;
$$;

-- Explicit service-only grants: Supabase no longer guarantees automatic Data
-- API exposure for new public objects, and functions default to PUBLIC execute.
REVOKE ALL ON FUNCTION public.reserve_invoice_payment_link(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_invoice_payment_link(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.park_invoice_payment_link(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_invoice_link_cancellation(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_gateway_invoice_payment(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_invoice_payment_link_terminal(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_razorpay_payment_link_recovery_batch(TEXT, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_razorpay_payment_link_verification(UUID, UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_invoice_payment_link(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_invoice_payment_link(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.park_invoice_payment_link(UUID, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.request_invoice_link_cancellation(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_gateway_invoice_payment(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_invoice_payment_link_terminal(UUID, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_payment_link_recovery_batch(TEXT, UUID, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_razorpay_payment_link_verification(UUID, UUID, UUID, TEXT, INTEGER)
  TO service_role;

-- The redefined payment functions keep their established caller boundaries.
REVOKE ALL ON FUNCTION public.validate_membership_payment()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_membership_payment(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_membership_payment(UUID, TEXT)
  TO authenticated;
