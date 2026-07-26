-- ============================================================
-- Restore avatar upload metadata reads without reopening listing.
--
-- Supabase Storage inserts object metadata with RETURNING. The
-- operation-scoped SELECT policy from the media hardening migration
-- allowed downloads only, so a valid user-folder INSERT was rolled
-- back when Storage could not read its newly created row.
--
-- Keep this policy restricted to authenticated uploads in the
-- caller's own avatar folder. `object.list` remains unauthorized.
-- ============================================================

DROP POLICY IF EXISTS "Users can read their own avatar upload metadata"
  ON storage.objects;
CREATE POLICY "Users can read their own avatar upload metadata"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
    AND storage.allow_any_operation(ARRAY[
      'object.upload',
      'object.upload_update'
    ])
  );
