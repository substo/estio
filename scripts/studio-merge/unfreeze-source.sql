-- Only before target writes, or after reviewed reconciliation of every target write.
-- Never drop target schema or migration history to roll traffic back.
BEGIN;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND (tablename LIKE 'studio\_%' ESCAPE '\' OR tablename LIKE 'platform\_%' ESCAPE '\') ORDER BY tablename LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS studio_merge_write_freeze ON public.%I',t.tablename);
  END LOOP;
END $$;
COMMIT;
