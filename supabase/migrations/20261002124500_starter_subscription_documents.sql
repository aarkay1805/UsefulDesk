-- Ordinary commercial SaaS documents, separate from gym-member invoices.
-- Issuance creates no payment, refund, owner approval, entitlement or send.
CREATE TABLE IF NOT EXISTS private.subscription_live_document_issues (
  issue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE REFERENCES private.subscription_live_quotes(request_id),
  provider_payment_id TEXT NOT NULL UNIQUE REFERENCES private.subscription_live_payments(provider_payment_id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  financial_year INTEGER NOT NULL CHECK(financial_year BETWEEN 2026 AND 2100),
  sequence_number INTEGER NOT NULL CHECK(sequence_number BETWEEN 1 AND 999999),
  invoice_number TEXT NOT NULL UNIQUE,
  receipt_number TEXT NOT NULL UNIQUE,
  snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  invoice_pdf BYTEA NOT NULL CHECK(octet_length(invoice_pdf) BETWEEN 500 AND 200000),
  receipt_pdf BYTEA NOT NULL CHECK(octet_length(receipt_pdf) BETWEEN 500 AND 200000),
  invoice_sha256 TEXT NOT NULL CHECK(invoice_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_sha256 TEXT NOT NULL CHECK(receipt_sha256 ~ '^[0-9a-f]{64}$'),
  issued_by UUID NOT NULL REFERENCES auth.users(id),
  evidence_reference TEXT NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 1000),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(financial_year,sequence_number)
);
ALTER TABLE private.subscription_live_document_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_live_document_issues FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_live_document_issues TO service_role;

CREATE OR REPLACE FUNCTION private.subscription_freeze_document_issue()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Issued subscription documents are immutable' USING ERRCODE='55000';
END;
$$;
DROP TRIGGER IF EXISTS subscription_freeze_document_issue ON private.subscription_live_document_issues;
CREATE TRIGGER subscription_freeze_document_issue BEFORE UPDATE OR DELETE
 ON private.subscription_live_document_issues FOR EACH ROW EXECUTE FUNCTION private.subscription_freeze_document_issue();
ALTER FUNCTION private.subscription_freeze_document_issue() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_freeze_document_issue() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.subscription_document_candidate(p_request_id UUID,p_issuer JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 q private.subscription_live_quotes; p private.subscription_live_payments;
 t private.subscription_live_terms; g private.subscription_live_grants;
 a private.organization_product_access; r private.subscription_live_customer_reviews;
 o private.subscription_live_offer_approvals; b public.invoice_profiles;
 v_day DATE; v_year INTEGER; v_next INTEGER; v_suffix TEXT;
BEGIN
 -- Issuer is supplied from the existing private operator review, never inferred
 -- from a gym's own invoice profile. Other supplier/tax treatments need review.
 IF p_issuer IS NULL OR jsonb_typeof(p_issuer)<>'object'
  OR p_issuer->>'name' IS DISTINCT FROM 'UsefulMade'
  OR p_issuer->>'email' IS DISTINCT FROM 'contact@usefulmade.com'
  OR coalesce(length(btrim(p_issuer->>'address')),0) NOT BETWEEN 1 AND 2000
  OR coalesce(length(btrim(p_issuer->>'review_reference')),0) NOT BETWEEN 1 AND 1000
  OR p_issuer - ARRAY['name','email','address','review_reference'] <> '{}'::JSONB THEN
  RAISE EXCEPTION 'Reviewed private supplier details required' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM private.subscription_live_quotes WHERE request_id=p_request_id;
 SELECT * INTO p FROM private.subscription_live_payments WHERE request_id=p_request_id;
 SELECT * INTO t FROM private.subscription_live_terms WHERE request_id=p_request_id;
 SELECT * INTO g FROM private.subscription_live_grants WHERE organization_id=q.organization_id;
 SELECT * INTO a FROM private.organization_product_access WHERE organization_id=q.organization_id;
 SELECT * INTO r FROM private.subscription_live_customer_reviews WHERE review_id=q.customer_review_id;
 SELECT * INTO o FROM private.subscription_live_offer_approvals WHERE approval_id=q.offer_approval_id;
 SELECT * INTO b FROM public.invoice_profiles WHERE account_id=q.billing_account_id;
 IF q.request_id IS NULL OR p.provider_payment_id IS NULL OR t.request_id IS NULL
  OR r.review_id IS NULL OR r.commercial_context<>'customer_sale'
  OR r.organization_id IS DISTINCT FROM q.organization_id
  OR r.offer_approval_id IS DISTINCT FROM q.offer_approval_id
  OR r.merchant_id IS DISTINCT FROM q.merchant_id
  OR r.reviewed_by IS DISTINCT FROM q.requested_by OR r.revoked_at IS NOT NULL
  OR q.tier<>'starter' OR q.renewal_of_request_id IS NOT NULL
  OR q.amount_minor<>79900 OR q.currency<>'INR'
  OR p.state<>'verified' OR p.hold_reason IS NOT NULL OR p.provider_mode<>'live'
  OR p.organization_id IS DISTINCT FROM q.organization_id OR p.merchant_id IS DISTINCT FROM q.merchant_id
  OR p.amount_minor IS DISTINCT FROM q.amount_minor OR p.currency IS DISTINCT FROM q.currency
  OR t.provider_payment_id IS DISTINCT FROM p.provider_payment_id OR t.organization_id IS DISTINCT FROM q.organization_id
  OR t.merchant_id IS DISTINCT FROM p.merchant_id OR t.tier IS DISTINCT FROM q.tier
  OR t.period_start IS DISTINCT FROM p.capture_event_at
  OR g.request_id IS DISTINCT FROM q.request_id OR g.provider_payment_id IS DISTINCT FROM p.provider_payment_id
  OR g.merchant_id IS DISTINCT FROM p.merchant_id OR g.provider_mode IS DISTINCT FROM 'live'
  OR g.period_start IS DISTINCT FROM t.period_start OR g.paid_through_end IS DISTINCT FROM t.paid_through_end
  OR g.refund_confirmed_at IS NOT NULL OR a.suspended_at IS NOT NULL
  OR a.mode IS DISTINCT FROM 'manual' OR a.access_starts_at IS DISTINCT FROM t.period_start
  OR a.access_ends_at IS DISTINCT FROM t.paid_through_end OR a.access_ends_at<=clock_timestamp()
  OR o.approval_id IS NULL OR o.customer_tax_note IS DISTINCT FROM 'GST not charged — supplier unregistered.'
  OR o.tax_decision_reference IS DISTINCT FROM q.tax_decision_reference
  OR b.account_id IS NULL OR NOT b.is_complete OR nullif(btrim(b.legal_name),'') IS NULL
  OR EXISTS(SELECT 1 FROM private.subscription_live_refunds f WHERE f.provider_payment_id=p.provider_payment_id)
 THEN RAISE EXCEPTION 'Verified customer sale, paid access and exact document review required' USING ERRCODE='55000'; END IF;
 -- UsefulMade's supplier financial year uses its reviewed India billing basis.
 -- The gym's capture/term timestamps and timezone remain frozen payment facts.
 v_day:=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::DATE;
 v_year:=extract(year FROM v_day)::INTEGER - CASE WHEN extract(month FROM v_day)<4 THEN 1 ELSE 0 END;
 SELECT coalesce(max(sequence_number),0)+1 INTO v_next FROM private.subscription_live_document_issues WHERE financial_year=v_year;
 IF v_next>999999 THEN RAISE EXCEPTION 'Document series exhausted' USING ERRCODE='55000'; END IF;
 v_suffix:=v_year::TEXT||'-'||right((v_year+1)::TEXT,2)||'/'||lpad(v_next::TEXT,6,'0');
 RETURN jsonb_build_object('request_id',q.request_id,'organization_id',q.organization_id,
  'billing_account_id',q.billing_account_id,'customer_review_id',r.review_id,
  'offer_approval_id',q.offer_approval_id,'offer_reference',q.offer_reference,
  'tax_decision_reference',q.tax_decision_reference,'document_review_reference',r.tax_receipt_review_reference,
  'refund_policy_reference',o.refund_policy_reference,'tax_note',o.customer_tax_note,
  'issuer',p_issuer,'buyer',jsonb_build_object('legal_name',b.legal_name,'business_name',b.business_name,
   'address_line1',b.address_line1,'address_line2',b.address_line2,'city',b.city,'state',b.state,
   'postal_code',b.postal_code,'country',b.country,'phone',b.phone,'email',b.email),
  'amount_minor',p.amount_minor,'currency',p.currency,'provider_payment_id',p.provider_payment_id,
  'provider_order_id',p.provider_order_id,'merchant_id',p.merchant_id,'capture_event_at',p.capture_event_at,
  'period_start',t.period_start,'paid_through_end',t.paid_through_end,'billing_timezone',p.billing_timezone,
  'tier',q.tier,'issue_date',v_day,'financial_year',v_year,'sequence_number',v_next,
  'invoice_number','UM/'||v_suffix,'receipt_number','UM-R/'||v_suffix);
END;
$$;
ALTER FUNCTION private.subscription_document_candidate(UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_document_candidate(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.subscription_preview_live_document_issue(p_request_id UUID,p_issuer JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM private.subscription_live_document_issues WHERE request_id=p_request_id) THEN
  RAISE EXCEPTION 'Already issued; retrieve the immutable originals' USING ERRCODE='55000'; END IF;
 RETURN private.subscription_document_candidate(p_request_id,p_issuer);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_issue_live_document_pair(
 p_request_id UUID,p_snapshot JSONB,p_invoice_pdf_base64 TEXT,p_receipt_pdf_base64 TEXT,
 p_operator_id UUID,p_evidence_reference TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_existing private.subscription_live_document_issues; v_candidate JSONB;
 v_invoice BYTEA; v_receipt BYTEA; v_invoice_hash TEXT; v_receipt_hash TEXT; v_issue UUID; v_year INTEGER;
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'object'
  OR p_operator_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_operator_id)
  OR coalesce(length(btrim(p_evidence_reference)),0) NOT BETWEEN 1 AND 1000
  OR p_invoice_pdf_base64 IS NULL OR p_receipt_pdf_base64 IS NULL
  OR length(p_invoice_pdf_base64)>280000 OR length(p_receipt_pdf_base64)>280000 THEN
  RAISE EXCEPTION 'Reviewed document bytes and actual operator required' USING ERRCODE='22023'; END IF;
 BEGIN
  v_invoice:=decode(p_invoice_pdf_base64,'base64'); v_receipt:=decode(p_receipt_pdf_base64,'base64');
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid PDF encoding' USING ERRCODE='22023'; END;
 IF octet_length(v_invoice) NOT BETWEEN 500 AND 200000 OR octet_length(v_receipt) NOT BETWEEN 500 AND 200000
  OR substring(v_invoice FROM 1 FOR 5)<>convert_to('%PDF-','UTF8')
  OR substring(v_receipt FROM 1 FOR 5)<>convert_to('%PDF-','UTF8')
  OR position(convert_to('%%EOF','UTF8') IN substring(v_invoice FROM greatest(1,octet_length(v_invoice)-30)))=0
  OR position(convert_to('%%EOF','UTF8') IN substring(v_receipt FROM greatest(1,octet_length(v_receipt)-30)))=0 THEN
  RAISE EXCEPTION 'Reviewed PDF files required' USING ERRCODE='22023'; END IF;
 v_invoice_hash:=encode(extensions.digest(v_invoice,'sha256'),'hex');
 v_receipt_hash:=encode(extensions.digest(v_receipt,'sha256'),'hex');
 -- One global issuance lock: concurrent previews cannot consume/reuse a number.
 -- Read-back is checked before current facts so later expiry/refund cannot make
 -- an exact retry rewrite history or issue another pair.
 PERFORM pg_advisory_xact_lock(20261002,124500);
 SELECT * INTO v_existing FROM private.subscription_live_document_issues WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_existing.snapshot IS DISTINCT FROM p_snapshot OR v_existing.invoice_sha256<>v_invoice_hash
   OR v_existing.receipt_sha256<>v_receipt_hash OR v_existing.issued_by IS DISTINCT FROM p_operator_id
   OR v_existing.evidence_reference IS DISTINCT FROM p_evidence_reference THEN
   RAISE EXCEPTION 'Issued documents conflict; preserve originals' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('status','already_issued','issue_id',v_existing.issue_id,
   'invoice_number',v_existing.invoice_number,'receipt_number',v_existing.receipt_number,
   'issued_at',v_existing.issued_at,'invoice_sha256',v_existing.invoice_sha256,'receipt_sha256',v_existing.receipt_sha256);
 END IF;
 -- Prevent a concurrent access/refund/profile change while validating the final
 -- candidate. This follows the existing organization-first financial lock order.
 PERFORM 1 FROM public.organizations WHERE id=(SELECT organization_id FROM private.subscription_live_quotes WHERE request_id=p_request_id) FOR NO KEY UPDATE;
 -- Platform access edits and customer-review revocation may bypass the financial
 -- org lock. Wait for those writers and then rebuild from committed facts.
 PERFORM 1 FROM private.subscription_live_quotes WHERE request_id=p_request_id FOR SHARE;
 PERFORM 1 FROM private.subscription_live_payments WHERE request_id=p_request_id FOR SHARE;
 PERFORM 1 FROM private.subscription_live_terms WHERE request_id=p_request_id FOR SHARE;
 PERFORM 1 FROM private.subscription_live_grants WHERE request_id=p_request_id FOR SHARE;
 PERFORM 1 FROM private.organization_product_access WHERE organization_id=(SELECT organization_id FROM private.subscription_live_quotes WHERE request_id=p_request_id) FOR SHARE;
 PERFORM 1 FROM private.subscription_live_customer_reviews WHERE review_id=(SELECT customer_review_id FROM private.subscription_live_quotes WHERE request_id=p_request_id) FOR SHARE;
 PERFORM 1 FROM private.subscription_live_offer_approvals WHERE approval_id=(SELECT offer_approval_id FROM private.subscription_live_quotes WHERE request_id=p_request_id) FOR SHARE;
 PERFORM 1 FROM public.invoice_profiles WHERE account_id=(SELECT billing_account_id FROM private.subscription_live_quotes WHERE request_id=p_request_id) FOR SHARE;
 v_candidate:=private.subscription_document_candidate(p_request_id,p_snapshot->'issuer');
 IF v_candidate IS DISTINCT FROM p_snapshot THEN
  RAISE EXCEPTION 'Document facts or next number changed; rebuild and review' USING ERRCODE='40001'; END IF;
 v_year:=(v_candidate->>'financial_year')::INTEGER;
 INSERT INTO private.subscription_live_document_issues(request_id,provider_payment_id,organization_id,
  financial_year,sequence_number,invoice_number,receipt_number,snapshot,invoice_pdf,receipt_pdf,
  invoice_sha256,receipt_sha256,issued_by,evidence_reference)
 VALUES(p_request_id,v_candidate->>'provider_payment_id',(v_candidate->>'organization_id')::UUID,
  v_year,(v_candidate->>'sequence_number')::INTEGER,v_candidate->>'invoice_number',v_candidate->>'receipt_number',
  v_candidate,v_invoice,v_receipt,v_invoice_hash,v_receipt_hash,p_operator_id,p_evidence_reference)
 RETURNING issue_id INTO v_issue;
 RETURN jsonb_build_object('status','issued','issue_id',v_issue,'invoice_number',v_candidate->>'invoice_number',
  'receipt_number',v_candidate->>'receipt_number','invoice_sha256',v_invoice_hash,'receipt_sha256',v_receipt_hash);
END;
$$;
ALTER FUNCTION public.subscription_preview_live_document_issue(UUID,JSONB) OWNER TO postgres;
ALTER FUNCTION public.subscription_issue_live_document_pair(UUID,JSONB,TEXT,TEXT,UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.subscription_preview_live_document_issue(UUID,JSONB),
 public.subscription_issue_live_document_pair(UUID,JSONB,TEXT,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.subscription_preview_live_document_issue(UUID,JSONB),
 public.subscription_issue_live_document_pair(UUID,JSONB,TEXT,TEXT,UUID,TEXT) TO service_role;
