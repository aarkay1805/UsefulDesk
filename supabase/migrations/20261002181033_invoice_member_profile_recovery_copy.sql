-- Match the member drawer's Profile tab. Replace only this recovery sentence;
-- the reservation algorithm, existing identity and execution grants stay intact.
DO $migration$
DECLARE
  v_definition TEXT := pg_get_functiondef(
    'public.reserve_invoice_document(uuid,uuid)'::regprocedure
  );
  v_old TEXT := $old$Add the member''s name in Details, then try again.$old$;
  v_new TEXT := $new$Add the member''s name in Profile, then try again.$new$;
BEGIN
  IF strpos(v_definition, v_old) > 0 THEN
    EXECUTE replace(v_definition, v_old, v_new);
  ELSIF strpos(v_definition, v_new) = 0 THEN
    RAISE EXCEPTION 'Invoice member name recovery instruction is missing';
  END IF;
END;
$migration$;
