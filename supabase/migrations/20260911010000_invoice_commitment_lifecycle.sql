-- Step 4: staff-authored invoice commitments and explicit collection holds.
-- This stays additive and disabled by default. It never moves money, creates
-- provider links, or treats a customer reply as a payment fact.

ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS promise_to_pay_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS promise_to_pay_reminders_activated_on DATE,
  ADD COLUMN IF NOT EXISTS promise_to_pay_reminders_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promise_to_pay_reminders_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS payment_link_follow_up_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_link_follow_up_activated_on DATE,
  ADD COLUMN IF NOT EXISTS payment_link_follow_up_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_link_follow_up_generation UUID NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS public.invoice_collection_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('promise_to_pay', 'verification_hold', 'dispute_hold')),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'fulfilled', 'broken', 'resolved', 'cancelled')),
  amount NUMERIC(12, 2),
  promised_on DATE,
  reason TEXT,
  next_action TEXT NOT NULL,
  assigned_to UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  payment_allocation_snapshot NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (payment_allocation_snapshot >= 0),
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,
  broken_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (kind = 'promise_to_pay' AND amount IS NOT NULL AND amount > 0 AND promised_on IS NOT NULL AND reason IS NULL)
    OR (kind IN ('verification_hold', 'dispute_hold') AND amount IS NULL AND promised_on IS NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_collection_commitments_open_invoice_kind
  ON public.invoice_collection_commitments(invoice_id, kind)
  WHERE state = 'open';
CREATE INDEX IF NOT EXISTS invoice_collection_commitments_worker_idx
  ON public.invoice_collection_commitments(account_id, state, promised_on)
  WHERE state = 'open';

CREATE TABLE IF NOT EXISTS public.invoice_collection_commitment_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES public.invoice_collection_commitments(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK (event IN ('created', 'revised', 'fulfilled', 'broken', 'resolved', 'cancelled')),
  revision INTEGER NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS invoice_collection_commitment_audit_history_idx
  ON public.invoice_collection_commitment_audit(commitment_id, created_at DESC);

ALTER TABLE public.invoice_collection_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_collection_commitment_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_collection_commitments_select ON public.invoice_collection_commitments;
CREATE POLICY invoice_collection_commitments_select ON public.invoice_collection_commitments
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS invoice_collection_commitments_insert ON public.invoice_collection_commitments;
CREATE POLICY invoice_collection_commitments_insert ON public.invoice_collection_commitments
  FOR INSERT TO authenticated WITH CHECK (
    public.is_account_member(account_id, 'agent') AND created_by = auth.uid()
  );
-- Author-only direct edits; service reconciliation and audited cancellation
-- use the narrowly scoped SECURITY DEFINER functions below.
DROP POLICY IF EXISTS invoice_collection_commitments_update ON public.invoice_collection_commitments;
CREATE POLICY invoice_collection_commitments_update ON public.invoice_collection_commitments
  FOR UPDATE TO authenticated USING (
    public.is_account_member(account_id, 'agent') AND created_by = auth.uid()
  ) WITH CHECK (
    public.is_account_member(account_id, 'agent') AND created_by = auth.uid()
  );
DROP POLICY IF EXISTS invoice_collection_commitment_audit_select ON public.invoice_collection_commitment_audit;
CREATE POLICY invoice_collection_commitment_audit_select ON public.invoice_collection_commitment_audit
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

REVOKE ALL ON public.invoice_collection_commitments, public.invoice_collection_commitment_audit FROM anon, authenticated;
GRANT SELECT ON public.invoice_collection_commitments, public.invoice_collection_commitment_audit TO authenticated;
GRANT ALL ON public.invoice_collection_commitments, public.invoice_collection_commitment_audit TO service_role;

CREATE OR REPLACE FUNCTION public.invoice_commitment_payment_allocations(p_invoice_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(SUM(allocation.amount), 0)
  FROM public.payment_allocations allocation
  JOIN public.payments payment ON payment.id = allocation.payment_id
  JOIN public.invoice_lines line ON line.id = allocation.invoice_line_id
  WHERE line.invoice_id = p_invoice_id AND payment.status = 'paid';
$$;

CREATE OR REPLACE FUNCTION public.assert_invoice_collection_commitment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_invoice RECORD;
BEGIN
  SELECT balance.account_id, balance.contact_id, balance.collectible_balance, balance.state, balance.requires_refund_review
  INTO v_invoice FROM public.invoice_balances balance WHERE balance.id = NEW.invoice_id FOR SHARE;
  IF NOT FOUND OR v_invoice.account_id <> NEW.account_id OR v_invoice.contact_id <> NEW.contact_id
    OR v_invoice.state <> 'open' OR v_invoice.requires_refund_review OR v_invoice.collectible_balance <= 0 THEN
    RAISE EXCEPTION 'Invoice is not collectible' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'promise_to_pay' AND NEW.amount > v_invoice.collectible_balance THEN
    RAISE EXCEPTION 'Promise amount exceeds current collectible balance' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.account_id = NEW.account_id AND p.user_id = NEW.assigned_to) THEN
    RAISE EXCEPTION 'Assignee is not a member of this branch' USING ERRCODE = '23514';
  END IF;
  NEW.payment_allocation_snapshot := public.invoice_commitment_payment_allocations(NEW.invoice_id);
  NEW.snapshot_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_invoice_collection_commitment ON public.invoice_collection_commitments;
CREATE TRIGGER trg_assert_invoice_collection_commitment
  BEFORE INSERT OR UPDATE OF amount, promised_on, reason, next_action, assigned_to, kind
  ON public.invoice_collection_commitments
  FOR EACH ROW EXECUTE FUNCTION public.assert_invoice_collection_commitment();
DROP TRIGGER IF EXISTS trg_invoice_collection_commitments_updated_at ON public.invoice_collection_commitments;
CREATE TRIGGER trg_invoice_collection_commitments_updated_at
  BEFORE UPDATE ON public.invoice_collection_commitments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.save_invoice_collection_commitment(
  p_id UUID DEFAULT NULL,
  p_invoice_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_promised_on DATE DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_next_action TEXT DEFAULT NULL,
  p_assigned_to UUID DEFAULT NULL,
  p_expected_revision INTEGER DEFAULT NULL
)
RETURNS public.invoice_collection_commitments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.invoice_collection_commitments%ROWTYPE; v_invoice RECORD; v_result public.invoice_collection_commitments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL THEN
    SELECT id, account_id, contact_id INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
    IF NOT FOUND OR NOT public.is_account_member(v_invoice.account_id, 'agent') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.invoice_collection_commitments(account_id, invoice_id, contact_id, kind, amount, promised_on, reason, next_action, assigned_to, created_by)
    VALUES (v_invoice.account_id, p_invoice_id, v_invoice.contact_id, p_kind, p_amount, p_promised_on, NULLIF(btrim(COALESCE(p_reason,'')), ''), NULLIF(btrim(COALESCE(p_next_action,'')), ''), COALESCE(p_assigned_to, auth.uid()), auth.uid())
    RETURNING * INTO v_result;
    INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, actor_id, event, revision, detail)
    VALUES (v_result.id, v_result.account_id, auth.uid(), 'created', v_result.revision, jsonb_build_object('kind', v_result.kind));
    RETURN v_result;
  END IF;
  SELECT * INTO v_existing FROM public.invoice_collection_commitments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_existing.created_by <> auth.uid() OR NOT public.is_account_member(v_existing.account_id, 'agent') THEN RAISE EXCEPTION 'Only the author may edit this commitment' USING ERRCODE = '42501'; END IF;
  IF v_existing.state <> 'open' OR p_expected_revision IS NULL OR p_expected_revision <> v_existing.revision THEN RAISE EXCEPTION 'Commitment changed; refresh and try again' USING ERRCODE = '40001'; END IF;
  UPDATE public.invoice_collection_commitments SET
    amount = p_amount, promised_on = p_promised_on, reason = NULLIF(btrim(COALESCE(p_reason,'')), ''),
    next_action = NULLIF(btrim(COALESCE(p_next_action,'')), ''), assigned_to = COALESCE(p_assigned_to, v_existing.assigned_to),
    revision = revision + 1
  WHERE id = v_existing.id RETURNING * INTO v_result;
  INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, actor_id, event, revision, detail)
  VALUES (v_result.id, v_result.account_id, auth.uid(), 'revised', v_result.revision, jsonb_build_object('previous_revision', v_existing.revision));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_invoice_collection_commitment(p_id UUID, p_expected_revision INTEGER)
