-- Harden Razorpay subscription setup and recurring charge accounting.
--
-- Safety invariants introduced here:
--   * a local mandate reservation exists before any remote subscription is
--     created, and one blocking reservation exists per membership;
--   * every recurring charge is addressed by Razorpay's monotonic paid_count
--     and the period that was current when the mandate was created;
--   * a provider-confirmed charge that cannot safely enter the ledger is
--     preserved as an operator-visible exception and completes its webhook;
--   * automatic payments allocate only to their explicit membership line.

-- ---------------------------------------------------------------------------
-- Mandate setup reservation and immutable billing context
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_mandates
  DROP CONSTRAINT IF EXISTS payment_mandates_status_check;

ALTER TABLE public.payment_mandates
  ADD CONSTRAINT payment_mandates_status_check CHECK (
    status IN (
      'creating', 'pending', 'active', 'paused', 'revoked', 'expired',
      'failed', 'orphaned'
    )
  );

ALTER TABLE public.payment_mandates
  ADD COLUMN IF NOT EXISTS pricing_option_id UUID
    REFERENCES public.plan_pricing_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gateway_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_short_url TEXT,
  ADD COLUMN IF NOT EXISTS cycle_duration_count INTEGER,
  ADD COLUMN IF NOT EXISTS cycle_duration_unit TEXT,
  ADD COLUMN IF NOT EXISTS recurring_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS initial_period_end DATE,
  ADD COLUMN IF NOT EXISTS last_applied_paid_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_applied_period_end DATE,
  ADD COLUMN IF NOT EXISTS setup_error TEXT;

ALTER TABLE public.payment_mandates
  DROP CONSTRAINT IF EXISTS payment_mandates_cycle_duration_count_check,
  DROP CONSTRAINT IF EXISTS payment_mandates_cycle_duration_unit_check,
  DROP CONSTRAINT IF EXISTS payment_mandates_recurring_amount_check,
  DROP CONSTRAINT IF EXISTS payment_mandates_last_applied_paid_count_check;

ALTER TABLE public.payment_mandates
  ADD CONSTRAINT payment_mandates_cycle_duration_count_check
    CHECK (cycle_duration_count IS NULL OR cycle_duration_count > 0),
  ADD CONSTRAINT payment_mandates_cycle_duration_unit_check
    CHECK (
      cycle_duration_unit IS NULL
      OR cycle_duration_unit IN ('day', 'week', 'month', 'year')
    ),
  ADD CONSTRAINT payment_mandates_recurring_amount_check
    CHECK (recurring_amount IS NULL OR recurring_amount > 0),
  ADD CONSTRAINT payment_mandates_last_applied_paid_count_check
    CHECK (last_applied_paid_count >= 0);

-- Best-effort snapshots for mandates created before this migration. New setup
-- writes every field before contacting Razorpay, so new charges never rely on
-- mutable plan or membership values.
UPDATE public.payment_mandates mandate
SET
  pricing_option_id = COALESCE(mandate.pricing_option_id, membership.pricing_option_id),
  cycle_duration_count = COALESCE(
    mandate.cycle_duration_count,
    option.duration_count,
    plan.duration_days
  ),
  cycle_duration_unit = COALESCE(
    mandate.cycle_duration_unit,
    option.duration_unit,
    CASE WHEN plan.duration_days IS NOT NULL THEN 'day' END
  ),
  recurring_amount = COALESCE(
    mandate.recurring_amount,
    mandate.max_amount,
    option.price,
    membership.fee_amount
  ),
  currency = COALESCE(mandate.currency, account.default_currency),
  initial_period_end = COALESCE(
    mandate.initial_period_end,
    (
      SELECT MIN(payment.period_end)
      FROM public.payments payment
      WHERE payment.mandate_id = mandate.id
        AND payment.source = 'auto'
        AND payment.status = 'paid'
    ),
    (
      SELECT period.period_end
      FROM public.membership_periods period
      WHERE period.membership_id = mandate.membership_id
        AND mandate.created_at::DATE BETWEEN period.period_start AND period.period_end
      ORDER BY period.period_start DESC
      LIMIT 1
    ),
    membership.end_date
  )
