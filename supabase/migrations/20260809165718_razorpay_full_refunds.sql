-- Razorpay Stage 4: full remaining-payment refunds, external-refund import,
-- explicit accounting classification, and review-safe collection read models.

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  gateway_refund_id TEXT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (length(btrim(currency)) = 3),
  source TEXT NOT NULL CHECK (source IN ('usefuldesk', 'razorpay_dashboard')),
  disposition TEXT CHECK (disposition IN ('reopen_balance', 'reduce_charge')),
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('creating', 'pending', 'processed', 'failed', 'orphaned')),
  idempotency_key TEXT,
  provider_idempotency_key TEXT,
  canonical_request_body TEXT,
  canonical_request_sha256 TEXT,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  outbound_owner UUID,
  outbound_lease_until TIMESTAMPTZ,
  next_reconcile_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconcile_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_attempt_count >= 0),
  provider_status TEXT,
  provider_error TEXT,
  provider_created_at TIMESTAMPTZ,
  provider_facts JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key),
  UNIQUE (account_id, id),
  CONSTRAINT payment_refunds_usefuldesk_fields_check CHECK (
    source <> 'usefuldesk' OR (
      disposition IS NOT NULL AND length(btrim(reason)) > 0
      AND idempotency_key IS NOT NULL AND requested_by IS NOT NULL
    )
  ),
  CONSTRAINT payment_refunds_request_hash_check CHECK (
    canonical_request_sha256 IS NULL
    OR canonical_request_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_gateway_identity_idx
  ON public.payment_refunds(account_id, gateway_refund_id)
  WHERE gateway_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_refunds_payment_status_idx
  ON public.payment_refunds(payment_id, status, created_at);
CREATE INDEX IF NOT EXISTS payment_refunds_recovery_idx
  ON public.payment_refunds(status, next_reconcile_at, outbound_lease_until);
CREATE INDEX IF NOT EXISTS payment_refunds_invoice_created_idx
  ON public.payment_refunds(invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_refunds_requested_by_idx
  ON public.payment_refunds(requested_by) WHERE requested_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payment_refund_allocations (
  refund_id UUID NOT NULL REFERENCES public.payment_refunds(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  invoice_line_id UUID NOT NULL REFERENCES public.invoice_lines(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (refund_id, invoice_line_id)
);
CREATE INDEX IF NOT EXISTS payment_refund_allocations_payment_idx
  ON public.payment_refund_allocations(payment_id, invoice_line_id);
CREATE INDEX IF NOT EXISTS payment_refund_allocations_line_idx
  ON public.payment_refund_allocations(invoice_line_id, refund_id);

CREATE TABLE IF NOT EXISTS public.invoice_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source = 'refund'),
  source_refund_id UUID NOT NULL UNIQUE REFERENCES public.payment_refunds(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, id)
);
CREATE INDEX IF NOT EXISTS invoice_adjustments_invoice_idx
  ON public.invoice_adjustments(invoice_id, created_at);
CREATE INDEX IF NOT EXISTS invoice_adjustments_created_by_idx
  ON public.invoice_adjustments(created_by) WHERE created_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_adjustment_allocations (
  adjustment_id UUID NOT NULL REFERENCES public.invoice_adjustments(id) ON DELETE RESTRICT,
  invoice_line_id UUID NOT NULL REFERENCES public.invoice_lines(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (adjustment_id, invoice_line_id)
);
CREATE INDEX IF NOT EXISTS invoice_adjustment_allocations_line_idx
  ON public.invoice_adjustment_allocations(invoice_line_id, adjustment_id);

CREATE TABLE IF NOT EXISTS public.gateway_refund_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  refund_id UUID REFERENCES public.payment_refunds(id) ON DELETE RESTRICT,
  gateway_payment_id TEXT NOT NULL,
  gateway_refund_id TEXT,
  reason_code TEXT NOT NULL,
  reason_message TEXT NOT NULL,
  provider_facts JSONB NOT NULL DEFAULT '{}'::JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  UNIQUE (account_id, gateway_refund_id)
);
CREATE INDEX IF NOT EXISTS gateway_refund_exceptions_payment_idx
  ON public.gateway_refund_exceptions(payment_id, resolved_at);
CREATE INDEX IF NOT EXISTS gateway_refund_exceptions_invoice_idx
  ON public.gateway_refund_exceptions(invoice_id, resolved_at);

CREATE TABLE IF NOT EXISTS public.razorpay_reconciliation_state (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider_mode TEXT NOT NULL CHECK (provider_mode IN ('test', 'live')),
  next_refund_reconcile_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refund_completed_through TIMESTAMPTZ NOT NULL,
  refund_window_from TIMESTAMPTZ,
  refund_window_to TIMESTAMPTZ,
  refund_skip INTEGER NOT NULL DEFAULT 0 CHECK (refund_skip >= 0),
  refund_lease_owner UUID,
  refund_lease_until TIMESTAMPTZ,
  initial_scan_completed_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  unrelated_refund_count BIGINT NOT NULL DEFAULT 0 CHECK (unrelated_refund_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((refund_window_from IS NULL) = (refund_window_to IS NULL)),
  CHECK (refund_window_from IS NULL OR refund_window_from <= refund_window_to)
);

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'payment_refunds', 'payment_refund_allocations',
    'invoice_adjustments', 'invoice_adjustment_allocations',
    'gateway_refund_exceptions', 'razorpay_reconciliation_state'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
  END LOOP;
END $$;

CREATE POLICY payment_refunds_select ON public.payment_refunds
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY payment_refund_allocations_select ON public.payment_refund_allocations
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY invoice_adjustments_select ON public.invoice_adjustments
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY invoice_adjustment_allocations_select ON public.invoice_adjustment_allocations
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

GRANT SELECT ON public.payment_refunds, public.payment_refund_allocations,
  public.invoice_adjustments, public.invoice_adjustment_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_refunds TO service_role;
GRANT SELECT, INSERT ON public.payment_refund_allocations,
  public.invoice_adjustments, public.invoice_adjustment_allocations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.gateway_refund_exceptions,
  public.razorpay_reconciliation_state TO service_role;

CREATE OR REPLACE FUNCTION public.has_unallocated_processed_refund(p_payment_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payment_refunds refund
    WHERE refund.payment_id = p_payment_id AND refund.status = 'processed'
      AND COALESCE((SELECT SUM(allocation.amount)
                    FROM public.payment_refund_allocations allocation
                    WHERE allocation.refund_id = refund.id), 0) <> refund.amount
  );
$$;

CREATE OR REPLACE FUNCTION public.protect_refund_financial_facts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Financial facts are append-only'; END IF;
  IF COALESCE(current_setting('app.gateway_refund_workflow', TRUE), '') <> '1' THEN
    RAISE EXCEPTION 'Refund facts may change only through the refund workflow';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR (OLD.gateway_refund_id IS NOT NULL AND NEW.gateway_refund_id IS DISTINCT FROM OLD.gateway_refund_id)
     OR (OLD.canonical_request_body IS NOT NULL AND NEW.canonical_request_body IS DISTINCT FROM OLD.canonical_request_body)
     OR (OLD.canonical_request_sha256 IS NOT NULL AND NEW.canonical_request_sha256 IS DISTINCT FROM OLD.canonical_request_sha256)
     OR (OLD.provider_idempotency_key IS NOT NULL AND NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key)
     OR (OLD.disposition IS NOT NULL AND NEW.disposition IS DISTINCT FROM OLD.disposition)
     OR (OLD.reason IS NOT NULL AND NEW.reason IS DISTINCT FROM OLD.reason)
  THEN RAISE EXCEPTION 'Immutable refund fact cannot be changed'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'creating' AND NEW.status IN ('pending','processed','failed','orphaned'))
    OR (OLD.status = 'pending' AND NEW.status IN ('processed','failed','orphaned'))
    OR (OLD.status = 'orphaned' AND NEW.status IN ('pending','processed','failed'))
  ) THEN RAISE EXCEPTION 'Invalid refund state transition'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_refund_financial_facts ON public.payment_refunds;
CREATE TRIGGER protect_refund_financial_facts
  BEFORE UPDATE OR DELETE ON public.payment_refunds
  FOR EACH ROW EXECUTE FUNCTION public.protect_refund_financial_facts();

CREATE OR REPLACE FUNCTION public.validate_refund_allocation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE; v_original NUMERIC(12,2); v_line_invoice UUID;
BEGIN
  SELECT * INTO v_refund FROM public.payment_refunds WHERE id=NEW.refund_id;
  SELECT invoice_id INTO v_line_invoice FROM public.invoice_lines WHERE id=NEW.invoice_line_id;
  SELECT amount INTO v_original FROM public.payment_allocations
    WHERE payment_id=v_refund.payment_id AND invoice_line_id=NEW.invoice_line_id;
  IF NOT FOUND OR v_refund.payment_id<>NEW.payment_id OR v_refund.account_id<>NEW.account_id
     OR v_line_invoice<>v_refund.invoice_id OR v_original IS NULL THEN
    RAISE EXCEPTION 'Refund allocation does not match the original payment';
  END IF;
  IF COALESCE((SELECT SUM(allocation.amount) FROM public.payment_refund_allocations allocation
      JOIN public.payment_refunds refund ON refund.id=allocation.refund_id
      WHERE allocation.payment_id=NEW.payment_id AND allocation.invoice_line_id=NEW.invoice_line_id
        AND refund.status IN ('creating','pending','processed','orphaned')),0)+NEW.amount>v_original THEN
    RAISE EXCEPTION 'Refund allocation exceeds the original payment allocation';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_refund_allocation ON public.payment_refund_allocations;
CREATE TRIGGER validate_refund_allocation BEFORE INSERT ON public.payment_refund_allocations
 FOR EACH ROW EXECUTE FUNCTION public.validate_refund_allocation();

CREATE OR REPLACE FUNCTION public.validate_refund_adjustment_allocation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_adjustment public.invoice_adjustments%ROWTYPE; v_refund_amount NUMERIC(12,2); v_line_invoice UUID;
BEGIN
  SELECT * INTO v_adjustment FROM public.invoice_adjustments WHERE id=NEW.adjustment_id;
  SELECT amount INTO v_refund_amount FROM public.payment_refund_allocations
    WHERE refund_id=v_adjustment.source_refund_id AND invoice_line_id=NEW.invoice_line_id;
  SELECT invoice_id INTO v_line_invoice FROM public.invoice_lines WHERE id=NEW.invoice_line_id;
  IF NOT FOUND OR v_adjustment.account_id<>NEW.account_id OR v_line_invoice<>v_adjustment.invoice_id
     OR v_refund_amount IS NULL OR v_refund_amount<>NEW.amount THEN
    RAISE EXCEPTION 'Adjustment allocation must exactly copy the refund allocation';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_refund_adjustment_allocation ON public.invoice_adjustment_allocations;
CREATE TRIGGER validate_refund_adjustment_allocation BEFORE INSERT ON public.invoice_adjustment_allocations
 FOR EACH ROW EXECUTE FUNCTION public.validate_refund_adjustment_allocation();

CREATE OR REPLACE FUNCTION public.reject_financial_fact_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Financial facts are immutable'; END; $$;

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'payment_refund_allocations', 'invoice_adjustments', 'invoice_adjustment_allocations'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_mutation ON public.%I', v_table);
    EXECUTE format('CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_financial_fact_mutation()', v_table);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_refund_adjustment(p_refund_id UUID, p_actor UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE; v_adjustment_id UUID;
BEGIN
  SELECT * INTO v_refund FROM public.payment_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status <> 'processed' OR v_refund.disposition <> 'reduce_charge' THEN
    RAISE EXCEPTION 'Processed reduce-charge refund required';
  END IF;
  SELECT id INTO v_adjustment_id FROM public.invoice_adjustments WHERE source_refund_id = v_refund.id;
  IF v_adjustment_id IS NOT NULL THEN RETURN v_adjustment_id; END IF;
  IF COALESCE((SELECT SUM(amount) FROM public.payment_refund_allocations WHERE refund_id=v_refund.id),0) <> v_refund.amount THEN
    RAISE EXCEPTION 'Refund allocations are incomplete';
  END IF;
  INSERT INTO public.invoice_adjustments(account_id,invoice_id,source,source_refund_id,amount,reason,created_by)
  VALUES(v_refund.account_id,v_refund.invoice_id,'refund',v_refund.id,v_refund.amount,p_reason,p_actor)
  RETURNING id INTO v_adjustment_id;
  INSERT INTO public.invoice_adjustment_allocations(adjustment_id,invoice_line_id,account_id,amount)
  SELECT v_adjustment_id,invoice_line_id,account_id,amount
  FROM public.payment_refund_allocations WHERE refund_id=v_refund.id;
  RETURN v_adjustment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_gateway_refund(
  p_account_id UUID, p_payment_id UUID, p_actor UUID, p_disposition TEXT,
  p_reason TEXT, p_idempotency_key TEXT, p_outbound_owner UUID, p_provider_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_payment public.payments%ROWTYPE; v_invoice public.invoices%ROWTYPE;
  v_existing public.payment_refunds%ROWTYPE; v_refund public.payment_refunds%ROWTYPE;
  v_refund_id UUID:=gen_random_uuid(); v_reserved NUMERIC(12,2); v_remaining NUMERIC(12,2); v_allocated NUMERIC(12,2);
BEGIN
  IF p_actor IS NULL OR p_outbound_owner IS NULL OR p_disposition NOT IN ('reopen_balance','reduce_charge')
     OR p_provider_mode NOT IN ('test','live') OR length(btrim(COALESCE(p_reason,'')))=0
     OR length(btrim(COALESCE(p_idempotency_key,'')))<10 THEN
    RAISE EXCEPTION 'Invalid refund request';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account_payment_credentials credential
    WHERE credential.account_id=p_account_id AND credential.gateway='razorpay'
      AND credential.authentication_mode='oauth' AND credential.provider_mode=p_provider_mode
      AND credential.connection_status='ready'
      AND (credential.merchant_status='activated' OR (credential.merchant_status='unknown'
        AND credential.activation_verified_at>=now()-interval '24 hours'))) THEN
    RAISE EXCEPTION 'Ready Razorpay OAuth connection required';
  END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=p_payment_id AND account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status<>'paid' OR v_payment.gateway_payment_id IS NULL
     OR v_payment.source NOT IN ('auto','payment_link') OR v_payment.invoice_id IS NULL THEN
    RAISE EXCEPTION 'Captured Razorpay payment required';
  END IF;
  IF v_payment.paid_at < now()-interval '6 months' THEN RAISE EXCEPTION 'Payment is outside the refund window'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id=v_payment.invoice_id AND account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.currency<>'INR' THEN RAISE EXCEPTION 'INR invoice required'; END IF;
  SELECT * INTO v_existing FROM public.payment_refunds
    WHERE account_id=p_account_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payment_id<>p_payment_id OR v_existing.disposition<>p_disposition
       OR v_existing.reason<>btrim(p_reason) THEN RAISE EXCEPTION 'Conflicting refund idempotency key'; END IF;
    RETURN jsonb_build_object('outcome','reused','refund',to_jsonb(v_existing));
  END IF;
  IF public.has_unallocated_processed_refund(v_payment.id) THEN
    RAISE EXCEPTION 'Payment has an unallocated processed refund';
  END IF;
  IF COALESCE((SELECT SUM(amount) FROM public.payment_allocations WHERE payment_id=v_payment.id),0)<>v_payment.amount THEN
    RAISE EXCEPTION 'Original payment allocations are incomplete';
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_reserved FROM public.payment_refunds
    WHERE payment_id=v_payment.id AND status IN ('creating','pending','processed','orphaned');
  v_remaining := v_payment.amount-v_reserved;
  IF v_remaining<=0 THEN RAISE EXCEPTION 'Payment has no refundable amount'; END IF;
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  INSERT INTO public.payment_refunds(id,account_id,payment_id,invoice_id,amount,currency,source,disposition,reason,status,
    idempotency_key,provider_idempotency_key,requested_by,outbound_owner,outbound_lease_until)
  VALUES(v_refund_id,p_account_id,v_payment.id,v_invoice.id,v_remaining,v_invoice.currency,'usefuldesk',p_disposition,btrim(p_reason),'creating',
    p_idempotency_key,v_refund_id::TEXT,p_actor,p_outbound_owner,now()+interval '2 minutes') RETURNING * INTO v_refund;
  INSERT INTO public.payment_refund_allocations(refund_id,payment_id,invoice_line_id,account_id,amount)
  SELECT v_refund.id,v_payment.id,original.invoice_line_id,p_account_id,
    original.amount-COALESCE((SELECT SUM(prior.amount) FROM public.payment_refund_allocations prior
      JOIN public.payment_refunds prior_refund ON prior_refund.id=prior.refund_id
      WHERE prior.payment_id=v_payment.id AND prior.invoice_line_id=original.invoice_line_id
        AND prior_refund.status IN ('creating','pending','processed','orphaned')),0)
  FROM public.payment_allocations original WHERE original.payment_id=v_payment.id
    AND original.amount-COALESCE((SELECT SUM(prior.amount) FROM public.payment_refund_allocations prior
      JOIN public.payment_refunds prior_refund ON prior_refund.id=prior.refund_id
      WHERE prior.payment_id=v_payment.id AND prior.invoice_line_id=original.invoice_line_id
        AND prior_refund.status IN ('creating','pending','processed','orphaned')),0)>0;
  SELECT COALESCE(SUM(amount),0) INTO v_allocated FROM public.payment_refund_allocations WHERE refund_id=v_refund.id;
  IF v_allocated<>v_refund.amount THEN RAISE EXCEPTION 'Refund allocation capacity mismatch'; END IF;
  RETURN jsonb_build_object('outcome','reserved','refund',to_jsonb(v_refund));
END;
$$;

CREATE OR REPLACE FUNCTION public.store_gateway_refund_request(
  p_account_id UUID,p_refund_id UUID,p_outbound_owner UUID,p_provider_idempotency_key TEXT,
  p_canonical_body TEXT,p_body_sha256 TEXT
)
RETURNS public.payment_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE;
BEGIN
  IF p_body_sha256 !~ '^[0-9a-f]{64}$' OR encode(extensions.digest(p_canonical_body,'sha256'),'hex')<>p_body_sha256
     OR p_provider_idempotency_key !~ '^[A-Za-z0-9_-]{10,}$' THEN RAISE EXCEPTION 'Invalid canonical refund request'; END IF;
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  UPDATE public.payment_refunds SET provider_idempotency_key=p_provider_idempotency_key,
    canonical_request_body=p_canonical_body,canonical_request_sha256=p_body_sha256,updated_at=now()
  WHERE id=p_refund_id AND account_id=p_account_id AND status='creating'
    AND outbound_owner=p_outbound_owner AND outbound_lease_until>now()
    AND (canonical_request_body IS NULL OR (canonical_request_body=p_canonical_body AND canonical_request_sha256=p_body_sha256))
  RETURNING * INTO v_refund;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request lease is unavailable'; END IF;
  RETURN v_refund;
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_gateway_refund(
  p_account_id UUID,p_refund_id UUID,p_gateway_refund_id TEXT,p_provider_status TEXT,
  p_payment_gateway_id TEXT,p_amount NUMERIC,p_currency TEXT,p_provider_created_at TIMESTAMPTZ,
  p_provider_facts JSONB DEFAULT '{}'::JSONB,p_provider_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE; v_payment public.payments%ROWTYPE; v_adjustment UUID;
BEGIN
  IF p_provider_status NOT IN ('pending','processed','failed') OR length(btrim(COALESCE(p_gateway_refund_id,'')))=0 THEN
    RAISE EXCEPTION 'Invalid provider refund result'; END IF;
  SELECT * INTO v_refund FROM public.payment_refunds WHERE id=p_refund_id AND account_id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=v_refund.payment_id FOR UPDATE;
  IF v_payment.gateway_payment_id<>p_payment_gateway_id OR v_refund.amount<>p_amount OR v_refund.currency<>p_currency THEN
    RAISE EXCEPTION 'Provider refund facts do not match the local intent'; END IF;
  IF v_refund.gateway_refund_id IS NOT NULL AND v_refund.gateway_refund_id<>p_gateway_refund_id THEN
    RAISE EXCEPTION 'Gateway refund identity is immutable'; END IF;
  IF v_refund.status IN ('processed','failed') THEN
    IF v_refund.status<>p_provider_status THEN RAISE EXCEPTION 'Terminal refund state conflict'; END IF;
    RETURN jsonb_build_object('outcome','duplicate','refund_id',v_refund.id);
  END IF;
  IF (v_refund.status='creating' AND p_provider_status NOT IN ('pending','processed','failed'))
     OR (v_refund.status IN ('pending','orphaned') AND p_provider_status NOT IN ('pending','processed','failed')) THEN
    RAISE EXCEPTION 'Invalid refund transition'; END IF;
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  UPDATE public.payment_refunds SET gateway_refund_id=p_gateway_refund_id,status=p_provider_status,
    provider_status=p_provider_status,provider_error=left(p_provider_error,500),provider_created_at=p_provider_created_at,
    provider_facts=COALESCE(p_provider_facts,'{}'::JSONB),processed_at=CASE WHEN p_provider_status='processed' THEN COALESCE(processed_at,now()) ELSE processed_at END,
    failed_at=CASE WHEN p_provider_status='failed' THEN COALESCE(failed_at,now()) ELSE failed_at END,
    outbound_owner=NULL,outbound_lease_until=NULL,
    next_reconcile_at=CASE WHEN p_provider_status='pending' THEN now()+interval '15 minutes' ELSE next_reconcile_at END,
    updated_at=now() WHERE id=v_refund.id RETURNING * INTO v_refund;
  IF v_refund.status='processed' AND v_refund.disposition='reduce_charge' THEN
    v_adjustment:=public.create_refund_adjustment(v_refund.id,v_refund.requested_by,v_refund.reason);
  END IF;
  PERFORM public.request_invoice_link_cancellation(v_refund.invoice_id,'refund_processed');
  IF v_payment.membership_id IS NOT NULL THEN UPDATE public.memberships SET fee_status=fee_status WHERE id=v_payment.membership_id; END IF;
  RETURN jsonb_build_object('outcome','finalized','refund_id',v_refund.id,'adjustment_id',v_adjustment);
END; $$;

CREATE OR REPLACE FUNCTION public.import_gateway_refund(
  p_account_id UUID,p_payment_id UUID,p_gateway_refund_id TEXT,p_amount NUMERIC,p_currency TEXT,
  p_provider_status TEXT,p_provider_created_at TIMESTAMPTZ,p_provider_facts JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_payment public.payments%ROWTYPE; v_invoice public.invoices%ROWTYPE; v_existing public.payment_refunds%ROWTYPE;
  v_refund public.payment_refunds%ROWTYPE; v_reserved NUMERIC(12,2); v_remaining NUMERIC(12,2); v_unallocated BOOLEAN;
BEGIN
  IF p_provider_status<>'processed' OR p_amount<=0 OR length(btrim(COALESCE(p_gateway_refund_id,'')))=0 THEN
    RAISE EXCEPTION 'Only provider-processed refunds can be imported'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=p_payment_id AND account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR v_payment.gateway_payment_id IS NULL OR v_payment.invoice_id IS NULL THEN RAISE EXCEPTION 'Gateway payment not found'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id=v_payment.invoice_id FOR UPDATE;
  IF p_currency<>v_invoice.currency THEN RAISE EXCEPTION 'Refund currency mismatch'; END IF;
  SELECT * INTO v_existing FROM public.payment_refunds WHERE account_id=p_account_id AND gateway_refund_id=p_gateway_refund_id;
  IF FOUND THEN RETURN jsonb_build_object('outcome','duplicate','refund_id',v_existing.id); END IF;
  IF EXISTS(SELECT 1 FROM public.payment_refunds WHERE payment_id=v_payment.id AND status IN ('creating','pending','orphaned') AND outbound_lease_until>now()) THEN
    RAISE EXCEPTION 'UsefulDesk refund request still has an active provider lease'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_reserved FROM public.payment_refunds
    WHERE payment_id=v_payment.id AND status IN ('creating','pending','processed','orphaned');
  v_remaining:=v_payment.amount-v_reserved;
  IF p_amount>v_remaining OR v_remaining<=0 THEN RAISE EXCEPTION 'Provider refund exceeds local refundable capacity'; END IF;
  v_unallocated:=public.has_unallocated_processed_refund(v_payment.id)
    OR COALESCE((SELECT SUM(amount) FROM public.payment_allocations WHERE payment_id=v_payment.id),0)<>v_payment.amount
    OR p_amount<>v_remaining;
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  INSERT INTO public.payment_refunds(account_id,payment_id,invoice_id,gateway_refund_id,amount,currency,source,status,
    provider_status,provider_created_at,provider_facts,processed_at)
  VALUES(p_account_id,v_payment.id,v_invoice.id,p_gateway_refund_id,p_amount,p_currency,'razorpay_dashboard','processed',
    'processed',p_provider_created_at,COALESCE(p_provider_facts,'{}'::JSONB),now()) RETURNING * INTO v_refund;
  IF NOT v_unallocated THEN
    INSERT INTO public.payment_refund_allocations(refund_id,payment_id,invoice_line_id,account_id,amount)
    SELECT v_refund.id,v_payment.id,original.invoice_line_id,p_account_id,
      original.amount-COALESCE((SELECT SUM(prior.amount) FROM public.payment_refund_allocations prior
        JOIN public.payment_refunds prior_refund ON prior_refund.id=prior.refund_id
        WHERE prior.payment_id=v_payment.id AND prior.invoice_line_id=original.invoice_line_id
          AND prior_refund.status='processed'),0)
    FROM public.payment_allocations original WHERE original.payment_id=v_payment.id
      AND original.amount-COALESCE((SELECT SUM(prior.amount) FROM public.payment_refund_allocations prior
        JOIN public.payment_refunds prior_refund ON prior_refund.id=prior.refund_id
        WHERE prior.payment_id=v_payment.id AND prior.invoice_line_id=original.invoice_line_id
          AND prior_refund.status='processed'),0)>0;
  ELSE
    INSERT INTO public.gateway_refund_exceptions(account_id,payment_id,invoice_id,refund_id,gateway_payment_id,gateway_refund_id,
      reason_code,reason_message,provider_facts)
    VALUES(p_account_id,v_payment.id,v_invoice.id,v_refund.id,v_payment.gateway_payment_id,p_gateway_refund_id,
      'partial_refund_line_target_required','External partial refund requires explicit invoice-line targeting.',COALESCE(p_provider_facts,'{}'::JSONB))
    ON CONFLICT(account_id,gateway_refund_id) DO UPDATE SET last_seen_at=now(),
      attempt_count=public.gateway_refund_exceptions.attempt_count+1,
      provider_facts=EXCLUDED.provider_facts;
  END IF;
  PERFORM public.request_invoice_link_cancellation(v_invoice.id,'external_refund_review');
  IF v_payment.membership_id IS NOT NULL THEN UPDATE public.memberships SET fee_status=fee_status WHERE id=v_payment.membership_id; END IF;
  RETURN jsonb_build_object('outcome',CASE WHEN v_unallocated THEN 'partial_review' ELSE 'full_review' END,'refund_id',v_refund.id);
END; $$;

CREATE OR REPLACE FUNCTION public.classify_gateway_refund(
  p_account_id UUID,p_refund_id UUID,p_actor UUID,p_disposition TEXT,p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE; v_payment public.payments%ROWTYPE; v_adjustment UUID;
BEGIN
  IF p_actor IS NULL OR p_disposition NOT IN ('reopen_balance','reduce_charge') OR length(btrim(COALESCE(p_reason,'')))=0 THEN
    RAISE EXCEPTION 'Valid refund classification required'; END IF;
  SELECT * INTO v_refund FROM public.payment_refunds WHERE id=p_refund_id AND account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status<>'processed' OR v_refund.source<>'razorpay_dashboard' THEN RAISE EXCEPTION 'External processed refund required'; END IF;
  IF v_refund.disposition IS NOT NULL THEN
    IF v_refund.disposition=p_disposition AND v_refund.reason=btrim(p_reason) THEN RETURN jsonb_build_object('outcome','duplicate','refund_id',v_refund.id); END IF;
    RAISE EXCEPTION 'Refund classification is immutable';
  END IF;
  IF public.has_unallocated_processed_refund(v_refund.payment_id)
     OR COALESCE((SELECT SUM(amount) FROM public.payment_refund_allocations WHERE refund_id=v_refund.id),0)<>v_refund.amount THEN
    RAISE EXCEPTION 'Refund line targeting is incomplete'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=v_refund.payment_id FOR UPDATE;
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  UPDATE public.payment_refunds SET disposition=p_disposition,reason=btrim(p_reason),updated_at=now()
    WHERE id=v_refund.id RETURNING * INTO v_refund;
  IF p_disposition='reduce_charge' THEN v_adjustment:=public.create_refund_adjustment(v_refund.id,p_actor,btrim(p_reason)); END IF;
  PERFORM public.request_invoice_link_cancellation(v_refund.invoice_id,'refund_classified');
  IF v_payment.membership_id IS NOT NULL THEN UPDATE public.memberships SET fee_status=fee_status WHERE id=v_payment.membership_id; END IF;
  RETURN jsonb_build_object('outcome','classified','refund_id',v_refund.id,'adjustment_id',v_adjustment);
END; $$;

CREATE OR REPLACE FUNCTION public.initialize_razorpay_refund_reconciliation(p_account_id UUID,p_provider_mode TEXT)
RETURNS public.razorpay_reconciliation_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_start TIMESTAMPTZ; v_state public.razorpay_reconciliation_state%ROWTYPE;
BEGIN
  IF p_provider_mode NOT IN ('test','live') THEN RAISE EXCEPTION 'Invalid provider mode'; END IF;
  SELECT COALESCE(MIN(paid_at)-interval '48 hours',now()-interval '48 hours') INTO v_start
  FROM public.payments WHERE account_id=p_account_id AND gateway_payment_id IS NOT NULL AND source IN ('auto','payment_link');
  INSERT INTO public.razorpay_reconciliation_state(account_id,provider_mode,refund_completed_through,next_refund_reconcile_at)
  VALUES(p_account_id,p_provider_mode,v_start,now()) ON CONFLICT(account_id) DO NOTHING;
  SELECT * INTO v_state FROM public.razorpay_reconciliation_state WHERE account_id=p_account_id;
  IF v_state.provider_mode<>p_provider_mode THEN RAISE EXCEPTION 'Reconciliation mode mismatch'; END IF;
  RETURN v_state;
END; $$;

CREATE OR REPLACE FUNCTION public.claim_gateway_refund_recovery_batch(
  p_provider_mode TEXT,p_recovery_owner UUID,p_limit INTEGER DEFAULT 100,p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.payment_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_provider_mode NOT IN ('test','live') OR p_recovery_owner IS NULL OR p_limit<1 OR p_limit>100
     OR p_lease_seconds<30 OR p_lease_seconds>300 THEN RAISE EXCEPTION 'Invalid refund recovery claim'; END IF;
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  RETURN QUERY
  WITH candidates AS (
    SELECT refund.id FROM public.payment_refunds refund
    JOIN public.account_payment_credentials credential ON credential.account_id=refund.account_id
      AND credential.gateway='razorpay' AND credential.authentication_mode='oauth'
      AND credential.provider_mode=p_provider_mode AND credential.connection_status='ready'
    WHERE refund.status IN ('creating','pending','orphaned') AND refund.next_reconcile_at<=now()
      AND (refund.outbound_lease_until IS NULL OR refund.outbound_lease_until<now())
    ORDER BY refund.next_reconcile_at,refund.created_at LIMIT p_limit FOR UPDATE OF refund SKIP LOCKED
  )
  UPDATE public.payment_refunds refund SET
    status=CASE WHEN refund.status='creating' THEN 'orphaned' ELSE refund.status END,
    outbound_owner=p_recovery_owner,outbound_lease_until=now()+make_interval(secs=>p_lease_seconds),
    reconcile_attempt_count=refund.reconcile_attempt_count+1,updated_at=now()
  FROM candidates WHERE refund.id=candidates.id RETURNING refund.*;
END; $$;

CREATE OR REPLACE FUNCTION public.defer_gateway_refund_recovery(
  p_account_id UUID,p_refund_id UUID,p_recovery_owner UUID,p_error TEXT
)
RETURNS public.payment_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE; v_delay_seconds INTEGER;
BEGIN
  SELECT * INTO v_refund FROM public.payment_refunds WHERE id=p_refund_id AND account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status NOT IN ('creating','pending','orphaned')
     OR v_refund.outbound_owner<>p_recovery_owner OR v_refund.outbound_lease_until<now() THEN
    RAISE EXCEPTION 'Refund recovery lease is unavailable'; END IF;
  v_delay_seconds:=LEAST(86400,CASE WHEN v_refund.reconcile_attempt_count<=1 THEN 60
    WHEN v_refund.reconcile_attempt_count=2 THEN 300 WHEN v_refund.reconcile_attempt_count=3 THEN 900
    WHEN v_refund.reconcile_attempt_count=4 THEN 3600 ELSE 21600 END);
  PERFORM set_config('app.gateway_refund_workflow','1',TRUE);
  UPDATE public.payment_refunds SET status='orphaned',provider_error=left(p_error,500),
    outbound_owner=NULL,outbound_lease_until=NULL,next_reconcile_at=now()+make_interval(secs=>v_delay_seconds),updated_at=now()
  WHERE id=v_refund.id RETURNING * INTO v_refund;
  RETURN v_refund;
END; $$;

CREATE OR REPLACE FUNCTION public.claim_razorpay_refund_reconciliation(
  p_provider_mode TEXT,p_recovery_owner UUID,p_lease_seconds INTEGER DEFAULT 300
)
RETURNS public.razorpay_reconciliation_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_account_id UUID; v_state public.razorpay_reconciliation_state%ROWTYPE;
BEGIN
  IF p_provider_mode NOT IN ('test','live') OR p_recovery_owner IS NULL OR p_lease_seconds<30 OR p_lease_seconds>300 THEN
    RAISE EXCEPTION 'Invalid reconciliation claim'; END IF;
  SELECT state.account_id INTO v_account_id FROM public.razorpay_reconciliation_state state
  JOIN public.account_payment_credentials credential ON credential.account_id=state.account_id
    AND credential.gateway='razorpay' AND credential.authentication_mode='oauth'
    AND credential.provider_mode=p_provider_mode AND credential.connection_status='ready'
  WHERE state.provider_mode=p_provider_mode AND state.next_refund_reconcile_at<=now()
    AND (state.refund_lease_until IS NULL OR state.refund_lease_until<now())
  ORDER BY state.next_refund_reconcile_at LIMIT 1 FOR UPDATE OF state SKIP LOCKED;
  IF v_account_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.razorpay_reconciliation_state SET
    refund_window_from=COALESCE(refund_window_from,CASE WHEN initial_scan_completed_at IS NULL
      THEN refund_completed_through ELSE refund_completed_through-interval '48 hours' END),
    refund_window_to=COALESCE(refund_window_to,now()),refund_lease_owner=p_recovery_owner,
    refund_lease_until=now()+make_interval(secs=>p_lease_seconds),last_error=NULL,updated_at=now()
  WHERE account_id=v_account_id RETURNING * INTO v_state;
  RETURN v_state;
END; $$;

CREATE OR REPLACE FUNCTION public.advance_razorpay_refund_reconciliation(
  p_account_id UUID,p_recovery_owner UUID,p_window_from TIMESTAMPTZ,p_window_to TIMESTAMPTZ,
  p_expected_skip INTEGER,p_page_count INTEGER,p_unrelated_count INTEGER DEFAULT 0
)
RETURNS public.razorpay_reconciliation_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state public.razorpay_reconciliation_state%ROWTYPE;
BEGIN
  IF p_expected_skip<0 OR p_page_count<0 OR p_page_count>25 OR p_unrelated_count<0 THEN
    RAISE EXCEPTION 'Invalid reconciliation page'; END IF;
  SELECT * INTO v_state FROM public.razorpay_reconciliation_state WHERE account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR v_state.refund_lease_owner<>p_recovery_owner OR v_state.refund_lease_until<now()
     OR v_state.refund_window_from IS DISTINCT FROM p_window_from OR v_state.refund_window_to IS DISTINCT FROM p_window_to
     OR v_state.refund_skip<>p_expected_skip THEN RAISE EXCEPTION 'Reconciliation lease or cursor changed'; END IF;
  IF p_page_count<25 THEN
    UPDATE public.razorpay_reconciliation_state SET refund_completed_through=p_window_to,
      refund_window_from=NULL,refund_window_to=NULL,refund_skip=0,refund_lease_owner=NULL,refund_lease_until=NULL,
      initial_scan_completed_at=COALESCE(initial_scan_completed_at,now()),last_success_at=now(),last_error=NULL,
      next_refund_reconcile_at=now()+interval '1 hour',unrelated_refund_count=unrelated_refund_count+p_unrelated_count,updated_at=now()
    WHERE account_id=p_account_id RETURNING * INTO v_state;
  ELSE
    UPDATE public.razorpay_reconciliation_state SET refund_skip=refund_skip+25,
      refund_lease_until=now()+interval '5 minutes',unrelated_refund_count=unrelated_refund_count+p_unrelated_count,updated_at=now()
    WHERE account_id=p_account_id RETURNING * INTO v_state;
  END IF;
  RETURN v_state;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_razorpay_refund_reconciliation(
  p_account_id UUID,p_recovery_owner UUID,p_error TEXT
)
RETURNS public.razorpay_reconciliation_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state public.razorpay_reconciliation_state%ROWTYPE;
BEGIN
  UPDATE public.razorpay_reconciliation_state SET refund_lease_owner=NULL,refund_lease_until=NULL,
    next_refund_reconcile_at=now()+interval '15 minutes',last_error=left(p_error,500),updated_at=now()
  WHERE account_id=p_account_id AND refund_lease_owner=p_recovery_owner AND refund_lease_until>=now()
  RETURNING * INTO v_state;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation lease is unavailable'; END IF;
  RETURN v_state;
END; $$;

-- Reconciled cash, adjustments, and review-safe collectible balances.
CREATE OR REPLACE VIEW public.invoice_line_balances WITH (security_invoker=true) AS
WITH paid AS (
  SELECT pa.invoice_line_id,SUM(pa.amount) FILTER(WHERE p.status='paid')::NUMERIC(12,2) gross_amount_paid
  FROM public.payment_allocations pa JOIN public.payments p ON p.id=pa.payment_id GROUP BY pa.invoice_line_id
), refunded AS (
  SELECT pra.invoice_line_id,SUM(pra.amount)::NUMERIC(12,2) processed_refund_amount
  FROM public.payment_refund_allocations pra JOIN public.payment_refunds pr ON pr.id=pra.refund_id
  WHERE pr.status='processed' GROUP BY pra.invoice_line_id
), credited AS (
  SELECT invoice_line_id,SUM(amount)::NUMERIC(12,2) credit_applied FROM public.invoice_credit_allocations GROUP BY invoice_line_id
), adjusted AS (
  SELECT iaa.invoice_line_id,SUM(iaa.amount)::NUMERIC(12,2) invoice_adjustment_amount
  FROM public.invoice_adjustment_allocations iaa GROUP BY iaa.invoice_line_id
), review AS (
  SELECT DISTINCT invoice_id FROM public.payment_refunds WHERE status='processed' AND disposition IS NULL
)
SELECT il.*,
  (COALESCE(paid.gross_amount_paid,0)-COALESCE(refunded.processed_refund_amount,0))::NUMERIC(12,2) amount_paid,
  COALESCE(credited.credit_applied,0)::NUMERIC(12,2) credit_applied,
  CASE WHEN review.invoice_id IS NOT NULL THEN 0 ELSE GREATEST(CASE WHEN il.state='void' THEN 0 ELSE il.line_amount END
    -COALESCE(adjusted.invoice_adjustment_amount,0)-COALESCE(credited.credit_applied,0)
    -(COALESCE(paid.gross_amount_paid,0)-COALESCE(refunded.processed_refund_amount,0)),0) END::NUMERIC(12,2) balance,
  COALESCE(paid.gross_amount_paid,0)::NUMERIC(12,2) gross_amount_paid,
  COALESCE(refunded.processed_refund_amount,0)::NUMERIC(12,2) processed_refund_amount,
  (COALESCE(paid.gross_amount_paid,0)-COALESCE(refunded.processed_refund_amount,0))::NUMERIC(12,2) net_amount_paid,
  COALESCE(adjusted.invoice_adjustment_amount,0)::NUMERIC(12,2) invoice_adjustment_amount,
  GREATEST(CASE WHEN il.state='void' THEN 0 ELSE il.line_amount END-COALESCE(adjusted.invoice_adjustment_amount,0),0)::NUMERIC(12,2) net_total,
  GREATEST(CASE WHEN il.state='void' THEN 0 ELSE il.line_amount END-COALESCE(adjusted.invoice_adjustment_amount,0)
    -COALESCE(credited.credit_applied,0)-(COALESCE(paid.gross_amount_paid,0)-COALESCE(refunded.processed_refund_amount,0)),0)::NUMERIC(12,2) accounting_balance,
  (review.invoice_id IS NOT NULL) requires_refund_review,
  CASE WHEN review.invoice_id IS NOT NULL THEN 0 ELSE GREATEST(CASE WHEN il.state='void' THEN 0 ELSE il.line_amount END
    -COALESCE(adjusted.invoice_adjustment_amount,0)-COALESCE(credited.credit_applied,0)
    -(COALESCE(paid.gross_amount_paid,0)-COALESCE(refunded.processed_refund_amount,0)),0) END::NUMERIC(12,2) collectible_balance
FROM public.invoice_lines il LEFT JOIN paid ON paid.invoice_line_id=il.id LEFT JOIN refunded ON refunded.invoice_line_id=il.id
LEFT JOIN credited ON credited.invoice_line_id=il.id LEFT JOIN adjusted ON adjusted.invoice_line_id=il.id
LEFT JOIN review ON review.invoice_id=il.invoice_id;

CREATE OR REPLACE VIEW public.invoice_balances WITH (security_invoker=true) AS
WITH header_refunds AS (
 SELECT invoice_id,SUM(amount)::NUMERIC(12,2) processed_refund_amount,
   BOOL_OR(disposition IS NULL) requires_refund_review
 FROM public.payment_refunds WHERE status='processed' GROUP BY invoice_id
)
SELECT i.id,i.account_id,i.contact_id,i.membership_id,i.membership_period_id,i.source,i.state,i.issued_at,
 i.customer_name_snapshot,i.member_number_snapshot,i.currency,i.created_by,i.created_at,
 COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)::NUMERIC(12,2) total,
 (COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0))::NUMERIC(12,2) amount_paid,
 COALESCE(SUM(il.credit_applied),0)::NUMERIC(12,2) credit_applied,
 CASE WHEN i.state='void' OR COALESCE(header_refunds.requires_refund_review,FALSE) THEN 0 ELSE
  GREATEST(COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)-COALESCE(SUM(il.invoice_adjustment_amount),0)
   -COALESCE(SUM(il.credit_applied),0)-(COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0)),0) END::NUMERIC(12,2) balance,
 COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)::NUMERIC(12,2) gross_total,
 COALESCE(SUM(il.gross_amount_paid),0)::NUMERIC(12,2) gross_amount_paid,
 COALESCE(header_refunds.processed_refund_amount,0)::NUMERIC(12,2) processed_refund_amount,
 (COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0))::NUMERIC(12,2) net_amount_paid,
 COALESCE(SUM(il.invoice_adjustment_amount),0)::NUMERIC(12,2) invoice_adjustment_amount,
 GREATEST(COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)-COALESCE(SUM(il.invoice_adjustment_amount),0),0)::NUMERIC(12,2) net_total,
 GREATEST(COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)-COALESCE(SUM(il.invoice_adjustment_amount),0)
  -COALESCE(SUM(il.credit_applied),0)-(COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0)),0)::NUMERIC(12,2) accounting_balance,
 COALESCE(header_refunds.requires_refund_review,FALSE) requires_refund_review,
 CASE WHEN i.state='void' OR COALESCE(header_refunds.requires_refund_review,FALSE) THEN 0 ELSE
  GREATEST(COALESCE(SUM(CASE WHEN il.state='active' THEN il.line_amount ELSE 0 END),0)-COALESCE(SUM(il.invoice_adjustment_amount),0)
   -COALESCE(SUM(il.credit_applied),0)-(COALESCE(SUM(il.gross_amount_paid),0)-COALESCE(header_refunds.processed_refund_amount,0)),0) END::NUMERIC(12,2) collectible_balance