RETURNS public.invoice_collection_commitments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.invoice_collection_commitments%ROWTYPE; v_result public.invoice_collection_commitments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_existing FROM public.invoice_collection_commitments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_existing.account_id, 'admin') THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF v_existing.state <> 'open' OR p_expected_revision <> v_existing.revision THEN RAISE EXCEPTION 'Commitment changed; refresh and try again' USING ERRCODE = '40001'; END IF;
  UPDATE public.invoice_collection_commitments SET state='cancelled', cancelled_at=NOW(), cancelled_by=auth.uid(), revision=revision+1 WHERE id=p_id RETURNING * INTO v_result;
  INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, actor_id, event, revision, detail)
  VALUES (v_result.id, v_result.account_id, auth.uid(), 'cancelled', v_result.revision, jsonb_build_object('previous_revision', v_existing.revision));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_invoice_collection_commitment(p_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_commitment public.invoice_collection_commitments%ROWTYPE; v_paid NUMERIC; v_owner UUID; v_existing UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_commitment FROM public.invoice_collection_commitments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_commitment.state <> 'open' THEN RETURN 'not_open'; END IF;
  IF v_commitment.kind <> 'promise_to_pay' THEN RETURN 'hold_open'; END IF;
  v_paid := public.invoice_commitment_payment_allocations(v_commitment.invoice_id) - v_commitment.payment_allocation_snapshot;
  IF v_paid >= v_commitment.amount THEN
    UPDATE public.invoice_collection_commitments SET state='fulfilled', fulfilled_at=NOW() WHERE id=v_commitment.id;
    INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, event, revision, detail)
    VALUES (v_commitment.id, v_commitment.account_id, 'fulfilled', v_commitment.revision, jsonb_build_object('paid_since_snapshot', v_paid));
    RETURN 'fulfilled';
  END IF;
  IF (NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id=v_commitment.account_id))::DATE <= v_commitment.promised_on THEN RETURN 'open'; END IF;
  UPDATE public.invoice_collection_commitments SET state='broken', broken_at=NOW() WHERE id=v_commitment.id;
  INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, event, revision, detail)
  VALUES (v_commitment.id, v_commitment.account_id, 'broken', v_commitment.revision, jsonb_build_object('paid_since_snapshot', v_paid));
  SELECT id INTO v_existing FROM public.follow_ups WHERE account_id=v_commitment.account_id AND contact_id=v_commitment.contact_id AND status='open';
  IF v_existing IS NULL THEN
    v_owner := v_commitment.assigned_to;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE account_id=v_commitment.account_id AND user_id=v_owner) THEN SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id=v_commitment.account_id; END IF;
    INSERT INTO public.follow_ups(account_id, contact_id, assigned_to, created_by, reason, task_type, due_date, note)
    VALUES (v_commitment.account_id, v_commitment.contact_id, v_owner, v_commitment.created_by, 'payment', 'todo',
      (NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id=v_commitment.account_id))::DATE,
      'Broken payment promise: ' || v_commitment.next_action);
  END IF;
  RETURN 'broken';