FROM public.memberships membership
LEFT JOIN public.plan_pricing_options option
  ON option.id = membership.pricing_option_id
LEFT JOIN public.membership_plans plan ON plan.id = membership.plan_id
JOIN public.accounts account ON account.id = membership.account_id
WHERE mandate.membership_id = membership.id;

UPDATE public.payment_mandates mandate
SET
  last_applied_paid_count = applied.charge_count,
  last_applied_period_end = applied.last_period_end
FROM (
  SELECT
    payment.mandate_id,
    COUNT(DISTINCT payment.gateway_payment_id)::INTEGER AS charge_count,
    MAX(payment.period_end) AS last_period_end
  FROM public.payments payment
  WHERE payment.source = 'auto'
    AND payment.status = 'paid'
    AND payment.mandate_id IS NOT NULL
    AND payment.gateway_payment_id IS NOT NULL
  GROUP BY payment.mandate_id
) applied
WHERE mandate.id = applied.mandate_id;

-- Older code allowed more than one pending row. Keep the most authoritative
-- row blocking and flag every duplicate remote reference for review before
-- installing the stronger unique index.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY membership_id
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'paused' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        updated_at DESC,
        id
    ) AS position
  FROM public.payment_mandates
  WHERE status IN ('creating', 'pending', 'active', 'paused', 'orphaned')
)
UPDATE public.payment_mandates mandate
SET status = 'failed',
    setup_error = COALESCE(
      mandate.setup_error,
      'Pre-migration duplicate mandate: verify and cancel the remote subscription before retrying setup.'
    )
FROM ranked
WHERE mandate.id = ranked.id AND ranked.position > 1;

DROP INDEX IF EXISTS public.uniq_payment_mandate_active;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_mandate_blocking
  ON public.payment_mandates(membership_id)
  WHERE status IN ('creating', 'pending', 'active', 'paused', 'orphaned');

-- Client-side writes could bypass the setup reservation/compensation flow.
-- Reads remain tenant-scoped so member billing can show setup state.
DROP POLICY IF EXISTS payment_mandates_insert ON public.payment_mandates;
DROP POLICY IF EXISTS payment_mandates_update ON public.payment_mandates;
DROP POLICY IF EXISTS payment_mandates_delete ON public.payment_mandates;
REVOKE INSERT, UPDATE, DELETE ON public.payment_mandates FROM authenticated;
GRANT SELECT ON public.payment_mandates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_mandates TO service_role;