FROM public.invoices i LEFT JOIN public.invoice_line_balances il ON il.invoice_id=i.id
LEFT JOIN header_refunds ON header_refunds.invoice_id=i.id GROUP BY i.id,header_refunds.processed_refund_amount,header_refunds.requires_refund_review;

CREATE OR REPLACE VIEW public.membership_period_invoices WITH (security_invoker=true) AS
SELECT mp.id,mp.account_id,mp.membership_id,mp.contact_id,mp.plan_id,mp.period_start,mp.period_end,mp.fee_amount,
 mp.state,mp.created_at,COALESCE(il.amount_paid,0)::NUMERIC(12,2) amount_paid,
 COALESCE(il.balance,mp.fee_amount)::NUMERIC(12,2) balance,mp.list_price,mp.discount_type,mp.discount_value,
 mp.discount_amount,mp.standard_period_end,mp.bonus_months,mp.pricing_option_id,COALESCE(il.credit_applied,0)::NUMERIC(12,2) credit_applied,
 il.invoice_id,mp.invoice_line_id,COALESCE(il.gross_amount_paid,0)::NUMERIC(12,2) gross_amount_paid,
 COALESCE(il.processed_refund_amount,0)::NUMERIC(12,2) processed_refund_amount,
 COALESCE(il.invoice_adjustment_amount,0)::NUMERIC(12,2) invoice_adjustment_amount,
 COALESCE(il.accounting_balance,mp.fee_amount)::NUMERIC(12,2) accounting_balance,
 COALESCE(il.collectible_balance,mp.fee_amount)::NUMERIC(12,2) collectible_balance,
 COALESCE(il.requires_refund_review,FALSE) requires_refund_review