END;
$$;

ALTER TABLE public.lifecycle_reminder_jobs
  ADD COLUMN IF NOT EXISTS collection_commitment_id UUID REFERENCES public.invoice_collection_commitments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commitment_revision INTEGER,
  ADD COLUMN IF NOT EXISTS payment_link_id UUID REFERENCES public.razorpay_payment_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_link_revision INTEGER;
ALTER TABLE public.lifecycle_reminder_jobs DROP CONSTRAINT IF EXISTS lifecycle_reminder_jobs_kind_check;
ALTER TABLE public.lifecycle_reminder_jobs ADD CONSTRAINT lifecycle_reminder_jobs_kind_check CHECK (kind IN (
  'invoice_due', 'invoice_overdue', 'installment_overdue', 'payment_confirmation',
  'membership_post_expiry', 'service_post_expiry', 'promise_to_pay', 'payment_link_follow_up'
));
CREATE INDEX IF NOT EXISTS lifecycle_reminder_jobs_commitment_idx ON public.lifecycle_reminder_jobs(collection_commitment_id, commitment_revision) WHERE collection_commitment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lifecycle_reminder_jobs_payment_link_idx ON public.lifecycle_reminder_jobs(payment_link_id, payment_link_revision) WHERE payment_link_id IS NOT NULL;

