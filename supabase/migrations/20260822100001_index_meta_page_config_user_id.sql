-- Cover the nullable connecting-user audit foreign key. PostgreSQL checks
-- referencing rows when an Auth user is deleted, so this keeps ON DELETE
-- SET NULL bounded as Meta Page integrations accumulate.
CREATE INDEX IF NOT EXISTS idx_meta_page_config_user_id
  ON public.meta_page_config (user_id);