FROM public.membership_periods mp LEFT JOIN public.invoice_line_balances il ON il.id=mp.invoice_line_id;

CREATE OR REPLACE VIEW public.membership_dues WITH (security_invoker=true) AS
SELECT m.id membership_id,m.account_id,m.contact_id,m.plan_id,m.start_date,m.end_date,m.status,m.fee_status,m.fee_amount,
 COALESCE(period.amount_paid,0)::NUMERIC(12,2) collected_current,
 COALESCE(period.collectible_balance,m.fee_amount)::NUMERIC(12,2) balance,
 COALESCE(period.accounting_balance,m.fee_amount)::NUMERIC(12,2) accounting_balance,
 COALESCE(period.requires_refund_review,FALSE) requires_refund_review
FROM public.memberships m LEFT JOIN public.membership_period_invoices period
 ON period.membership_id=m.id AND period.period_end=m.end_date WHERE m.status<>'cancelled';

GRANT SELECT ON public.invoice_line_balances,public.invoice_balances,public.membership_period_invoices,public.membership_dues
 TO authenticated,service_role;
REVOKE ALL ON public.invoice_line_balances,public.invoice_balances,public.membership_period_invoices,public.membership_dues FROM anon;

-- New payments and allocations consume review-safe, refund-aware balances.
CREATE OR REPLACE FUNCTION public.allocate_invoice_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_invoice_cents BIGINT; v_payment_cents BIGINT:=ROUND(NEW.amount*100)::BIGINT;
BEGIN
 IF NEW.status<>'paid' OR NEW.invoice_id IS NULL THEN RETURN NEW; END IF;
 SELECT ROUND(collectible_balance*100)::BIGINT INTO v_invoice_cents FROM public.invoice_balances WHERE id=NEW.invoice_id;
 IF COALESCE(v_invoice_cents,0)<v_payment_cents THEN RAISE EXCEPTION 'Payment exceeds invoice line balances'; END IF;
 INSERT INTO public.payment_allocations(payment_id,invoice_line_id,account_id,amount)
 WITH line_balance AS (
  SELECT id,ROUND(collectible_balance*100)::BIGINT balance_cents FROM public.invoice_line_balances
  WHERE invoice_id=NEW.invoice_id AND state='active' AND collectible_balance>0
 ),shares AS (
  SELECT id,(v_payment_cents*balance_cents/v_invoice_cents)::BIGINT base_cents,MOD(v_payment_cents*balance_cents,v_invoice_cents) remainder
  FROM line_balance
 ),ranked AS (SELECT *,ROW_NUMBER() OVER(ORDER BY remainder DESC,id) rank FROM shares),
 totals AS (SELECT v_payment_cents-SUM(base_cents) extra_cents FROM shares)
 SELECT NEW.id,ranked.id,NEW.account_id,(ranked.base_cents+CASE WHEN ranked.rank<=totals.extra_cents THEN 1 ELSE 0 END)::NUMERIC/100
 FROM ranked CROSS JOIN totals WHERE ranked.base_cents+CASE WHEN ranked.rank<=totals.extra_cents THEN 1 ELSE 0 END>0;
 RETURN NEW;
