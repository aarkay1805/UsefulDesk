-- Follow-up to 10000: invoice contact ownership is authoritative in the
-- balance projection, not invoices.contact_id (which can be NULL).

CREATE OR REPLACE FUNCTION public.assert_invoice_collection_commitment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_invoice public.invoices%ROWTYPE; v_balance RECORD;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id=NEW.invoice_id FOR SHARE;
  SELECT account_id,contact_id,collectible_balance,state,requires_refund_review INTO v_balance FROM public.invoice_balances WHERE id=NEW.invoice_id;
  IF NOT FOUND OR v_invoice.account_id<>NEW.account_id OR v_balance.account_id<>NEW.account_id OR v_balance.contact_id<>NEW.contact_id OR v_balance.state<>'open' OR v_balance.requires_refund_review OR v_balance.collectible_balance<=0 THEN RAISE EXCEPTION 'Invoice is not collectible' USING ERRCODE='23514'; END IF;
  IF NEW.kind='promise_to_pay' AND NEW.amount>v_balance.collectible_balance THEN RAISE EXCEPTION 'Promise amount exceeds current collectible balance' USING ERRCODE='23514'; END IF;
  IF NEW.kind='promise_to_pay' AND NEW.promised_on<(NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id=NEW.account_id))::DATE THEN RAISE EXCEPTION 'Promise date cannot be in the past' USING ERRCODE='23514'; END IF;
  IF length(btrim(COALESCE(NEW.next_action,''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Next action must be between 1 and 500 characters' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account_memberships membership WHERE membership.account_id=NEW.account_id AND membership.user_id=NEW.assigned_to) THEN RAISE EXCEPTION 'Assignee is not a member of this branch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.kind IS DISTINCT FROM OLD.kind THEN NEW.payment_allocation_snapshot:=public.invoice_commitment_payment_allocations(NEW.invoice_id); NEW.snapshot_at:=NOW(); ELSE NEW.payment_allocation_snapshot:=OLD.payment_allocation_snapshot; NEW.snapshot_at:=OLD.snapshot_at; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_invoice_collection_commitment(p_id UUID DEFAULT NULL,p_invoice_id UUID DEFAULT NULL,p_kind TEXT DEFAULT NULL,p_amount NUMERIC DEFAULT NULL,p_promised_on DATE DEFAULT NULL,p_reason TEXT DEFAULT NULL,p_next_action TEXT DEFAULT NULL,p_assigned_to UUID DEFAULT NULL,p_expected_revision INTEGER DEFAULT NULL)
RETURNS public.invoice_collection_commitments LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.invoice_collection_commitments%ROWTYPE; v_invoice public.invoices%ROWTYPE; v_contact UUID; v_result public.invoice_collection_commitments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'')<>'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN
    IF p_expected_revision IS NOT NULL OR p_invoice_id IS NULL OR p_kind NOT IN ('promise_to_pay','verification_hold','dispute_hold') THEN RAISE EXCEPTION 'Invalid commitment create request' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice_id FOR SHARE;
    SELECT contact_id INTO v_contact FROM public.invoice_balances WHERE id=p_invoice_id;
    IF NOT FOUND OR v_contact IS NULL OR NOT public.is_account_member(v_invoice.account_id,'agent') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
    INSERT INTO public.invoice_collection_commitments(account_id,invoice_id,contact_id,kind,amount,promised_on,reason,next_action,assigned_to,created_by) VALUES(v_invoice.account_id,v_invoice.id,v_contact,p_kind,p_amount,p_promised_on,NULLIF(btrim(COALESCE(p_reason,'')),''),NULLIF(btrim(COALESCE(p_next_action,'')),''),COALESCE(p_assigned_to,auth.uid()),auth.uid()) RETURNING * INTO v_result;
    INSERT INTO public.invoice_collection_commitment_audit(commitment_id,account_id,actor_id,event,revision,detail) VALUES(v_result.id,v_result.account_id,auth.uid(),'created',v_result.revision,jsonb_build_object('kind',v_result.kind)); RETURN v_result;
  END IF;
  IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Expected revision is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_existing FROM public.invoice_collection_commitments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_existing.created_by<>auth.uid() OR NOT public.is_account_member(v_existing.account_id,'agent') THEN RAISE EXCEPTION 'Only the author may edit this commitment' USING ERRCODE='42501'; END IF;
  IF v_existing.state<>'open' OR p_expected_revision<>v_existing.revision THEN RAISE EXCEPTION 'Commitment changed; refresh and try again' USING ERRCODE='40001'; END IF;
  IF p_kind IS DISTINCT FROM v_existing.kind THEN RAISE EXCEPTION 'Commitment kind cannot be changed' USING ERRCODE='22023'; END IF;
  UPDATE public.invoice_collection_commitments SET amount=p_amount,promised_on=p_promised_on,reason=NULLIF(btrim(COALESCE(p_reason,'')),''),next_action=NULLIF(btrim(COALESCE(p_next_action,'')),''),assigned_to=COALESCE(p_assigned_to,v_existing.assigned_to),revision=revision+1 WHERE id=v_existing.id RETURNING * INTO v_result;
  INSERT INTO public.invoice_collection_commitment_audit(commitment_id,account_id,actor_id,event,revision,detail) VALUES(v_result.id,v_result.account_id,auth.uid(),'revised',v_result.revision,jsonb_build_object('previous_revision',v_existing.revision)); RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_link_whatsapp_send(p_link_id UUID,p_whatsapp_message_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.razorpay_payment_links%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'')<>'authenticated' THEN RAISE EXCEPTION 'authenticated user required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_link FROM public.razorpay_payment_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_link.account_id,'agent') OR v_link.status<>'created' OR NULLIF(btrim(COALESCE(p_whatsapp_message_id,'')),'') IS NULL THEN RETURN FALSE; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.messages message JOIN public.conversations conversation ON conversation.id=message.conversation_id JOIN public.invoice_balances balance ON balance.id=v_link.invoice_id WHERE conversation.account_id=v_link.account_id AND conversation.contact_id=balance.contact_id AND message.message_id=p_whatsapp_message_id AND message.sender_type IN ('agent','bot') AND message.content_type='template' AND message.template_name='gym_payment_link' AND message.status IN ('sent','delivered','read') AND message.content_text ILIKE '%'||v_link.short_url||'%') THEN RETURN FALSE; END IF;
  UPDATE public.razorpay_payment_links SET last_whatsapp_message_id=p_whatsapp_message_id,last_sent_at=NOW() WHERE id=v_link.id; RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.escalate_expired_payment_link(p_link_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.razorpay_payment_links%ROWTYPE; v_balance RECORD; v_contact UUID; v_owner UUID; v_existing UUID; v_enabled BOOLEAN; v_activated_at TIMESTAMPTZ;
BEGIN
  IF COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_link FROM public.razorpay_payment_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status<>'created' OR v_link.expires_at>NOW() OR v_link.last_sent_at IS NULL OR v_link.last_whatsapp_message_id IS NULL THEN RETURN 'not_expired'; END IF;
  IF v_link.expired_escalation_state IS NOT NULL THEN RETURN 'already_escalated'; END IF;
  SELECT payment_link_follow_up_enabled,payment_link_follow_up_activated_at INTO v_enabled,v_activated_at FROM public.renewal_reminder_settings WHERE account_id=v_link.account_id;
  IF NOT COALESCE(v_enabled,FALSE) OR v_activated_at IS NULL OR v_link.last_sent_at<v_activated_at THEN RETURN 'lifecycle_inactive'; END IF;
  SELECT collectible_balance,state,requires_refund_review,contact_id INTO v_balance FROM public.invoice_balances WHERE id=v_link.invoice_id;
  IF NOT FOUND OR v_balance.state<>'open' OR v_balance.requires_refund_review OR v_balance.collectible_balance<>v_link.expected_amount THEN UPDATE public.razorpay_payment_links SET expired_escalation_state='stopped',expired_escalated_at=NOW() WHERE id=v_link.id; RETURN 'not_collectible'; END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_collection_commitments WHERE account_id=v_link.account_id AND invoice_id=v_link.invoice_id AND state='open') THEN UPDATE public.razorpay_payment_links SET expired_escalation_state='held',expired_escalated_at=NOW() WHERE id=v_link.id; RETURN 'held'; END IF;
  v_contact:=v_balance.contact_id;
  SELECT id INTO v_existing FROM public.follow_ups WHERE account_id=v_link.account_id AND contact_id=v_contact AND status='open' LIMIT 1;
  IF v_existing IS NOT NULL THEN UPDATE public.razorpay_payment_links SET expired_escalation_state='existing',expired_escalated_at=NOW() WHERE id=v_link.id; RETURN 'existing'; END IF;
  SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id=v_link.account_id;
  IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.account_memberships membership WHERE membership.account_id=v_link.account_id AND membership.user_id=v_owner) THEN RETURN 'owner_unavailable'; END IF;
  INSERT INTO public.follow_ups(account_id,contact_id,assigned_to,created_by,reason,task_type,due_date,note) VALUES(v_link.account_id,v_contact,v_owner,v_owner,'payment','todo',(NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id=v_link.account_id))::DATE,'Payment link expired before settlement. Generate a replacement through the invoice payment-link action if still needed.');
  UPDATE public.razorpay_payment_links SET expired_escalation_state='created',expired_escalated_at=NOW() WHERE id=v_link.id; RETURN 'created';
EXCEPTION WHEN unique_violation THEN UPDATE public.razorpay_payment_links SET expired_escalation_state='existing',expired_escalated_at=NOW() WHERE id=p_link_id; RETURN 'existing';
END;
$$;
