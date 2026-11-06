BEGIN;
-- Credentials live in encrypted settings secrets (documentation/credentials.md). Deploy after the code that no
-- longer reads or writes these columns is live. Refuses to run while any row still holds a value outside its new
-- home: production on 2026-11-06 had 0 plain passwords/tokens and 1 username, already in its user.crm document.
DO $$
DECLARE
    remaining bigint;
BEGIN
    SELECT count(*) INTO remaining FROM "User"
     WHERE nullif(btrim("crmPassword"), '') IS NOT NULL
        OR nullif(btrim("googleAccessToken"), '') IS NOT NULL
        OR nullif(btrim("googleRefreshToken"), '') IS NOT NULL
        OR nullif(btrim("googleSyncToken"), '') IS NOT NULL
        OR nullif(btrim("outlookAccessToken"), '') IS NOT NULL
        OR nullif(btrim("outlookRefreshToken"), '') IS NOT NULL;
    IF remaining > 0 THEN
        RAISE EXCEPTION 'Refusing to drop legacy credential columns: % user(s) still hold a plain CRM password or OAuth token', remaining;
    END IF;

    SELECT count(*) INTO remaining FROM "User" u
     WHERE nullif(btrim(u."crmUsername"), '') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM settings_documents d
            WHERE d.scope_type = 'USER' AND d.scope_id = u.id AND d.domain = 'user.crm'
       );
    IF remaining > 0 THEN
        RAISE EXCEPTION 'Refusing to drop User.crmUsername: % user(s) have no user.crm settings document', remaining;
    END IF;
END $$;

ALTER TABLE "User"
    DROP COLUMN IF EXISTS "crmUsername",
    DROP COLUMN IF EXISTS "crmPassword",
    DROP COLUMN IF EXISTS "googleAccessToken",
    DROP COLUMN IF EXISTS "googleRefreshToken",
    DROP COLUMN IF EXISTS "googleSyncToken",
    DROP COLUMN IF EXISTS "outlookAccessToken",
    DROP COLUMN IF EXISTS "outlookRefreshToken";

COMMIT;