END; $$;

-- Keep the Stage 3 source/provenance checks and replace its balance read.

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
  v_review BOOLEAN;
  v_system BOOLEAN := COALESCE(current_setting('app.system_payment', TRUE), '') = '1';
BEGIN
  IF NEW.status <> 'paid' THEN RAISE EXCEPTION 'New ledger rows must be paid payments'; END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;
  IF NEW.invoice_id IS NULL THEN
    IF NEW.membership_id IS NULL THEN RAISE EXCEPTION 'An invoice or membership is required'; END IF;
    SELECT * INTO v_membership FROM public.memberships WHERE id=NEW.membership_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
    NEW.period_end:=COALESCE(NEW.period_end,v_membership.end_date);
    SELECT * INTO v_period FROM public.membership_periods
      WHERE membership_id=v_membership.id AND period_end=NEW.period_end FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing period not found'; END IF;
    SELECT invoice.* INTO v_invoice FROM public.invoices invoice
      JOIN public.invoice_lines line ON line.invoice_id=invoice.id
      WHERE line.id=v_period.invoice_line_id FOR UPDATE OF invoice;
    NEW.invoice_id:=v_invoice.id;
  ELSE
    SELECT * INTO v_invoice FROM public.invoices WHERE id=NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF v_invoice.membership_period_id IS NOT NULL THEN
      SELECT * INTO v_period FROM public.membership_periods WHERE id=v_invoice.membership_period_id;
    END IF;
    IF v_invoice.membership_id IS NOT NULL THEN
      SELECT * INTO v_membership FROM public.memberships WHERE id=v_invoice.membership_id;
    END IF;
  END IF;
  IF NEW.source='payment_link' THEN
    IF NOT v_system OR NEW.gateway_payment_id IS NULL OR NEW.mandate_id IS NOT NULL OR NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid trusted Payment Link payment'; END IF;
    IF v_invoice.currency<>'INR' OR v_invoice.membership_id IS NULL OR v_invoice.contact_id IS NULL THEN
      RAISE EXCEPTION 'Payment Link invoice is not collectible'; END IF;
  ELSIF NEW.source='auto' THEN
    IF NOT v_system OR NEW.gateway_payment_id IS NULL OR NEW.mandate_id IS NULL OR NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid trusted AutoPay payment'; END IF;
  ELSIF NEW.source='manual' THEN
    IF NEW.gateway_payment_id IS NOT NULL OR NEW.mandate_id IS NOT NULL OR NEW.gateway_metadata IS NOT NULL THEN
      RAISE EXCEPTION 'Manual payments cannot carry gateway provenance'; END IF;
    IF NOT v_system AND NOT public.is_account_member(v_invoice.account_id,'agent') THEN
      RAISE EXCEPTION 'Insufficient access to record this payment'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported payment source'; END IF;
  IF v_invoice.state<>'open' THEN RAISE EXCEPTION 'Payments cannot be recorded against a void invoice'; END IF;
  SELECT collectible_balance,requires_refund_review INTO v_balance,v_review
    FROM public.invoice_balances WHERE id=v_invoice.id;
  IF v_review THEN RAISE EXCEPTION 'Invoice is under refund review'; END IF;
  IF COALESCE(v_balance,0)<=0 THEN RAISE EXCEPTION 'This invoice is already settled'; END IF;
  IF NEW.source='payment_link' THEN
    IF ROUND(NEW.amount*100)::BIGINT<>ROUND(v_balance*100)::BIGINT THEN
      RAISE EXCEPTION 'Payment Link amount must equal the full invoice balance'; END IF;
  ELSIF NEW.amount>v_balance THEN RAISE EXCEPTION 'Payment exceeds the outstanding balance of %',v_balance; END IF;
  IF NEW.receipt_bucket IS NOT NULL AND NEW.receipt_bucket<>'payment-receipts' THEN RAISE EXCEPTION 'Unsupported receipt bucket'; END IF;
  NEW.account_id:=v_invoice.account_id; NEW.contact_id:=v_invoice.contact_id; NEW.membership_id:=v_invoice.membership_id;
  NEW.user_id:=CASE WHEN NEW.source='payment_link' THEN NULL ELSE COALESCE((SELECT auth.uid()),NEW.user_id) END;
  IF v_period.id IS NOT NULL THEN
    IF v_period.state='void' THEN RAISE EXCEPTION 'Payments cannot be recorded against a void billing period'; END IF;
    NEW.period_start:=v_period.period_start; NEW.period_end:=v_period.period_end; NEW.plan_id:=v_period.plan_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.derive_membership_fee_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_balance NUMERIC(12,2); v_review BOOLEAN;