-- Activation values cannot be client supplied and every re-enable starts a new
-- generation, exactly as prior lifecycle settings do.
CREATE OR REPLACE FUNCTION public.set_invoice_collection_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_timezone TEXT;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.invoice_collection_enabled=OLD.invoice_collection_enabled AND (NEW.invoice_collection_activated_on IS DISTINCT FROM OLD.invoice_collection_activated_on OR NEW.invoice_collection_activated_at IS DISTINCT FROM OLD.invoice_collection_activated_at OR NEW.invoice_collection_generation IS DISTINCT FROM OLD.invoice_collection_generation) THEN RAISE EXCEPTION 'Invoice collection activation fields are system managed'; END IF;
    IF NEW.membership_post_expiry_enabled=OLD.membership_post_expiry_enabled AND (NEW.membership_post_expiry_activated_on IS DISTINCT FROM OLD.membership_post_expiry_activated_on OR NEW.membership_post_expiry_activated_at IS DISTINCT FROM OLD.membership_post_expiry_activated_at OR NEW.membership_post_expiry_generation IS DISTINCT FROM OLD.membership_post_expiry_generation) THEN RAISE EXCEPTION 'Membership post-expiry activation fields are system managed'; END IF;
    IF NEW.service_post_expiry_enabled=OLD.service_post_expiry_enabled AND (NEW.service_post_expiry_activated_on IS DISTINCT FROM OLD.service_post_expiry_activated_on OR NEW.service_post_expiry_activated_at IS DISTINCT FROM OLD.service_post_expiry_activated_at OR NEW.service_post_expiry_generation IS DISTINCT FROM OLD.service_post_expiry_generation) THEN RAISE EXCEPTION 'Service post-expiry activation fields are system managed'; END IF;
    IF NEW.promise_to_pay_reminders_enabled=OLD.promise_to_pay_reminders_enabled AND (NEW.promise_to_pay_reminders_activated_on IS DISTINCT FROM OLD.promise_to_pay_reminders_activated_on OR NEW.promise_to_pay_reminders_activated_at IS DISTINCT FROM OLD.promise_to_pay_reminders_activated_at OR NEW.promise_to_pay_reminders_generation IS DISTINCT FROM OLD.promise_to_pay_reminders_generation) THEN RAISE EXCEPTION 'Promise-to-pay activation fields are system managed'; END IF;
    IF NEW.payment_link_follow_up_enabled=OLD.payment_link_follow_up_enabled AND (NEW.payment_link_follow_up_activated_on IS DISTINCT FROM OLD.payment_link_follow_up_activated_on OR NEW.payment_link_follow_up_activated_at IS DISTINCT FROM OLD.payment_link_follow_up_activated_at OR NEW.payment_link_follow_up_generation IS DISTINCT FROM OLD.payment_link_follow_up_generation) THEN RAISE EXCEPTION 'Payment-link follow-up activation fields are system managed'; END IF;
  END IF;
  SELECT timezone INTO v_timezone FROM public.accounts WHERE id=NEW.account_id;
  IF NEW.invoice_collection_enabled AND NOT COALESCE(OLD.invoice_collection_enabled,FALSE) THEN NEW.invoice_collection_activated_on:=(NOW() AT TIME ZONE COALESCE(v_timezone,'UTC'))::DATE; NEW.invoice_collection_activated_at:=NOW(); NEW.invoice_collection_generation:=gen_random_uuid(); END IF;
  IF NEW.membership_post_expiry_enabled AND NOT COALESCE(OLD.membership_post_expiry_enabled,FALSE) THEN NEW.membership_post_expiry_activated_on:=(NOW() AT TIME ZONE COALESCE(v_timezone,'UTC'))::DATE; NEW.membership_post_expiry_activated_at:=NOW(); NEW.membership_post_expiry_generation:=gen_random_uuid(); END IF;
  IF NEW.service_post_expiry_enabled AND NOT COALESCE(OLD.service_post_expiry_enabled,FALSE) THEN NEW.service_post_expiry_activated_on:=(NOW() AT TIME ZONE COALESCE(v_timezone,'UTC'))::DATE; NEW.service_post_expiry_activated_at:=NOW(); NEW.service_post_expiry_generation:=gen_random_uuid(); END IF;
  IF NEW.promise_to_pay_reminders_enabled AND NOT COALESCE(OLD.promise_to_pay_reminders_enabled,FALSE) THEN NEW.promise_to_pay_reminders_activated_on:=(NOW() AT TIME ZONE COALESCE(v_timezone,'UTC'))::DATE; NEW.promise_to_pay_reminders_activated_at:=NOW(); NEW.promise_to_pay_reminders_generation:=gen_random_uuid(); END IF;
  IF NEW.payment_link_follow_up_enabled AND NOT COALESCE(OLD.payment_link_follow_up_enabled,FALSE) THEN NEW.payment_link_follow_up_activated_on:=(NOW() AT TIME ZONE COALESCE(v_timezone,'UTC'))::DATE; NEW.payment_link_follow_up_activated_at:=NOW(); NEW.payment_link_follow_up_generation:=gen_random_uuid(); END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.record_payment_link_whatsapp_send(p_link_id UUID, p_whatsapp_message_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.razorpay_payment_links%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_link FROM public.razorpay_payment_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_link.account_id, 'agent') OR v_link.status <> 'created' OR p_whatsapp_message_id IS NULL OR btrim(p_whatsapp_message_id)='' THEN RETURN FALSE; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages message JOIN public.conversations conversation ON conversation.id=message.conversation_id
    WHERE conversation.account_id=v_link.account_id AND message.message_id=p_whatsapp_message_id
  ) THEN RETURN FALSE; END IF;
  UPDATE public.razorpay_payment_links SET last_whatsapp_message_id=p_whatsapp_message_id, last_sent_at=NOW() WHERE id=v_link.id;
  RETURN TRUE;
END; $$;

CREATE OR REPLACE FUNCTION public.escalate_expired_payment_link(p_link_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.razorpay_payment_links%ROWTYPE; v_contact UUID; v_owner UUID; v_existing UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_link FROM public.razorpay_payment_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status <> 'created' OR v_link.expires_at > NOW() OR v_link.last_sent_at IS NULL THEN RETURN 'not_expired'; END IF;
  SELECT contact_id INTO v_contact FROM public.invoices WHERE id=v_link.invoice_id AND account_id=v_link.account_id;
  IF v_contact IS NULL THEN RETURN 'invoice_missing'; END IF;
  SELECT id INTO v_existing FROM public.follow_ups WHERE account_id=v_link.account_id AND contact_id=v_contact AND status='open';
  IF v_existing IS NOT NULL THEN RETURN 'existing'; END IF;
  SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id=v_link.account_id;
  IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE account_id=v_link.account_id AND user_id=v_owner) THEN RETURN 'owner_unavailable'; END IF;
  INSERT INTO public.follow_ups(account_id, contact_id, assigned_to, created_by, reason, task_type, due_date, note)
  VALUES (v_link.account_id, v_contact, v_owner, v_owner, 'payment', 'todo',
    (NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id=v_link.account_id))::DATE,
    'Payment link expired before settlement. Generate a replacement through the invoice payment-link action if still needed.');
  RETURN 'created';
EXCEPTION WHEN unique_violation THEN RETURN 'existing';
END; $$;

