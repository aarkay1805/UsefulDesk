-- Supabase Storage evaluates SELECT policies under the route operation that
-- reads the object row. Creating a signed download URL uses
-- `storage.object.sign`, while an authenticated direct download uses
-- `storage.object.get_authenticated`.
DROP POLICY IF EXISTS "Authors can read member import draft files"
  ON storage.objects;
CREATE POLICY "Authors can read member import draft files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'member-import-drafts'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'storage.object.get_authenticated',
      'storage.object.sign'
    ])
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
    AND public.is_account_member(
      ((storage.foldername(name))[1])::UUID,
      'agent'
    )
  );