BEGIN
 SELECT collectible_balance,requires_refund_review INTO v_balance,v_review FROM public.membership_period_invoices
 WHERE membership_id=NEW.id AND period_end=NEW.end_date;
 IF v_balance IS NULL THEN v_balance:=NEW.fee_amount; END IF;
 NEW.fee_status:=CASE WHEN NEW.is_trial OR NEW.status='cancelled' OR v_review OR v_balance<0.5 THEN 'paid' ELSE 'due' END;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.invalidate_invoice_link_from_refund_fact()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_invoice_id UUID;
BEGIN
 IF TG_TABLE_NAME='payment_refunds' THEN v_invoice_id:=COALESCE(NEW.invoice_id,OLD.invoice_id);
 ELSIF TG_TABLE_NAME='payment_refund_allocations' THEN SELECT invoice_id INTO v_invoice_id FROM public.payment_refunds WHERE id=COALESCE(NEW.refund_id,OLD.refund_id);
 ELSIF TG_TABLE_NAME='invoice_adjustments' THEN v_invoice_id:=COALESCE(NEW.invoice_id,OLD.invoice_id);
 ELSIF TG_TABLE_NAME='invoice_adjustment_allocations' THEN SELECT invoice_id INTO v_invoice_id FROM public.invoice_adjustments WHERE id=COALESCE(NEW.adjustment_id,OLD.adjustment_id);
 END IF;
 IF v_invoice_id IS NOT NULL THEN PERFORM public.request_invoice_link_cancellation(v_invoice_id,TG_TABLE_NAME||'_changed'); END IF;
 RETURN COALESCE(NEW,OLD);
