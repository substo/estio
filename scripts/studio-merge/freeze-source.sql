-- Operator-only, old Studio source project. Execute during approved cutover, never deploy automatically.
-- Locks wait for prior writers; committed triggers fence every later web/worker/cron/Mac write.
BEGIN;
CREATE OR REPLACE FUNCTION public.studio_merge_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Studio merge maintenance: writes frozen' USING ERRCODE='55000'; END $$;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND (tablename LIKE 'studio\_%' ESCAPE '\' OR tablename LIKE 'platform\_%' ESCAPE '\') ORDER BY tablename LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',t.tablename);
    EXECUTE format('DROP TRIGGER IF EXISTS studio_merge_write_freeze ON public.%I',t.tablename);
    EXECUTE format('CREATE TRIGGER studio_merge_write_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.studio_merge_frozen()',t.tablename);
  END LOOP;
END $$;
COMMIT;