REVOKE ALL ON FUNCTION public.invoice_commitment_payment_allocations(UUID), public.assert_invoice_collection_commitment(), public.save_invoice_collection_commitment(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, INTEGER), public.cancel_invoice_collection_commitment(UUID, INTEGER), public.reconcile_invoice_collection_commitment(UUID), public.record_payment_link_whatsapp_send(UUID, TEXT), public.escalate_expired_payment_link(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_invoice_collection_commitment(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, INTEGER), public.cancel_invoice_collection_commitment(UUID, INTEGER), public.record_payment_link_whatsapp_send(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_invoice_collection_commitment(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.escalate_expired_payment_link(UUID) TO service_role;

-- Harden the Step 4 surface before first application. These definitions are
-- intentionally repeated with CREATE OR REPLACE so this one additive migration
-- is safe to review as a single unit.
ALTER TABLE public.invoice_collection_commitments
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS broken_follow_up_id UUID REFERENCES public.follow_ups(id) ON DELETE SET NULL;
ALTER TABLE public.razorpay_payment_links
  ADD COLUMN IF NOT EXISTS expired_escalation_state TEXT,
  ADD COLUMN IF NOT EXISTS expired_escalated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.assert_invoice_collection_commitment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_invoice public.invoices%ROWTYPE; v_balance RECORD;
BEGIN
  -- invoice_balances is aggregate-backed and cannot be locked. Lock the base
  -- invoice first, then read its current authoritative balance.
  SELECT * INTO v_invoice FROM public.invoices WHERE id = NEW.invoice_id FOR SHARE;
  SELECT account_id, contact_id, collectible_balance, state, requires_refund_review
    INTO v_balance FROM public.invoice_balances WHERE id = NEW.invoice_id;
  IF NOT FOUND OR v_invoice.account_id <> NEW.account_id OR v_invoice.contact_id <> NEW.contact_id
    OR v_balance.account_id <> NEW.account_id OR v_balance.contact_id <> NEW.contact_id
    OR v_balance.state <> 'open' OR v_balance.requires_refund_review OR v_balance.collectible_balance <= 0 THEN
    RAISE EXCEPTION 'Invoice is not collectible' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'promise_to_pay' AND NEW.amount > v_balance.collectible_balance THEN
    RAISE EXCEPTION 'Promise amount exceeds current collectible balance' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'promise_to_pay' AND NEW.promised_on < (NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id = NEW.account_id))::DATE THEN
    RAISE EXCEPTION 'Promise date cannot be in the past' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(NEW.next_action, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Next action must be between 1 and 500 characters' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_memberships membership WHERE membership.account_id = NEW.account_id AND membership.user_id = NEW.assigned_to) THEN
    RAISE EXCEPTION 'Assignee is not a member of this branch' USING ERRCODE = '23514';
  END IF;
  -- Assignment/next-action edits do not discard already observed payment
  -- progress. An amount/kind replacement deliberately starts a new baseline.
  IF TG_OP = 'INSERT' OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    NEW.payment_allocation_snapshot := public.invoice_commitment_payment_allocations(NEW.invoice_id);
    NEW.snapshot_at := NOW();
  ELSE
    NEW.payment_allocation_snapshot := OLD.payment_allocation_snapshot;
    NEW.snapshot_at := OLD.snapshot_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_invoice_collection_commitment(
  p_id UUID DEFAULT NULL, p_invoice_id UUID DEFAULT NULL, p_kind TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL, p_promised_on DATE DEFAULT NULL, p_reason TEXT DEFAULT NULL,
  p_next_action TEXT DEFAULT NULL, p_assigned_to UUID DEFAULT NULL, p_expected_revision INTEGER DEFAULT NULL
) RETURNS public.invoice_collection_commitments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.invoice_collection_commitments%ROWTYPE; v_invoice public.invoices%ROWTYPE; v_result public.invoice_collection_commitments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL THEN
    IF p_expected_revision IS NOT NULL OR p_invoice_id IS NULL OR p_kind NOT IN ('promise_to_pay', 'verification_hold', 'dispute_hold') THEN RAISE EXCEPTION 'Invalid commitment create request' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR SHARE;
    IF NOT FOUND OR NOT public.is_account_member(v_invoice.account_id, 'agent') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.invoice_collection_commitments(account_id, invoice_id, contact_id, kind, amount, promised_on, reason, next_action, assigned_to, created_by)
    VALUES (v_invoice.account_id, v_invoice.id, v_invoice.contact_id, p_kind, p_amount, p_promised_on, NULLIF(btrim(COALESCE(p_reason,'')), ''), NULLIF(btrim(COALESCE(p_next_action,'')), ''), COALESCE(p_assigned_to, auth.uid()), auth.uid()) RETURNING * INTO v_result;
    INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, actor_id, event, revision, detail)
      VALUES (v_result.id, v_result.account_id, auth.uid(), 'created', v_result.revision, jsonb_build_object('kind', v_result.kind));
    RETURN v_result;
  END IF;
  IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Expected revision is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_existing FROM public.invoice_collection_commitments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_existing.created_by <> auth.uid() OR NOT public.is_account_member(v_existing.account_id, 'agent') THEN RAISE EXCEPTION 'Only the author may edit this commitment' USING ERRCODE = '42501'; END IF;
  IF v_existing.state <> 'open' OR p_expected_revision <> v_existing.revision THEN RAISE EXCEPTION 'Commitment changed; refresh and try again' USING ERRCODE = '40001'; END IF;
  IF p_kind IS DISTINCT FROM v_existing.kind THEN RAISE EXCEPTION 'Commitment kind cannot be changed' USING ERRCODE = '22023'; END IF;
  UPDATE public.invoice_collection_commitments SET amount=p_amount, promised_on=p_promised_on, reason=NULLIF(btrim(COALESCE(p_reason,'')), ''), next_action=NULLIF(btrim(COALESCE(p_next_action,'')), ''), assigned_to=COALESCE(p_assigned_to, v_existing.assigned_to), revision=revision+1 WHERE id=v_existing.id RETURNING * INTO v_result;
  INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, actor_id, event, revision, detail)
    VALUES (v_result.id, v_result.account_id, auth.uid(), 'revised', v_result.revision, jsonb_build_object('previous_revision', v_existing.revision));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_invoice_collection_commitment(p_id UUID, p_expected_revision INTEGER)
RETURNS public.invoice_collection_commitments LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.invoice_collection_commitments%ROWTYPE; v_result public.invoice_collection_commitments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_existing FROM public.invoice_collection_commitments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_existing.created_by <> auth.uid() OR NOT public.is_account_member(v_existing.account_id, 'agent') THEN RAISE EXCEPTION 'Only the author may resolve this commitment' USING ERRCODE='42501'; END IF;
  IF v_existing.state <> 'open' OR p_expected_revision IS NULL OR p_expected_revision <> v_existing.revision THEN RAISE EXCEPTION 'Commitment changed; refresh and try again' USING ERRCODE='40001'; END IF;
  UPDATE public.invoice_collection_commitments SET state='resolved', resolved_at=NOW(), resolved_by=auth.uid(), revision=revision+1 WHERE id=v_existing.id RETURNING * INTO v_result;
  INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, actor_id, event, revision, detail) VALUES (v_result.id, v_result.account_id, auth.uid(), 'resolved', v_result.revision, jsonb_build_object('previous_revision',v_existing.revision));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_invoice_collection_commitment(p_id UUID, p_expected_revision INTEGER)