END; $$;
DO $$ DECLARE v_table TEXT; BEGIN FOREACH v_table IN ARRAY ARRAY['payment_refunds','payment_refund_allocations','invoice_adjustments','invoice_adjustment_allocations'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS invalidate_invoice_link ON public.%I',v_table);
 EXECUTE format('CREATE TRIGGER invalidate_invoice_link AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.invalidate_invoice_link_from_refund_fact()',v_table);
END LOOP; END $$;

REVOKE ALL ON FUNCTION public.has_unallocated_processed_refund(UUID),public.protect_refund_financial_facts(),
 public.validate_refund_allocation(),public.validate_refund_adjustment_allocation(),
 public.reject_financial_fact_mutation(),public.create_refund_adjustment(UUID,UUID,TEXT),
 public.reserve_gateway_refund(UUID,UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT),
 public.store_gateway_refund_request(UUID,UUID,UUID,TEXT,TEXT,TEXT),
 public.finalize_gateway_refund(UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT,TIMESTAMPTZ,JSONB,TEXT),
 public.import_gateway_refund(UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,TIMESTAMPTZ,JSONB),
 public.classify_gateway_refund(UUID,UUID,UUID,TEXT,TEXT),
 public.initialize_razorpay_refund_reconciliation(UUID,TEXT),
 public.claim_gateway_refund_recovery_batch(TEXT,UUID,INTEGER,INTEGER),
 public.defer_gateway_refund_recovery(UUID,UUID,UUID,TEXT),
 public.claim_razorpay_refund_reconciliation(TEXT,UUID,INTEGER),
 public.advance_razorpay_refund_reconciliation(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,INTEGER,INTEGER),
 public.fail_razorpay_refund_reconciliation(UUID,UUID,TEXT),public.invalidate_invoice_link_from_refund_fact()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_gateway_refund(UUID,UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT),
 public.store_gateway_refund_request(UUID,UUID,UUID,TEXT,TEXT,TEXT),
 public.finalize_gateway_refund(UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT,TIMESTAMPTZ,JSONB,TEXT),
 public.import_gateway_refund(UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,TIMESTAMPTZ,JSONB),
 public.classify_gateway_refund(UUID,UUID,UUID,TEXT,TEXT),
 public.initialize_razorpay_refund_reconciliation(UUID,TEXT),
 public.claim_gateway_refund_recovery_batch(TEXT,UUID,INTEGER,INTEGER),
 public.defer_gateway_refund_recovery(UUID,UUID,UUID,TEXT),
 public.claim_razorpay_refund_reconciliation(TEXT,UUID,INTEGER),
 public.advance_razorpay_refund_reconciliation(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,INTEGER,INTEGER),
 public.fail_razorpay_refund_reconciliation(UUID,UUID,TEXT)
 TO service_role;

COMMENT ON TABLE public.payment_refunds IS 'Append-preserving Razorpay refund headers. Provider status and accounting disposition are separate axes.';
COMMENT ON TABLE public.gateway_refund_exceptions IS 'Service-only containment for external partial or otherwise unsafe refund facts.';
COMMENT ON TABLE public.razorpay_reconciliation_state IS 'Service-only fixed-window cursor for complete merchant refund discovery.';
