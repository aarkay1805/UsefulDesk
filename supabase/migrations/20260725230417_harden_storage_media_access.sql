-- ============================================================
-- Harden Storage media access without changing delivery contracts.
--
-- Public buckets remain public because avatars render directly and
-- WhatsApp/Meta fetches chat/flow media asynchronously from persisted
-- public URLs. Public delivery therefore still works for callers that
-- know an exact URL, but Storage API listing is no longer authorized.
--
-- Private receipt buckets keep their signed-URL flow. Their SELECT
-- policies allow exact-object metadata/download operations only, not
-- object.list. Writes retain the product capabilities already enforced
-- elsewhere: payment receipts agent+, expense receipts admin+.
-- ============================================================

UPDATE storage.buckets
SET public = CASE
  WHEN id IN ('avatars', 'chat-media', 'flow-media') THEN TRUE
  ELSE FALSE
END
WHERE id IN (
  'avatars',
  'chat-media',
  'flow-media',
  'payment-receipts',
  'expense-receipts'
);

-- Public delivery buckets: exact-object access remains available through
-- public URLs. This narrow policy also preserves direct authenticated
-- object retrieval without granting object.list.
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Avatar object retrieval without listing"
  ON storage.objects FOR SELECT TO public
  USING (
    bucket_id = 'avatars'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );

DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
CREATE POLICY "Chat media object retrieval without listing"
  ON storage.objects FOR SELECT TO public
  USING (
    bucket_id = 'chat-media'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );

DROP POLICY IF EXISTS "Flow media is publicly readable" ON storage.objects;
CREATE POLICY "Flow media object retrieval without listing"
  ON storage.objects FOR SELECT TO public
  USING (
    bucket_id = 'flow-media'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );

-- Avatar paths remain user-scoped so both self-profile avatars and member
-- photos uploaded by an authorized UI caller continue to work.
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

-- Chat and flow media are operational writes. Require agent capability and
-- the canonical account-<uuid> path. The pre-account-sharing user-id path is
-- intentionally no longer mutable; existing public objects still deliver.
DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Agents can upload chat media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Agents can update chat media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  )
  WITH CHECK (
    bucket_id = 'chat-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Agents can delete chat media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Agents can upload flow media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'flow-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
CREATE POLICY "Agents can update flow media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'flow-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  )
  WITH CHECK (
    bucket_id = 'flow-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
CREATE POLICY "Agents can delete flow media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'flow-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

-- Signed-URL creation and authenticated downloads need SELECT, but listing
-- receipt object names is unnecessary. Keep tenant membership on exact
-- object access and preserve the existing signed-URL application flow.
DROP POLICY IF EXISTS "Account members can read payment receipts"
  ON storage.objects;
CREATE POLICY "Account members can read payment receipts"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Account members can read expense receipts"
  ON storage.objects;
CREATE POLICY "Account members can read expense receipts"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID
      )
      ELSE FALSE
    END
  );

-- Reassert private receipt write policies with explicit roles, capabilities,
-- canonical tenant paths, and the existing persisted-receipt protections.
DROP POLICY IF EXISTS "Agents can upload payment receipts" ON storage.objects;
CREATE POLICY "Agents can upload payment receipts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'agent'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Agents can delete staged payment receipts"
  ON storage.objects;
CREATE POLICY "Agents can delete staged payment receipts"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN
        public.is_account_member(
          SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
          'agent'
        )
        AND (
          public.is_account_member(
            SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
            'admin'
          )
          OR NOT EXISTS (
            SELECT 1
            FROM public.payments p
            WHERE p.receipt_bucket = 'payment-receipts'
              AND p.screenshot_path = storage.objects.name
          )
        )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Admins can upload expense receipts"
  ON storage.objects;
CREATE POLICY "Admins can upload expense receipts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'admin'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Admins can delete staged expense receipts"
  ON storage.objects;
CREATE POLICY "Admins can delete staged expense receipts"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~
        '^account-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN
        public.is_account_member(
          SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
          'admin'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.expenses
          WHERE receipt_bucket = 'expense-receipts'
            AND receipt_path = storage.objects.name
        )
      ELSE FALSE
    END
  );