RETURNS public.invoice_collection_commitments LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.invoice_collection_commitments%ROWTYPE; v_result public.invoice_collection_commitments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_existing FROM public.invoice_collection_commitments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_existing.account_id, 'agent') OR (v_existing.created_by <> auth.uid() AND NOT public.is_account_member(v_existing.account_id, 'admin')) THEN RAISE EXCEPTION 'Only the author or an admin may cancel this commitment' USING ERRCODE='42501'; END IF;
  IF v_existing.state <> 'open' OR p_expected_revision IS NULL OR p_expected_revision <> v_existing.revision THEN RAISE EXCEPTION 'Commitment changed; refresh and try again' USING ERRCODE='40001'; END IF;
  UPDATE public.invoice_collection_commitments SET state='cancelled', cancelled_at=NOW(), cancelled_by=auth.uid(), revision=revision+1 WHERE id=p_id RETURNING * INTO v_result;
  INSERT INTO public.invoice_collection_commitment_audit(commitment_id, account_id, actor_id, event, revision, detail) VALUES (v_result.id, v_result.account_id, auth.uid(), 'cancelled', v_result.revision, jsonb_build_object('previous_revision',v_existing.revision));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_invoice_collection_commitment(p_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_commitment public.invoice_collection_commitments%ROWTYPE; v_invoice public.invoices%ROWTYPE; v_balance RECORD; v_paid NUMERIC; v_owner UUID; v_follow_up UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_commitment FROM public.invoice_collection_commitments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_commitment.kind <> 'promise_to_pay' THEN RETURN CASE WHEN v_commitment.state='open' THEN 'hold_open' ELSE v_commitment.state END; END IF;
  IF v_commitment.state IN ('fulfilled','resolved','cancelled') THEN RETURN v_commitment.state; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id=v_commitment.invoice_id FOR SHARE;
  SELECT collectible_balance, state, requires_refund_review INTO v_balance FROM public.invoice_balances WHERE id=v_commitment.invoice_id;
  IF NOT FOUND OR v_balance.requires_refund_review THEN RETURN 'review_required'; END IF;
  IF v_balance.state <> 'open' OR v_balance.collectible_balance <= 0 THEN
    IF v_commitment.state = 'open' THEN
      UPDATE public.invoice_collection_commitments SET state='resolved', resolved_at=NOW(), revision=revision+1 WHERE id=v_commitment.id;
      INSERT INTO public.invoice_collection_commitment_audit(commitment_id,account_id,event,revision,detail) VALUES(v_commitment.id,v_commitment.account_id,'resolved',v_commitment.revision+1,jsonb_build_object('reason','invoice_not_collectible'));
    END IF;
    RETURN 'resolved';
  END IF;
  v_paid := GREATEST(public.invoice_commitment_payment_allocations(v_commitment.invoice_id)-v_commitment.payment_allocation_snapshot,0);
  IF v_paid >= v_commitment.amount THEN
    IF v_commitment.state <> 'fulfilled' THEN UPDATE public.invoice_collection_commitments SET state='fulfilled', fulfilled_at=NOW(), revision=revision+1 WHERE id=v_commitment.id; INSERT INTO public.invoice_collection_commitment_audit(commitment_id,account_id,event,revision,detail) VALUES(v_commitment.id,v_commitment.account_id,'fulfilled',v_commitment.revision+1,jsonb_build_object('paid_since_snapshot',v_paid)); END IF;
    RETURN 'fulfilled';
  END IF;
  IF v_commitment.state='broken' THEN RETURN 'broken'; END IF;
  IF (NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id=v_commitment.account_id))::DATE <= v_commitment.promised_on THEN RETURN 'open'; END IF;
  UPDATE public.invoice_collection_commitments SET state='broken', broken_at=NOW(), revision=revision+1 WHERE id=v_commitment.id RETURNING broken_follow_up_id INTO v_follow_up;
  INSERT INTO public.invoice_collection_commitment_audit(commitment_id,account_id,event,revision,detail) VALUES(v_commitment.id,v_commitment.account_id,'broken',v_commitment.revision+1,jsonb_build_object('paid_since_snapshot',v_paid));
  IF v_follow_up IS NULL THEN
    SELECT id INTO v_follow_up FROM public.follow_ups WHERE account_id=v_commitment.account_id AND contact_id=v_commitment.contact_id AND status='open' LIMIT 1;
    IF v_follow_up IS NULL THEN
      v_owner:=v_commitment.assigned_to;
      IF NOT EXISTS(SELECT 1 FROM public.account_memberships membership WHERE membership.account_id=v_commitment.account_id AND membership.user_id=v_owner) THEN SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id=v_commitment.account_id; END IF;
      IF v_owner IS NOT NULL AND EXISTS(SELECT 1 FROM public.account_memberships membership WHERE membership.account_id=v_commitment.account_id AND membership.user_id=v_owner) THEN INSERT INTO public.follow_ups(account_id,contact_id,assigned_to,created_by,reason,task_type,due_date,note) VALUES(v_commitment.account_id,v_commitment.contact_id,v_owner,v_commitment.created_by,'payment','todo',(NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id=v_commitment.account_id))::DATE,'Broken payment promise: '||v_commitment.next_action) RETURNING id INTO v_follow_up; END IF;
    END IF;
    UPDATE public.invoice_collection_commitments SET broken_follow_up_id=v_follow_up WHERE id=v_commitment.id;
  END IF;
  RETURN 'broken';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_link_whatsapp_send(p_link_id UUID, p_whatsapp_message_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.razorpay_payment_links%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_link FROM public.razorpay_payment_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_link.account_id,'agent') OR v_link.status<>'created' OR NULLIF(btrim(COALESCE(p_whatsapp_message_id,'')),'') IS NULL THEN RETURN FALSE; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.messages message JOIN public.conversations conversation ON conversation.id=message.conversation_id JOIN public.invoices invoice ON invoice.id=v_link.invoice_id WHERE conversation.account_id=v_link.account_id AND conversation.contact_id=invoice.contact_id AND message.message_id=p_whatsapp_message_id AND message.sender_type IN ('agent','bot') AND message.content_type='template' AND message.template_name='gym_payment_link' AND message.status IN ('sent','delivered','read') AND message.content_text ILIKE '%'||v_link.short_url||'%') THEN RETURN FALSE; END IF;
  UPDATE public.razorpay_payment_links SET last_whatsapp_message_id=p_whatsapp_message_id,last_sent_at=NOW() WHERE id=v_link.id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.escalate_expired_payment_link(p_link_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.razorpay_payment_links%ROWTYPE; v_balance RECORD; v_contact UUID; v_owner UUID; v_existing UUID; v_enabled BOOLEAN; v_activated_at TIMESTAMPTZ;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_link FROM public.razorpay_payment_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status<>'created' OR v_link.expires_at>NOW() OR v_link.last_sent_at IS NULL OR v_link.last_whatsapp_message_id IS NULL THEN RETURN 'not_expired'; END IF;
  IF v_link.expired_escalation_state IS NOT NULL THEN RETURN 'already_escalated'; END IF;
  SELECT payment_link_follow_up_enabled,payment_link_follow_up_activated_at INTO v_enabled,v_activated_at FROM public.renewal_reminder_settings WHERE account_id=v_link.account_id;
  IF NOT COALESCE(v_enabled,FALSE) OR v_activated_at IS NULL OR v_link.last_sent_at<v_activated_at THEN RETURN 'lifecycle_inactive'; END IF;
  SELECT collectible_balance,state,requires_refund_review INTO v_balance FROM public.invoice_balances WHERE id=v_link.invoice_id;
  IF NOT FOUND OR v_balance.state<>'open' OR v_balance.requires_refund_review OR v_balance.collectible_balance<>v_link.expected_amount THEN UPDATE public.razorpay_payment_links SET expired_escalation_state='stopped',expired_escalated_at=NOW() WHERE id=v_link.id; RETURN 'not_collectible'; END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_collection_commitments WHERE account_id=v_link.account_id AND invoice_id=v_link.invoice_id AND state='open') THEN UPDATE public.razorpay_payment_links SET expired_escalation_state='held',expired_escalated_at=NOW() WHERE id=v_link.id; RETURN 'held'; END IF;
  SELECT contact_id INTO v_contact FROM public.invoices WHERE id=v_link.invoice_id AND account_id=v_link.account_id;
  SELECT id INTO v_existing FROM public.follow_ups WHERE account_id=v_link.account_id AND contact_id=v_contact AND status='open' LIMIT 1;
  IF v_existing IS NOT NULL THEN UPDATE public.razorpay_payment_links SET expired_escalation_state='existing',expired_escalated_at=NOW() WHERE id=v_link.id; RETURN 'existing'; END IF;
  SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id=v_link.account_id;
  IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.account_memberships membership WHERE membership.account_id=v_link.account_id AND membership.user_id=v_owner) THEN RETURN 'owner_unavailable'; END IF;
  INSERT INTO public.follow_ups(account_id,contact_id,assigned_to,created_by,reason,task_type,due_date,note) VALUES(v_link.account_id,v_contact,v_owner,v_owner,'payment','todo',(NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id=v_link.account_id))::DATE,'Payment link expired before settlement. Generate a replacement through the invoice payment-link action if still needed.');
  UPDATE public.razorpay_payment_links SET expired_escalation_state='created',expired_escalated_at=NOW() WHERE id=v_link.id;
  RETURN 'created';