-- A terminal failed reservation does not make the membership automatic.
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

  IF NOT FOUND THEN RAISE EXCEPTION 'Mandate not found'; END IF;
  IF v_mandate.status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'Mandate in state % cannot be activated', v_mandate.status;
  END IF;
  IF v_mandate.gateway_subscription_id IS DISTINCT FROM p_subscription_id THEN
    RAISE EXCEPTION 'Subscription does not match the mandate reservation';
  END IF;

  UPDATE public.payment_mandates
  SET status = 'active',
      gateway_token_id = COALESCE(p_token_id, gateway_token_id),
      authed_at = COALESCE(authed_at, NOW()),
      setup_error = NULL
  WHERE id = p_mandate_id;

  UPDATE public.memberships
  SET collection_mode = 'auto'
  WHERE id = v_mandate.membership_id;

  RETURN p_mandate_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_mandate(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_mandate(UUID, TEXT, TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Durable provider-confirmed, unapplied charge exceptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gateway_charge_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  mandate_id UUID REFERENCES public.payment_mandates(id) ON DELETE SET NULL,
  webhook_event_id TEXT REFERENCES public.webhook_events(id) ON DELETE SET NULL,
  gateway TEXT NOT NULL DEFAULT 'razorpay',
  gateway_subscription_id TEXT NOT NULL,
  gateway_payment_id TEXT NOT NULL,
  gateway_invoice_id TEXT,
  provider_paid_count INTEGER,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT,
  method TEXT,
  payment_status TEXT,
  gateway_current_start TIMESTAMPTZ,
  gateway_current_end TIMESTAMPTZ,
  reason_code TEXT NOT NULL,
  reason_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'ignored')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  UNIQUE (account_id, gateway_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_gateway_charge_exceptions_open
  ON public.gateway_charge_exceptions(account_id, first_seen_at DESC)
  WHERE status = 'open';

ALTER TABLE public.gateway_charge_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_charge_exceptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.gateway_charge_exceptions TO service_role;

CREATE OR REPLACE FUNCTION public.preserve_gateway_charge_exception(
  p_account_id UUID,
  p_membership_id UUID,
  p_mandate_id UUID,
  p_webhook_event_id TEXT,
  p_gateway_subscription_id TEXT,
  p_gateway_payment_id TEXT,
  p_gateway_invoice_id TEXT,
  p_provider_paid_count INTEGER,
  p_amount NUMERIC,
  p_currency TEXT,
  p_method TEXT,
  p_payment_status TEXT,
  p_gateway_current_start TIMESTAMPTZ,
  p_gateway_current_end TIMESTAMPTZ,
  p_reason_code TEXT,
  p_reason_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exception_id UUID;
  v_membership_id UUID;
  v_mandate_id UUID;
  v_webhook_event_id TEXT;
BEGIN
  SELECT id INTO v_membership_id
  FROM public.memberships
  WHERE id = p_membership_id AND account_id = p_account_id;

  SELECT id INTO v_mandate_id
  FROM public.payment_mandates
  WHERE id = p_mandate_id AND account_id = p_account_id;

  SELECT id INTO v_webhook_event_id
  FROM public.webhook_events
  WHERE id = p_webhook_event_id AND account_id = p_account_id;

  INSERT INTO public.gateway_charge_exceptions AS existing (
    account_id, membership_id, mandate_id, webhook_event_id,
    gateway_subscription_id, gateway_payment_id, gateway_invoice_id,
    provider_paid_count, amount, currency, method, payment_status,
    gateway_current_start, gateway_current_end, reason_code, reason_message
  ) VALUES (
    p_account_id, v_membership_id, v_mandate_id, v_webhook_event_id,
    p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
    p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
    p_gateway_current_start, p_gateway_current_end, p_reason_code, p_reason_message
  )
  ON CONFLICT (account_id, gateway_payment_id) DO UPDATE SET
    webhook_event_id = COALESCE(existing.webhook_event_id, EXCLUDED.webhook_event_id),
    last_seen_at = NOW(),
    attempt_count = existing.attempt_count + 1,
    reason_code = EXCLUDED.reason_code,
    reason_message = EXCLUDED.reason_message
  RETURNING id INTO v_exception_id;

  RETURN v_exception_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.preserve_gateway_charge_exception(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, TEXT, TEXT,
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_gateway_charge_exception(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, TEXT, TEXT,
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- Explicit recurring charge address: paid_count + frozen period anchor
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_gateway_charge(
  UUID, UUID, TEXT, NUMERIC, TEXT, UUID
);

CREATE OR REPLACE FUNCTION public.record_gateway_charge(
  p_account_id UUID,
  p_membership_id UUID,
  p_mandate_id UUID,
  p_webhook_event_id TEXT,
  p_gateway_subscription_id TEXT,
  p_gateway_payment_id TEXT,
  p_gateway_invoice_id TEXT,
  p_provider_paid_count INTEGER,
  p_amount NUMERIC,
  p_currency TEXT,
  p_method TEXT,
  p_payment_status TEXT,
  p_gateway_current_start TIMESTAMPTZ,
  p_gateway_current_end TIMESTAMPTZ
)
RETURNS TABLE(
  outcome TEXT,
  payment_id UUID,
  exception_id UUID,
  renewed BOOLEAN,
  settled_period_end DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mandate public.payment_mandates%ROWTYPE;
  v_membership public.memberships%ROWTYPE;
  v_period public.membership_periods%ROWTYPE;
  v_existing_payment public.payments%ROWTYPE;
  v_existing_exception UUID;
  v_target_end DATE;
  v_target_start DATE;
  v_line_balance NUMERIC(12, 2);
  v_payment_id UUID;
  v_exception_id UUID;
  v_renewed BOOLEAN := FALSE;
  v_expected_count INTEGER;
  v_message TEXT;
BEGIN
  IF p_gateway_payment_id IS NULL OR btrim(p_gateway_payment_id) = '' THEN
    RAISE EXCEPTION 'A gateway payment id is required';
  END IF;
  IF p_gateway_subscription_id IS NULL OR btrim(p_gateway_subscription_id) = '' THEN
    RAISE EXCEPTION 'A gateway subscription id is required';
  END IF;

  -- Both applied and exception outcomes are idempotent on the provider's
  -- payment id. A redelivery never creates a second period or credit.
  SELECT * INTO v_existing_payment
  FROM public.payments
  WHERE account_id = p_account_id
    AND gateway_payment_id = p_gateway_payment_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      'applied'::TEXT, v_existing_payment.id, NULL::UUID, FALSE,
      v_existing_payment.period_end;
    RETURN;
  END IF;

  SELECT id INTO v_existing_exception
  FROM public.gateway_charge_exceptions
  WHERE account_id = p_account_id
    AND gateway_payment_id = p_gateway_payment_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      'exception'::TEXT, NULL::UUID, v_existing_exception, FALSE, NULL::DATE;
    RETURN;
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE id = p_mandate_id
  FOR UPDATE;

  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mandate.id IS NULL
     OR v_membership.id IS NULL
     OR v_mandate.account_id <> p_account_id
     OR v_membership.account_id <> p_account_id
     OR v_mandate.membership_id <> p_membership_id
     OR v_mandate.gateway_subscription_id IS DISTINCT FROM p_gateway_subscription_id THEN
    v_exception_id := public.preserve_gateway_charge_exception(
      p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
      p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
      p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
      p_gateway_current_start, p_gateway_current_end, 'mandate_mismatch',
      'The charge does not match this account, membership, and subscription reservation.'
    );
    RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
    RETURN;
  END IF;

  IF v_mandate.status NOT IN ('pending', 'active') THEN
    v_message := format(
      'Mandate %s cannot accept a charge while in state %s.',
      v_mandate.id, v_mandate.status
    );
    v_exception_id := public.preserve_gateway_charge_exception(
      p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
      p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
      p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
      p_gateway_current_start, p_gateway_current_end, 'mandate_state_mismatch',
      v_message
    );
    RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
    RETURN;
  END IF;

  v_expected_count := v_mandate.last_applied_paid_count + 1;
  IF p_provider_paid_count IS NULL OR p_provider_paid_count <> v_expected_count THEN
    v_message := format(
      'Expected Razorpay paid_count %s after the last applied charge, received %s.',
      v_expected_count, COALESCE(p_provider_paid_count::TEXT, 'null')
    );
    v_exception_id := public.preserve_gateway_charge_exception(
      p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
      p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
      p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
      p_gateway_current_start, p_gateway_current_end, 'charge_sequence_mismatch',
      v_message
    );
    RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
    RETURN;
  END IF;

  IF p_payment_status IS DISTINCT FROM 'captured' THEN
    v_exception_id := public.preserve_gateway_charge_exception(
      p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
      p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
      p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
      p_gateway_current_start, p_gateway_current_end, 'payment_not_captured',
      'Razorpay emitted subscription.charged without a captured payment.'
    );
    RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
    RETURN;
  END IF;

  IF v_mandate.recurring_amount IS NULL
     OR p_amount IS DISTINCT FROM v_mandate.recurring_amount THEN
    v_message := format(
      'Expected recurring amount %s, received %s.',
      COALESCE(v_mandate.recurring_amount::TEXT, 'null'),
      COALESCE(p_amount::TEXT, 'null')
    );
    v_exception_id := public.preserve_gateway_charge_exception(
      p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
      p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
      p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
      p_gateway_current_start, p_gateway_current_end, 'amount_mismatch', v_message
    );
    RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
    RETURN;
  END IF;

  IF v_mandate.currency IS NULL OR upper(p_currency) IS DISTINCT FROM upper(v_mandate.currency) THEN
    v_message := format(
      'Expected currency %s, received %s.',
      COALESCE(v_mandate.currency, 'null'), COALESCE(p_currency, 'null')
    );
    v_exception_id := public.preserve_gateway_charge_exception(
      p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
      p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
      p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
      p_gateway_current_start, p_gateway_current_end, 'currency_mismatch', v_message
    );
    RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
    RETURN;
  END IF;

  IF p_provider_paid_count = 1 THEN
    v_target_end := v_mandate.initial_period_end;
  ELSE
    IF v_mandate.last_applied_period_end IS NULL
       OR v_mandate.cycle_duration_count IS NULL
       OR v_mandate.cycle_duration_unit IS NULL THEN
      v_target_end := NULL;
    ELSE
      v_target_end := (
        v_mandate.last_applied_period_end
        + v_mandate.cycle_duration_count
          * CASE v_mandate.cycle_duration_unit
              WHEN 'day' THEN INTERVAL '1 day'
              WHEN 'week' THEN INTERVAL '1 week'
              WHEN 'month' THEN INTERVAL '1 month'
              WHEN 'year' THEN INTERVAL '1 year'
            END
      )::DATE;
    END IF;
  END IF;

  IF v_target_end IS NULL THEN
    v_exception_id := public.preserve_gateway_charge_exception(
      p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
      p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
      p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
      p_gateway_current_start, p_gateway_current_end, 'missing_period_anchor',
      'The mandate has no reliable local period anchor for this provider charge.'
    );
    RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
    RETURN;
  END IF;

  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = p_membership_id AND period_end = v_target_end
  FOR UPDATE;

  IF FOUND THEN
    IF v_period.state <> 'open' THEN
      v_exception_id := public.preserve_gateway_charge_exception(
        p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
        p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
        p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
        p_gateway_current_start, p_gateway_current_end, 'target_period_void',
        'The explicitly addressed membership period is void.'
      );
      RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
      RETURN;
    END IF;

    SELECT balance INTO v_line_balance
    FROM public.invoice_line_balances
    WHERE id = v_period.invoice_line_id;

    IF v_line_balance IS NULL OR p_amount > v_line_balance THEN
      v_message := format(
        'The explicit period has balance %s but Razorpay captured %s; the charge was not moved to another cycle.',
        COALESCE(v_line_balance::TEXT, 'null'), p_amount
      );
      v_exception_id := public.preserve_gateway_charge_exception(
        p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
        p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
        p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
        p_gateway_current_start, p_gateway_current_end, 'target_balance_mismatch',
        v_message
      );
      RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
      RETURN;
    END IF;
  ELSE
    -- Only a sequential charge after one successfully applied charge may open
    -- a new period, and only if the membership still points at that anchor.
    IF p_provider_paid_count = 1
       OR v_membership.end_date IS DISTINCT FROM v_mandate.last_applied_period_end
       OR v_membership.pricing_option_id IS DISTINCT FROM v_mandate.pricing_option_id
       OR v_mandate.cycle_duration_count IS NULL
       OR v_mandate.cycle_duration_unit IS NULL THEN
      v_exception_id := public.preserve_gateway_charge_exception(
        p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
        p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
        p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
        p_gateway_current_start, p_gateway_current_end, 'period_context_mismatch',
        'The next period cannot be opened from the frozen mandate context; review the membership or plan change.'
      );
      RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
      RETURN;
    END IF;

    v_target_start := v_mandate.last_applied_period_end;
  END IF;

  BEGIN
    IF v_period.id IS NULL THEN
      INSERT INTO public.membership_periods (
        account_id, membership_id, contact_id, plan_id, pricing_option_id,
        period_start, period_end, fee_amount, state
      ) VALUES (
        v_membership.account_id, v_membership.id, v_membership.contact_id,
        v_membership.plan_id, v_mandate.pricing_option_id,
        v_target_start, v_target_end, v_mandate.recurring_amount, 'open'
      )
      RETURNING * INTO v_period;

      UPDATE public.memberships
      SET start_date = v_target_start,
          end_date = v_target_end,
          fee_amount = v_mandate.recurring_amount,
          status = 'active'
      WHERE id = v_membership.id;
      v_renewed := TRUE;
    END IF;

    PERFORM set_config('app.system_payment', '1', TRUE);
    INSERT INTO public.payments (
      account_id, membership_id, contact_id, plan_id, user_id,
      amount, method, status, paid_at, period_end,
      source, mandate_id, gateway_payment_id
    ) VALUES (
      v_membership.account_id, v_membership.id, v_membership.contact_id,
      v_period.plan_id, NULL, p_amount,
      CASE WHEN p_method = 'card' THEN 'card' ELSE 'upi' END,
      'paid', NOW(), v_target_end, 'auto', v_mandate.id,
      p_gateway_payment_id
    )
    RETURNING id INTO v_payment_id;

    UPDATE public.payment_mandates
    SET last_applied_paid_count = p_provider_paid_count,
        last_applied_period_end = v_target_end,
        next_charge_at = v_target_end,
        setup_error = NULL
    WHERE id = v_mandate.id;
    PERFORM set_config('app.system_payment', '', TRUE);
  EXCEPTION WHEN OTHERS THEN
    v_message := 'Ledger insertion failed after provider confirmation: ' || SQLERRM;
    v_exception_id := public.preserve_gateway_charge_exception(
      p_account_id, p_membership_id, p_mandate_id, p_webhook_event_id,
      p_gateway_subscription_id, p_gateway_payment_id, p_gateway_invoice_id,
      p_provider_paid_count, p_amount, p_currency, p_method, p_payment_status,
      p_gateway_current_start, p_gateway_current_end, 'ledger_insert_failed',
      v_message
    );
    RETURN QUERY SELECT 'exception'::TEXT, NULL::UUID, v_exception_id, FALSE, NULL::DATE;
    RETURN;
  END;

  RETURN QUERY SELECT 'applied'::TEXT, v_payment_id, NULL::UUID, v_renewed, v_target_end;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_gateway_charge(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, TEXT, TEXT,
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gateway_charge(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, TEXT, TEXT,
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

-- Deployment/rollback compatibility for the pre-hardening webhook route.
-- The legacy payload does not provide paid_count, currency, captured state,
-- or event identity, so it is never safe to infer/apply a cycle. Preserve the
-- confirmed money as an exception and return success; the new route selects
-- the richer overload by its distinct named arguments.
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
  v_existing_payment UUID;
  v_mandate public.payment_mandates%ROWTYPE;
BEGIN
  SELECT id INTO v_existing_payment
  FROM public.payments
  WHERE account_id = p_account_id
    AND gateway_payment_id = p_gateway_payment_id;

  IF v_existing_payment IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_payment, FALSE, NULL::DATE;
    RETURN;
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE id = p_mandate_id AND account_id = p_account_id;

  PERFORM public.preserve_gateway_charge_exception(
    p_account_id,
    p_membership_id,
    p_mandate_id,
    NULL,
    COALESCE(v_mandate.gateway_subscription_id, 'legacy-payload-unknown'),
    p_gateway_payment_id,
    NULL,
    NULL,
    p_amount,
    v_mandate.currency,
    p_method,
    NULL,
    NULL,
    NULL,
    'legacy_payload_missing_charge_identity',
    'A pre-hardening webhook confirmed this charge without paid_count and period identity; it was not applied automatically.'
  );

  RETURN QUERY SELECT NULL::UUID, FALSE, NULL::DATE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_gateway_charge(
  UUID, UUID, TEXT, NUMERIC, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gateway_charge(
  UUID, UUID, TEXT, NUMERIC, TEXT, UUID
) TO service_role;

-- ---------------------------------------------------------------------------
-- Auto payments may settle only their explicitly addressed membership line.
-- Manual payments keep the established proportional allocation behavior.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_invoice_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice_cents BIGINT;
  v_payment_cents BIGINT := ROUND(NEW.amount * 100)::BIGINT;
  v_auto_line_id UUID;
BEGIN
  IF NEW.status <> 'paid' OR NEW.invoice_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.source = 'auto' THEN
    SELECT period.invoice_line_id INTO v_auto_line_id
    FROM public.membership_periods period
    JOIN public.invoice_lines line ON line.id = period.invoice_line_id
    WHERE period.membership_id = NEW.membership_id
      AND period.period_end = NEW.period_end
      AND line.invoice_id = NEW.invoice_id;
    IF v_auto_line_id IS NULL THEN
      RAISE EXCEPTION 'Automatic payment has no explicit membership invoice line';
    END IF;
  END IF;

  WITH line_balance AS (
    SELECT
      line.id,
      GREATEST(
        ROUND(line.line_amount * 100)::BIGINT
          - COALESCE((
              SELECT SUM(ROUND(allocation.amount * 100)::BIGINT)
              FROM public.payment_allocations allocation
              JOIN public.payments payment ON payment.id = allocation.payment_id
              WHERE allocation.invoice_line_id = line.id
                AND payment.status = 'paid'
            ), 0)
          - COALESCE((
              SELECT SUM(ROUND(credit.amount * 100)::BIGINT)
              FROM public.invoice_credit_allocations credit
              WHERE credit.invoice_line_id = line.id
            ), 0),
        0
      ) AS balance_cents
    FROM public.invoice_lines line
    WHERE line.invoice_id = NEW.invoice_id
      AND line.state = 'active'
      AND (NEW.source <> 'auto' OR line.id = v_auto_line_id)
  )
  SELECT SUM(balance_cents) INTO v_invoice_cents FROM line_balance;

  IF COALESCE(v_invoice_cents, 0) < v_payment_cents THEN
    RAISE EXCEPTION 'Payment exceeds eligible invoice line balances';
  END IF;

  INSERT INTO public.payment_allocations (
    payment_id, invoice_line_id, account_id, amount
  )
  WITH line_balance AS (
    SELECT
      line.id,
      GREATEST(
        ROUND(line.line_amount * 100)::BIGINT
          - COALESCE((
              SELECT SUM(ROUND(allocation.amount * 100)::BIGINT)
              FROM public.payment_allocations allocation
              JOIN public.payments payment ON payment.id = allocation.payment_id
              WHERE allocation.invoice_line_id = line.id
                AND payment.status = 'paid'
            ), 0)
          - COALESCE((
              SELECT SUM(ROUND(credit.amount * 100)::BIGINT)
              FROM public.invoice_credit_allocations credit
              WHERE credit.invoice_line_id = line.id
            ), 0),
        0
      ) AS balance_cents
    FROM public.invoice_lines line
    WHERE line.invoice_id = NEW.invoice_id
      AND line.state = 'active'
      AND (NEW.source <> 'auto' OR line.id = v_auto_line_id)
  ), shares AS (
    SELECT
      id,
      (v_payment_cents * balance_cents / v_invoice_cents)::BIGINT AS base_cents,
      MOD(v_payment_cents * balance_cents, v_invoice_cents) AS remainder
    FROM line_balance
    WHERE balance_cents > 0
  ), ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY remainder DESC, id) AS rank
    FROM shares
  ), totals AS (
    SELECT v_payment_cents - SUM(base_cents) AS extra_cents FROM shares
  )
  SELECT
    NEW.id,
    ranked.id,
    NEW.account_id,
    (
      ranked.base_cents
      + CASE WHEN ranked.rank <= totals.extra_cents THEN 1 ELSE 0 END
    )::NUMERIC / 100
  FROM ranked CROSS JOIN totals
  WHERE
    ranked.base_cents
      + CASE WHEN ranked.rank <= totals.extra_cents THEN 1 ELSE 0 END > 0;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_payment()
  FROM PUBLIC, anon, authenticated;
