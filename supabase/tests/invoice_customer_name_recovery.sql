-- Synthetic local fixture only. Caller wraps the whole file in ROLLBACK.
DO $$
DECLARE
  v_user UUID := gen_random_uuid();
  v_org UUID := gen_random_uuid();
  v_legal UUID := gen_random_uuid();
  v_account UUID := gen_random_uuid();
  v_contact UUID := gen_random_uuid();
  v_invoice UUID := gen_random_uuid();
  v_named_invoice UUID := gen_random_uuid();
  v_detached_invoice UUID := gen_random_uuid();
  v_before JSONB;
  v_claim RECORD;
  v_retry RECORD;
  v_ready RECORD;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data)
    VALUES(v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      v_user::TEXT || '@example.invalid',now(),'{"full_name":"Synthetic invoice owner"}');
  INSERT INTO public.organizations(id,name) VALUES(v_org,'Synthetic invoice gym');
  INSERT INTO public.legal_entities(id,organization_id,name,legal_name)
    VALUES(v_legal,v_org,'Synthetic invoice seller','Synthetic invoice seller');
  INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id)
    VALUES(v_account,'Synthetic branch',v_org,v_user,v_legal);
  INSERT INTO public.account_memberships(account_id,user_id,role) VALUES(v_account,v_user,'owner');
  INSERT INTO public.invoice_profiles(account_id,business_name,address_line1,city,country)
    VALUES(v_account,'Synthetic invoice seller','1 Gym Road','Pune','India');
  INSERT INTO public.contacts(id,user_id,account_id,phone,name,address_line1)
    VALUES(v_contact,v_user,v_account,'+919999999999',NULL,'Original address');
  INSERT INTO public.invoices(id,account_id,contact_id,source,currency)
    VALUES(v_invoice,v_account,v_contact,'sale','INR');
  INSERT INTO public.invoice_lines(account_id,invoice_id,kind,description,unit_amount,line_amount)
    VALUES(v_account,v_invoice,'merchandise','Synthetic item',1000,1000);
  SELECT to_jsonb(i) INTO v_before FROM public.invoices i WHERE id=v_invoice;

  -- This is the live sequence: create without a name, then complete Details.
  UPDATE public.contacts SET name='Completed name',address_line1='Later address' WHERE id=v_contact;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT * INTO v_claim FROM public.reserve_invoice_document(v_invoice,v_user);
  IF v_claim.outcome <> 'claimed'
     OR v_claim.payload_snapshot->'customer'->>'customer_name' <> 'Completed name'
     OR ((v_claim.payload_snapshot->'customer') - 'customer_name')
       IS DISTINCT FROM ((v_before->'customer_snapshot') - 'customer_name')
     OR (v_claim.payload_snapshot->>'total_minor')::BIGINT <> 100000
     OR v_claim.payload_snapshot->'seller' IS DISTINCT FROM v_before->'seller_snapshot'
     OR (SELECT to_jsonb(i) FROM public.invoices i WHERE id=v_invoice) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Missing-name completion changed captured identity or invoice facts';
  END IF;

  -- Failed/stale retry and ready reuse must keep the first completed name.
  PERFORM public.fail_invoice_document(v_invoice,v_claim.generation_token,'Synthetic renderer failure');
  UPDATE public.contacts SET name='Later edited name' WHERE id=v_contact;
  SELECT * INTO v_retry FROM public.reserve_invoice_document(v_invoice,v_user);
  IF v_retry.payload_snapshot IS DISTINCT FROM v_claim.payload_snapshot THEN
    RAISE EXCEPTION 'Failed retry changed the reserved document identity';
  END IF;
  PERFORM public.finalize_invoice_document(v_invoice,v_retry.generation_token,repeat('a',64),1234);
  SELECT * INTO v_ready FROM public.reserve_invoice_document(v_invoice,v_user);
  IF v_ready.outcome <> 'ready' OR v_ready.sha256 <> repeat('a',64)
     OR v_ready.byte_count <> 1234
     OR v_ready.payload_snapshot IS DISTINCT FROM v_claim.payload_snapshot THEN
    RAISE EXCEPTION 'Ready document metadata or identity changed';
  END IF;

  -- An existing captured name wins over later contact edits.
  INSERT INTO public.invoices(id,account_id,contact_id,source,currency)
    VALUES(v_named_invoice,v_account,v_contact,'sale','INR');
  INSERT INTO public.invoice_lines(account_id,invoice_id,kind,description,unit_amount,line_amount)
    VALUES(v_account,v_named_invoice,'merchandise','Synthetic item',100,100);
  UPDATE public.contacts SET name='Newest contact name' WHERE id=v_contact;
  SELECT * INTO v_claim FROM public.reserve_invoice_document(v_named_invoice,v_user);
  IF v_claim.payload_snapshot->'customer'->>'customer_name' <> 'Later edited name' THEN
    RAISE EXCEPTION 'An already captured name was overwritten';
  END IF;

  UPDATE public.contacts SET name=NULL WHERE id=v_contact;
  INSERT INTO public.invoices(id,account_id,contact_id,source,currency)
    VALUES(v_detached_invoice,v_account,v_contact,'sale','INR');
  INSERT INTO public.invoice_lines(account_id,invoice_id,kind,description,unit_amount,line_amount)
    VALUES(v_account,v_detached_invoice,'merchandise','Synthetic item',100,100);
  BEGIN
    PERFORM public.reserve_invoice_document(v_detached_invoice,v_user);
    RAISE EXCEPTION 'A nameless member unexpectedly generated a document';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'Could not make the invoice PDF. Add the member''s name in Profile, then try again.' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.invoice_documents WHERE invoice_id=v_detached_invoice) THEN
    RAISE EXCEPTION 'Missing-name rejection left a document lease';
  END IF;
  -- Remove only the reference, as normal erasure permits; never invent a name.
  UPDATE public.invoices SET contact_id=NULL WHERE id=v_detached_invoice;
  BEGIN
    PERFORM public.reserve_invoice_document(v_detached_invoice,v_user);
    RAISE EXCEPTION 'Detached nameless invoice unexpectedly generated a document';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE '%Contact support with the invoice number.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.reserve_invoice_document(v_invoice,gen_random_uuid());
    RAISE EXCEPTION 'Unrelated actor could read the document';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF has_function_privilege('anon','public.reserve_invoice_document(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.reserve_invoice_document(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.reserve_invoice_document(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Invoice document function grants are incorrect';
  END IF;
END;
$$;