EXCEPTION WHEN unique_violation THEN UPDATE public.razorpay_payment_links SET expired_escalation_state='existing',expired_escalated_at=NOW() WHERE id=p_link_id; RETURN 'existing';
END;
$$;

-- Debt and a broken promise outrank renewal retention; payment-link nudges do
-- not leapfrog a live debt reminder.
CREATE OR REPLACE FUNCTION public.reserve_lifecycle_reminder_daily_claim(p_job_id UUID,p_worker_id TEXT,p_lease_generation INTEGER,p_send_on DATE)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.lifecycle_reminder_jobs%ROWTYPE; v_candidate_priority INTEGER; v_existing_day DATE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_job FROM public.lifecycle_reminder_jobs WHERE id=p_job_id AND lease_owner=p_worker_id AND lease_generation=p_lease_generation AND state='leased' AND lease_expires_at>=NOW() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'lost'; END IF;
  SELECT send_on INTO v_existing_day FROM public.lifecycle_reminder_daily_claims WHERE job_id=p_job_id;
  IF v_existing_day IS NOT NULL THEN RETURN CASE WHEN v_existing_day=p_send_on THEN 'reserved' ELSE 'lost' END; END IF;
  v_candidate_priority:=CASE v_job.kind WHEN 'promise_to_pay' THEN CASE WHEN v_job.milestone_key='promise-broken' THEN 5 ELSE 4 END WHEN 'installment_overdue' THEN 4 WHEN 'invoice_overdue' THEN 3 WHEN 'invoice_due' THEN 2 WHEN 'payment_link_follow_up' THEN 2 WHEN 'membership_post_expiry' THEN 1 WHEN 'service_post_expiry' THEN 1 ELSE 5 END;
  IF EXISTS(SELECT 1 FROM public.lifecycle_reminder_jobs other WHERE other.account_id=v_job.account_id AND other.contact_id=v_job.contact_id AND other.id<>v_job.id AND other.state IN ('queued','leased','deferred','blocked') AND other.next_attempt_at<=NOW() AND (CASE other.kind WHEN 'promise_to_pay' THEN CASE WHEN other.milestone_key='promise-broken' THEN 5 ELSE 4 END WHEN 'installment_overdue' THEN 4 WHEN 'invoice_overdue' THEN 3 WHEN 'invoice_due' THEN 2 WHEN 'payment_link_follow_up' THEN 2 WHEN 'membership_post_expiry' THEN 1 WHEN 'service_post_expiry' THEN 1 ELSE 5 END)>v_candidate_priority) THEN RETURN 'deferred'; END IF;
  INSERT INTO public.lifecycle_reminder_daily_claims(account_id,contact_id,send_on,job_id) VALUES(v_job.account_id,v_job.contact_id,p_send_on,v_job.id) ON CONFLICT(account_id,contact_id,send_on) DO NOTHING;
  RETURN CASE WHEN EXISTS(SELECT 1 FROM public.lifecycle_reminder_daily_claims WHERE job_id=p_job_id AND send_on=p_send_on) THEN 'reserved' ELSE 'deferred' END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_invoice_collection_commitment(UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_invoice_collection_commitment(UUID,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_commitment_payment_allocations(UUID) TO service_role;
